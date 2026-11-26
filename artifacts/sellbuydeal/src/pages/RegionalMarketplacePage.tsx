import {Link} from "wouter";
import {Navbar} from "@/components/Navbar";
import {Footer} from "@/components/Footer";
import {useCurrency} from "@/context/CurrencyContext";
import {useSeoMetadata} from "@/hooks/useSeoMetadata";
export const regionalMarkets = [["uk","United Kingdom","GB","GBP","en-GB","Browse marketplace products for UK shoppers, compare domestic delivery options and check postage before buying."],["us","United States","US","USD","en-US","Discover marketplace products for US shoppers, check international shipping eligibility and review estimated dollar prices."],["ireland","Ireland","IE","EUR","en-IE","Explore marketplace shopping for Ireland, check delivery from overseas sellers and review estimated euro prices."],["canada","Canada","CA","CAD","en-CA","Discover marketplace listings for Canadian shoppers and check shipping eligibility and estimated Canadian dollar prices."],["australia","Australia","AU","AUD","en-AU","Explore marketplace listings for Australian shoppers, compare overseas delivery options and estimated Australian dollar prices."]] as const;
export function RegionalMarketplacePage({slug}:{slug:string}){
 const market=regionalMarkets.find(r=>r[0]===slug);
 const {setCountry}=useCurrency();
 const title=market?"Shop online in "+market[1]+" | Bazunk":"International marketplace | Bazunk";
 const url="https://www.bazunk.com/marketplace/"+slug;
 useSeoMetadata(market?{title,description:market[5],url}:null);
 if(!market)return null;
 const [,name,country,currency,,description]=market;
 return <><Navbar/><main className="mx-auto max-w-6xl px-4 py-10 space-y-8">
 <section className="rounded-2xl bg-blue-50 border border-blue-100 p-6 md:p-12"><p className="font-semibold text-blue-700">Bazunk international marketplace</p><h1 className="text-3xl md:text-5xl font-bold text-slate-900 mt-3">Shop online in {name}</h1><p className="mt-4 text-slate-700 max-w-2xl">{description}</p><Link href={"/browse?deliveryMode=ships-to-me&region="+(country==="US"?"us":"uk")} onClick={()=>setCountry(country)} className="inline-block mt-6 rounded-xl bg-orange-600 text-white font-bold px-6 py-3">Browse products for {name}</Link></section>
 <section className="grid gap-4 md:grid-cols-3">{[["Delivery","Check each seller's shipping destinations and delivery costs before ordering."],["Currency","Choose "+currency+" for estimated display prices. Payments are settled in GBP."],["International orders","Import duties, taxes and delivery times may vary. Review the listing and checkout details."]].map(([heading,body])=><article key={heading} className="rounded-xl border p-5"><h2 className="font-bold text-xl">{heading}</h2><p className="mt-2 text-slate-600">{body}</p></article>)}</section>
 <section><h2 className="text-2xl font-bold mb-4">Explore Bazunk</h2><div className="flex flex-wrap gap-3">{[["/deals","Latest deals"],["/new-arrivals","New arrivals"],["/auctions","Auctions"],["/buyer-protection","Buyer protection"]].map(([href,label])=><Link key={href} href={href} className="rounded-lg border px-4 py-3 text-blue-700">{label}</Link>)}</div></section>
 <section><h2 className="text-xl font-bold mb-3">Other regional marketplaces</h2><div className="flex flex-wrap gap-4">{regionalMarkets.filter(r=>r[0]!==slug).map(r=><Link key={r[0]} href={"/marketplace/"+r[0]} className="text-blue-700 underline">{r[1]}</Link>)}</div></section>
 </main><Footer/></>;
}
