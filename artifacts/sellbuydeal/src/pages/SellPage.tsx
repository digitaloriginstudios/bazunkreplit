import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { useRawSettings } from "@/context/SiteSettingsContext";
import { featureForHref, isFeatureEnabled } from "@/components/FeatureGate";
import { Link, useLocation, useSearch } from "wouter";
import {
  ArrowLeftRight, Camera,
  ShoppingCart,
  Gavel,
  Layers,
  Newspaper,
  Store,
  ArrowRight,
  Globe,
  Headphones,
  ShieldCheck,
  Tag,
  CreditCard,
  TrendingUp,
  Calculator,
  Banknote,
  Percent,
  Zap, Video, X, Maximize2, Minimize2, Package, Users, Truck, Star, Sparkles, ClipboardList, Gift, ShoppingBag,
} from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useCurrency } from "@/context/CurrencyContext";

const SELLER_TOOLS = [
  { title: "Create a Store", description: "Set up your own branded Bazunk shop.", href: "/dashboard?section=my-store", icon: Store },
  { title: "Manage Listings", description: "Review your listings and drafts.", href: "/dashboard?section=my-listings", icon: ClipboardList },
  { title: "Import Listings", description: "Bring products over from other marketplaces.", href: "/importers", icon: Package },
  { title: "Bulk Import", description: "Upload a CSV and preview your listings before publishing.", href: "/sell/import", icon: Layers },
  { title: "Snap & Sell", description: "Use a photo or barcode to start an editable listing.", href: "/sell/snap", icon: Camera },
  { title: "Create a Bundle", description: "Group multiple items together as a bundle deal.", href: "/bundle", icon: ShoppingBag },
  { title: "Promote Items", description: "Boost listing visibility and reach more buyers.", href: "/promotions", icon: TrendingUp },
  { title: "Earn Credits", description: "Earn rewards and use credits for boosts and features.", href: "/rewards", icon: Gift },
  { title: "Become a Verified Seller", description: "Verify your identity and build buyer confidence.", href: "/dashboard?section=verification", icon: ShieldCheck, feature: "verification" },
  { title: "Seller Support", description: "Find seller guides or contact support.", href: "/support", icon: Headphones },
];

const WHY_FEATURES = [
  {
    icon: Tag,
    title: "Free to List",
    desc: "No listing fee and no seller commission for private sellers — keep your item price.",
  },
  {
    icon: Globe,
    title: "Wide Reach",
    desc: "List your items and reach buyers across the Bazunk marketplace instantly.",
  },
  {
    icon: Headphones,
    title: "Seller Support",
    desc: "Questions? Contact our support team and we'll get back to you fast.",
  },
  {
    icon: ShieldCheck,
    title: "Dispute Handling",
    desc: "Report issues with buyers and our team will review the case fairly.",
  },
];

const STRIPE_RATE = 0.029;
const STRIPE_FIXED = 0.30;

function useMktRate(rawSettings: Record<string, string>) {
  return (parseFloat(rawSettings["fee_rate_default"] ?? "5") || 5) / 100;
}

function buildFeeRows(mktRatePct: number) {
  const sellerPct = Math.round((1 - mktRatePct / 100 - STRIPE_RATE) * 100);
  return [
    {
      label: "Listing fee",
      value: "Free",
      sub: "Always — no upfront cost",
      color: "text-emerald-300",
      bg: "bg-emerald-50",
      icon: Tag,
      iconColor: "text-emerald-500",
    },
    {
      label: "Private seller commission",
      value: "0%",
      sub: "Private sellers keep 100% of the item price",
      color: "text-[#F26B21]",
      bg: "bg-orange-50",
      icon: Percent,
      iconColor: "text-[#F26B21]",
    },
    {
      label: "Stripe card processing",
      value: "Covered by Bazunk",
      sub: "Not shown as a private-seller commission",
      color: "text-[#4A5CE8]",
      bg: "bg-blue-50",
      icon: CreditCard,
      iconColor: "text-[#4A5CE8]",
    },
    {
      label: "Seller receives",
      value: "100%",
      sub: "Of the item price for private sellers",
      color: "text-emerald-700",
      bg: "bg-emerald-50",
      icon: Banknote,
      iconColor: "text-emerald-300",
    },
  ];
}

