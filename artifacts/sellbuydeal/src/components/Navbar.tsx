import { HeaderMegaModals } from "./HeaderMegaModals";
import { BuyerProtectionModal } from "./BuyerProtectionModal";
import { CategoryDrawer } from "@/components/CategoryDrawer";
import { usePublicCategoryVisibility } from "@/hooks/usePublicCategoryVisibility";
import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "next-themes";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, User, HelpCircle, X, Eye, CheckCircle2, ChevronRight,
  Heart, ShoppingCart, Tag, ChevronDown, LogOut,
  LayoutDashboard, Menu, Home, Grid3X3, List, Newspaper, MessageSquare,
  Gavel, Zap, Gift, Package, Radio, Handshake, Info,
  Trophy, MoreHorizontal, Film, Flame, ArrowDownToLine, ShieldCheck, Database, Truck, Leaf, Store, Sparkles,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ACTIVE_CATEGORIES } from "@/data/categories";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useCurrency, CURRENCIES, MARKET_COUNTRIES, type CurrencyCode } from "@/context/CurrencyContext";
import { useLanguage } from "@/context/LanguageContext";
import { useMarketplaceRegion } from "@/hooks/useMarketplaceRegion";
import { MessageCenterOverlay } from "./MessageCenterOverlay";
import { useRawSettings } from "@/context/SiteSettingsContext";
import {parseIconOverrides,iconForPlacement} from "@/design-system/designCenterFields";
import { featureForHref, isFeatureEnabled } from "@/components/FeatureGate";

const API_BASE=(import.meta.env.VITE_API_URL||import.meta.env.VITE_API_BASE_URL||"https://bazunk-api.onrender.com").replace(/\/$/,"");

const ALL_PRODUCTS: { id: number; title: string; price: number; condition: string; views: number; image: string; category: string }[] = [];

const SELL_OPTIONS: Array<{
  id: string; label: string; desc: string;
  icon: React.FC<{ className?: string }>; href: string;
  color: string; bg: string; badge?: string;
}> = [
  {
    id: "selling-guide",
    label: "Selling Overview",
    desc: "Explore every way to sell on Bazunk",
    icon: Tag,
    href: "/sell",
    color: "text-[#4A5CE8]",
    bg: "bg-blue-50",
  },
  {
    id: "import-listings",
    label: "Import Listings",
    desc: "Bring products from other marketplaces",
    icon: ArrowDownToLine,
    href: "/importers",
    color: "text-indigo-600",
    bg: "bg-indigo-50",
  },
  {
    id: "quick",
    label: "Quick Sale",
    desc: "List the basics now, add details later",
    icon: Zap,
    href: "/sell/quick",
    color: "text-[#F26B21]",
    bg: "bg-orange-50",
  },
  {
    id: "direct",
    label: "Direct Sale",
    desc: "Guided six-step full listing",
    icon: Tag,
    href: "/sell/direct",
    color: "text-[#4A5CE8]",
    bg: "bg-blue-50",
  },
  {
    id: "bundle",
    label: "Bundle Deal",
    desc: "Sell multiple items together",
    icon: Package,
    href: "/bundle",
    color: "text-[#4A5CE8]",
    bg: "bg-blue-50",
  },
  {
    id: "auction",
    label: "Auction",
    desc: "Let buyers bid on your item",
    icon: Gavel,
    href: "/auctions",
    color: "text-amber-600",
    bg: "bg-amber-50",
  },
  {
    id: "classified",
    label: "Classified Ad",
    desc: "Post a local or free ad",
    icon: Newspaper,
    href: "/classifieds/post",
    color: "text-purple-600",
    bg: "bg-purple-50",
  },
];

const MORE_NAV = [
  { href: "/deal-pilot",       label: "DealPilot", icon: Search, color: "text-orange-600", bg: "bg-orange-50" },
  { href: "/find-it", label: "Find It – buyer requests", icon: Handshake, color: "text-orange-700", bg: "bg-orange-50" },
  { href: "/rewards",          label: "Rewards", icon: Trophy, color: "text-amber-700", bg: "bg-amber-50" },
  { href: "/live",             label: "Live Shopping", icon: Radio, color: "text-red-600", bg: "bg-red-50" },
  { href: "/auctions",          label: "Auctions",         icon: Gavel,           color: "text-amber-600",   bg: "bg-amber-50" },
  { href: "/flash-sales",       label: "Flash Sales",      icon: Flame,           color: "text-red-500",     bg: "bg-red-50" },
  { href: "/classifieds",       label: "Classifieds",      icon: Newspaper,       color: "text-purple-600",  bg: "bg-purple-50" },
  { href: "/buyer-protection",  label: "Buyer Protection", icon: ShieldCheck,     color: "text-emerald-600", bg: "bg-emerald-50" },
  { href: "/support",           label: "Support",          icon: HelpCircle,      color: "text-sky-600",     bg: "bg-sky-50" },
  { href: "/videos",            label: "Promotional Videos", icon: Film,          color: "text-blue-600",    bg: "bg-blue-50" },
  { href: "https://data.bazunk.com", label: "Bazunk Data Platform", icon: Database, color: "text-indigo-600", bg: "bg-indigo-50", external: true },
];

