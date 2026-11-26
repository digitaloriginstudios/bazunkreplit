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
 await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS swap_pending_pair ON swap_offers(target_id,offered_id) WHERE status='pending'`);
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
export default router;