function FeeCalculator() {
  const { currency } = useCurrency();
  const formatPrice = (amount: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.code }).format(amount);
  const rawSettings = useRawSettings();
  const businessRate = useMktRate(rawSettings);
  const businessRatePct = businessRate * 100;
  const buyerPct = (parseFloat(rawSettings["buyer_protection_percent"] ?? "6") || 6) / 100;
  const defaultFixed: Record<string, number> = { GBP: 1.00, USD: 1.00, EUR: 1.00, AUD: 1.00, CAD: 1.00, NZD: 1.00, CHF: 1.00 };
  const fixedSetting = rawSettings[`buyer_protection_fixed_${currency.code.toLowerCase()}`] ?? (currency.code === "GBP" ? rawSettings["buyer_protection_fixed"] : undefined);
  const buyerFixed = fixedSetting !== undefined && Number.isFinite(Number(fixedSetting)) ? Math.max(0, Number(fixedSetting)) : defaultFixed[currency.code] ?? 1;
  const [amount, setAmount] = useState("50");
  const [sellerType, setSellerType] = useState<"private"|"business">("private");
  const val = Math.max(0, parseFloat(amount) || 0);
  const buyerProtection = val > 0 ? val * buyerPct + buyerFixed : 0;
  const buyerPays = val + buyerProtection;
  const sellerFee = sellerType === "business" ? val * businessRate : 0;
  const sellerReceives = Math.max(0, val - sellerFee);

  return (
    <div className="bg-blue-50 text-slate-900 rounded-xl border border-blue-400/25 p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-9 h-9 rounded-xl bg-blue-500/30 flex items-center justify-center"><Calculator className="w-4 h-4 text-[#4A5CE8]" /></div>
        <div><p className="font-bold text-slate-900 text-sm">Buyer & Seller Fee Calculator</p><p className="text-xs text-slate-600">See what the buyer pays and seller receives</p></div>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-4 rounded-xl bg-blue-100 p-1">
        <button type="button" onClick={()=>setSellerType("private")} className={`rounded-lg px-3 py-2.5 text-sm font-bold transition ${sellerType==="private"?"bg-[#ff9b28] text-[#06142e] shadow-sm":"text-blue-900 hover:bg-blue-200"}`}>Private seller</button>
        <button type="button" onClick={()=>setSellerType("business")} className={`rounded-lg px-3 py-2.5 text-sm font-bold transition ${sellerType==="business"?"bg-white text-[#4A5CE8] shadow-sm":"text-slate-700"}`}>Business seller</button>
      </div>
      <label className="block text-xs font-bold text-slate-700 mb-1.5">Item sale price</label>
      <div className="relative mb-5"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 font-bold text-sm">{currency.symbol}</span><input type="number" min="0" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} className="w-full bg-white text-slate-900 pl-8 pr-4 py-3 border border-blue-400/30 rounded-xl text-sm font-semibold focus:outline-none focus:border-[#4A5CE8] focus:ring-2 focus:ring-[#4A5CE8]/10"/></div>
      {val>0 ? <div className="space-y-2.5">
        <div className="flex justify-between text-sm"><span className="text-slate-700">Item price</span><b>{formatPrice(val)}</b></div>
        {sellerType==="private" ? <>
          <div className="flex justify-between gap-3 text-sm"><span className="text-slate-700">Buyer Protection ({(buyerPct*100).toFixed(1).replace(".0","")}% + {formatPrice(buyerFixed)})</span><b className="text-blue-800">+{formatPrice(buyerProtection)}</b></div>
          <div className="flex justify-between border-t border-blue-200 pt-3 text-sm"><span className="font-black text-slate-900">Buyer pays</span><span className="font-black text-blue-800 text-base">{formatPrice(buyerPays)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-slate-700">Private seller fee</span><b className="text-emerald-700">{formatPrice(0)} (0%)</b></div>
          <div className="flex justify-between border-t border-blue-200 pt-3 text-sm"><span className="font-black">Seller receives</span><span className="font-black text-emerald-700 text-base">{formatPrice(sellerReceives)}</span></div>
          <p className="text-xs text-slate-600">Buyer Protection is paid by the buyer. The private seller keeps 100% of the item price. Delivery is excluded from this example.</p>
        </> : <>
          <div className="flex justify-between gap-3 text-sm"><span className="text-slate-700">Buyer Protection</span><b className="text-emerald-700">Included · {formatPrice(0)} extra</b></div>
          <div className="flex justify-between border-t border-blue-200 pt-3 text-sm"><span className="font-black">Buyer pays</span><span className="font-black text-blue-800 text-base">{formatPrice(buyerPays)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-slate-700">Business selling fee ({businessRatePct.toFixed(1).replace(".0","")}%)</span><b className="text-[#F26B21]">−{formatPrice(sellerFee)}</b></div>
          <div className="flex justify-between border-t border-blue-200 pt-3 text-sm"><span className="font-black">Business seller receives</span><span className="font-black text-emerald-700 text-base">{formatPrice(sellerReceives)}</span></div>
          <p className="text-xs text-slate-600">Protection and support are included in the business selling fee, so the buyer pays no additional Buyer Protection charge. Category rates may differ. Delivery is excluded.</p>
        </>}
      </div> : <div className="text-center py-4 text-sm text-slate-600">Enter an item price to calculate the transaction</div>}
    </div>
  );
}

const SELL_HUB_OPTIONS = [
 {id:"swap",title:"Bazunk Swap",desc:"List an item and describe what you want in return.",href:"/swap/create",icon:ArrowLeftRight,colors:"from-blue-500 to-blue-700",label:"Create swap"},
 {id:"direct",title:"Direct Sale",desc:"Create a detailed listing with pricing, shipping and offers.",href:"/sell/direct",icon:ShoppingCart,colors:"from-amber-500 to-orange-700",label:"List item"},
 {id:"quick",title:"Quick Sale",desc:"Get your item listed quickly with the essentials.",href:"/sell/quick",icon:Zap,colors:"from-sky-400 to-blue-700",label:"List now"},
 {id:"auction",title:"List an Auction",desc:"Set a starting bid and let buyers compete.",href:"/auctions/create",icon:Gavel,colors:"from-teal-400 to-teal-700",label:"Create auction"},
 {id:"flash",title:"Run a Flash Sale",desc:"Create a limited-time offer for your products.",href:"/flash-sales/create",icon:Percent,colors:"from-pink-500 to-rose-700",label:"Create deal"},
 {id:"classified",title:"List a Classified",desc:"Post a local listing, service or wanted ad.",href:"/classifieds/post",icon:Newspaper,colors:"from-lime-500 to-emerald-700",label:"Post ad"},
 {id:"live",title:"Go Live",desc:"Set up live shopping and reach buyers in real time.",href:"/live",icon:Video,colors:"from-[#14c7f4] to-[#006dce]",label:"Start live"}
] as const;
const SELL_PALETTE = {
 swap:{color:"#2563eb",light:"#dbeafe"},
 direct:{color:"#c2410c",light:"#ffedd5"},
 quick:{color:"#0369a1",light:"#e0f2fe"},
 auction:{color:"#087f75",light:"#ccfbf1"},
 flash:{color:"#be185d",light:"#fce7f3"},
 classified:{color:"#15803d",light:"#dcfce7"},
 live:{color:"#b91c1c",light:"#fee2e2"}
};
const NativeSwapSeller = lazy(() => import("@/pages/SwapPage").then(m => ({default:m.SwapListingForm})));
const NativeDirectSeller = lazy(() => import("@/pages/DirectSalePage").then(m => ({default:m.DirectSalePage})));
const NativeAuctionSeller = lazy(() => import("@/pages/CreateAuctionPage").then(m => ({default:m.CreateAuctionPage})));
const NativeFlashSeller = lazy(() => import("@/pages/CreateFlashSalePage").then(m => ({default:m.CreateFlashSalePage})));
const NativeClassifiedSeller = lazy(() => import("@/pages/ClassifiedsPage").then(m => ({default:m.CreateClassifiedPage})));
function SellHubModal({option,onClose}:{option:(typeof SELL_HUB_OPTIONS)[number];onClose:()=>void}) {
 const [expanded, setExpanded] = useState(false);
 const hasSeparateEditor = option.id === "live";
 useEffect(()=>{const previous=document.body.style.overflow;document.body.style.overflow="hidden";const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose()};window.addEventListener("keydown",onKey);return ()=>{document.body.style.overflow=previous;window.removeEventListener("keydown",onKey)}},[onClose]);

 return createPortal(<div className="fixed inset-0 z-[9999] flex items-stretch justify-center bg-[#082653]/45 p-0 backdrop-blur-[2px] lg:items-center lg:justify-end lg:bg-[#082653]/20 lg:p-5" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
  <section role="dialog" aria-modal="true" aria-label={option.title+" listing wizard"} className={`flex h-[100dvh] w-full flex-col overflow-hidden bg-background shadow-[0_18px_65px_rgba(4,36,88,.35)] lg:h-[min(91dvh,900px)] lg:rounded-[24px] lg:border-2 lg:border-[#9bbff1] ${expanded ? "lg:w-full" : "lg:w-[min(47vw,760px)]"}`}>
   <header className="flex min-h-16 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-3 py-3 text-foreground sm:px-5">
    <div className="flex min-w-0 items-center gap-3"><span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${option.colors} text-white`}><option.icon className="h-6 w-6"/></span><div className="min-w-0"><h2 className="truncate text-base font-black sm:text-xl">{option.title}</h2><p className="hidden text-xs font-medium text-muted-foreground sm:block">Create your listing with Bazunk Seller Studio</p></div></div>
    <div className="flex shrink-0 gap-1 sm:gap-2">{hasSeparateEditor ? <a href={option.href} target="_blank" rel="noopener noreferrer" aria-label="Open full editor in new tab" className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-800 hover:bg-blue-100"><Maximize2 className="h-5 w-5"/></a> : <button type="button" onClick={() => setExpanded(current => !current)} aria-label={expanded ? "Restore listing panel" : "Expand listing panel"} className="hidden h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-800 hover:bg-blue-100 lg:flex">{expanded ? <Minimize2 className="h-5 w-5"/> : <Maximize2 className="h-5 w-5"/>}</button>}<button type="button" onClick={onClose} aria-label="Close listing window" className="flex h-10 w-10 items-center justify-center rounded-full border border-blue-200 bg-white text-[#123c66] hover:bg-orange-50"><X className="h-5 w-5"/></button></div>
   </header>
   <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background" data-testid="sell-native-wizard">
    <Suspense fallback={<div className="p-8 text-center font-bold text-[#123c66]">Loading your listing form…</div>}>
      {option.id==="swap" ? <NativeSwapSeller embedded/> :
       option.id==="direct" || option.id==="quick" ? <NativeDirectSeller embedded sellMode={option.id} key={option.id}/> :
       option.id==="auction" ? <NativeAuctionSeller embedded/> :
       option.id==="flash" ? <NativeFlashSeller embedded onClose={onClose}/> :
       option.id==="classified" ? <NativeClassifiedSeller embedded onClose={onClose}/> :
       <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
         <span className={`flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br ${option.colors} text-white`}><option.icon className="h-11 w-11"/></span>
         <h3 className="text-2xl font-black text-[#082b69]">{option.title}</h3>
         <p className="max-w-md text-[#33577c]">This selling tool has its own creator workflow. Open it to configure your listing and publish safely.</p>
         <a href={option.href} className={`inline-flex min-h-12 items-center gap-2 rounded-full bg-gradient-to-r ${option.colors} px-6 py-3 font-bold text-white`}>Open {option.title}<ArrowRight className="h-5 w-5"/></a>
       </div>}
    </Suspense>
   </div>
  </section>
 </div>, document.body);
}

export function SellPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { formatPrice, currency } = useCurrency();
  const rawSettings = useRawSettings();
  const isAvailable = ({ href, feature = featureForHref(href) }: { href: string; feature?: string }) =>
    !feature || isFeatureEnabled(rawSettings, feature);
  const availableOptions = SELL_HUB_OPTIONS.filter(isAvailable);
  const createMode = new URLSearchParams(search).get("create");
  const selectedSellOption = availableOptions.find(option => option.id === createMode);
  const closeListing = useCallback(() => navigate("/sell", { replace: true }), [navigate]);
  const mktRate = useMktRate(rawSettings);
  const mktRatePct = Math.round(mktRate * 100);
  const FEE_ROWS = buildFeeRows(mktRatePct);

  return (
    <div className="sell-page min-h-screen bg-[linear-gradient(130deg,#dceeff_0%,#fff5ed_45%,#e3f3ff_100%)] font-sans text-[#10213e] flex flex-col">
      <Navbar />
      <main className="flex-1">


        <div className="mx-auto max-w-[1440px] px-3 sm:px-6 py-6 space-y-5">
          <section aria-label="Choose how to sell" className="relative isolate overflow-hidden rounded-[26px] border border-[#bddbff] bg-[radial-gradient(circle_at_0%_25%,#bde5ff_0%,transparent_32%),radial-gradient(circle_at_95%_0%,#ffdfbc_0%,transparent_32%),linear-gradient(145deg,#f3f9ff_0%,#fff7f3_55%,#e7f3ff_100%)] p-4 shadow-[0_18px_55px_rgba(24,78,142,.12)] sm:p-8">


            <div className="relative mb-7 flex flex-col items-center gap-5 text-center lg:flex-row lg:justify-between lg:text-left">
              <div className="max-w-2xl">
                <span className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#ffb65d] bg-[#fff0dc] px-4 py-2 text-xs font-extrabold uppercase tracking-wide text-[#a74300]"><Sparkles className="h-4 w-4"/> List it. Sell it. Get paid!</span>
                <h1 className="text-4xl font-black tracking-tight text-[#082b69] sm:text-5xl lg:text-6xl">Sell on Bazunk</h1>
                <p className="mt-3 text-base font-medium text-[#28496d] sm:text-lg">Choose how you'd like to sell. Simple, fast and secure.</p>
              </div>

            </div>
            <div className="relative grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {availableOptions.map(({ id, icon: Icon, title, desc, label }) => {
                const { color, light } = SELL_PALETTE[id];
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => navigate(`/sell?create=${id}`, { replace: true })}
                    data-testid={`sell-hub-${id}`}
                    className="flex min-w-0 flex-col items-center rounded-2xl border border-slate-200 bg-white p-3.5 text-center text-slate-900 shadow-sm transition-shadow hover:border-slate-400 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-500"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: light, color }}>
                      <Icon aria-hidden="true" className="h-6 w-6" strokeWidth={1.8} />
                    </span>
                    <span className="mt-3 text-[15px] font-bold leading-tight">{title}</span>
                    <span className="mb-3 mt-1.5 text-[13px] leading-snug text-slate-600 dark:text-slate-300">{desc}</span>
                    <span className="mt-auto inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg px-1.5 py-1.5 text-xs font-bold text-white" style={{ backgroundColor: color }}>
                      {label}<ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="relative mt-7 grid grid-cols-2 gap-3 rounded-2xl border border-[#c3d8ff] bg-white p-4 shadow-[0_6px_18px_rgba(10,61,133,.12)] md:grid-cols-4">
              <div className="flex items-center gap-2 text-xs font-bold text-[#123c66] sm:text-sm"><ShieldCheck className="h-6 w-6 shrink-0 text-blue-600"/> Secure payments</div>
              <div className="flex items-center gap-2 text-xs font-bold text-[#123c66] sm:text-sm"><Truck className="h-6 w-6 shrink-0 text-blue-600"/> Flexible selling</div>
              <div className="flex items-center gap-2 text-xs font-bold text-[#123c66] sm:text-sm"><Users className="h-6 w-6 shrink-0 text-blue-600"/> Reach more buyers</div>
              <div className="flex items-center gap-2 text-xs font-bold text-[#123c66] sm:text-sm"><Star className="h-6 w-6 shrink-0 text-orange-500"/> Free listing options</div>
            </div>
          </section>

          <section aria-labelledby="seller-tools-heading" className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:p-6">
            <h2 id="seller-tools-heading" className="text-2xl font-black">Seller tools</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {SELLER_TOOLS.filter(isAvailable).map(({ title, description, href, icon: Icon }) => (
                <Link key={href} href={href} className="flex min-w-0 items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 hover:border-blue-400 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-blue-400 dark:hover:bg-slate-700">
                  <span className="rounded-lg bg-blue-100 p-2 text-blue-800"><Icon aria-hidden="true" className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">{title}</span>
                    <span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">{description}</span>
                  </span>
                  <ArrowRight aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-blue-700 dark:text-blue-300" />
                </Link>
              ))}
            </div>
          </section>

          <section className="grid lg:grid-cols-2 gap-3" aria-label="Seller fees and calculator">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-[#10213e] shadow-sm">
              <span className="inline-block rounded-full bg-orange-500 px-3 py-1 text-xs font-black">⚡ Transparent Pricing</span>
              <h2 className="text-2xl md:text-3xl font-black mt-3">Seller Fees — No Hidden Costs</h2>
              <p className="mt-2 text-sm text-slate-700">Private sellers list and sell free. Business sellers pay their configured fee when an item sells. No invoices, no surprises.</p>
              <div className="mt-4 rounded-xl border border-slate-200 overflow-hidden">
                {FEE_ROWS.map(row=>{const Icon=row.icon;return <div key={row.label} className="flex gap-3 items-center justify-between border-b border-slate-200 bg-slate-50 p-3 last:border-b-0"><span className="flex items-center gap-3"><span className={`rounded-lg p-2 ${row.bg}`}><Icon className={`w-5 h-5 ${row.iconColor}`}/></span><span><strong className="block text-sm text-[#10213e]">{row.label}</strong><small className="text-slate-600">{row.sub}</small></span></span><strong className="text-emerald-700 text-sm text-right">{row.value}</strong></div>})}
              </div>
              <div className="mt-4 flex flex-wrap justify-between gap-2 text-xs font-bold text-slate-700"><span>✓ No invoices</span><span>✓ No monthly fees</span><span>✓ No hidden charges</span></div>
              <p className="mt-3 text-xs text-slate-600">Business fees vary by category. Exact fees appear before checkout.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 text-[#10213e] shadow-sm">
              <h2 className="text-xl font-black mb-3">🧮 Fee Calculator</h2>
              <div className="sell-bright-calculator"><FeeCalculator /></div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gradient-to-r from-blue-800 to-blue-600 p-4 text-white">
                <div><strong className="block">💳 Get paid automatically</strong><span className="text-xs text-white/90">Connect your bank account securely via Stripe.</span></div>
                <Link href="/dashboard?section=seller-payouts" className="rounded-lg bg-white px-4 py-2.5 font-black text-blue-800 hover:bg-yellow-200" data-testid="button-connect-bank">Connect Bank Account →</Link>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 text-[#10213e] shadow-sm">
            <h2 className="text-center text-2xl md:text-3xl font-black">Why Sellers <span className="text-orange-600">Choose Bazunk</span></h2>
            <p className="text-center text-slate-700 text-sm mb-5">Everything you need to succeed as a seller.</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{WHY_FEATURES.map((f,i)=>{const Icon=f.icon;return <div key={f.title} className="flex flex-col items-start gap-3 rounded-xl bg-slate-50 p-4"><span className={`shrink-0 rounded-xl p-3 ${["bg-orange-600","bg-blue-600","bg-teal-600","bg-emerald-600"][i]}`}><Icon className="w-6 h-6 text-white"/></span><div><h3 className="font-black text-sm">{f.title}</h3><p className="text-xs text-slate-700 mt-1">{f.desc}</p></div></div>})}</div>
          </section>
          <section className="relative overflow-hidden rounded-2xl border border-blue-800 bg-gradient-to-r from-[#082b69] to-blue-700 text-white p-5 md:p-7 flex flex-col md:flex-row justify-between gap-5 items-center">

            <div className="relative"><h2 className="text-2xl md:text-3xl font-black">Ready to <span className="text-yellow-300">Start Selling?</span></h2><p className="text-sm text-white mt-1">It's free to list. Private sellers keep 100% of the item price.</p></div>
            <div className="relative flex flex-wrap gap-2"><Link href="/sell/direct" className="rounded-full bg-orange-500 px-5 py-3 text-sm font-black text-white hover:bg-orange-600" data-testid="button-create-seller-account">🛒 List Your First Item →</Link><Link href="/dashboard?section=seller-payouts" className="rounded-full bg-[#071c46] px-5 py-3 text-sm font-black text-white hover:bg-blue-900" data-testid="button-seller-dashboard">Connect Bank Account</Link></div>
          </section>
        </div>
      </main>
      {selectedSellOption && <SellHubModal option={selectedSellOption} key={selectedSellOption.id} onClose={closeListing}/>}
      <Footer />
    </div>
  );
}