const MOBILE_NAV_LINKS = [
  { href: "/",            label: "Home",        icon: Home },
  { href: "/browse",      label: "Shop",        icon: Grid3X3 },
  { href: "/deal-pilot", label: "DealPilot", icon: Search },
  { href: "/find-it", label: "Find It", icon: Handshake },
  { href: "/categories",  label: "Categories",  icon: List },
  { href: "/rewards", label: "Daily Rewards", icon: Gift },
  { href: "/dashboard?section=credits", label: "Credits & Milestones", icon: Trophy },
  { href: "/promotions", label: "Promotions", icon: Zap },
  { href: "/auctions",    label: "Auctions",    icon: Gavel },
  { href: "/flash-sales", label: "Flash Sales", icon: Zap },
  { href: "/live",        label: "Live",        icon: Radio,  live: true },
  { href: "/classifieds", label: "Classifieds", icon: Newspaper },
  { href: "/sell/direct",  label: "Direct Sale",  icon: Tag },
  { href: "/bundle",      label: "Bundle Deal", icon: Package },
  { href: "/offers",      label: "My Offers",   icon: Handshake },
  { href: "/messages",    label: "Messages",    icon: MessageSquare },
  { href: "/dashboard",   label: "Dashboard",   icon: LayoutDashboard },
  { href: "/buyer-protection", label: "Buyer Protection", icon: ShieldCheck },
  { href: "/importers",        label: "Importers",        icon: ArrowDownToLine },
  { href: "/support",          label: "Support",          icon: HelpCircle },
  { href: "/videos",           label: "Promotional Videos", icon: Film },
];

