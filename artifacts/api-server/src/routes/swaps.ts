import { getUncachableStripeClient } from "../stripeClient.js";
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { authenticatedSellerEmail } from "../lib/authenticatedSeller.js";
import { featureEnabled } from "../lib/featureFlags.js";
const router=Router();
let setup: Promise<void>|undefined;
function ensureTables(){
 return setup ??= (async()=>{
 await db.execute(sql`CREATE TABLE IF NOT EXISTS swap_listings (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_email TEXT NOT NULL,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 160),
 description TEXT NOT NULL, category TEXT NOT NULL, condition TEXT NOT NULL,
 wanted TEXT NOT NULL, value_minor INTEGER NOT NULL CHECK(value_minor>=0),
 currency TEXT NOT NULL DEFAULT 'GBP' CHECK(currency='GBP'),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','withdrawn','reserved','completed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
 await db.execute(sql`CREATE INDEX IF NOT EXISTS swap_listings_browse ON swap_listings(status,created_at DESC,id)`);
 await db.execute(sql`CREATE INDEX IF NOT EXISTS swap_listings_owner ON swap_listings(owner_email,created_at DESC)`);
 await db.execute(sql`CREATE TABLE IF NOT EXISTS swap_offers (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), target_id UUID NOT NULL REFERENCES swap_listings(id),
 offered_id UUID NOT NULL REFERENCES swap_listings(id), proposer_email TEXT NOT NULL,
 cash_minor INTEGER NOT NULL DEFAULT 0 CHECK(cash_minor BETWEEN -10000000 AND 10000000),
 currency TEXT NOT NULL DEFAULT 'GBP' CHECK(currency='GBP'),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','withdrawn','declined','accepted','completed','disputed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CHECK(target_id<>offered_id))`);
 await db.execute(sql`ALTER TABLE swap_offers ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1`);
 await db.execute(sql`ALTER TABLE swap_offers ADD COLUMN IF NOT EXISTS last_actor_email TEXT`);
 await db.execute(sql`UPDATE swap_offers SET last_actor_email=proposer_email WHERE last_actor_email IS NULL`);
 await db.execute(sql`ALTER TABLE swap_offers ALTER COLUMN last_actor_email SET NOT NULL`);
 await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS swap_pending_pair ON swap_offers(target_id,offered_id) WHERE status='pending'`);
 await db.execute(sql`CREATE TABLE IF NOT EXISTS swap_payments(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),offer_id UUID NOT NULL REFERENCES swap_offers(id),payer_email TEXT NOT NULL,amount_minor INTEGER NOT NULL CHECK(amount_minor>0),fee_minor INTEGER NOT NULL DEFAULT 0 CHECK(fee_minor>=0),session_id TEXT UNIQUE,intent_id TEXT UNIQUE,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','refund_pending','refunded')),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(offer_id,payer_email))`);
 await db.execute(sql`CREATE TABLE IF NOT EXISTS swap_events (
 id BIGSERIAL PRIMARY KEY, offer_id UUID NOT NULL REFERENCES swap_offers(id),
 actor_email TEXT NOT NULL, event TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
 })().catch(e=>{setup=undefined;throw e;});
}
router.use("/swaps",async(_req,res,next)=>{
 if(!await featureEnabled("swaps")){res.status(404).json({error:"Swap unavailable"});return;}
 try{await ensureTables();next();}catch{res.status(503).json({error:"Swap temporarily unavailable"});}
});
router.get("/swaps",async(req,res)=>{
 try{
 const offset=Number(req.query.offset??0);
 if(!Number.isSafeInteger(offset)||offset<0||offset>10000){res.status(400).json({error:"Invalid offset"});return;}
 const rows=(await db.execute(sql`SELECT id,title,description,category,condition,wanted,value_minor,currency,created_at FROM swap_listings WHERE status='active' ORDER BY created_at DESC,id LIMIT 50 OFFSET ${offset}`)).rows;
 res.json({items:rows});
 }catch{res.status(503).json({error:"Swap catalogue unavailable"});}
});
router.get("/swaps/mine",async(req,res)=>{
 try{const email=await authenticatedSellerEmail(req,res);if(!email)return;
 res.setHeader("Cache-Control","private, no-store");
 res.json({items:(await db.execute(sql`SELECT id,title,description,category,condition,wanted,value_minor,currency,status,created_at FROM swap_listings WHERE owner_email=${email} ORDER BY created_at DESC LIMIT 100`)).rows});
 }catch{res.status(503).json({error:"Swap listings unavailable"});}
});
router.post("/swaps",async(req,res)=>{
 try{const email=await authenticatedSellerEmail(req,res);if(!email)return;
 const {title,description,category,condition,wanted,valueMinor}=req.body??{};
 const valid=(v:unknown,min:number,max:number):v is string=>typeof v==="string"&&v.trim().length>=min&&v.trim().length<=max;
 if(!valid(title,3,160)||!valid(description,1,5000)||!valid(category,1,100)||!valid(condition,1,50)||!valid(wanted,1,2000)||!Number.isInteger(valueMinor)||valueMinor<0||valueMinor>10000000){res.status(400).json({error:"Invalid swap listing"});return;}
 const row=(await db.execute(sql`INSERT INTO swap_listings(owner_email,title,description,category,condition,wanted,value_minor) VALUES(${email},${title.trim()},${description.trim()},${category.trim()},${condition.trim()},${wanted.trim()},${valueMinor}) RETURNING id,status,currency`)).rows[0];
 res.status(201).json(row);
 }catch{res.status(503).json({error:"Could not create swap listing"});}
});
router.get("/swaps/:id",async(req,res)=>{
 try{
 const id=req.params.id;
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)){res.status(400).json({error:"Invalid swap ID"});return;}
 const row=(await db.execute(sql`SELECT id,title,description,category,condition,wanted,value_minor,currency,created_at FROM swap_listings WHERE id=${id} AND status='active'`)).rows[0];
 if(!row){res.status(404).json({error:"Swap not found"});return;}res.json(row);
 }catch{res.status(503).json({error:"Swap unavailable"});}
});

// Positive cash means the original proposer pays the target owner; negative reverses it.
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
class SwapConflict extends Error {}
router.get("/swaps/offers/mine",async(req,res)=>{
 try{const email=await authenticatedSellerEmail(req,res);if(!email)return;
 res.setHeader("Cache-Control","private, no-store");
 const rows=(await db.execute(sql`SELECT o.id,o.target_id,o.offered_id,o.cash_minor,o.status,o.revision,o.created_at,t.title AS target_title,p.title AS offered_title,
 (o.proposer_email=${email}) AS is_proposer,(o.last_actor_email=${email}) AS is_last_actor
 FROM swap_offers o JOIN swap_listings t ON t.id=o.target_id JOIN swap_listings p ON p.id=o.offered_id
 WHERE t.owner_email=${email} OR p.owner_email=${email} ORDER BY o.created_at DESC LIMIT 100`)).rows;
 res.json({items:rows});
 }catch{res.status(503).json({error:"Offers unavailable"});}
});
router.post("/swaps/offers",async(req,res)=>{
 try{const email=await authenticatedSellerEmail(req,res);if(!email)return;
 const {targetId,offeredId,cashMinor}=req.body??{};
 if(!uuid(targetId)||!uuid(offeredId)||targetId.toLowerCase()===offeredId.toLowerCase()||!Number.isInteger(cashMinor)||Math.abs(cashMinor)>10000000){res.status(400).json({error:"Invalid proposal"});return;}
 const result=await db.transaction(async tx=>{
 const items=(await tx.execute(sql`SELECT id,owner_email,status FROM swap_listings WHERE id IN (${targetId},${offeredId}) ORDER BY id FOR UPDATE`)).rows;
 const target=items.find(x=>x.id===targetId.toLowerCase()),offered=items.find(x=>x.id===offeredId.toLowerCase());
 if(!target||!offered||target.status!=="active"||offered.status!=="active"||offered.owner_email!==email||target.owner_email===email)throw new SwapConflict("Items are unavailable or not eligible.");
 const duplicate=(await tx.execute(sql`SELECT id FROM swap_offers WHERE status='pending' AND ((target_id=${targetId} AND offered_id=${offeredId}) OR (target_id=${offeredId} AND offered_id=${targetId}))`)).rows[0];
 if(duplicate)throw new SwapConflict("A proposal already exists for these items.");
 const row=(await tx.execute(sql`INSERT INTO swap_offers(target_id,offered_id,proposer_email,last_actor_email,cash_minor) VALUES(${targetId},${offeredId},${email},${email},${cashMinor}) RETURNING id,status,revision`)).rows[0];
 await tx.execute(sql`INSERT INTO swap_events(offer_id,actor_email,event) VALUES(${row.id},${email},${JSON.stringify({action:"proposed",cashMinor,revision:1})})`);
 return row;
 });res.status(201).json(result);
 }catch(e){res.status(e instanceof SwapConflict?409:503).json({error:e instanceof SwapConflict?e.message:"Could not submit proposal"});}
});
router.post("/swaps/offers/:id/action",async(req,res)=>{
 try{const email=await authenticatedSellerEmail(req,res);if(!email)return;
 const id=req.params.id,{action,revision,cashMinor}=req.body??{};
 if(!uuid(id)||!["counter","accept","decline","withdraw"].includes(action)||!Number.isInteger(revision)||revision<1||(action==="counter"&&(!Number.isInteger(cashMinor)||Math.abs(cashMinor)>10000000))){res.status(400).json({error:"Invalid action"});return;}
 const result=await db.transaction(async tx=>{
 // Always lock listings before offers, in stable ID order, including creation.
 const initial=(await tx.execute(sql`SELECT target_id,offered_id FROM swap_offers WHERE id=${id}`)).rows[0];
 if(!initial)throw new SwapConflict("Offer unavailable.");
 const items=(await tx.execute(sql`SELECT id,owner_email,status FROM swap_listings WHERE id IN (${initial.target_id},${initial.offered_id}) ORDER BY id FOR UPDATE`)).rows;
 const o=(await tx.execute(sql`SELECT * FROM swap_offers WHERE id=${id} FOR UPDATE`)).rows[0];
 if(!o||!items.some(x=>x.owner_email===email)||o.status!=="pending"||Number(o.revision)!==revision)throw new SwapConflict("Offer unavailable or changed. Refresh and try again.");
 if(action==="withdraw"?o.last_actor_email!==email:o.last_actor_email===email)throw new SwapConflict("This action is not available on your turn.");
 if((action==="accept"||action==="counter")&&(items.length!==2||items.some(x=>x.status!=="active")))throw new SwapConflict("An item is no longer available.");
 const status=action==="accept"?"accepted":action==="decline"?"declined":action==="withdraw"?"withdrawn":"pending";
 const nextCash=action==="counter"?cashMinor:o.cash_minor;
 if(action==="accept"){
 await tx.execute(sql`UPDATE swap_listings SET status='reserved' WHERE id IN (${o.target_id},${o.offered_id})`);
 const closed=(await tx.execute(sql`UPDATE swap_offers SET status='declined',revision=revision+1 WHERE id<>${id} AND status='pending' AND (target_id IN (${o.target_id},${o.offered_id}) OR offered_id IN (${o.target_id},${o.offered_id})) RETURNING id`)).rows;
 for(const c of closed)await tx.execute(sql`INSERT INTO swap_events(offer_id,actor_email,event) VALUES(${c.id},${email},'item_reserved')`);
 }
 const row=(await tx.execute(sql`UPDATE swap_offers SET status=${status},cash_minor=${nextCash},last_actor_email=${email},revision=revision+1 WHERE id=${id} RETURNING id,status,revision,cash_minor`)).rows[0];
 await tx.execute(sql`INSERT INTO swap_events(offer_id,actor_email,event) VALUES(${id},${email},${JSON.stringify({action,cashMinor:nextCash,revision:revision+1})})`);
 return row;
 });res.json(result);
 }catch(e){res.status(e instanceof SwapConflict?409:503).json({error:e instanceof SwapConflict?e.message:"Could not update offer"});}
});
router.get("/swaps/offers/:id/history",async(req,res)=>{
 try{const email=await authenticatedSellerEmail(req,res);if(!email)return;const id=req.params.id;
 if(!uuid(id)){res.status(400).json({error:"Invalid offer ID"});return;}
 const allowed=(await db.execute(sql`SELECT o.id FROM swap_offers o JOIN swap_listings t ON t.id=o.target_id JOIN swap_listings p ON p.id=o.offered_id WHERE o.id=${id} AND (t.owner_email=${email} OR p.owner_email=${email})`)).rows[0];
 if(!allowed){res.status(404).json({error:"Offer not found"});return;}
 res.setHeader("Cache-Control","private, no-store");
 res.json({items:(await db.execute(sql`SELECT event,created_at,(actor_email=${email}) AS is_mine FROM swap_events WHERE offer_id=${id} ORDER BY id`)).rows});
 }catch{res.status(503).json({error:"History unavailable"});}
});


async function paymentOffer(id:string,email:string){
 return (await db.execute(sql`SELECT o.id,o.cash_minor,o.status,o.proposer_email,t.owner_email AS target_email FROM swap_offers o JOIN swap_listings t ON t.id=o.target_id JOIN swap_listings p ON p.id=o.offered_id WHERE o.id=${id} AND (t.owner_email=${email} OR p.owner_email=${email})`)).rows[0];
}
async function paymentRecord(id:string,email:string){
 return (await db.execute(sql`SELECT * FROM swap_payments WHERE offer_id=${id} AND payer_email=${email}`)).rows[0];
}
router.get("/swaps/offers/:id/payment",async(req,res)=>{
 try{const email=await authenticatedSellerEmail(req,res);if(!email)return;const id=req.params.id;
 if(!uuid(id)){res.status(400).json({error:"Invalid offer ID"});return;}
 const o=await paymentOffer(id,email);if(!o){res.status(404).json({error:"Offer unavailable"});return;}
 const rows=(await db.execute(sql`SELECT amount_minor,fee_minor,status,(payer_email=${email}) AS is_mine FROM swap_payments WHERE offer_id=${id}`)).rows;
 res.setHeader("Cache-Control","private, no-store");res.json({status:o.status,cashMinor:o.cash_minor,payments:rows,testEnabled:process.env.SWAP_TEST_PAYMENTS_ENABLED==="true"});
 }catch{res.status(503).json({error:"Payment status unavailable"});}
});
router.post("/swaps/offers/:id/payment/checkout",async(req,res)=>{
 try{const email=await authenticatedSellerEmail(req,res);if(!email)return;const id=req.params.id;
 if(!uuid(id)){res.status(400).json({error:"Invalid offer ID"});return;}
 if(process.env.SWAP_TEST_PAYMENTS_ENABLED!=="true"){res.status(503).json({error:"Swap payments are disabled"});return;}
 const stripe=await getUncachableStripeClient();
 // Explicitly refuse live-mode keys: fulfilment and payout are not implemented.
 const accountBalance=await stripe.balance.retrieve();
 if(accountBalance.livemode){res.status(503).json({error:"Swap checkout requires Stripe test mode"});return;}
 const o=await paymentOffer(id,email);if(!o||o.status!=="accepted"){res.status(409).json({error:"Accepted offer required"});return;}
 const cash=Number(o.cash_minor),payer=cash>0?o.proposer_email:o.target_email;
 if(!cash||payer!==email||Math.abs(cash)<30){res.status(409).json({error:"No payable cash adjustment, or below the Stripe minimum"});return;}
 // Fee remains zero until the two-sided protection policy is approved.
 await db.execute(sql`INSERT INTO swap_payments(offer_id,payer_email,amount_minor,fee_minor) VALUES(${id},${email},${Math.abs(cash)},0) ON CONFLICT(offer_id,payer_email) DO NOTHING`);
 const p=await paymentRecord(id,email);if(!p||p.status!=="pending"){res.status(409).json({error:"Payment already processed or closed"});return;}
 if(Date.now()-new Date(String(p.created_at)).getTime()>23*3600000){res.status(409).json({error:"Checkout recovery window elapsed; contact support"});return;}
 const session=p.session_id?await stripe.checkout.sessions.retrieve(String(p.session_id)):await stripe.checkout.sessions.create({
 mode:"payment",payment_method_types:["card"],customer_email:email,
 line_items:[{price_data:{currency:"gbp",unit_amount:Number(p.amount_minor)+Number(p.fee_minor),product_data:{name:"Bazunk Swap test cash adjustment"}},quantity:1}],
 metadata:{kind:"bazunk_swap",offer_id:id,payment_id:String(p.id)},
 success_url:"https://bazunk.com/dashboard/swaps?payment=return",cancel_url:"https://bazunk.com/dashboard/swaps?payment=cancel"
 },{idempotencyKey:"swap-test-"+String(p.id)});
 await db.execute(sql`UPDATE swap_payments SET session_id=${session.id} WHERE id=${p.id} AND (session_id IS NULL OR session_id=${session.id})`);
 if(session.livemode||session.status!=="open"||!session.url){res.status(409).json({error:"Checkout is closed; verify payment status"});return;}
 res.json({url:session.url});
 }catch{res.status(503).json({error:"Could not open test checkout"});}
});
router.post("/swaps/offers/:id/payment/verify",async(req,res)=>{
 try{const email=await authenticatedSellerEmail(req,res);if(!email)return;const id=req.params.id;
 if(!uuid(id)){res.status(400).json({error:"Invalid offer ID"});return;}
 const p=await paymentRecord(id,email);if(!p||!p.session_id){res.status(404).json({error:"Payment unavailable"});return;}
 const stripe=await getUncachableStripeClient(),s=await stripe.checkout.sessions.retrieve(String(p.session_id));
 if(s.livemode||s.metadata?.kind!=="bazunk_swap"||s.metadata?.offer_id!==id||s.metadata?.payment_id!==String(p.id)||s.currency!=="gbp"||s.amount_total!==Number(p.amount_minor)+Number(p.fee_minor)){res.status(409).json({error:"Payment verification mismatch"});return;}
 if(s.payment_status==="paid"&&s.status==="complete"&&typeof s.payment_intent==="string"){
 await db.execute(sql`UPDATE swap_payments SET status='paid',intent_id=${s.payment_intent},updated_at=NOW() WHERE id=${p.id} AND status='pending'`);
 }
 const latest=await paymentRecord(id,email);res.json({status:latest?.status});
 }catch{res.status(503).json({error:"Payment verification unavailable"});}
});

export default router;
