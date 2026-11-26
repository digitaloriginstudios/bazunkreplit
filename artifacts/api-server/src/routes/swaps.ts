import { requireAdmin } from "../middlewares/adminAuth.js";
import { randomBytes,createHash } from "node:crypto";
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
 await db.execute(sql`CREATE TABLE IF NOT EXISTS swap_deliveries(offer_id UUID NOT NULL REFERENCES swap_offers(id),sender_email TEXT NOT NULL,method TEXT NOT NULL CHECK(method IN ('shipping','local')),carrier TEXT,tracking TEXT,dispatched_at TIMESTAMPTZ,received_at TIMESTAMPTZ,code_hash TEXT,code_expires TIMESTAMPTZ,PRIMARY KEY(offer_id,sender_email))`);
 await db.execute(sql`CREATE TABLE IF NOT EXISTS swap_events (
 id BIGSERIAL PRIMARY KEY, offer_id UUID NOT NULL REFERENCES swap_offers(id),
 actor_email TEXT NOT NULL, event TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
 await db.execute(sql`CREATE TABLE IF NOT EXISTS swap_messages(id BIGSERIAL PRIMARY KEY,offer_id UUID NOT NULL REFERENCES swap_offers(id),sender_email TEXT NOT NULL,body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
 await db.execute(sql`CREATE INDEX IF NOT EXISTS swap_messages_thread ON swap_messages(offer_id,id DESC)`);
 await db.execute(sql`CREATE TABLE IF NOT EXISTS swap_activity_reads(event_id BIGINT NOT NULL REFERENCES swap_events(id),reader_email TEXT NOT NULL,PRIMARY KEY(event_id,reader_email))`);
 await db.execute(sql`CREATE TABLE IF NOT EXISTS swap_cases(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),offer_id UUID NOT NULL REFERENCES swap_offers(id),opened_by TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('dispute','cancellation')),reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),resolution TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
 await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS swap_open_case ON swap_cases(offer_id) WHERE status='open'`);
 await db.execute(sql`CREATE TABLE IF NOT EXISTS swap_admin_audit(id BIGSERIAL PRIMARY KEY,subject_id UUID NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
 await db.execute(sql`CREATE TABLE IF NOT EXISTS swap_saved(owner_email TEXT NOT NULL,listing_id UUID NOT NULL REFERENCES swap_listings(id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(owner_email,listing_id))`);
 await db.execute(sql`CREATE INDEX IF NOT EXISTS swap_search_idx ON swap_listings USING GIN(to_tsvector('simple',title||' '||description||' '||category||' '||wanted)) WHERE status='active'`);
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
 const q=String(req.query.q??"").trim().slice(0,160),category=String(req.query.category??"").trim().slice(0,100);
 const rows=(await db.execute(sql`SELECT id,title,description,category,condition,wanted,value_minor,currency,created_at FROM swap_listings WHERE status='active' AND (${q}='' OR to_tsvector('simple',title||' '||description||' '||category||' '||wanted) @@ plainto_tsquery('simple',${q})) AND (${category}='' OR lower(category)=lower(${category})) ORDER BY created_at DESC,id LIMIT 50 OFFSET ${offset}`)).rows;
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

router.get("/swaps/saved",async(req,res)=>{
 try{const email=await authenticatedSellerEmail(req,res);if(!email)return;
 res.setHeader("Cache-Control","private, no-store");res.json({items:(await db.execute(sql`SELECT l.id,l.title,l.description,l.category,l.condition,l.wanted,l.value_minor,l.currency,l.status,l.created_at FROM swap_saved s JOIN swap_listings l ON l.id=s.listing_id WHERE s.owner_email=${email} ORDER BY s.created_at DESC LIMIT 100`)).rows});
 }catch{res.status(503).json({error:"Saved swaps unavailable"});}
});
router.post("/swaps/saved/:id",async(req,res)=>{
 try{const email=await authenticatedSellerEmail(req,res);if(!email)return;const id=req.params.id,saved=req.body?.saved;
 if(!uuid(id)||typeof saved!=="boolean"){res.status(400).json({error:"Invalid save request"});return;}
 if(saved){const row=(await db.execute(sql`INSERT INTO swap_saved(owner_email,listing_id) SELECT ${email},id FROM swap_listings WHERE id=${id} AND status='active' AND owner_email<>${email} ON CONFLICT DO NOTHING RETURNING listing_id`)).rows[0];if(!row){const existing=(await db.execute(sql`SELECT listing_id FROM swap_saved WHERE owner_email=${email} AND listing_id=${id}`)).rows[0];if(!existing){res.status(409).json({error:"Listing unavailable to save"});return;}}}
 else await db.execute(sql`DELETE FROM swap_saved WHERE owner_email=${email} AND listing_id=${id}`);
 res.json({saved});
 }catch{res.status(503).json({error:"Could not update saved swaps"});}
});
router.get("/swaps/matches",async(req,res)=>{
 try{const email=await authenticatedSellerEmail(req,res);if(!email)return;
 const rows=(await db.execute(sql`WITH mine AS (SELECT id,title,category,wanted,value_minor FROM swap_listings WHERE owner_email=${email} AND status='active' ORDER BY created_at DESC LIMIT 30),
 candidates AS (SELECT id,title,description,category,condition,wanted,value_minor,currency,created_at FROM swap_listings WHERE owner_email<>${email} AND status='active' ORDER BY created_at DESC LIMIT 3000),
 scored AS (SELECT c.*,m.id AS my_listing_id,m.title AS my_title,
 ts_rank(to_tsvector('simple',c.title||' '||c.category),plainto_tsquery('simple',m.wanted)) AS wanted_score,
 ts_rank(to_tsvector('simple',m.title||' '||m.category),plainto_tsquery('simple',c.wanted)) AS reciprocal_score,
 (CASE WHEN lower(c.category)=lower(m.category) THEN 1 ELSE 0 END) AS category_match,
 abs(c.value_minor-m.value_minor) AS value_gap FROM candidates c CROSS JOIN mine),
 ranked AS (SELECT *,row_number() OVER(PARTITION BY id ORDER BY (wanted_score+reciprocal_score) DESC,category_match DESC,value_gap ASC,my_listing_id) AS rn FROM scored WHERE wanted_score>0 OR reciprocal_score>0 OR category_match=1)
 SELECT id,title,description,category,condition,wanted,value_minor,currency,created_at,my_listing_id,my_title,wanted_score,reciprocal_score,category_match,value_gap FROM ranked WHERE rn=1 ORDER BY (wanted_score+reciprocal_score) DESC,category_match DESC,value_gap ASC,id LIMIT 50`)).rows;
 res.setHeader("Cache-Control","private, no-store");res.json({items:rows});
 }catch{res.status(503).json({error:"Recommendations unavailable"});}
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


router.get("/swaps/offers/:id/delivery",async(req,res)=>{
 try{const email=await authenticatedSellerEmail(req,res);if(!email)return;const id=req.params.id;
 if(!uuid(id)){res.status(400).json({error:"Invalid offer ID"});return;}
 const o=await paymentOffer(id,email);if(!o){res.status(404).json({error:"Offer unavailable"});return;}
 const rows=(await db.execute(sql`SELECT (sender_email=${email}) AS is_mine,carrier,tracking,dispatched_at,received_at,method FROM swap_deliveries WHERE offer_id=${id}`)).rows;
 res.setHeader("Cache-Control","private, no-store");res.json({items:rows,status:o.status,preview:true});
 }catch{res.status(503).json({error:"Delivery status unavailable"});}
});
router.post("/swaps/offers/:id/delivery",async(req,res)=>{
 try{const email=await authenticatedSellerEmail(req,res);if(!email)return;const id=req.params.id;
 if(!uuid(id)){res.status(400).json({error:"Invalid offer ID"});return;}
 // No actual fulfilment until live protection, refunds and payout controls are ready.
 if(process.env.SWAP_TEST_FULFILMENT_ENABLED!=="true"){res.status(503).json({error:"Test fulfilment disabled"});return;}
 const {action,carrier,tracking,code}=req.body??{};
 if(!["dispatch","receive","local_code","local_confirm"].includes(action)){res.status(400).json({error:"Invalid delivery action"});return;}
 if(action==="dispatch"&&(typeof carrier!=="string"||carrier.trim().length<1||carrier.length>80||typeof tracking!=="string"||tracking.trim().length<3||tracking.length>120)){res.status(400).json({error:"Enter carrier and tracking reference"});return;}
 const result=await db.transaction(async tx=>{
 const o=(await tx.execute(sql`SELECT o.*,t.owner_email AS target_email FROM swap_offers o JOIN swap_listings t ON t.id=o.target_id WHERE o.id=${id} FOR UPDATE OF o`)).rows[0];
 if(!o||o.status!=="accepted"||(email!==o.proposer_email&&email!==o.target_email))throw new SwapConflict("Accepted exchange required.");
 const other=String(email===o.proposer_email?o.target_email:o.proposer_email);
 if(Number(o.cash_minor)!==0){const paid=(await tx.execute(sql`SELECT id FROM swap_payments WHERE offer_id=${id} AND status='paid' AND amount_minor=${Math.abs(Number(o.cash_minor))} AND payer_email=${Number(o.cash_minor)>0?o.proposer_email:o.target_email}`)).rows[0];if(!paid)throw new SwapConflict("Verify test payment first.");}
 const method=action.startsWith("local")?"local":"shipping";
 const existing=(await tx.execute(sql`SELECT method FROM swap_deliveries WHERE offer_id=${id} LIMIT 1`)).rows[0];
 if(existing&&existing.method!==method)throw new SwapConflict("Exchange method already selected.");
 let result:{code?:string}={};
 if(action==="dispatch"){
 const row=(await tx.execute(sql`INSERT INTO swap_deliveries(offer_id,sender_email,method,carrier,tracking,dispatched_at) VALUES(${id},${email},'shipping',${carrier.trim()},${tracking.trim()},NOW()) ON CONFLICT DO NOTHING RETURNING offer_id`)).rows[0];if(!row)throw new SwapConflict("Dispatch already recorded.");
 }else if(action==="receive"){
 const row=(await tx.execute(sql`UPDATE swap_deliveries SET received_at=NOW() WHERE offer_id=${id} AND sender_email=${other} AND method='shipping' AND dispatched_at IS NOT NULL AND received_at IS NULL RETURNING offer_id`)).rows[0];if(!row)throw new SwapConflict("No outstanding delivery to confirm.");
 }else if(action==="local_code"){
 const secret=randomBytes(16).toString("hex");
 const row=(await tx.execute(sql`INSERT INTO swap_deliveries(offer_id,sender_email,method,code_hash,code_expires) VALUES(${id},${email},'local',${createHash("sha256").update(secret).digest("hex")},NOW()+INTERVAL '15 minutes') ON CONFLICT(offer_id,sender_email) DO UPDATE SET code_hash=EXCLUDED.code_hash,code_expires=EXCLUDED.code_expires WHERE swap_deliveries.received_at IS NULL AND swap_deliveries.method='local' RETURNING offer_id`)).rows[0];if(!row)throw new SwapConflict("Exchange already confirmed.");result={code:secret};
 }else{
 if(typeof code!=="string"||! /^[a-f0-9]{32}$/.test(code))throw new SwapConflict("Invalid collection code.");
 const row=(await tx.execute(sql`UPDATE swap_deliveries SET received_at=NOW(),code_hash=NULL,code_expires=NULL WHERE offer_id=${id} AND sender_email=${other} AND method='local' AND received_at IS NULL AND code_expires>NOW() AND code_hash=${createHash("sha256").update(code).digest("hex")} RETURNING offer_id`)).rows[0];if(!row)throw new SwapConflict("Invalid or expired collection code.");
 }
 await tx.execute(sql`INSERT INTO swap_events(offer_id,actor_email,event) VALUES(${id},${email},${"test_"+action})`);
 const done=(await tx.execute(sql`SELECT count(*)::int AS total FROM swap_deliveries WHERE offer_id=${id} AND received_at IS NOT NULL`)).rows[0];
 if(Number(done?.total)===2){
 if(Number(o.cash_minor)===0){
 await tx.execute(sql`UPDATE swap_offers SET status='completed',revision=revision+1 WHERE id=${id} AND status='accepted'`);
 await tx.execute(sql`UPDATE swap_listings SET status='completed' WHERE id IN (${o.target_id},${o.offered_id}) AND status='reserved'`);
 await tx.execute(sql`INSERT INTO swap_events(offer_id,actor_email,event) VALUES(${id},${email},'test_exchange_completed')`);
 }else await tx.execute(sql`INSERT INTO swap_events(offer_id,actor_email,event) VALUES(${id},${email},'test_both_receipts_confirmed')`);
 }
 return {...result,bothConfirmed:Number(done?.total)===2};
 });res.json(result);
 }catch(e){res.status(e instanceof SwapConflict?409:503).json({error:e instanceof SwapConflict?e.message:"Delivery update unavailable"});}
});


router.get("/swaps/activity",async(req,res)=>{
 try{const email=await authenticatedSellerEmail(req,res);if(!email)return;
 const rows=(await db.execute(sql`SELECT e.id::text AS id,e.offer_id,e.event,e.created_at,t.title AS target_title,(n.event_id IS NULL) AS unread FROM swap_events e JOIN swap_offers o ON o.id=e.offer_id JOIN swap_listings t ON t.id=o.target_id JOIN swap_listings p ON p.id=o.offered_id LEFT JOIN swap_activity_reads n ON n.event_id=e.id AND n.reader_email=${email} WHERE (t.owner_email=${email} OR p.owner_email=${email}) AND e.actor_email<>${email} ORDER BY e.id DESC LIMIT 100`)).rows;
 res.setHeader("Cache-Control","private, no-store");res.json({items:rows});
 }catch{res.status(503).json({error:"Activity unavailable"});}
});
router.post("/swaps/activity/read",async(req,res)=>{
 try{const email=await authenticatedSellerEmail(req,res);if(!email)return;const ids=req.body?.ids;
 if(!Array.isArray(ids)||ids.length>100||ids.some(x=>typeof x!=="string"||!/^\d{1,18}$/.test(x))){res.status(400).json({error:"Invalid activity IDs"});return;}
 await db.transaction(async tx=>{for(const id of ids)await tx.execute(sql`INSERT INTO swap_activity_reads(event_id,reader_email) SELECT e.id,${email} FROM swap_events e JOIN swap_offers o ON o.id=e.offer_id JOIN swap_listings t ON t.id=o.target_id JOIN swap_listings p ON p.id=o.offered_id WHERE e.id=${id}::bigint AND (t.owner_email=${email} OR p.owner_email=${email}) AND e.actor_email<>${email} ON CONFLICT DO NOTHING`);});res.json({ok:true});
 }catch{res.status(503).json({error:"Could not mark activity read"});}
});
router.get("/swaps/offers/:id/messages",async(req,res)=>{
 try{const email=await authenticatedSellerEmail(req,res);if(!email)return;const id=req.params.id;
 if(!uuid(id)||!await paymentOffer(id,email)){res.status(404).json({error:"Exchange unavailable"});return;}
 const before=req.query.before??"9223372036854775807";
 if(typeof before!=="string"||!/^\d{1,19}$/.test(before)||BigInt(before)>9223372036854775807n){res.status(400).json({error:"Invalid cursor"});return;}
 const rows=(await db.execute(sql`SELECT id::text AS id,body,created_at,(sender_email=${email}) AS is_mine FROM swap_messages WHERE offer_id=${id} AND id<${before}::bigint ORDER BY id DESC LIMIT 50`)).rows;
 res.setHeader("Cache-Control","private, no-store");res.json({items:rows.reverse()});
 }catch{res.status(503).json({error:"Messages unavailable"});}
});
router.post("/swaps/offers/:id/messages",async(req,res)=>{
 try{const email=await authenticatedSellerEmail(req,res);if(!email)return;const id=req.params.id,body=req.body?.body;
 if(!uuid(id)||typeof body!=="string"||!body.trim()||body.trim().length>2000){res.status(400).json({error:"Enter a message of 1–2000 characters"});return;}
 const result=await db.transaction(async tx=>{
 const o=(await tx.execute(sql`SELECT o.status,o.proposer_email,t.owner_email AS target_email FROM swap_offers o JOIN swap_listings t ON t.id=o.target_id WHERE o.id=${id} FOR UPDATE OF o`)).rows[0];
 if(!o||(email!==o.proposer_email&&email!==o.target_email)||!["pending","accepted","disputed"].includes(String(o.status)))throw new SwapConflict("Conversation unavailable.");
 const recent=(await tx.execute(sql`SELECT count(*)::int AS total FROM swap_messages WHERE offer_id=${id} AND sender_email=${email} AND created_at>NOW()-INTERVAL '1 minute'`)).rows[0];
 if(Number(recent?.total)>=10)throw new SwapConflict("Too many messages. Try again in a minute.");
 const row=(await tx.execute(sql`INSERT INTO swap_messages(offer_id,sender_email,body) VALUES(${id},${email},${body.trim()}) RETURNING id::text AS id,body,created_at`)).rows[0];
 await tx.execute(sql`INSERT INTO swap_events(offer_id,actor_email,event) VALUES(${id},${email},'new_message')`);return row;
 });res.status(201).json({...result,is_mine:true});
 }catch(e){res.status(e instanceof SwapConflict?409:503).json({error:e instanceof SwapConflict?e.message:"Message could not be sent"});}
});


router.post("/swaps/offers/:id/dispute",async(req,res)=>{
 try{const email=await authenticatedSellerEmail(req,res);if(!email)return;const id=req.params.id,{reason,kind}=req.body??{};
 if(!uuid(id)||!["dispute","cancellation"].includes(kind)||typeof reason!=="string"||reason.trim().length<10||reason.length>2000){res.status(400).json({error:"Enter a reason of 10–2000 characters"});return;}
 const row=await db.transaction(async tx=>{
 const o=(await tx.execute(sql`SELECT o.*,t.owner_email AS target_email FROM swap_offers o JOIN swap_listings t ON t.id=o.target_id WHERE o.id=${id} FOR UPDATE OF o`)).rows[0];
 if(!o||o.status!=="accepted"||(email!==o.proposer_email&&email!==o.target_email))throw new SwapConflict("Accepted exchange required.");
 const c=(await tx.execute(sql`INSERT INTO swap_cases(offer_id,opened_by,kind,reason) VALUES(${id},${email},${kind},${reason.trim()}) RETURNING id,status`)).rows[0];
 await tx.execute(sql`UPDATE swap_offers SET status='disputed',revision=revision+1 WHERE id=${id}`);
 await tx.execute(sql`INSERT INTO swap_events(offer_id,actor_email,event) VALUES(${id},${email},'case_opened')`);return c;
 });res.status(201).json(row);
 }catch(e){res.status(e instanceof SwapConflict?409:503).json({error:e instanceof SwapConflict?e.message:"Could not open case"});}
});
router.get("/swaps/offers/:id/dispute",async(req,res)=>{
 try{const email=await authenticatedSellerEmail(req,res);if(!email)return;const id=req.params.id;
 if(!uuid(id)||!await paymentOffer(id,email)){res.status(404).json({error:"Exchange unavailable"});return;}
 res.setHeader("Cache-Control","private, no-store");res.json({items:(await db.execute(sql`SELECT id,kind,reason,status,resolution,created_at,updated_at FROM swap_cases WHERE offer_id=${id} ORDER BY created_at DESC`)).rows});
 }catch{res.status(503).json({error:"Cases unavailable"});}
});
router.use("/admin/swaps",requireAdmin,async(_req,res,next)=>{try{await ensureTables();res.setHeader("Cache-Control","private, no-store");next();}catch{res.status(503).json({error:"Swap administration unavailable"});}});
router.get("/admin/swaps",async(req,res)=>{
 try{const offset=Number(req.query.offset??0);if(!Number.isInteger(offset)||offset<0||offset>10000){res.status(400).json({error:"Invalid offset"});return;}
 const [listings,offers,cases,payments]=await Promise.all([
 db.execute(sql`SELECT id,title,status,created_at FROM swap_listings ORDER BY created_at DESC LIMIT 50 OFFSET ${offset}`),
 db.execute(sql`SELECT o.id,o.status,o.cash_minor,t.title AS target_title,p.title AS offered_title,o.created_at FROM swap_offers o JOIN swap_listings t ON t.id=o.target_id JOIN swap_listings p ON p.id=o.offered_id ORDER BY o.created_at DESC LIMIT 50 OFFSET ${offset}`),
 db.execute(sql`SELECT id,offer_id,kind,reason,status,resolution,created_at FROM swap_cases ORDER BY (status='open') DESC,created_at DESC LIMIT 50 OFFSET ${offset}`),
 db.execute(sql`SELECT id,offer_id,amount_minor,fee_minor,status,created_at FROM swap_payments ORDER BY created_at DESC LIMIT 50 OFFSET ${offset}`)]);
 res.json({listings:listings.rows,offers:offers.rows,cases:cases.rows,payments:payments.rows});
 }catch{res.status(503).json({error:"Admin data unavailable"});}
});
router.post("/admin/swaps/listings/:id/withdraw",async(req,res)=>{
 try{const id=req.params.id,reason=req.body?.reason;if(!uuid(id)||typeof reason!=="string"||reason.trim().length<10||reason.length>2000){res.status(400).json({error:"Moderation reason required"});return;}
 await db.transaction(async tx=>{
 const row=(await tx.execute(sql`UPDATE swap_listings SET status='withdrawn' WHERE id=${id} AND status='active' RETURNING id`)).rows[0];if(!row)throw new SwapConflict("Only active listings can be withdrawn.");
 const closed=(await tx.execute(sql`UPDATE swap_offers SET status='declined',revision=revision+1 WHERE status='pending' AND (target_id=${id} OR offered_id=${id}) RETURNING id`)).rows;
 for(const o of closed)await tx.execute(sql`INSERT INTO swap_events(offer_id,actor_email,event) VALUES(${o.id},'admin','listing_moderated')`);
 await tx.execute(sql`INSERT INTO swap_admin_audit(subject_id,action,reason) VALUES(${id},'withdraw_listing',${reason.trim()})`);
 });res.json({ok:true});
 }catch(e){res.status(e instanceof SwapConflict?409:503).json({error:e instanceof SwapConflict?e.message:"Moderation failed"});}
});
router.post("/admin/swaps/cases/:id/resolve",async(req,res)=>{
 try{const id=req.params.id,{action,reason}=req.body??{};if(!uuid(id)||!["resume","cancel"].includes(action)||typeof reason!=="string"||reason.trim().length<10||reason.length>2000){res.status(400).json({error:"Resolution reason required"});return;}
 await db.transaction(async tx=>{
 const initial=(await tx.execute(sql`SELECT o.id,o.target_id,o.offered_id FROM swap_cases c JOIN swap_offers o ON o.id=c.offer_id WHERE c.id=${id}`)).rows[0];if(!initial)throw new SwapConflict("Case unavailable.");
 await tx.execute(sql`SELECT id FROM swap_listings WHERE id IN (${initial.target_id},${initial.offered_id}) ORDER BY id FOR UPDATE`);
 const o=(await tx.execute(sql`SELECT * FROM swap_offers WHERE id=${initial.id} FOR UPDATE`)).rows[0];
 const c=(await tx.execute(sql`SELECT * FROM swap_cases WHERE id=${id} FOR UPDATE`)).rows[0];
 if(!o||o.status!=="disputed"||c?.status!=="open")throw new SwapConflict("Case already resolved.");
 if(action==="cancel"){
 const payment=(await tx.execute(sql`SELECT id FROM swap_payments WHERE offer_id=${o.id} LIMIT 1`)).rows[0];
 const delivery=(await tx.execute(sql`SELECT offer_id FROM swap_deliveries WHERE offer_id=${o.id} LIMIT 1`)).rows[0];
 if(payment||delivery)throw new SwapConflict("Payment or delivery records require manual reconciliation; cancellation blocked.");
 await tx.execute(sql`UPDATE swap_listings SET status='active' WHERE id IN (${o.target_id},${o.offered_id}) AND status='reserved'`);
 }
 await tx.execute(sql`UPDATE swap_offers SET status=${action==="resume"?"accepted":"withdrawn"},revision=revision+1 WHERE id=${o.id}`);
 await tx.execute(sql`UPDATE swap_cases SET status='resolved',resolution=${reason.trim()},updated_at=NOW() WHERE id=${id}`);
 await tx.execute(sql`INSERT INTO swap_admin_audit(subject_id,action,reason) VALUES(${id},${action},${reason.trim()})`);
 await tx.execute(sql`INSERT INTO swap_events(offer_id,actor_email,event) VALUES(${o.id},'admin',${"case_"+action})`);
 });res.json({ok:true});
 }catch(e){res.status(e instanceof SwapConflict?409:503).json({error:e instanceof SwapConflict?e.message:"Resolution failed"});}
});

export default router;
