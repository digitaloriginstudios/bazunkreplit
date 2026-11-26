import {Router} from "express";
import {db} from "@workspace/db";
import {sql} from "drizzle-orm";
import {requireAdmin} from "../middlewares/adminAuth.js";
import {recordAdminAudit} from "../lib/adminAudit.js";
import {shippingCountry,shippingZone,shipsToCountry} from "../lib/listingShipping.js";
const router=Router();
const codes=["GBP","USD","EUR","AUD","CAD","NZD","CHF"];
const countries=["GB","US","IE","AU","CA","NZ","CH","DE","FR","IT","ES","NL","BE","PT","AT","FI","GR","LU"];
const defaults={countries:countries.map(code=>({code,enabled:true,currency:({GB:"GBP",US:"USD",AU:"AUD",CA:"CAD",NZ:"NZD",CH:"CHF"} as Record<string,string>)[code]||"EUR"})),currencies:codes.map(code=>({code,enabled:true})),zones:["domestic","worldwide","eu","eu-only","europe","north-america","asia"].map(code=>({code,label:code,notes:""}))};
async function load(){const row=(await db.execute(sql`SELECT value FROM site_settings WHERE key='international_marketplace_config'`)).rows[0];return row?JSON.parse(String(row.value)):defaults;}
router.get("/admin/international-marketplace",requireAdmin,async(_req,res)=>{try{res.setHeader("Cache-Control","no-store");res.json(await load());}catch{res.status(503).json({error:"Configuration unavailable"});}});
router.put("/admin/international-marketplace",requireAdmin,async(req,res)=>{try{
 const v=req.body;
 if(!Array.isArray(v?.countries)||!Array.isArray(v?.currencies)||!Array.isArray(v?.zones)||v.countries.length!==countries.length||v.currencies.length!==codes.length||v.zones.length>100)return void res.status(400).json({error:"Invalid configuration"});
 const cs=v.currencies.map((x:any)=>({code:x?.code,enabled:x?.enabled}));
 const ct=v.countries.map((x:any)=>({code:x?.code,enabled:x?.enabled,currency:x?.currency}));
 const zs=v.zones.map((x:any)=>({code:shippingZone(x?.code),label:typeof x?.label==="string"?x.label.trim().slice(0,80):"",notes:typeof x?.notes==="string"?x.notes.slice(0,500):""}));
 if(new Set(cs.map((x:any)=>x.code)).size!==codes.length||cs.some((x:any)=>!codes.includes(x.code)||typeof x.enabled!=="boolean")||!cs.some((x:any)=>x.code==="GBP"&&x.enabled)||new Set(ct.map((x:any)=>x.code)).size!==countries.length||ct.some((x:any)=>!countries.includes(x.code)||typeof x.enabled!=="boolean"||!codes.includes(x.currency)||(x.enabled&&!cs.some((y:any)=>y.code===x.currency&&y.enabled)))||!ct.some((x:any)=>x.enabled)||zs.some((x:any)=>!x.code||!x.label)||new Set(zs.map((x:any)=>x.code)).size!==zs.length)return void res.status(400).json({error:"Check country, currency and zone settings. GBP must stay enabled."});
 const next={countries:ct,currencies:cs,zones:zs};const before=await load();
 await db.execute(sql`INSERT INTO site_settings(key,value,updated_at) VALUES('international_marketplace_config',${JSON.stringify(next)},NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`);
 await recordAdminAudit({req,category:"settings",action:"international.update",targetType:"site_settings",targetId:"international_marketplace_config",summary:"Updated international marketplace configuration",before,after:next});
 res.json(next);
 }catch{res.status(503).json({error:"Could not save configuration"});}});
router.get("/admin/international-marketplace/shipping-check",requireAdmin,(req,res)=>{const origin=shippingCountry(req.query.origin),destination=shippingCountry(req.query.destination),zone=shippingZone(req.query.zone);if(!origin||!destination||!zone)return void res.status(400).json({error:"Enter valid country codes and shipping zone"});res.json({origin,destination,zone,eligible:shipsToCountry(zone,origin,destination)});});
const regionalFeatures=["auctions","flash_sales","classifieds","live","offers","promotions","personalized_recommendations"];
async function regionalConfig(){const row=(await db.execute(sql`SELECT value FROM site_settings WHERE key='international_growth_config'`)).rows[0];return row?JSON.parse(String(row.value)):{promotions:[],controls:{}};}
router.get("/admin/international-growth",requireAdmin,async(_req,res)=>{try{res.json(await regionalConfig());}catch{res.status(503).json({error:"Configuration unavailable"});}});
router.put("/admin/international-growth",requireAdmin,async(req,res)=>{try{
 const {promotions,controls}=req.body||{};
 if(!Array.isArray(promotions)||promotions.length>100||!controls||typeof controls!=="object"||Array.isArray(controls))return void res.status(400).json({error:"Invalid configuration"});
 if(promotions.some((p:any)=>!countries.includes(p?.country)||typeof p.title!=="string"||!p.title.trim()||p.title.length>100||typeof p.text!=="string"||p.text.length>300||typeof p.enabled!=="boolean"||!["/deals","/browse","/new-arrivals","/flash-sales"].includes(p.href)))return void res.status(400).json({error:"Invalid promotion"});
 for(const [country,flags] of Object.entries(controls)){if(!countries.includes(country)||!flags||typeof flags!=="object"||Array.isArray(flags)||Object.entries(flags).some(([key,value])=>!regionalFeatures.includes(key)||typeof value!=="boolean"))return void res.status(400).json({error:"Invalid regional feature control"});}
 const next={promotions:promotions.map((p:any)=>({country:p.country,title:p.title,text:p.text,enabled:p.enabled,href:p.href})),controls};const before=await regionalConfig();
 await db.execute(sql`INSERT INTO site_settings(key,value,updated_at) VALUES('international_growth_config',${JSON.stringify(next)},NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`);
 await recordAdminAudit({req,category:"settings",action:"international.growth",targetType:"site_settings",targetId:"international_growth_config",summary:"Updated regional promotions and feature controls",before,after:next});res.json(next);
 }catch{res.status(503).json({error:"Save failed"});}});
router.get("/public/international-growth",async(req,res)=>{try{const country=shippingCountry(req.query.country);if(!country||!countries.includes(country))return void res.status(400).json({error:"Invalid country"});const config=await regionalConfig();res.setHeader("Cache-Control","no-store");res.json({promotions:config.promotions.filter((p:any)=>p.country===country&&p.enabled),controls:config.controls[country]||{}});}catch{res.status(503).json({error:"Regional settings unavailable"});}});
router.get("/admin/international-sales",requireAdmin,async(_req,res)=>{try{
 const rows=await db.execute(sql`SELECT CASE WHEN upper(trim(split_part(reverse(coalesce(address,'')),chr(10),1)))='' THEN 'Unknown' WHEN upper(trim(reverse(split_part(reverse(coalesce(address,'')),chr(10),1)))) ~ '^[A-Z]{2}
 THEN upper(trim(reverse(split_part(reverse(address),chr(10),1)))) ELSE 'Unknown' END AS country, count(*)::int AS order_lines, count(*) FILTER (WHERE transaction_currency='GBP')::int AS verified_gbp_lines, coalesce(sum(buyer_total) FILTER (WHERE transaction_currency='GBP'),0)::text AS recorded_gbp_total FROM orders WHERE created_at >= NOW()-interval '30 days' GROUP BY 1 ORDER BY 2 DESC`);
 res.json({days:30,rows:rows.rows});}catch{res.status(503).json({error:"Sales analytics unavailable"});}});
export default router;
