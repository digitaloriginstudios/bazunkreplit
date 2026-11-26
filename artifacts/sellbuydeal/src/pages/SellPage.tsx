import { useState, useEffect, lazy, Suspense } from "react";
import { useRawSettings } from "@/context/SiteSettingsContext";
import { featureForHref, isFeatureEnabled } from "@/components/FeatureGate";
import { motion } from "framer-motion";
import { Link } from "wouter";
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
  CheckCircle2,
  Calculator,
  ExternalLink,
  Banknote,
  Percent,
  Info,
  Zap, Video, X, Maximize2, Package, Users, Truck, Star, Sparkles, Timer, BadgePercent, ClipboardList, Play, Gift, ShoppingBag,
} from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useCurrency } from "@/context/CurrencyContext";

const SELL_OPTIONS = [
  { id:"bulk-import",title:"Bulk Import",description:"Upload a CSV to create multiple product listings with a preview before publishing.",icon:Layers,gradient:"from-indigo-500 to-purple-600",cta:"Import CSV",ctaColor:"text-indigo-600",href:"/sell/import",badge:"NEW" },
  {
    id:"snap-sell",title:"Snap & Sell",
    description:"Take a photo or scan a barcode to start an editable listing with AI-assisted details.",
    icon:Camera,gradient:"from-orange-500 to-fuchsia-600",cta:"Snap an item",ctaColor:"text-orange-600",href:"/sell/snap",badge:"NEW",
  },
  {
    id: "direct-sale",
    title: "Direct Sale",
    description:
      "List your item for immediate sale with Buy It Now or Make an Offer options",
    icon: ShoppingCart,
    gradient: "from-[#5B4FD9] to-[#7C3AED]",
    cta: "Get started",
    ctaColor: "text-[#4A5CE8]",
    href: "/sell/direct",
    badge: null,
  },
  {
    id: "auction",
    title: "Auctions",
    description: "Let buyers compete with timed bidding and discover the best selling price.",
    icon: Gavel,
    gradient: "from-orange-500 to-amber-500",
    cta: "Create auction",
    ctaColor: "text-orange-600",
    href: "/auctions/create",
    badge: null,
  },
  {
    id: "create-bundle",
    title: "Create Bundle",
    description:
      "Group multiple items together for bundle deals and increased sales",
    icon: Layers,
    gradient: "from-[#1a9e6f] to-[#0d7a57]",
    cta: "Create bundle",
    ctaColor: "text-[#1a9e6f]",
    href: "/bundle",
    badge: null,
  },
  {
    id: "classified-ads",
    title: "Classified Ads",
    description:
      "Post classified ads for services, rentals, and local items",
    icon: Newspaper,
    gradient: "from-[#E8622A] to-[#C0392B]",
    cta: "Post an ad",
    ctaColor: "text-[#E8622A]",
    href: "/classifieds",
    badge: null,
  },
  {
    id: "open-store",
    title: "Open a Store",
    description:
      "Create your own branded storefront with a banner, profile pic, and all your listings",
    icon: Store,
    gradient: "from-[#2563EB] to-[#1E3A8A]",
    cta: "Create store",
    ctaColor: "text-[#2563EB]",
    href: "/dashboard",
    badge: "FREE",
  },
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
    <div className="bg-[#081c3c] text-white rounded-xl border border-blue-400/25 p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-9 h-9 rounded-xl bg-blue-500/30 flex items-center justify-center"><Calculator className="w-4 h-4 text-[#4A5CE8]" /></div>
        <div><p className="font-bold text-white text-sm">Buyer & Seller Fee Calculator</p><p className="text-xs text-white/85">See what the buyer pays and seller receives</p></div>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-4 rounded-xl bg-[#0c2852] p-1">
        <button type="button" onClick={()=>setSellerType("private")} className={`rounded-lg px-3 py-2.5 text-sm font-bold transition ${sellerType==="private"?"bg-[#ff9b28] text-[#06142e] shadow-sm":"text-white hover:bg-blue-700"}`}>Private seller</button>
        <button type="button" onClick={()=>setSellerType("business")} className={`rounded-lg px-3 py-2.5 text-sm font-bold transition ${sellerType==="business"?"bg-white text-[#4A5CE8] shadow-sm":"text-blue-100"}`}>Business seller</button>
      </div>
      <label className="block text-xs font-bold text-blue-100 mb-1.5">Item sale price</label>
      <div className="relative mb-5"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-200 font-bold text-sm">{currency.symbol}</span><input type="number" min="0" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} className="w-full bg-[#102d57] text-white pl-8 pr-4 py-3 border border-blue-400/30 rounded-xl text-sm font-semibold focus:outline-none focus:border-[#4A5CE8] focus:ring-2 focus:ring-[#4A5CE8]/10"/></div>
      {val>0 ? <div className="space-y-2.5">
        <div className="flex justify-between text-sm"><span className="text-blue-100">Item price</span><b>{formatPrice(val)}</b></div>
        {sellerType==="private" ? <>
          <div className="flex justify-between gap-3 text-sm"><span className="text-blue-100">Buyer Protection ({(buyerPct*100).toFixed(1).replace(".0","")}% + {formatPrice(buyerFixed)})</span><b className="text-cyan-300">+{formatPrice(buyerProtection)}</b></div>
          <div className="flex justify-between border-t border-white/20 pt-3 text-sm"><span className="font-black text-white">Buyer pays</span><span className="font-black text-cyan-300 text-base">{formatPrice(buyerPays)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-blue-100">Private seller fee</span><b className="text-emerald-300">{formatPrice(0)} (0%)</b></div>
          <div className="flex justify-between border-t border-white/20 pt-3 text-sm"><span className="font-black">Seller receives</span><span className="font-black text-emerald-300 text-base">{formatPrice(sellerReceives)}</span></div>
          <p className="text-xs text-blue-200">Buyer Protection is paid by the buyer. The private seller keeps 100% of the item price. Delivery is excluded from this example.</p>
        </> : <>
          <div className="flex justify-between gap-3 text-sm"><span className="text-blue-100">Buyer Protection</span><b className="text-emerald-300">Included · {formatPrice(0)} extra</b></div>
          <div className="flex justify-between border-t border-white/20 pt-3 text-sm"><span className="font-black">Buyer pays</span><span className="font-black text-cyan-300 text-base">{formatPrice(buyerPays)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-blue-100">Business selling fee ({businessRatePct.toFixed(1).replace(".0","")}%)</span><b className="text-[#F26B21]">−{formatPrice(sellerFee)}</b></div>
          <div className="flex justify-between border-t border-white/20 pt-3 text-sm"><span className="font-black">Business seller receives</span><span className="font-black text-emerald-300 text-base">{formatPrice(sellerReceives)}</span></div>
          <p className="text-xs text-blue-200">Protection and support are included in the business selling fee, so the buyer pays no additional Buyer Protection charge. Category rates may differ. Delivery is excluded.</p>
        </>}
      </div> : <div className="text-center py-4 text-sm text-blue-200">Enter an item price to calculate the transaction</div>}
    </div>
  );
}

const SELL_HUB_OPTIONS = [
 {id:"swap",title:"Bazunk Swap",desc:"List an item and describe what you want in return.",href:"/swap/create",icon:ArrowLeftRight,colors:"from-blue-500 to-blue-700",border:"border-blue-600",label:"Create swap"},
 {id:"direct",title:"Direct Sale",desc:"Create a detailed listing with pricing, shipping and offers.",href:"/sell/direct",icon:ShoppingCart,colors:"from-[#ffad12] to-[#ff7900]",border:"border-[#ff9500]",label:"List item"},
 {id:"quick",title:"Quick Sale",desc:"Get your item listed quickly with the essentials.",href:"/sell/quick",icon:Zap,colors:"from-[#20b4ff] to-[#0067ff]",border:"border-[#087cff]",label:"List now"},
 {id:"auction",title:"List an Auction",desc:"Set a starting bid and let buyers compete.",href:"/auctions/create",icon:Gavel,colors:"from-[#b54bff] to-[#7921f1]",border:"border-[#9235ff]",label:"Create auction"},
 {id:"flash",title:"Run a Flash Sale",desc:"Create a limited-time offer for your products.",href:"/flash-sales",icon:Percent,colors:"from-[#ff3da1] to-[#ee0066]",border:"border-[#ff238c]",label:"Create deal"},
 {id:"classified",title:"List a Classified",desc:"Post a local listing, service or wanted ad.",href:"/classifieds/post",icon:Newspaper,colors:"from-[#19d978] to-[#00a957]",border:"border-[#00bf69]",label:"Post ad"},
 {id:"live",title:"Go Live",desc:"Set up live shopping and reach buyers in real time.",href:"/live",icon:Video,colors:"from-[#14c7f4] to-[#006dce]",border:"border-[#04aeed]",label:"Start live"}
] as const;
function SellHubArtwork({kind}:{kind:string}) {
 const common="absolute drop-shadow-[0_12px_10px_rgba(15,46,96,.18)]";
 return <div aria-hidden="true" className="relative mb-3 flex h-40 w-full items-center justify-center overflow-hidden rounded-2xl">
  <div className="absolute inset-0 bg-[repeating-conic-gradient(from_0deg_at_50%_78%,rgba(255,255,255,.8)_0deg,rgba(255,255,255,0)_13deg,rgba(255,255,255,0)_26deg)] opacity-65"/>
  <span className="absolute left-[18%] top-[26%] h-2 w-5 -rotate-12 rounded-full bg-current opacity-30"/><span className="absolute right-[17%] top-[37%] h-2 w-4 rotate-12 rounded-full bg-current opacity-30"/>
  {kind==="swap"&&<div className="rounded-2xl bg-blue-600 p-6 text-white"><ArrowLeftRight size={64}/></div>}
  {kind==="direct"&&<><div className="relative rotate-[-10deg] rounded-[24px] bg-gradient-to-br from-amber-300 to-orange-600 p-6 text-white shadow-[0_12px_22px_rgba(238,120,15,.35)] ring-4 ring-white"><ShoppingBag size={64} strokeWidth={2.5}/></div><Zap className={common+" right-[22%] top-[14%] rotate-12 text-amber-500"} size={43} fill="#fbbf24"/></>}
  {kind==="quick"&&<><div className="relative rounded-full bg-gradient-to-br from-sky-300 via-blue-500 to-blue-700 p-7 text-white shadow-[0_12px_22px_rgba(23,108,233,.35)] ring-[7px] ring-sky-100"><Zap size={67} strokeWidth={2.8} fill="#ffdd51" className="text-yellow-300"/></div><Sparkles className={common+" right-[20%] top-[12%] text-blue-500"} size={25}/></>}
  {kind==="auction"&&<><div className="relative rotate-[-16deg] rounded-3xl bg-gradient-to-br from-purple-300 to-violet-700 p-5 text-white shadow-[0_12px_22px_rgba(127,51,222,.35)] ring-4 ring-white"><Gavel size={76} strokeWidth={2.6}/></div><Sparkles className={common+" right-[17%] top-[16%] text-violet-500"} size={30}/></>}
  {kind==="flash"&&<><div className="relative rotate-[-12deg] rounded-[24px] bg-gradient-to-br from-pink-300 via-pink-500 to-rose-700 p-6 text-white shadow-[0_12px_22px_rgba(227,36,116,.35)] ring-4 ring-white"><BadgePercent size={70} strokeWidth={2.5}/></div><Timer className={common+" right-[18%] top-[16%] text-pink-500"} size={30}/></>}
  {kind==="classified"&&<><div className="relative rotate-[-8deg] rounded-[24px] bg-gradient-to-br from-emerald-300 to-green-700 p-6 text-white shadow-[0_12px_22px_rgba(19,161,102,.35)] ring-4 ring-white"><ClipboardList size={70} strokeWidth={2.5}/></div><Sparkles className={common+" right-[18%] top-[15%] text-green-500"} size={25}/></>}
  {kind==="live"&&<><div className="relative rotate-[-7deg] rounded-[24px] bg-gradient-to-br from-cyan-300 via-sky-500 to-blue-700 p-6 text-white shadow-[0_12px_22px_rgba(6,151,216,.35)] ring-4 ring-white"><Video size={70} strokeWidth={2.5}/></div><span className="absolute bottom-5 right-[17%] rounded-full border-2 border-white bg-red-500 px-2 py-1 text-[10px] font-black text-white shadow-md">LIVE</span><Play className={common+" left-[20%] top-[20%] text-sky-500"} size={25} fill="currentColor"/></>}
 </div>;
}
const NativeDirectSeller = lazy(() => import("@/pages/DirectSalePage").then(m => ({default:m.DirectSalePage})));
const NativeAuctionSeller = lazy(() => import("@/pages/CreateAuctionPage").then(m => ({default:m.CreateAuctionPage})));
const NativeClassifiedSeller = lazy(() => import("@/pages/ClassifiedsPage").then(m => ({default:m.CreateClassifiedPage})));
function SellHubModal({option,onClose}:{option:(typeof SELL_HUB_OPTIONS)[number];onClose:()=>void}) {
 useEffect(()=>{const previous=document.body.style.overflow;document.body.style.overflow="hidden";const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose()};window.addEventListener("keydown",onKey);return ()=>{document.body.style.overflow=previous;window.removeEventListener("keydown",onKey)}},[onClose]);

 return <div className="fixed inset-0 z-[9999] flex items-stretch justify-center bg-[#082653]/45 p-0 backdrop-blur-[2px] lg:items-center lg:justify-end lg:bg-[#082653]/20 lg:p-5" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
  <section role="dialog" aria-modal="true" aria-label={option.title+" listing wizard"} className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-[0_18px_65px_rgba(4,36,88,.35)] lg:h-[min(91dvh,900px)] lg:w-[min(47vw,760px)] lg:rounded-[24px] lg:border-2 lg:border-[#9bbff1]">
   <header className="flex min-h-16 shrink-0 items-center justify-between gap-2 border-b border-[#d6e5f9] bg-white px-3 py-3 text-[#082b69] sm:px-5">
    <div className="flex min-w-0 items-center gap-3"><span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${option.colors} text-white`}><option.icon className="h-6 w-6"/></span><div className="min-w-0"><h2 className="truncate text-base font-black sm:text-xl">{option.title}</h2><p className="hidden text-xs font-medium text-[#33577c] sm:block">Create your listing with Bazunk Seller Studio</p></div></div>
    <div className="flex shrink-0 gap-1 sm:gap-2"><a href={option.href} target="_blank" rel="noopener noreferrer" aria-label="Open full editor in new tab" className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-800 hover:bg-blue-100"><Maximize2 className="h-5 w-5"/></a><button type="button" onClick={onClose} aria-label="Close listing window" className="flex h-10 w-10 items-center justify-center rounded-full border border-blue-200 bg-white text-[#123c66] hover:bg-orange-50"><X className="h-5 w-5"/></button></div>
   </header>
   <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white" data-testid="sell-native-wizard">
    <Suspense fallback={<div className="p-8 text-center font-bold text-[#123c66]">Loading your listing form…</div>}>
      {option.id==="direct" || option.id==="quick" ? <NativeDirectSeller embedded sellMode={option.id} key={option.id}/> :
       option.id==="auction" ? <NativeAuctionSeller embedded/> :
       option.id==="classified" ? <NativeClassifiedSeller embedded/> :
       <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
         <span className={`flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br ${option.colors} text-white`}><option.icon className="h-11 w-11"/></span>
         <h3 className="text-2xl font-black text-[#082b69]">{option.title}</h3>
         <p className="max-w-md text-[#33577c]">This selling tool has its own creator workflow. Open it to configure your listing and publish safely.</p>
         <a href={option.href} className={`inline-flex min-h-12 items-center gap-2 rounded-full bg-gradient-to-r ${option.colors} px-6 py-3 font-bold text-white`}>Open {option.title}<ArrowRight className="h-5 w-5"/></a>
       </div>}
    </Suspense>
   </div>
  </section>
 </div>;
}

export function SellPage() {
  const [selectedSellOption,setSelectedSellOption] = useState<(typeof SELL_HUB_OPTIONS)[number] | null>(null);
  const { formatPrice, currency } = useCurrency();
  const rawSettings = useRawSettings();
  const mktRate = useMktRate(rawSettings);
  const mktRatePct = Math.round(mktRate * 100);
  const FEE_ROWS = buildFeeRows(mktRatePct);

  return (
    <div className="sell-page min-h-screen bg-[linear-gradient(130deg,#dceeff_0%,#fff5ed_45%,#e3f3ff_100%)] font-sans text-[#10213e] flex flex-col">
      <Navbar />
      <main className="flex-1">


        <div className="mx-auto max-w-[1440px] px-3 sm:px-6 py-6 space-y-5">
          <section aria-label="Choose how to sell" className="relative isolate overflow-hidden rounded-[26px] border border-[#bddbff] bg-[radial-gradient(circle_at_0%_25%,#bde5ff_0%,transparent_32%),radial-gradient(circle_at_95%_0%,#ffdfbc_0%,transparent_32%),linear-gradient(145deg,#f3f9ff_0%,#fff7f3_55%,#e7f3ff_100%)] p-4 shadow-[0_18px_55px_rgba(24,78,142,.12)] sm:p-8">
            <div aria-hidden="true" className="pointer-events-none absolute -left-14 top-24 h-52 w-52 rounded-full border-[24px] border-sky-100/70"/>
            <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full border-[32px] border-orange-100/70"/>
            <div className="relative mb-7 flex flex-col items-center gap-5 text-center lg:flex-row lg:justify-between lg:text-left">
              <div className="max-w-2xl">
                <span className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#ffb65d] bg-[#fff0dc] px-4 py-2 text-xs font-extrabold uppercase tracking-wide text-[#a74300]"><Sparkles className="h-4 w-4"/> List it. Sell it. Get paid!</span>
                <h1 className="text-4xl font-black tracking-tight text-[#082b69] sm:text-5xl lg:text-6xl">Sell on Bazunk</h1>
                <p className="mt-3 text-base font-medium text-[#28496d] sm:text-lg">Choose how you'd like to sell. Simple, fast and secure.</p>
              </div>
              <div className="hidden shrink-0 items-center gap-3 rounded-3xl border border-white/90 bg-white/75 px-5 py-4 shadow-lg lg:flex">
                <ShoppingBag className="h-16 w-16 rotate-[-12deg] rounded-2xl bg-orange-500 p-3 text-white shadow-lg"/><Gift className="h-14 w-14 rotate-12 rounded-2xl bg-blue-500 p-3 text-white shadow-lg"/><Sparkles className="h-10 w-10 text-amber-500"/>
              </div>
            </div>
            <div className="relative grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-3 lg:gap-5">
              {SELL_HUB_OPTIONS.filter(option => !featureForHref(option.href) || isFeatureEnabled(rawSettings,featureForHref(option.href)!)).map(option => {const Icon=option.icon;return <button type="button" key={option.id} onClick={()=>setSelectedSellOption(option)} data-testid={`sell-hub-${option.id}`} className={`group relative flex min-w-0 flex-col items-center overflow-hidden rounded-[22px] border-2 ${option.border} bg-white p-5 text-center shadow-[0_7px_18px_rgba(12,58,116,.14)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_14px_26px_rgba(12,58,116,.2)] focus-visible:outline focus-visible:outline-4 focus-visible:outline-orange-500 sm:p-6`}>
                <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-48 bg-gradient-to-b ${option.colors} opacity-[.22]`}/>
                <SellHubArtwork kind={option.id}/>
                <h3 className="relative text-xl font-black tracking-tight text-[#092b68] sm:text-[25px]">{option.title}</h3>
                <p className="relative mt-2 min-h-14 max-w-[240px] text-sm font-medium leading-relaxed text-[#173c71]">{option.desc}</p>
                <span className={`relative mt-auto inline-flex min-h-11 w-full max-w-[240px] items-center justify-center gap-2 rounded-full bg-gradient-to-r ${option.colors} px-4 py-2 text-sm font-black text-white shadow-sm`}>{option.label}<ArrowRight className="h-4 w-4"/></span>
              </button>})}
            </div>
            <div className="relative mt-7 grid grid-cols-2 gap-3 rounded-2xl border border-[#c3d8ff] bg-white p-4 shadow-[0_6px_18px_rgba(10,61,133,.12)] md:grid-cols-4">
              <div className="flex items-center gap-2 text-xs font-bold text-[#123c66] sm:text-sm"><ShieldCheck className="h-6 w-6 shrink-0 text-blue-600"/> Secure payments</div>
              <div className="flex items-center gap-2 text-xs font-bold text-[#123c66] sm:text-sm"><Truck className="h-6 w-6 shrink-0 text-blue-600"/> Flexible selling</div>
              <div className="flex items-center gap-2 text-xs font-bold text-[#123c66] sm:text-sm"><Users className="h-6 w-6 shrink-0 text-blue-600"/> Reach more buyers</div>
              <div className="flex items-center gap-2 text-xs font-bold text-[#123c66] sm:text-sm"><Star className="h-6 w-6 shrink-0 text-orange-500"/> Free listing options</div>
            </div>
          </section>

          <section className="grid lg:grid-cols-2 gap-3" aria-label="Seller fees and calculator">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-[#10213e] shadow-sm">
              <span className="inline-block rounded-full bg-orange-500 px-3 py-1 text-xs font-black">⚡ Transparent Pricing</span>
              <h2 className="text-2xl md:text-3xl font-black mt-3">Seller Fees — No Hidden Costs</h2>
              <p className="mt-2 text-sm text-white/85">Private sellers list and sell free. Business sellers pay their configured fee when an item sells. No invoices, no surprises.</p>
              <div className="mt-4 rounded-xl border border-slate-200 overflow-hidden">
                {FEE_ROWS.map(row=>{const Icon=row.icon;return <div key={row.label} className="flex gap-3 items-center justify-between border-b border-slate-200 bg-slate-50 p-3 last:border-b-0"><span className="flex items-center gap-3"><span className="rounded-lg bg-blue-600 p-2"><Icon className="w-5 h-5 text-white"/></span><span><strong className="block text-sm text-[#10213e]">{row.label}</strong><small className="text-slate-600">{row.sub}</small></span></span><strong className="text-emerald-700 text-sm text-right">{row.value}</strong></div>})}
              </div>
              <div className="mt-4 flex flex-wrap justify-between gap-2 text-xs font-bold text-slate-700"><span>✓ No invoices</span><span>✓ No monthly fees</span><span>✓ No hidden charges</span></div>
              <p className="mt-3 text-xs text-slate-600">Business fees vary by category. Exact fees appear before checkout.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 text-[#10213e] shadow-sm">
              <h2 className="text-xl font-black mb-3">🧮 Fee Calculator</h2>
              <div className="sell-bright-calculator"><FeeCalculator /></div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 p-4">
                <div><strong className="block">💳 Get paid automatically</strong><span className="text-xs text-white/90">Connect your bank account securely via Stripe.</span></div>
                <Link href="/dashboard?section=seller-payouts" className="rounded-lg bg-white px-4 py-2.5 font-black text-blue-800 hover:bg-yellow-200" data-testid="button-connect-bank">Connect Bank Account →</Link>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 text-[#10213e] shadow-sm">
            <h2 className="text-center text-2xl md:text-3xl font-black">Why Sellers <span className="text-orange-600">Choose Bazunk</span></h2>
            <p className="text-center text-slate-700 text-sm mb-5">Everything you need to succeed as a seller.</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{WHY_FEATURES.map((f,i)=>{const Icon=f.icon;return <div key={f.title} className="flex items-start gap-3"><span className={`shrink-0 rounded-xl p-3 ${["bg-fuchsia-600","bg-blue-600","bg-orange-500","bg-emerald-500"][i]}`}><Icon className="w-6 h-6 text-white"/></span><div><h3 className="font-black text-sm">{f.title}</h3><p className="text-xs text-white/85 mt-1">{f.desc}</p></div></div>})}</div>
          </section>
          <section className="relative overflow-hidden rounded-2xl border-2 border-purple-400 bg-gradient-to-r from-[#1256f2] via-[#4e20e8] to-[#f02dc1] p-5 md:p-7 flex flex-col md:flex-row justify-between gap-5 items-center">
            <span className="absolute right-4 top-1 text-5xl opacity-60">🚀 📦 ✨</span>
            <div className="relative"><h2 className="text-2xl md:text-3xl font-black">Ready to <span className="text-yellow-300">Start Selling?</span></h2><p className="text-sm text-white mt-1">It's free to list. Private sellers keep 100% of the item price.</p></div>
            <div className="relative flex flex-wrap gap-2"><Link href="/sell/direct" className="rounded-full bg-orange-500 px-5 py-3 text-sm font-black text-white hover:bg-orange-600" data-testid="button-create-seller-account">🛒 List Your First Item →</Link><Link href="/dashboard?section=seller-payouts" className="rounded-full bg-[#071c46] px-5 py-3 text-sm font-black text-white hover:bg-blue-900" data-testid="button-seller-dashboard">Connect Bank Account</Link></div>
          </section>
        </div>
      </main>
      {selectedSellOption && <SellHubModal option={selectedSellOption} onClose={()=>setSelectedSellOption(null)}/>}
      <Footer />
    </div>
  );
}