export function Navbar() {
  const { user, logout } = useAuth();
  const { itemCount, openCart } = useCart();
  const { currency, setCurrency, formatPrice, country, setCountry } = useCurrency();
  const { t } = useLanguage();
  const changeCountry = (code: string) => { setCountry(code); changeMarketRegion(code === "US" ? "us" : "uk"); };
  const featureSettings = useRawSettings();
  const { resolvedTheme } = useTheme();
  const defaultLogo = "/bazunk-brand-dark.png";
  // The dark PNG is 1061×600 but its visible pixels occupy only the top ~257px.
  // Fit the artwork inside a light-logo aspect ratio frame instead of transforming
  // the image (which previously overlapped navigation and still looked too small).
  const useDefaultDarkLogo = !featureSettings.site_logo_url?.startsWith("/api/site-media/");
  const studioIcons=parseIconOverrides(featureSettings.icon_overrides);
  const HomeHeaderIcon=iconForPlacement(studioIcons,"header_home");
  const SearchHeaderIcon=iconForPlacement(studioIcons,"header_search");
  const CartHeaderIcon=iconForPlacement(studioIcons,"header_cart");
  const AccountHeaderIcon=iconForPlacement(studioIcons,"header_account");
  const visibleHref = (href:string) => { const f=featureForHref(href); return !f || isFeatureEnabled(featureSettings,f); };
  const {isActive:categoryIsActive}=usePublicCategoryVisibility();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [liveSearchResults, setLiveSearchResults] = useState<any[]>([]);
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [marketRegion, changeMarketRegion] = useMarketplaceRegion();
  const [sellOpen, setSellOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [protectionOpen,setProtectionOpen] = useState(false);
  const [rewardsPopover, setRewardsPopover] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [categoryDrawerOpen,setCategoryDrawerOpen] = useState(false);
  const [messageCenterOpen, setMessageCenterOpen] = useState(false);
  useEffect(() => { const openInbox = () => setMessageCenterOpen(true); window.addEventListener("bazunk-open-inbox", openInbox); return () => window.removeEventListener("bazunk-open-inbox", openInbox); }, []);
  const [location, setLocation] = useLocation();
  const searchRef = useRef<HTMLDivElement>(null);
  const [searchPopupRect,setSearchPopupRect] = useState({top:0,left:0,width:500});
  useLayoutEffect(()=>{
    if(!searchOpen)return;
    const reposition=()=>{const r=searchRef.current?.getBoundingClientRect();if(r)setSearchPopupRect({top:r.bottom+10,left:Math.max(12,r.left),width:Math.min(r.width,window.innerWidth-24)});};
    reposition();window.addEventListener("resize",reposition);window.addEventListener("scroll",reposition,true);
    return()=>{window.removeEventListener("resize",reposition);window.removeEventListener("scroll",reposition,true);};
  },[searchOpen]);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const sellRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const rewardsRef = useRef<HTMLDivElement>(null);

  const trimmed = query.trim().toLowerCase();
  const matchedProducts = trimmed
    ? ALL_PRODUCTS.filter((p) => p.title.toLowerCase().includes(trimmed)).slice(0, 4)
    : [];
  const matchedCategories = trimmed
    ? ACTIVE_CATEGORIES.filter(
        (c) => categoryIsActive(c.slug) && (c.name.toLowerCase().includes(trimmed) ||
          c.subcategories.some((s) => categoryIsActive(c.slug,s.slug) && s.name.toLowerCase().includes(trimmed)))
      ).slice(0, 3)
    : [];
  const hasResults = liveSearchResults.length > 0 || matchedProducts.length > 0 || matchedCategories.length > 0 || searchSuggestions.length > 0;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if ((e.target as Element)?.closest?.(".bz-mega-panel")) return;
      if (searchRef.current && !searchRef.current.contains(e.target as Node) && !(e.target as Element)?.closest?.(".bz-search-popover")) setSearchOpen(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
      if (sellRef.current && !sellRef.current.contains(e.target as Node)) setSellOpen(false);
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
      if (rewardsRef.current && !rewardsRef.current.contains(e.target as Node)) setRewardsPopover(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setLiveSearchResults([]); return; }
    const timer = window.setTimeout(async () => {
      try {
        const r = await fetch(`${API_BASE}/api/listings?limit=5&offset=0&region=${marketRegion}&q=${encodeURIComponent(q)}`);
        if (!r.ok) return;
        const rows = await r.json();
        const needle = q.toLowerCase();
        setLiveSearchResults((Array.isArray(rows) ? rows : [])
          .filter((x:any) => String(x.title || "").toLowerCase().includes(needle))
          .slice(0, 5));
      } catch { setLiveSearchResults([]); }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, marketRegion]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setSearchSuggestions([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${API_BASE}/api/listings/search-suggestions?region=${marketRegion}&q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Suggestions unavailable");
        const data = await response.json();
        if (!controller.signal.aborted) setSearchSuggestions(Array.isArray(data.suggestions) ? data.suggestions.filter((x: unknown): x is string => typeof x === "string").slice(0, 8) : []);
      } catch { if (!controller.signal.aborted) setSearchSuggestions([]); }
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, marketRegion]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onEscape);
    };
  }, [mobileOpen]);

  useEffect(() => { setMobileOpen(false); }, [location]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (trimmed) {
      setLocation(`/browse?q=${encodeURIComponent(trimmed)}`);
      setSearchOpen(false);
      setMobileOpen(false);
    }
  }

  function handleLogout() {
    logout();
    setUserMenuOpen(false);
    setMobileOpen(false);
    setLocation("/");
  }

  function navTo(href: string) {
    setLocation(href);
    setMobileOpen(false);
  }

  function handleRewardsClick() {
    if (user) {
      setLocation("/dashboard?section=credits");
    } else {
      setRewardsPopover((v) => !v);
    }
  }

  const initial = user?.name?.charAt(0).toUpperCase() ?? "U";

  const primaryLinks: Array<{ href: string; label: string; live?: boolean }> = [
    { href: "/", label: "Home" },
    { href: "/browse", label: "Shop" },
    { href: "/auctions", label: "Auctions" },
    { href: "/flash-sales", label: "Flash Sales" },
    { href: "/live", label: "Live", live: true },
    { href: "/deals", label: "Deals" },
    { href: "/eco", label: "Eco" },
  ].filter(x => visibleHref(x.href));

  return (
    <>
      <nav data-bz-site-header className="bz-mockup-header relative z-50 w-full bg-white shadow-sm">
        <div className="bz-mockup-topbar border-b border-gray-100 bg-gray-50 px-4 py-1.5 flex items-center gap-2" aria-label="Delivery and currency preferences">
          <div className="inline-flex min-w-0 shrink-0 items-stretch divide-x divide-slate-200 rounded-xl border border-slate-200 bg-white shadow-sm">
            <label className="relative flex min-w-0 cursor-pointer items-center gap-2 rounded-l-xl px-2.5 py-1.5 transition hover:bg-orange-50 focus-within:ring-2 focus-within:ring-orange-500 sm:px-3">
              <span aria-hidden="true" className="text-xl leading-none">{country.flag}</span>
              <span className="min-w-0"><span className="block text-[10px] font-medium leading-tight text-slate-500">Deliver to</span><span className="block max-w-[92px] truncate text-xs font-bold text-slate-900 sm:max-w-[145px]">{country.name}</span></span>
              <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-orange-600"/>
              <select aria-label="Delivery country" value={country.code} onChange={e=>changeCountry(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">{MARKET_COUNTRIES.map(c=><option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}</select>
            </label>
            <label className="relative flex cursor-pointer items-center gap-2 rounded-r-xl px-2.5 py-1.5 transition hover:bg-sky-50 focus-within:ring-2 focus-within:ring-sky-500 sm:px-3">
              <span aria-hidden="true" className="flex h-7 min-w-7 items-center justify-center rounded-lg bg-sky-50 px-1 text-sm font-bold text-sky-700">{currency.symbol}</span>
              <span><span className="block text-[10px] font-medium leading-tight text-slate-500">Currency</span><span className="block text-xs font-bold text-slate-900">{currency.code}</span></span>
              <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 text-sky-700"/>
              <select aria-label="Display currency" value={currency.code} onChange={e=>setCurrency(e.target.value as CurrencyCode)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">{Object.values(CURRENCIES).map(c=><option key={c.code} value={c.code}>{c.code} · {c.symbol}</option>)}</select>
            </label>
          </div>
          <div className="bz-mockup-top-links">
            <Link href="/support">Help</Link>
            <button type="button" onClick={() => {setMoreOpen(false);setSellOpen(false);setProtectionOpen(true)}} aria-haspopup="dialog" aria-expanded={protectionOpen}><ShieldCheck size={17}/> Buyer Protection</button>
            <Link href="/dashboard?section=watchlist"><Heart size={18} className="text-sky-400"/> Watchlist</Link>
            <button type="button" onClick={() => {setSellOpen(false);setMoreOpen(v=>!v)}} aria-haspopup="dialog" aria-expanded={moreOpen} data-testid="button-more-nav" className="bz-mockup-top-more"><Grid3X3 size={17}/> More <ChevronDown size={14} className={moreOpen?"rotate-180":""}/></button>
             <button type="button" onClick={() => {setMoreOpen(false);setSellOpen(true)}} className="bz-mockup-top-sell"><Store size={17}/> Sell on Bazunk</button>
          </div>
        </div>
        <div className="mx-auto w-full max-w-[1920px] px-4 lg:px-7 h-16 md:h-20 flex items-center gap-3 lg:gap-4 bz-mockup-mainbar">

          {/* Theme + Logo */}
          <div className="bz-header-brand flex items-center gap-2 flex-shrink-0">
            <Link href="/" className="flex items-center flex-shrink-0" data-testid="link-logo">
              {useDefaultDarkLogo ? <span data-theme-edit="site_logo_url" className="flex h-9 w-[min(150px,40vw)] min-w-0 shrink items-center sm:h-9 md:h-12 xl:h-14 xl:w-[190px]"><img src={defaultLogo} alt={featureSettings.site_name||"Bazunk"} decoding="async" className="block h-full w-full object-contain object-left" /></span> : <img src={featureSettings.site_logo_url?.startsWith("/api/site-media/") ? API_BASE + featureSettings.site_logo_url : defaultLogo} alt={featureSettings.site_name||"Bazunk"} data-theme-edit="site_logo_url" decoding="async" className="h-7 sm:h-9 md:h-12 xl:h-14 w-auto object-contain" />}
            </Link>
            <Link
              href="/"
              aria-label="Home"
              title="Home"
              data-testid="link-home-icon" data-theme-edit="icon_overrides"
              className="hidden 2xl:flex w-8 h-8 items-center justify-center rounded-full text-gray-500 hover:text-[#4A5CE8] hover:bg-[#4A5CE8]/10 transition-colors flex-shrink-0"
            >
              <HomeHeaderIcon className="w-4 h-4" />
            </Link>
          </div>

          {/* Desktop category trigger stays visible beside the main navigation. */}
          <button type="button" className="bz-mockup-categories hidden xl:flex" aria-haspopup="dialog" aria-expanded={categoryDrawerOpen} onClick={()=>setCategoryDrawerOpen(v=>!v)}><Menu className="h-5 w-5"/> Categories <ChevronDown className="h-4 w-4"/></button>

          {/* Desktop nav */}
          <div className="bz-header-primary-nav hidden xl:flex items-center gap-1 text-sm font-medium flex-shrink-0">

            {/* Primary links */}
            {primaryLinks.map(({ href, label, live }) => {
              const active = location === href && !(href === "/" && location !== "/");
              return href === "/categories" ? (
                <button type="button" key={href} onClick={()=>setCategoryDrawerOpen(true)} aria-haspopup="dialog" aria-expanded={categoryDrawerOpen} className="px-2.5 py-1.5 rounded-full transition-colors whitespace-nowrap flex items-center gap-1 text-gray-700 hover:text-orange-600 hover:bg-orange-50 dark:text-white dark:hover:bg-slate-700">Categories <ChevronRight className="h-3.5 w-3.5 rotate-90"/></button>
              ) : (
                <Link
                  key={href}
                  href={href}
                  className={`px-2.5 py-1.5 rounded-full transition-colors whitespace-nowrap flex items-center gap-1 ${
                    live
                      ? `text-red-600 font-semibold ${active ? "bg-red-100" : "bg-red-50 hover:bg-red-100"}`
                      : active
                        ? "text-[#4A5CE8] font-semibold bg-[#4A5CE8]/10"
                        : "text-gray-600 hover:text-[#4A5CE8] hover:bg-[#4A5CE8]/5"
                  }`}
                >
                  {live && (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                    </span>
                  )}
                  {href === "/" ? <Home className="bz-nav-link-icon text-white"/> : href === "/browse" ? <ShoppingCart className="bz-nav-link-icon text-sky-300"/> : href === "/auctions" ? <Gavel className="bz-nav-link-icon text-orange-400"/> : href === "/flash-sales" ? <Zap className="bz-nav-link-icon text-yellow-300"/> : href === "/live" ? <Radio className="bz-nav-link-icon text-pink-400"/> : href === "/deals" ? <Tag className="bz-nav-link-icon text-rose-400"/> : href === "/eco" ? <Leaf className="bz-nav-link-icon text-green-400"/> : null}
                  {label}
                </Link>
              );
            })}

            
          </div>

          {/* Search occupies its own full-width slot beside navigation. */}
          <div className="bz-header-search-slot">
            {/* Desktop search */}
            <div ref={searchRef} className="relative hidden lg:block w-full min-w-0">
              <form onSubmit={handleSubmit}>
                <SearchHeaderIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600 pointer-events-none" />
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
                  onFocus={() => query.trim() && setSearchOpen(true)}
                  placeholder={featureSettings.header_search_placeholder||"Search listings..."}
                  className="w-full min-w-0 pl-10 pr-9 rounded-full bg-gray-100 border border-gray-200 focus-visible:border-[#F26B21]/50 focus-visible:ring-2 focus-visible:ring-[#F26B21]/20 h-11 text-sm"
                  data-testid="input-search" data-theme-edit="header_search_placeholder"
                />
                {query && (
                  <button type="button" onClick={() => { setQuery(""); setSearchOpen(false); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </form>
              {searchOpen && query.trim() && createPortal(
                <div role="region" aria-label="Search suggestions" className="bz-search-popover" style={{top:searchPopupRect.top,left:searchPopupRect.left,width:searchPopupRect.width}}><div className="bz-search-popover-head"><span className="bz-search-popover-icon"><Search size={18}/></span><div><strong>Search Bazunk</strong><small>Find products, deals and categories</small></div><button type="button" aria-label="Close suggestions" onClick={()=>setSearchOpen(false)}><X size={17}/></button></div><div className="bz-search-popover-scroll">
                  {searchSuggestions.length > 0 && <div className="border-b border-slate-200 px-3 py-2"><p className="text-xs font-bold text-slate-600 mb-1">Suggested searches</p>{searchSuggestions.map(suggestion => <button key={suggestion} type="button" onClick={() => { setQuery(suggestion); setSearchOpen(false); setLocation(`/browse?q=${encodeURIComponent(suggestion)}`); }} className="block w-full rounded-lg px-2 py-2 text-left text-sm font-semibold text-slate-900 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500">{suggestion}</button>)}</div>}
                  {!hasResults ? (
                    <div className="px-4 py-6 text-center text-sm text-gray-600">No results for "<span className="font-medium text-gray-600">{query}</span>"</div>
                  ) : (
                    <>
                      {liveSearchResults.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 pt-3 pb-1">Bazunk listings</p>
                          {liveSearchResults.map((product:any) => (
                            <Link key={product.id} href={`/listing/${product.publicId || product.id}`} onClick={() => setSearchOpen(false)}
                              className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors group">
                              <div className="w-9 h-9 rounded-lg bg-gray-100 flex-shrink-0 overflow-hidden">
                                {product.image && <img src={product.image} alt={product.title} className="w-full h-full object-cover" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-800 line-clamp-1 group-hover:text-[#4A5CE8]">{product.title}</p>
                                <p className="text-xs font-bold text-green-600">{product.currency || "GBP"} {product.price}</p>
                              </div>
                              <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
                            </Link>
                          ))}
                        </div>
                      )}
                      {matchedProducts.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 pt-3 pb-1">Products</p>
                          {matchedProducts.map((product) => (
                            <Link key={product.id} href={`/listing/${product.id}`} onClick={() => setSearchOpen(false)}
                              className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors group" data-testid={`link-search-product-${product.id}`}>
                              <div className="w-9 h-9 rounded-lg bg-gray-100 flex-shrink-0 overflow-hidden">
                                <img src={product.image} alt={product.title} className="w-full h-full object-contain p-1" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-800 line-clamp-1 group-hover:text-[#4A5CE8] transition-colors">{product.title}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-xs font-bold text-green-600">{formatPrice(product.price)}</span>
                                  <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 capitalize">{product.condition}</Badge>
                                  <span className="flex items-center gap-0.5 text-xs text-gray-600"><Eye className="w-2.5 h-2.5" />{product.views}</span>
                                </div>
                              </div>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                            </Link>
                          ))}
                        </div>
                      )}
                      {matchedCategories.length > 0 && (
                        <div className={matchedProducts.length > 0 ? "border-t border-gray-100" : ""}>
                          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 pt-3 pb-1">Categories</p>
                          {matchedCategories.map((cat) => (
                            <Link key={cat.slug} href={`/browse?category=${encodeURIComponent(cat.slug)}`} onClick={() => setSearchOpen(false)}
                              className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors group" data-testid={`link-search-category-${cat.slug}`}>
                              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#0983cf] to-[#063d82] flex items-center justify-center flex-shrink-0">
                                <span className="text-white text-xs font-bold">{cat.name.charAt(0)}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-800 line-clamp-1 group-hover:text-[#4A5CE8] transition-colors">{cat.name}</p>
                                <p className="text-xs text-gray-600">{cat.subcategories.length} subcategories</p>
                              </div>
                              <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-[#4A5CE8] transition-colors" />
                            </Link>
                          ))}
                        </div>
                      )}
                      <div className="border-t border-gray-100 px-4 py-2.5">
                        <button type="button" onClick={() => {setLocation(`/browse?q=${encodeURIComponent(query.trim())}`);setSearchOpen(false);}} className="bz-search-see-all">
                          See all results for "{query}"
                        </button>
                      </div>
                    </>
                  )}
                  </div>
                </div>, document.body
              )}
            </div>


          </div>

          {/* Right section */}
          <div className="bz-header-actions flex flex-1 min-w-0 items-center gap-2 justify-end">

            {/* Logged OUT actions */}
            {!user && (
              <>
                <Link href="/sign-in" className="hidden md:flex shrink-0 items-center gap-1.5 px-3 py-2 rounded-full border border-[#4A5CE8]/30 text-sm font-semibold text-[#4A5CE8] hover:bg-[#4A5CE8]/5 hover:border-[#4A5CE8] transition-colors whitespace-nowrap" data-testid="link-sign-in">
                  Sign In
                </Link>
                <Link href="/sign-up" className="hidden sm:flex shrink-0 items-center gap-1.5 px-3 py-2 rounded-full bg-[#F26B21] text-white text-sm font-semibold hover:bg-[#D97706] transition-colors shadow-sm whitespace-nowrap" data-testid="link-register">
                  Join Free
                </Link>
              </>
            )}

            {/* Logged IN actions */}
            {user && (
              <>
                {/* Messages */}
                <button
                  onClick={() => setMessageCenterOpen(true)}
                  className="hidden md:flex w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 items-center justify-center text-gray-600 transition-colors relative"
                  data-testid="button-messages"
                >
                  <MessageSquare className="w-4 h-4" />
                </button>

                {/* Cart */}
                <button
                  onClick={openCart}
                  className="hidden md:flex w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 items-center justify-center text-gray-600 transition-colors relative"
                  data-testid="button-cart" data-theme-edit="icon_overrides"
                >
                  <CartHeaderIcon className="w-4 h-4" />
                  {itemCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#F26B21] text-white text-xs font-bold flex items-center justify-center leading-none">
                      {itemCount > 9 ? "9+" : itemCount}
                    </span>
                  )}
                </button>

                {/* User menu */}
                <div ref={userMenuRef} className="relative flex-shrink-0">
                  <button
                    onClick={() => setUserMenuOpen(!userMenuOpen)}
                    className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
                    data-testid="button-user-menu" data-theme-edit="icon_overrides"
                  >
                    <div className="w-7 h-7 rounded-full bg-[#3B4FD8] flex items-center justify-center text-white text-xs font-bold">
                      {initial}
                    </div>
                    <AccountHeaderIcon className="hidden md:block h-4 w-4 text-slate-600" aria-hidden="true"/><span className="hidden md:block text-sm font-semibold text-gray-800 max-w-[80px] truncate">{user.username}</span>
                    <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform ${userMenuOpen ? "rotate-180" : ""}`} />
                  </button>
                  <AnimatePresence>
                    {userMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 6, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.97 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 top-[calc(100%+8px)] w-52 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden z-50"
                      >
                        <div className="px-4 py-3 border-b border-gray-100">
                          <p className="font-semibold text-gray-900 text-sm">{user.name}</p>
                          <p className="text-xs text-gray-600 truncate">{user.email}</p>
                        </div>
                        <Link href="/dashboard" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                          <LayoutDashboard className="w-5 h-5 text-slate-700" /> My Dashboard
                        </Link>
                        <Link href="/offers" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                          <Handshake className="w-4 h-4 text-gray-600" /> My Offers
                        </Link>
                        <button onClick={() => { setUserMenuOpen(false); setMessageCenterOpen(true); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                          <MessageSquare className="w-4 h-4 text-gray-600" /> Messages
                        </button>
                        <Link href="/sell/direct" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                          <Tag className="w-4 h-4 text-gray-600" /> Create Listing
                        </Link>
                        <div className="border-t border-gray-100">
                          <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-500 hover:bg-red-50 transition-colors" data-testid="button-logout">
                            <LogOut className="w-4 h-4" /> Sign Out
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </>
            )}

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen(true)}
              className="xl:hidden flex items-center justify-center w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors flex-shrink-0"
              aria-label="Open menu" aria-expanded={mobileOpen} aria-controls="bazunk-mobile-menu"
              data-testid="button-mobile-menu"
            >
              <Menu className="w-5 h-5 text-gray-700" />
            </button>
          </div>
        </div>
        <div className="relative lg:hidden px-4 pb-3">
          <form onSubmit={(event) => { setSearchOpen(false); handleSubmit(event); }} className="flex gap-2" role="search" aria-label="Search marketplace">
            <input type="search" value={query} onChange={e => { setQuery(e.target.value); setSearchOpen(true); }} onFocus={e => { setSearchOpen(true); window.setTimeout(() => e.target.scrollIntoView({block:"nearest",behavior:"smooth"}),150); }} placeholder={t("search")} aria-label="Search listings" aria-expanded={searchOpen && !!query.trim()} aria-controls="mobile-search-suggestions" className="min-w-0 flex-1 rounded-xl bg-gray-100 px-3 py-2 text-base text-gray-800 scroll-mt-4" />
            <button type="submit" aria-label="Search" className="w-11 shrink-0 rounded-xl bg-[#4A5CE8] text-white flex items-center justify-center"><Search className="w-5 h-5" /></button>
          </form>
          {searchOpen && !!query.trim() && searchSuggestions.length > 0 && (
            <div id="mobile-search-suggestions" role="region" aria-label="Search suggestions" className="absolute inset-x-4 top-[calc(100%-8px)] z-[70] max-h-[min(32dvh,220px)] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-1 shadow-xl" style={{WebkitOverflowScrolling:"touch"}}>
              {searchSuggestions.slice(0,5).map(suggestion => <button key={suggestion} type="button" onClick={() => {setQuery(suggestion);setSearchOpen(false);setLocation(`/browse?q=${encodeURIComponent(suggestion)}`);}} className="block min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-900 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500">{suggestion}</button>)}
            </div>
          )}
        </div>
        <div className="relative">
          <div className="bz-mockup-benefits" role="region" aria-label="Marketplace benefits, swipe horizontally for more" tabIndex={0}>
          <span><Truck className="text-blue-600"/> <strong>Free delivery</strong><small>On selected items</small></span>
          <span><ShieldCheck className="text-cyan-600"/> <strong>Buyer protection</strong><small>Shop with confidence</small></span>
          <span><CheckCircle2 className="text-orange-500"/> <strong>Verified sellers</strong><small>Look for verification</small></span>
          <span><Leaf className="text-green-600"/> <strong>Eco marketplace</strong><small>Reuse and resell</small></span>
          <span><Gift className="text-amber-500"/> <strong>Earn credits</strong><small>List, boost &amp; save</small></span>
          <span><Gift className="text-pink-500"/> <strong>Daily deals</strong><small>New offers every day</small></span>
          </div>
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-end bg-gradient-to-r from-transparent to-white/90 pr-2 sm:hidden">
            <ChevronRight className="h-4 w-4 text-[#15588e]"/>
          </div>
          <span className="pointer-events-none absolute bottom-0 right-11 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-[#15588e] shadow-sm sm:hidden" aria-hidden="true">Swipe →</span>
        </div>
        {/* Brand colour accent */}
        <div className="h-[3px] w-full bg-gradient-to-r from-[#1E6FE8] via-[#4A5CE8] to-[#F5B301]" />
      </nav>

      <BuyerProtectionModal open={protectionOpen} onClose={() => setProtectionOpen(false)} />
      <HeaderMegaModals kind={sellOpen ? "sell" : moreOpen ? "more" : null} onClose={() => {setSellOpen(false);setMoreOpen(false)}} />

      {/* Render the mobile drawer at document root so page stacking contexts cannot cover it. */}
      {typeof document !== "undefined" && createPortal(
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/70 xl:hidden" style={{ zIndex: 2147483000, position: "fixed", inset: 0, backgroundColor: "rgba(2, 8, 23, 0.72)" }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              key="drawer"
              id="bazunk-mobile-menu" role="dialog" aria-modal="true" aria-label="Mobile navigation"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 220 }}
              className="fixed top-0 right-0 bottom-0 w-[min(22rem,100vw)] bg-white flex flex-col xl:hidden shadow-2xl text-slate-900" style={{ zIndex: 2147483001, position: "fixed", top: 0, right: 0, bottom: 0, width: "min(22rem, 100vw)", height: "100dvh", backgroundColor: "#ffffff", color: "#0f172a", overflow: "hidden" }}
            >
              {/* Header */}
              <div className="flex shrink-0 items-center justify-between px-5 py-3 border-b border-gray-100">
                <Link href="/" onClick={() => setMobileOpen(false)} className="flex items-center">
                   {useDefaultDarkLogo ? <span className="flex h-9 w-[min(150px,40vw)] min-w-0 items-center"><img src={defaultLogo} alt={featureSettings.site_name||"Bazunk"} className="block h-full w-full object-contain object-left" /></span> : <img src={featureSettings.site_logo_url?.startsWith("/api/site-media/") ? API_BASE + featureSettings.site_logo_url : defaultLogo} alt={featureSettings.site_name||"Bazunk"} className="h-7 w-auto max-w-[200px] object-contain" />}
                </Link>
                <button
                  onClick={() => setMobileOpen(false)}
                  className="w-11 h-11 shrink-0 rounded-full bg-gray-100 flex items-center justify-center text-slate-700 hover:bg-gray-200 transition-colors"
                  aria-label="Close menu"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Only the brand header and account actions stay fixed; all discovery controls scroll together. */}
              <nav aria-label="Mobile marketplace links" className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-2" style={{WebkitOverflowScrolling:"touch"}}>
              <button type="button" onClick={()=>{setMobileOpen(false);setCategoryDrawerOpen(true);}} className="mx-5 my-3 flex min-h-12 items-center justify-between rounded-xl bg-orange-50 px-4 font-bold text-slate-900 border border-orange-200" aria-haspopup="dialog"><span className="flex items-center gap-2"><Grid3X3 className="h-5 w-5 text-orange-600"/> Shop by category</span><ChevronRight className="h-5 w-5"/></button>

              {/* User info (logged in) */}
              {user && (
                <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#3B4FD8] flex items-center justify-center text-white font-bold">
                    {initial}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{user.name}</p>
                    <p className="text-xs text-gray-600 truncate max-w-[180px]">{user.email}</p>
                  </div>
                </div>
              )}

              {/* Rewards banner (guest) */}
              {!user && (
                <div className="mx-4 mt-3 mb-1 rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 flex items-center gap-3">
                  <Trophy className="w-5 h-5 text-amber-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-amber-800">Earn Rewards</p>
                    <p className="text-xs text-amber-600">Credits, badges & perks</p>
                  </div>
                  <Link
                    href="/sign-up"
                    onClick={() => setMobileOpen(false)}
                    className="text-xs font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                  >
                    Join Free
                  </Link>
                </div>
              )}

                {/* Rewards link (logged in) */}
                {user && (
                  <button
                    onClick={() => { setLocation("/dashboard?section=credits"); setMobileOpen(false); }}
                    className="w-full flex items-center gap-3 px-5 py-3.5 text-sm font-semibold text-amber-600 hover:bg-amber-50 transition-colors text-left"
                    data-testid="mobile-link-rewards"
                  >
                    <Trophy className="w-4 h-4 text-amber-500" />
                    Rewards & Credits
                    <ChevronRight className="w-3.5 h-3.5 text-amber-300 ml-auto" />
                  </button>
                )}
                {MOBILE_NAV_LINKS.filter(x => visibleHref(x.href)).map(({ href, label, icon: Icon, live }) => (
                  <button
                    key={href}
                    onClick={() => navTo(href)}
                    className="w-full flex items-center gap-3 px-5 py-3.5 text-base font-medium text-slate-900 hover:bg-orange-50 hover:text-orange-800 transition-colors text-left"
                    data-testid={`mobile-link-${label.toLowerCase().replace(/\s/g, "-")}`}
                  >
                    <Icon className="w-4 h-4 text-gray-600" />
                    {label}
                    {live && (
                      <span className="relative flex h-2 w-2 ml-1">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4 text-slate-500 ml-auto" />
                  </button>
                ))}
              <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-3 shrink-0">
                <div className="flex flex-col gap-1 text-xs text-gray-600"><label>{t("country")}<select value={country.code} onChange={e => changeCountry(e.target.value)} className="ml-2 bg-gray-100 rounded-lg p-2 text-base">{MARKET_COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}</select></label><label>{t("currency")}<select value={currency.code} onChange={e => setCurrency(e.target.value as CurrencyCode)} className="ml-2 bg-gray-100 rounded-lg p-2 text-base">{Object.values(CURRENCIES).map(c => <option key={c.code} value={c.code}>{c.code} {c.symbol}</option>)}</select></label></div>
              </div>
              </nav>

              {/* Bottom auth actions */}
              {!user && (
                <div className="shrink-0 bg-white px-5 py-3 border-t border-gray-200 flex flex-col gap-2">
                  <Link
                    href="/sign-up"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#F26B21] text-white text-sm font-bold hover:bg-[#D97706] transition-colors"
                    data-testid="mobile-link-register"
                  >
                    <Gift className="w-4 h-4" /> Join Free
                  </Link>
                  <Link
                    href="/sign-in"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-semibold hover:border-[#4A5CE8] hover:text-[#4A5CE8] transition-colors"
                    data-testid="mobile-link-sign-in"
                  >
                    Sign In
                  </Link>
                </div>
              )}
              {user && (
                <div className="shrink-0 bg-white px-5 py-3 border-t border-gray-200">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-red-100 text-red-500 text-sm font-semibold hover:bg-red-50 transition-colors"
                    data-testid="mobile-button-logout"
                  >
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>, document.body)}

      <MessageCenterOverlay open={messageCenterOpen} onClose={() => setMessageCenterOpen(false)} />
          <CategoryDrawer open={categoryDrawerOpen} onClose={()=>setCategoryDrawerOpen(false)} />
    </>
  );
}
