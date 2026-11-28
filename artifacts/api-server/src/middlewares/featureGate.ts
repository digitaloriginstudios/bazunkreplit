import type { Request,Response,NextFunction } from "express";
import { featureEnabled } from "../lib/featureFlags.js";
const rules:[RegExp,string][]=[
 [/^\/social(?:\/|$)/i,"social"],
 [/^\/social\/(?:profile|people|seller)(?:\/|$)/i,"social_profiles"],
 [/^\/social\/(?:feed|posts)(?:\/|$)/i,"social_profiles"],
 [/^\/social\/(?:feed|posts)(?:\/|$)/i,"social_feed"],
 [/^\/social\/posts\/[^/]+\/comments(?:\/|$)/i,"social_comments"],
 [/^\/social\/creators(?:\/|$)/i,"social_creators"],
 [/^\/social\/stories(?:\/|$)/i,"social_stories"],
 [/^\/social\/polls(?:\/|$)/i,"social_polls"],
 [/^\/social\/collections(?:\/|$)/i,"social_collections"],
 [/^\/social\/blocks(?:\/|$)/i,"social_blocks"],
 [/^\/swaps(?:\/|$)/,"swaps"],
 [/^\/discovery\/recommendations(?:\/|$)/,"personalized_recommendations"],
 [/^\/discovery\/wishlist(?:\/|$)|^\/watch-alerts(?:\/|$)/,"watchers"],
 [/^\/seller\/bundle-policy(?:\/|$)/,"bundles"],
 [/^\/chatwoot(?:\/|$)/,"chatwoot_support"],
 [/^\/snap-sell(?:\/|$)/,"snap_sell"],
 [/^\/snap-sell\/lookup(?:\/|$)/,"snap_barcode"],
 [/^\/snap-sell\/(?:analyse|write|quality)(?:\/|$)/,"snap_ai_writing"],
 [/^\/snap-sell\/background(?:\/|$)/,"snap_background"],
 [/^\/snap-sell\/(?:pricing|performance)(?:\/|$)/,"snap_pricing"],
 [/^\/checkout-recovery\/save(?:\/|$)/,"checkout_recovery"],
 [/^\/trust-proof(?:\/|$)/,"trust_proof"],
 [/^\/deal-pilot(?:\/|$)/,"deal_pilot"],[/^\/find-it(?:\/|$)/,"find_it"],
 [/^\/auctions(?:\/|$)/,"auctions"],[/^\/flash-sales(?:\/|$)/,"flash_sales"],[/^\/classifieds(?:\/|$)/,"classifieds"],[/^\/live(?:\/|$)|^\/livekit(?:\/|$)|^\/live-commerce(?:\/|$)/,"live"],
 [/^\/rewards(?:\/|$)|^\/treasure-hunt(?:\/|$)/,"games"],[/^\/referrals(?:\/|$)/,"referrals"],[/^\/promotions(?:\/|$)/,"promotions"],
 [/^\/watch(?:ers)?(?:\/|$)/,"watchers"],[/^\/messages(?:\/|$)/,"messaging"],[/^\/reviews(?:\/|$)/,"reviews"],[/^\/verification(?:\/|$)/,"verification"],
 [/^\/disputes(?:\/|$)|^\/returns(?:\/|$)/,"disputes_returns"],[/^\/user\/(?:search|import)|^\/user\/rapidapi/,"importers"]
];
export async function featureGate(req:Request,res:Response,next:NextFunction){
 if(req.path.startsWith('/admin')||req.path==='/settings/public'||req.path.startsWith('/health')) return next();
 const hits=rules.filter(([r])=>r.test(req.path));
 if(req.path==="/offers" && req.method==="POST") hits.push([/^\/offers$/,"offers"]);
 for(const [,key] of hits){
   if(!(await featureEnabled(key))){res.status(503).json({error:"Feature temporarily unavailable",feature:key,disabled:true});return;}
 }
 next();
}
