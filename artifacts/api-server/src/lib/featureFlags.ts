import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const FEATURE_DEFINITIONS = [
  ["social","Bazunk Social","Community"],
  ["social_profiles","Social profiles","Community"],
  ["social_follows","Social follows","Community"],
  ["social_blocks","Social blocking","Community"],
  ["social_reports","Social reports","Community"],
  ["social_notifications","Social notifications","Community"],
  ["swaps","Bazunk Swap (preview)","Selling"],
  ["global_marketplace","Global marketplace catalogue (preview)","Buying"],
  ["quick_sell","Direct Sale","Selling"],["offers","Make an Offer","Selling"],["auctions","Auctions","Selling"],["flash_sales","Flash Sales","Selling"],["classifieds","Classifieds","Selling"],["live","Live selling","Selling"],["product_video","Product Video","Selling"],
  ["snap_sell","Snap & Sell","Tools"],["snap_barcode","Barcode & ISBN Scanning","Tools"],["snap_ai_writing","AI Photo & Writing","Tools"],["snap_background","Photo Background Cleanup","Tools"],["snap_pricing","Seller Pricing & Performance","Tools"],["importers","Importers","Tools"],["promotions","Promotions","Tools"],["watchers","Watch / Watcher offers","Tools"],["messaging","Messaging","Community"],["reviews","Reviews & reputation","Community"],["referrals","Referrals","Rewards"],["games","Rewards Arcade / Games","Rewards"],["credits","Credits","Rewards"],["cashback","Cashback","Rewards"],
  ["chatwoot_support","Chatwoot Live Support","Support"],["homepage_intro","Homepage Intro GIF","Appearance"],
  ["bundles","Bundles","Buying"],["personalized_recommendations","Personalised Recommendations","Buying"],["recently_viewed","Recently Viewed","Buying"],["combined_shipping","Combined Shipping","Buying"],["multi_item_discount","Multi-item Seller Discount","Buying"],["checkout_recovery","Checkout Recovery Messages","Buying"],["deal_pilot","DealPilot personal buying assistant","Buying"],["find_it","Find It reverse marketplace","Buying"],["buyer_protection","Buyer Protection","Buying"],["disputes_returns","Disputes & Returns","Buying"],["verification","Seller verification","Trust"],["trust_proof","TrustProof listing evidence","Trust"],["reputation_insights","Seller Reputation Insights","Trust"]
] as const;

export function resolveFeatureValue(key:string,value:unknown):boolean {
  if(value==null) return key!=="global_marketplace" && key!=="swaps" && key!=="social" && !key.startsWith("social_");
  return String(value).trim().toLowerCase()==="true";
}

export async function featureEnabled(key:string):Promise<boolean>{
  try {
    const r=await db.execute(sql`SELECT value FROM site_settings WHERE key=${`feature_${key}`} LIMIT 1`);
    const v=(r.rows[0] as any)?.value;
    return resolveFeatureValue(key,v);
  } catch (error) {
    // Fail closed if feature settings cannot be read. An absent setting still
    // uses the documented enabled-by-default behaviour above.
    console.error(`Feature flag lookup failed for ${key}; disabling feature`, error);
    return false;
  }
}
