import { Link } from "wouter";
import { useRawSettings, useSettingsLoaded } from "@/context/SiteSettingsContext";
import { Power } from "lucide-react";
export function isFeatureEnabled(settings: Record<string,string>, key:string){ return settings[`feature_${key}`] === "true"; }
export function useFeature(key:string){ const settings=useRawSettings(); const loaded=useSettingsLoaded(); return loaded && isFeatureEnabled(settings, key); }
export function FeatureVisible({feature,children}:{feature:string;children:React.ReactNode}){ return useFeature(feature) ? <>{children}</> : null; }
export function featureForHref(href:string):string|undefined {
  const [path,query=""]=href.split("?");
  const section=new URLSearchParams(query).get("section");
  if(path==="/swap"||path.startsWith("/swap/")||path==="/dashboard/swaps") return "swaps";
  if(path==="/dashboard" && section==="go-live") return "live";
  if(path==="/sell/snap") return "snap_sell";
  if(path==="/sell/quick" || path==="/sell/direct") return "quick_sell";
  if(path==="/bundle") return "bundles";
  if(path==="/credits") return "credits";
  if(path==="/rewards/referrals") return "referrals";

  if(path.startsWith("/trust-proof")) return "trust_proof";
  if(path.startsWith("/deal-pilot")) return "deal_pilot";
  if(path.startsWith("/find-it")) return "find_it";
  if(path.startsWith("/live")) return "live";
  if(path==="/99p-auctions" || path==="/ending-soon") return "auctions";
  if(path.startsWith("/auctions")) return "auctions";
  if(path.startsWith("/flash-sales")) return "flash_sales";
  if(path.startsWith("/classifieds")) return "classifieds";
  if(path.startsWith("/offers")) return "offers";
  if(path.startsWith("/messages")) return "messaging";
  if(path.startsWith("/importers")) return "importers";
  if(path.startsWith("/buyer-protection")) return "buyer_protection";
  if(path.startsWith("/referrals")) return "referrals";
  if(path.startsWith("/rewards")) return "games";
  if(path.startsWith("/promotions")) return "promotions";
  return undefined;
}
export function FeatureGate({feature,name,children}:{feature:string;name:string;children:React.ReactNode}){const loaded=useSettingsLoaded();const on=useFeature(feature);if(!loaded)return <div role="status" className="min-h-[30vh] flex items-center justify-center text-muted-foreground">Checking availability…</div>;if(on)return <>{children}</>;return <div className="min-h-[65vh] flex items-center justify-center p-6"><div className="max-w-md text-center bg-card border rounded-2xl p-8 shadow-sm"><Power className="w-10 h-10 mx-auto mb-3 text-muted-foreground"/><h1 className="text-2xl font-bold">{name} is temporarily unavailable</h1><p className="text-muted-foreground mt-2">This feature is currently unavailable.</p><Link href="/" className="inline-block mt-5 px-4 py-2 rounded-xl bg-[#F26B21] text-white font-semibold">Back to Bazunk</Link></div></div>}
