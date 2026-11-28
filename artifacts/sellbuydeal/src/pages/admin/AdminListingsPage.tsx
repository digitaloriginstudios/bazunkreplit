import { BulkListingConversion, type ConversionKind } from "./BulkListingConversion";
import "./AdminListingsContrast.css";
import { MarketplaceLoader } from "@/components/MarketplaceLoader";
import { Fragment, useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Search, RefreshCw, ExternalLink, ShoppingCart, Loader2, Package, Pencil, Trash2, EyeOff, Copy, Share2, Flag, Link2 } from "lucide-react";
import { AdminListingPromotion } from "@/components/AdminListingPromotion";
import { AdminLayout } from "./AdminLayout";
import { AdminListingEditor, AdminListingCatalogueTools } from "./AdminProductsPage";
import { catalogueTaxonomy, type CatalogueCategory } from "./catalogueTaxonomy";
import { AdminBulkSelection } from "@/components/admin/AdminBulkSelection";
import { AdminManagementHeader, AdminStatusTabs } from "@/components/admin/AdminUi";
import { useAdmin } from "@/context/AdminContext";

interface Listing {
  id: number;
  public_id: string | null;
  public_url_token: string | null;
  title: string;
  price: string;
  currency: string;
  category: string;
  subcategory: string | null;
  subsubcategory?: string | null;
  condition: string;
  status: string;
  seller_email: string;
  seller_username: string | null;
  specifications: string | null;
  image: string | null;
  created_at: string;
}

interface ThirdLevelCategory {
  category: string;
  subcategory: string;
  slug: string;
  name: string;
  visible: boolean;
}

interface Specs {
  admin_third_level_slug?: string;
  amazon_url?: string;
  aliexpress_url?: string;
  aliexpress_id?: string;
  asin?: string;
  source?: string;
  ebay_url?: string;
  item_id?: string;
  own_ebay_item_id?: string;
}

function parseSpecs(raw: string | null): Specs {
  if (!raw) return {};
  try { return JSON.parse(raw) ?? {}; } catch { return {}; }
}

function aliExpressSourceUrl(specs: Specs, publicId: string | null): string | undefined {
  if (specs.aliexpress_url) {
    try {
      const url = new URL(specs.aliexpress_url);
      if (url.protocol === "https:" && !url.username && !url.password &&
          (url.hostname === "aliexpress.com" || url.hostname.endsWith(".aliexpress.com"))) return url.href;
    } catch { /* Use the saved product ID when the original URL is unavailable. */ }
  }
  const id = specs.aliexpress_id ?? publicId?.match(/^BZK-ALI-(\d{10,20})$/)?.[1];
  return id && /^\d{10,20}$/.test(id) ? `https://www.aliexpress.com/item/${id}.html` : undefined;
}

const STATUS_STYLE: Record<string, string> = {
  active:   "bg-emerald-100 text-emerald-700",
  pending:  "bg-amber-100 text-amber-700",
  sold:     "bg-gray-100 text-gray-500",
  inactive: "bg-red-100 text-red-600",
};

export function AdminListingsPage() {
  const { isAdmin, authFetch } = useAdmin();
  const [, setLocation] = useLocation();

  const [listings, setListings] = useState<Listing[]>([]);
  const [view,setView]=useState<"listings"|"import-export">("listings");
  const [editingId,setEditingId]=useState<number|null>(null);

  const [rowBusy,setRowBusy]=useState<number|null>(null);
  const [deleteBusy,setDeleteBusy]=useState(false);
  const [deleteMessage,setDeleteMessage]=useState("");
  const [sharingId,setSharingId]=useState<number|null>(null);
  const [copiedId,setCopiedId]=useState<number|null>(null);
  const publicListingUrl=(l:Listing)=>window.location.origin+"/listing/"+(l.public_url_token||l.public_id||l.id);
  async function copyAdminListingLink(l:Listing){try{await navigator.clipboard.writeText(publicListingUrl(l));setCopiedId(l.id);}catch{setActionError("Unable to copy link. Please copy it from the public listing.");}}
  function shareAdminListing(l:Listing){const url=publicListingUrl(l);if(navigator.share){void navigator.share({title:l.title,url}).catch(()=>{});}else{window.open("https://wa.me/?text="+encodeURIComponent(l.title+" "+url),"_blank","noopener,noreferrer");}}
  const [actionError,setActionError]=useState("");
  async function hideListing(id:number) {
    setRowBusy(id);setActionError("");
    try {
      const res=await authFetch(`/api/admin/listings/${id}/visibility`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({hidden:true})});
      const data=await res.json().catch(()=>null);
      if(!res.ok)throw Error(data?.error||"Could not hide listing");
      setListings(prev=>prev.map(l=>l.id===id?{...l,status:"inactive"}:l));
    }catch(e){setActionError(e instanceof Error?e.message:"Action failed");}
    finally{setRowBusy(null);}
  }
  async function deleteListings(ids: string[]) {
    if (deleteBusy || rowBusy !== null || !ids.length) return;
    const label = ids.length === 1 ? "this listing" : `${ids.length} selected listings`;
    if (!window.confirm(`Permanently delete ${label}? This cannot be undone. Protected listings will be skipped.`)) return;
    setDeleteBusy(true);
    setDeleteMessage("");
    const deleted = new Set<string>();
    const failed: string[] = [];
    try {
      for (const id of ids) {
        setDeleteMessage(`Deleting ${deleted.size + failed.length + 1} of ${ids.length}…`);
        try {
          const res = await authFetch(`/api/admin/listings/${encodeURIComponent(id)}/safe-delete`, { method: "DELETE" });
          const result = await res.json().catch(() => null);
          if (!res.ok || result?.deleted !== true) throw Error(result?.error || "Could not delete listing.");
          deleted.add(id);
        } catch (error) {
          failed.push(`#${id}: ${error instanceof Error ? error.message : "Could not delete listing."}`);
        }
      }
      setListings(current => current.filter(listing => !deleted.has(String(listing.id))));
      setSelectedIds(current => current.filter(id => !deleted.has(id)));
      setTotal(current => Math.max(0, current - deleted.size));
      const removedOnPage = listings.filter(listing => deleted.has(String(listing.id))).length;
      if (offset > 0 && removedOnPage === listings.length) setOffset(Math.max(0, offset - LIMIT));
      else if (deleted.size) await load(true).catch(() => setActionError("Listings were deleted, but the table could not refresh."));
    } finally {
      setDeleteMessage(`${deleted.size} deleted.${failed.length ? " " + failed.length + " could not be deleted.\n" + failed.join("\n") : ""}`);
      setDeleteBusy(false);
    }
  }
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") || "");
  const [filter, setFilter] = useState<"all" | "imported" | "user">("all");
  const [offset, setOffset] = useState(0);
  const [statusFilter,setStatusFilter]=useState("all");
  const [conversion, setConversion] = useState<{ kind: ConversionKind; listings: Listing[] } | null>(null);
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const [mediaBusy,setMediaBusy]=useState(false);
  const [mediaMessage,setMediaMessage]=useState("");
  async function syncMedia(ids:number[]) {
    if(mediaBusy || !ids.length) return;
    setMediaBusy(true); setMediaMessage("Refreshing supplier media…");
    let ok=0, failed=0; const errors:string[]=[];
    try {
      for(let i=0;i<ids.length;i+=20){
        const batch=ids.slice(i,i+20);
        const r=await authFetch("/api/admin/aliexpress-sync-media",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({listingIds:batch})});
        const data=await r.json();
        if(!r.ok) throw new Error(data.error || "Media sync failed");
        for(const item of data.results ?? []) { if(item.status==="ok") ok++; else {failed++; errors.push(String(item.id)+": "+String(item.error));} }
        setMediaMessage("Media sync: "+ok+" updated, "+failed+" failed; "+Math.min(i+20,ids.length)+"/"+ids.length+" processed.");
      }
    } catch(e){errors.push(e instanceof Error?e.message:"Media sync failed");}
    finally {setMediaBusy(false);setMediaMessage(ok+" updated, "+failed+" failed."+ (errors.length?" "+errors.slice(0,5).join("; "):""));}
  }

  const [bulkPromoOpen,setBulkPromoOpen]=useState(false);
  const [bulkPromoOptions,setBulkPromoOptions]=useState<{type:string;label:string;daysValid:number}[]>([]);
  const [bulkPromoSelected,setBulkPromoSelected]=useState<Record<string,number>>({});
  const [bulkPromoBusy,setBulkPromoBusy]=useState(false);
  const [bulkPromoMessage,setBulkPromoMessage]=useState("");
  async function openBulkPromotions(){
    if (!selectedIds.length && !listings.length) {setActionError("No listings loaded to promote.");return;}
    if (!selectedIds.length) setSelectedIds(listings.map(l=>String(l.id)));
    setBulkPromoOpen(true);setBulkPromoBusy(true);setBulkPromoMessage("");
    try{
      const res=await authFetch(`/api/admin/listings/${selectedIds[0]||listings[0].id}/promotions`);
      const data=await res.json().catch(()=>({}));
      if(!res.ok||!Array.isArray(data.options))throw Error(data.error||"Cannot load promotion options");
      setBulkPromoOptions(data.options);setBulkPromoSelected(data.options.length?{[data.options[0].type]:data.options[0].daysValid}:{});
    }catch(e){setBulkPromoMessage(e instanceof Error?e.message:"Cannot load promotions");}
    finally{setBulkPromoBusy(false);}
  }
  async function applyBulkPromotions(){
    const ids=[...selectedIds],promotions=bulkPromoOptions.filter(o=>bulkPromoSelected[o.type]!==undefined).map(o=>({type:o.type,days:bulkPromoSelected[o.type]}));
    if(!ids.length||!promotions.length){setBulkPromoMessage("Select listings and at least one promotion.");return;}
    if(promotions.some(p=>!Number.isInteger(p.days)||p.days<1||p.days>365)){setBulkPromoMessage("Each selected promotion needs 1–365 whole days.");return;}
    const total=ids.length*promotions.length;
    if(!window.confirm(`Apply ${promotions.length} promotion types to ${ids.length} listings (${total} grants)? No seller credits charged. Existing promotions of matching types will have their expiry reset.`))return;
    setBulkPromoBusy(true);setBulkPromoMessage("");
    let ok=0;const failed:string[]=[];
    const failedIds=new Set<string>();
    for(const id of ids){
      for(const promo of promotions){
        try{
          const res=await authFetch(`/api/admin/listings/${encodeURIComponent(id)}/promotions`,{method:"POST",body:JSON.stringify(promo)});
          const data=await res.json().catch(()=>({}));
          if(!res.ok||data.ok!==true)throw Error(data.error||`HTTP ${res.status}`);
          ok++;
        }catch(e){failedIds.add(id);failed.push(`${id}/${promo.type}: ${e instanceof Error?e.message:"Network error"}`);}
      }
    }
    setBulkPromoMessage(`Applied ${ok}/${total} promotion grants across ${ids.length} listings. ${failed.length?`Failures: ${failed.slice(0,10).join("; ")}`:"All promotions saved."}`);
    setSelectedIds([...failedIds]);
    setBulkPromoBusy(false);
  }
  const visibleIds=listings.map(l=>String(l.id));
  const [imageEditing, setImageEditing] = useState<number | null>(null);
  const [imageDraft, setImageDraft] = useState("");
  const [imageSaving, setImageSaving] = useState<number | null>(null);
  const [imageError, setImageError] = useState("");
  type Review={id:number;title:string;category:string;subcategory:string|null;currentThird:string;suggestedCategory:string;suggestedSubcategory:string;suggestedThird:string;thirdName:string;thirdVisible:boolean;confidence:"high"|"medium"|"low";approved:boolean;approvedAt:string|null};
  const [reviews,setReviews]=useState<Review[]>([]);
  const [reviewOpen,setReviewOpen]=useState(false);
  const [reviewLoading,setReviewLoading]=useState(false);
  const [reviewError,setReviewError]=useState("");
  const [reviewBusy,setReviewBusy]=useState<number|null>(null);
  const [catalogue, setCatalogue] = useState<CatalogueCategory[]>(() => catalogueTaxonomy([]));
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    void authFetch("/api/taxonomy/category-overrides").then(async response => {
      if (!response.ok) return;
      const { overrides } = await response.json();
      if (active && Array.isArray(overrides)) setCatalogue(catalogueTaxonomy(overrides));
    }).catch(() => {});
    return () => { active = false; };
  }, [isAdmin]);
  const categoryOptions = catalogue.filter(row => !row.subcategory_slug).map(row => ({
    slug: row.category_slug,
    name: row.name,
    subcategories: catalogue.filter(sub => sub.category_slug === row.category_slug && sub.subcategory_slug)
      .map(sub => ({ slug: sub.subcategory_slug, name: sub.name })),
  }));
  const [taxonomy,setTaxonomy]=useState<ThirdLevelCategory[]>([]);
  async function loadThirdLevelCategories(): Promise<ThirdLevelCategory[]> {
    const response = await authFetch("/api/admin/taxonomy/third-level");
    if (!response.ok) throw new Error("Could not load third-level categories.");
    const data = await response.json();
    if (!Array.isArray(data.categories)) throw new Error("Could not load third-level categories.");
    return data.categories;
  }
  const [enableThirdIds,setEnableThirdIds]=useState<number[]>([]);
  async function checkCategories(){
    const ids=selectedIds.length?selectedIds.map(Number):listings.map(x=>x.id);
    if(!ids.length)return;
    setReviewOpen(true);setReviewLoading(true);setReviewError("");setReviews([]);setEnableThirdIds([]);
    try{
      const [a,entries]=await Promise.all([
       authFetch("/api/admin/listings/category-review",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids})}),
       loadThirdLevelCategories()
      ]);
      const d=await a.json();
      if(!a.ok)throw Error(d.error||"Category check failed");
      const validEntries = entries.filter(row => categoryOptions.some(
        parent => parent.slug === row.category && parent.subcategories.some(child => child.slug === row.subcategory),
      ));
      setTaxonomy(validEntries);
      const suggestion=(title:string, options:typeof entries)=>{
        const normalized=(v:string)=>v.toLowerCase().replace(/[^a-z0-9]+/g," ");
        const words=new Set(normalized(title).split(" ").filter(Boolean));
        const ranked=options.map((o:{slug:string;name:string})=>{
          const tokens=normalized(o.name).split(" ").filter(k=>k.length>3&&!["parts","other","products"].includes(k));
          if(tokens.includes("accessories")&&!/\b(accessories|accessory|replacement|spare|attachment)\b/i.test(title))return {o,matched:0,score:0};
          const matched=tokens.filter(k=>words.has(k)||[...words].some(w=>w.startsWith(k)||k.startsWith(w))).length;
          return {o,matched,score:tokens.length?matched/tokens.length:0};
        }).filter((o:{matched:number})=>o.matched>0).sort((a:{score:number;matched:number},b:{score:number;matched:number})=>b.score-a.score||b.matched-a.matched);
        return ranked[0]?.o?.slug||"";
      };
      setReviews((d.results||[]).map((x:Review)=>{
        const choices=validEntries.filter((v:{category:string;subcategory:string})=>v.category===x.suggestedCategory&&v.subcategory===x.suggestedSubcategory);
        const suggestedThird=choices.some((v:{slug:string})=>v.slug===x.suggestedThird)?x.suggestedThird:suggestion(x.title,choices);
        return {...x,suggestedThird};
      }));
    }catch(e){setReviewError(e instanceof Error?e.message:String(e));}
    finally{setReviewLoading(false)}
  }
  const patchReview=(id:number,change:Partial<Review>)=>setReviews(prev=>prev.map(x=>x.id===id?{...x,...change}:x));
  async function approveReview(x:Review){
    setReviewBusy(x.id);setReviewError("");
    try{
      const enableThird=enableThirdIds.includes(x.id);
      const r=await authFetch(`/api/admin/listings/${x.id}/category-review`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({category:x.suggestedCategory,subcategory:x.suggestedSubcategory,thirdSlug:x.suggestedThird,enableThird})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw Error(d.error||"Failed to move listing");
      setReviews(prev=>prev.map(v=>v.id===x.id?{...v,approved:true,approvedAt:new Date().toISOString(),category:x.suggestedCategory,subcategory:x.suggestedSubcategory,currentThird:x.suggestedThird}:v));
      setListings(prev => prev.map(listing => listing.id === x.id ? {
        ...listing,
        category: x.suggestedCategory,
        subcategory: x.suggestedSubcategory,
        subsubcategory: x.suggestedThird || null,
        specifications: JSON.stringify({...parseSpecs(listing.specifications), admin_third_level_slug: x.suggestedThird}),
      } : listing));
      if(enableThird)setTaxonomy(prev=>prev.map(t=>t.category===x.suggestedCategory&&t.subcategory===x.suggestedSubcategory&&t.slug===x.suggestedThird?{...t,visible:true}:t));
    }catch(e){setReviewError(e instanceof Error?e.message:String(e));}finally{setReviewBusy(null);}
  }
  const [categoryEditing, setCategoryEditing] = useState<number | "bulk" | null>(null);
  const [categoryDraft, setCategoryDraft] = useState("electronics");
  const [subcategoryDraft, setSubcategoryDraft] = useState("audio");
  const [thirdDraft, setThirdDraft] = useState<string>();
  const [categoryTaxonomy, setCategoryTaxonomy] = useState<ThirdLevelCategory[]>([]);
  const [categoryTaxonomyLoading, setCategoryTaxonomyLoading] = useState(false);
  const [categoryTaxonomyError, setCategoryTaxonomyError] = useState("");
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryError, setCategoryError] = useState("");
  const thirdOptions = categoryTaxonomy.filter(
    item => item.category === categoryDraft && item.subcategory === subcategoryDraft,
  );
  async function loadCategoryOptions() {
    setCategoryTaxonomyLoading(true);
    setCategoryTaxonomyError("");
    try {
      setCategoryTaxonomy(await loadThirdLevelCategories());
    } catch (error) {
      setCategoryTaxonomyError(error instanceof Error ? error.message : "Could not load third-level categories.");
    } finally {
      setCategoryTaxonomyLoading(false);
    }
  }
  function beginCategoryEdit(listing?: Listing) {
    setCategoryEditing(listing?.id ?? "bulk");
    const found=categoryOptions.find(c=>c.slug===listing?.category);
    setCategoryDraft(found?.slug ?? "electronics");
    setSubcategoryDraft(found?.subcategories.some(s=>s.slug===listing?.subcategory)?listing!.subcategory!:((found??categoryOptions.find(c=>c.slug==="electronics"))?.subcategories[0]?.slug??""));
    setThirdDraft(undefined);
    setCategoryError("");
    if (!categoryTaxonomyLoading) void loadCategoryOptions();
  }
  async function saveCategories() {
    const ids=categoryEditing==="bulk"?selectedIds.map(Number):[Number(categoryEditing)];
    if (!ids.length) return;
    setCategorySaving(true);setCategoryError("");
    try {
      const res=await authFetch("/api/admin/listings/categories",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids,category:categoryDraft,subcategory:subcategoryDraft,thirdSlug:thirdDraft})});
      const data=await res.json().catch(()=>null);
      if (!res.ok) throw new Error(data?.error || "Could not save categories.");
      const changed = new Map<number, Pick<Listing, "category" | "subcategory" | "subsubcategory" | "specifications">>(
        data.updated.map((row: Listing) => [row.id, row]),
      );
      setListings(prev => prev.map(listing => {
        const update = changed.get(listing.id);
        return update ? {...listing, ...update} : listing;
      }));
      setCategoryEditing(null);setSelectedIds([]);
    } catch(e) {setCategoryError(e instanceof Error?e.message:"Could not save categories.");}
    finally {setCategorySaving(false);}
  }
  const categoryFieldClass = "min-h-9 max-w-full rounded-lg border px-2 text-xs font-semibold";
  const categoryFields=(<fieldset disabled={categorySaving} className="bz-listing-category-fields flex min-w-0 flex-wrap items-center gap-2">
    <legend className="sr-only">Listing category assignment</legend>
    <select aria-label="New listing category" value={categoryDraft} onChange={e=>{setCategoryDraft(e.target.value);setThirdDraft(undefined);setSubcategoryDraft(categoryOptions.find(c=>c.slug===e.target.value)?.subcategories[0]?.slug??"");}} className={categoryFieldClass}>
      {categoryOptions.map(c=><option key={c.slug} value={c.slug}>{c.name}</option>)}
    </select>
    <select aria-label="New listing subcategory" value={subcategoryDraft} onChange={e=>{setSubcategoryDraft(e.target.value);setThirdDraft(undefined);}} className={categoryFieldClass}>
      {categoryOptions.find(c=>c.slug===categoryDraft)?.subcategories.map(s=><option key={s.slug} value={s.slug}>{s.name}</option>)}
    </select>
    <select aria-label="New listing third-level category" className={categoryFieldClass}
      disabled={categoryTaxonomyLoading || Boolean(categoryTaxonomyError)}
      value={thirdDraft ?? "__keep__"} onChange={e => setThirdDraft(e.target.value === "__keep__" ? undefined : e.target.value)}>
      <option value="__keep__">{categoryTaxonomyLoading ? "Loading third-level categories…" : "Keep third level if parent stays the same"}</option>
      <option value="">No third-level category</option>
      {thirdOptions.map(item => <option key={item.slug} value={item.slug}>{item.name}{item.visible ? "" : " (hidden)"}</option>)}
    </select>
    {categoryTaxonomyError && <span role="status">{categoryTaxonomyError} <button type="button" onClick={() => void loadCategoryOptions()}>Retry</button></span>}
    <button type="button" disabled={categorySaving} onClick={()=>void saveCategories()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60">{categorySaving?"Saving…":"Save category"}</button>
    <button type="button" disabled={categorySaving} onClick={()=>{setCategoryEditing(null);setCategoryError("");}} className="rounded-lg border border-slate-400 px-3 py-2 text-xs font-bold">Cancel</button>
  </fieldset>);
  const LIMIT = 50;

  useEffect(() => { if (!isAdmin) setLocation("/admin"); }, [isAdmin]);
  useEffect(() => { setOffset(0); setSelectedIds([]); }, [search, filter, statusFilter]);
  useEffect(() => { load(); }, [search, filter, statusFilter, offset]);

  async function load(keepSelection = false) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
      if (search) params.set("search", search);
      if (statusFilter!=="all") params.set("status",statusFilter);
      if (filter === "imported") params.set("imported", "1");
      if (filter === "user") params.set("imported", "0");
      const res = await authFetch(`/api/admin/listings?${params}`);
      if (res.ok) {
        const d = await res.json();
        setListings(d.listings ?? []);
        if (!keepSelection) setSelectedIds([]);
        setTotal(d.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }

  const pages = Math.ceil(total / LIMIT);
  const page = Math.floor(offset / LIMIT);

  async function saveImage(listing: Listing, value = imageDraft) {
    setImageError(""); setImageSaving(listing.id);
    try {
      const res = await authFetch(`/api/admin/listings/${listing.id}/image`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: value.trim() }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not update image.");
      setListings(prev => prev.map(l => l.id === listing.id ? { ...l, image: data.image ?? null } : l));
      setImageEditing(null); setImageDraft("");
    } catch (e) { setImageError(e instanceof Error ? e.message : "Could not update image."); }
    finally { setImageSaving(null); }
  }

  return (
    <AdminLayout>
      {loading && <MarketplaceLoader area="admin" label="Loading admin listings…" />}
      <div className="admin-listings-page wp-management-page wp-listings-page">
      <AdminManagementHeader title="Listings" description="Manage marketplace listings, product visibility and source imports." meta={<span>{total.toLocaleString("en-GB")} listings match the current filters</span>} actions={<>
        <button type="button" onClick={()=>setLocation("/admin/imports")} className="wp-action wp-action-secondary"><ShoppingCart className="h-4 w-4"/>Import products</button>
        <button type="button" onClick={()=>void load()} disabled={loading} className="wp-action wp-action-primary"><RefreshCw className={"h-4 w-4 "+(loading?"animate-spin":"")}/>Refresh listings</button>
      </>}/>
      <AdminStatusTabs label="Listing status" value={statusFilter} onChange={x=>setStatusFilter(x)} options={[
        {value:"all",label:"All listings"},{value:"active",label:"Live"},{value:"pending",label:"Pending"},
        {value:"draft",label:"Drafts"},{value:"suspended",label:"Suspended"},{value:"inactive",label:"Inactive"},{value:"sold",label:"Sold"}
      ]}/>
      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" disabled={mediaBusy || !listings.length} onClick={()=>void syncMedia(listings.filter(l=>(!selectedIds.length || selectedIds.includes(String(l.id))) && String(parseSpecs(l.specifications)?.source).toLowerCase()==="aliexpress").map(l=>l.id))} className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white">{mediaBusy?"Syncing media…":"Sync AliExpress media (selected / page)"}</button>
        {mediaMessage && <p role="status" className="text-sm text-slate-100">{mediaMessage}</p>}
        <button type="button" onClick={()=>void checkCategories()} disabled={loading || !listings.length || reviewLoading} className="rounded-lg border-2 border-cyan-300 !bg-blue-700 px-4 py-2 text-xs font-black !text-white hover:!bg-blue-600">Suggest categories ({selectedIds.length||listings.length})</button>
        <button type="button" onClick={()=>setLocation("/admin/listings/categories")} className="rounded-lg border-2 border-blue-400 !bg-blue-700 px-4 py-2 text-xs font-black !text-white hover:!bg-blue-600">Manage categories & subcategories →</button>
        {([{id:"listings",label:"All Listings"},{id:"import-export",label:"Import / Export"}] as const).map(item=><button aria-pressed={view===item.id} key={item.id} type="button" onClick={()=>setView(item.id)} className={`rounded-lg border px-3 py-2 text-xs font-bold ${view===item.id?"bg-blue-600 text-white border-blue-600":"border-slate-400 bg-white text-slate-950 dark:bg-slate-800 dark:text-white"}`}>{item.label}</button>)}
      </div>
      {reviewOpen&&<div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-3"><section id="bazunk-listing-category-review" role="dialog" aria-modal="true" aria-label="Review listing categories" className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border-2 border-slate-500 !bg-[#14243c] !text-white shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-slate-500 p-4"><div><h2 className="text-xl font-black text-white">Review suggested categories</h2><p className="text-xs text-slate-200">Already-approved listings are marked Checked. You can still change their categories and approve again.</p></div><button className="rounded-lg border-2 border-slate-400 !bg-[#273b56] px-4 py-2 font-black !text-white" onClick={()=>setReviewOpen(false)}>Close</button></header>
        {reviewError&&<p role="alert" className="m-3 rounded-lg border border-red-400 !bg-red-900 p-3 font-bold text-white">{reviewError}</p>}
        <div className="flex-1 space-y-3 overflow-y-auto p-4">{reviewLoading?<p className="text-white">Checking categories…</p>:reviews.map(x=>{const choices=categoryOptions.find(c=>c.slug===x.suggestedCategory)?.subcategories||[];const thirdOptions=taxonomy.filter(t=>t.category===x.suggestedCategory&&t.subcategory===x.suggestedSubcategory);const chosen=thirdOptions.find(t=>t.slug===x.suggestedThird);return <div key={x.id} className="rounded-xl border border-slate-500 !bg-[#213651] p-4 text-white">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2"><div className="max-w-2xl"><strong className="text-sm text-white">{x.title}</strong><p className="mt-1 text-xs text-slate-200">Current: {categoryOptions.find(c=>c.slug===x.category)?.name||x.category} / {categoryOptions.find(c=>c.slug===x.category)?.subcategories.find(sc=>sc.slug===x.subcategory)?.name||x.subcategory||"none"} / {x.currentThird||"none"}</p></div><span className="rounded border border-sky-300 !bg-[#194b83] px-2 py-1 text-xs font-black !text-white">{x.approved?"✓ Checked · Already approved":"Suggestion confidence: "+x.confidence}</span></div>
          <div className="grid gap-2 md:grid-cols-3">{[1].map(()=> <Fragment key="fields"><label className="text-xs font-bold text-white">Main category<select className="mt-1 w-full rounded border-2 border-slate-400 !bg-white p-2 !text-slate-950" value={x.suggestedCategory} onChange={e=>{const cat=categoryOptions.find(c=>c.slug===e.target.value);patchReview(x.id,{suggestedCategory:e.target.value,suggestedSubcategory:cat?.subcategories[0]?.slug||"",suggestedThird:""});}}>{categoryOptions.map(c=><option key={c.slug} value={c.slug}>{c.name}</option>)}</select></label><label className="text-xs font-bold text-white">Subcategory<select className="mt-1 w-full rounded border-2 border-slate-400 !bg-white p-2 !text-slate-950" value={x.suggestedSubcategory} onChange={e=>patchReview(x.id,{suggestedSubcategory:e.target.value,suggestedThird:""})}>{choices.map(c=><option key={c.slug} value={c.slug}>{c.name}</option>)}</select></label><label className="text-xs font-bold text-white">Third-level category<select className="mt-1 w-full rounded border-2 border-slate-400 !bg-white p-2 !text-slate-950" value={x.suggestedThird} onChange={e=>patchReview(x.id,{suggestedThird:e.target.value})}><option value="">None / review later</option>{thirdOptions.map(t=><option key={t.slug} value={t.slug}>{t.name}{t.visible?"":" (hidden)"}</option>)}</select></label></Fragment>)}</div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">{chosen&&!chosen.visible?<label className="flex items-center gap-2 text-xs font-bold text-white"><input type="checkbox" checked={enableThirdIds.includes(x.id)} onChange={e=>setEnableThirdIds(prev=>e.target.checked?[...prev,x.id]:prev.filter(id=>id!==x.id))}/> Enable this hidden third-level category on the site</label>:<span className="text-xs text-slate-200">{chosen?"Third-level already enabled":"No third-level selected"}</span>}<button disabled={reviewBusy===x.id} onClick={()=>void approveReview(x)} className="rounded-lg border-2 border-blue-200 !bg-[#114ab1] px-4 py-2 text-sm font-black !text-white hover:!bg-[#1d63c7]">{reviewBusy===x.id?"Saving…":x.approved?"Save Changes / Reapprove":"Approve & Mark Checked"}</button></div>
        </div>})}{!reviewLoading&&!reviewError&&!reviews.length&&<p className="text-white">No listings left to review.</p>}</div></section></div>}
      {view!=="listings" ? <AdminListingCatalogueTools section={view}/> : <>
      {actionError&&<p role="alert" className="my-2 rounded-lg border border-red-500 p-3 font-bold text-red-500">{actionError}</p>}
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search title, ID, email…"
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#4A5CE8]/30 focus:border-[#4A5CE8]"
          />
        </div>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {(["all", "imported", "user"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors capitalize ${
                filter === f ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}>
              {f === "imported" ? "Demo / Imported" : f === "user" ? "User Listed" : "All"}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-200">Select or export current page (up to {LIMIT} listings)</span>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void deleteListings([...selectedIds])}
          disabled={deleteBusy || rowBusy !== null || !selectedIds.length}
          className="inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-3 py-2 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-50">
          <Trash2 className="h-4 w-4" /> {deleteBusy ? "Deleting…" : selectedIds.length ? `Delete selected (${selectedIds.length})` : "Delete selected"}
        </button>
        {deleteMessage && <p role="status" className="whitespace-pre-line text-sm">{deleteMessage}</p>}
      </div>
      <div className="mb-3"><AdminBulkSelection selected={selectedIds}
        rows={listings.map(l=>({id:String(l.id),cells:[l.public_id??"",l.title,l.status,l.category,l.price,l.currency,l.seller_email]}))}
        columns={["Public ID","Title","Status","Category","Price","Currency","Seller"]} filename="bazunk-admin-selected-listings" onClear={()=>setSelectedIds([])}/></div>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border-2 border-orange-400 bg-orange-50 p-3 text-slate-900"><button type="button" onClick={()=>void openBulkPromotions()} disabled={!listings.length} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-black text-white disabled:opacity-40">📣 Bulk Promote Listings</button><span className="text-xs font-semibold">{selectedIds.length ? `${selectedIds.length} selected` : `No selection — promotes all ${listings.length} loaded listings on this page`}</span></div>
      {bulkPromoOpen&&<div className="mb-4 rounded-xl border-2 border-orange-400 bg-white p-4 text-gray-900">
        <div className="mb-3 flex items-center justify-between"><h3 className="font-bold">Bulk listing promotions · {selectedIds.length} selected</h3><button type="button" onClick={()=>setBulkPromoOpen(false)} disabled={bulkPromoBusy} className="text-sm font-bold text-blue-700">Close</button></div>
        <p className="mb-3 text-sm">Admin-sponsored promotions: no seller credits charged. Only selected listings on the current page are affected. Promotions do not publish inactive listings.</p>
        <div className="mb-3 flex items-center gap-3"><button type="button" onClick={()=>setBulkPromoSelected(Object.fromEntries(bulkPromoOptions.map(o=>[o.type,o.daysValid])))} disabled={bulkPromoBusy} className="rounded-lg border border-blue-600 px-3 py-2 text-xs font-bold text-blue-700">Select all promotions</button><button type="button" onClick={()=>setBulkPromoSelected({})} disabled={bulkPromoBusy} className="rounded-lg border border-gray-400 px-3 py-2 text-xs font-bold text-gray-700">Clear promotions</button></div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {bulkPromoOptions.map(option=><div key={option.type} className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-gray-900">
            <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" disabled={bulkPromoBusy} checked={bulkPromoSelected[option.type]!==undefined} onChange={e=>setBulkPromoSelected(prev=>{const next={...prev};if(e.target.checked)next[option.type]=option.daysValid;else delete next[option.type];return next;})}/>{option.label}</label>
            {bulkPromoSelected[option.type]!==undefined&&<label className="mt-2 block text-xs font-semibold">Duration (days)<input aria-label={`${option.label} duration in days`} type="number" min="1" max="365" step="1" disabled={bulkPromoBusy} value={bulkPromoSelected[option.type]} onChange={e=>setBulkPromoSelected(prev=>({...prev,[option.type]:Number(e.target.value)}))} className="mt-1 block w-28 rounded-lg border border-gray-400 bg-white p-2 text-gray-900"/></label>}
          </div>)}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3"><span className="text-sm font-semibold">{Object.keys(bulkPromoSelected).length} promotion types × {selectedIds.length} listings = {Object.keys(bulkPromoSelected).length*selectedIds.length} grants</span><button type="button" disabled={bulkPromoBusy||!Object.keys(bulkPromoSelected).length} onClick={()=>void applyBulkPromotions()} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{bulkPromoBusy?"Applying…":"Apply selected promotions"}</button></div>
        {bulkPromoMessage&&<p role="status" className="mt-3 text-sm font-semibold">{bulkPromoMessage}</p>}
      </div>}
      {selectedIds.length > 0 && <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" onClick={()=>beginCategoryEdit()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">Change category for {selectedIds.length} selected</button>
        {(["flash", "auction"] as const).map(kind => (
          <button key={kind} type="button" className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white"
            onClick={() => setConversion({ kind, listings: listings.filter(listing => selectedIds.includes(String(listing.id))) })}>
            {kind === "flash" ? "Duplicate into flash sales" : "Convert to auctions"}
          </button>
        ))}
      </div>}
      {conversion && <BulkListingConversion kind={conversion.kind} listings={conversion.listings}
        onClose={() => setConversion(null)}
        onComplete={ids => {
          setListings(current => current.map(row => ids.includes(row.id) ? { ...row, status: "inactive" } : row));
          setSelectedIds(current => current.filter(id => !ids.includes(Number(id))));
        }} />}
      {categoryEditing==="bulk"&&<div className="bz-listing-category-editor mb-3 rounded-xl border p-3"><p className="mb-2 text-xs font-bold">Change category for {selectedIds.length} selected listings</p>{categoryFields}{categoryError&&<p role="alert" className="mt-2 text-xs font-bold text-red-500">{categoryError}</p>}</div>}
      {/* Table */}
      <div className="wp-management-table-card rounded-xl border border-slate-300 bg-white shadow-sm dark:border-slate-600 dark:bg-slate-900">
        <div className="w-full overflow-x-hidden">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="w-9 px-2 py-2"><input type="checkbox" aria-label="Select all listings on current page" className="h-4 w-4"
                  checked={visibleIds.length>0&&visibleIds.every(id=>selectedIds.includes(id))}
                  onChange={e=>setSelectedIds(e.target.checked?visibleIds:[])}/></th>
                <th className="w-[19%] px-2 py-3 text-left text-xs font-bold text-slate-800 dark:text-white">ID</th>
                <th className="w-[35%] px-2 py-3 text-left text-xs font-bold text-slate-800 dark:text-white">Title</th>
                <th className="w-[19%] px-2 py-3 text-left text-xs font-bold text-slate-800 dark:text-white">Category</th>
                <th className="w-[10%] px-2 py-3 text-left text-xs font-bold text-slate-800 dark:text-white">Price</th>
                <th className="w-[17%] px-2 py-3 text-left text-xs font-bold text-slate-800 dark:text-white">Seller</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="text-center py-16">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-300" />
                </td></tr>
              )}
              {!loading && listings.length === 0 && (
                <tr><td colSpan={6} className="py-16 text-center">
                  <Package className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                  <p className="text-sm text-gray-400 font-medium">No listings found</p>
                </td></tr>
              )}
              {!loading && listings.map(l => {
                const isImported = l.public_id?.startsWith("BZK-DEMO-") ?? false;
                const specs = parseSpecs(l.specifications);
                const aliExpressUrl = aliExpressSourceUrl(specs, l.public_id);
                const ebayItemId = specs.item_id ?? specs.own_ebay_item_id;
                const ebayUrl = specs.ebay_url ?? (ebayItemId ? `https://www.ebay.co.uk/itm/${ebayItemId}` : undefined);
                return (
                  <Fragment key={l.id}>
                  <tr className="border-t border-slate-300 dark:border-slate-700">
                    <td className="px-3 py-2"><input type="checkbox" aria-label={`Select listing ${l.public_id||l.id}`} className="h-4 w-4"
                      checked={selectedIds.includes(String(l.id))}
                      onChange={e=>setSelectedIds(p=>e.target.checked?[...new Set([...p,String(l.id)])]:p.filter(x=>x!==String(l.id)))}/></td>
                    {/* ID */}
                    <td className="px-2 py-3 break-all align-top">
                      <div className="flex flex-col gap-1">
                        <span className="font-mono text-[11px] text-slate-700 dark:text-slate-200 break-all">{l.public_id ?? `#${l.id}`}</span>
                        {isImported && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-700 text-[10px] font-bold w-fit">
                            <ShoppingCart className="w-2.5 h-2.5" />
                            Imported
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Title */}
                    <td className="px-2 py-3 align-top">
                      <div className="flex gap-2 items-start"><div className="w-12 h-12 rounded-lg border bg-gray-50 shrink-0 overflow-hidden flex items-center justify-center">{l.image ? <img src={l.image.startsWith("/api/listing-media/") ? `https://bazunk-api-ifqs.onrender.com${l.image}` : l.image} alt="" className="w-full h-full object-contain" /> : <Package className="w-5 h-5 text-gray-300" />}</div><p className="font-medium text-slate-900 dark:text-white text-xs leading-snug break-words">{l.title}</p></div>
                      <p className="text-[10px] text-gray-400 mt-0.5 capitalize">{l.condition}</p>
                    </td>

                    {/* Category */}
                    <td className="px-2 py-3 break-words text-xs text-slate-700 dark:text-slate-200 align-top">
                      <span className="capitalize">{l.category.replace(/-/g, " ")}</span>
                      {l.subcategory && <span className="text-slate-600 dark:text-slate-200"> · {l.subcategory.replace(/-/g, " ")}</span>}
                      {(l.subsubcategory || specs.admin_third_level_slug) && <span className="text-slate-600 dark:text-slate-200"> · {(l.subsubcategory || specs.admin_third_level_slug || "").replace(/-/g, " ")}</span>}
                    </td>

                    {/* Price */}
                    <td className="px-2 py-3 font-bold text-slate-950 dark:text-white align-top">
                      £{parseFloat(l.price).toFixed(2)}
                    </td>

                    {/* Seller */}
                    <td className="px-2 py-3 min-w-0 align-top">
                      <p className="text-xs text-slate-800 dark:text-white break-all">{l.seller_email}</p>
                      {l.seller_username && <p className="text-[10px] text-slate-600 dark:text-slate-300">@{l.seller_username}</p>}
                    </td>

                  </tr>
                  <tr className="bz-admin-listing-actions border-b border-slate-700 !bg-[#101e35] text-white">
                    <td />
                    <td colSpan={5} className="px-3 pb-3 pt-2 align-top !bg-[#101e35] text-white">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <div className="mt-2 flex flex-wrap gap-2 items-center"><AdminListingPromotion listingId={l.id} title={l.title} status={l.status} /></div>
                      <div className="mt-2 flex flex-wrap items-center gap-2" aria-label="Listing status and source">
                        <span className={`rounded-full px-2 py-1 text-xs font-bold capitalize ${STATUS_STYLE[l.status] ?? "bg-gray-200 text-gray-900"}`}>{l.status}</span>
                        {ebayUrl ? <a href={ebayUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-lg border-2 border-white bg-[#075985] px-3 py-2 text-xs font-black !text-white no-underline hover:bg-[#0369a1]"><ExternalLink className="h-3 w-3"/> {ebayItemId ? `eBay ${ebayItemId}` : "View on eBay"}</a>
                          : specs.amazon_url ? <a href={specs.amazon_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-lg border-2 border-white bg-[#92400e] px-3 py-2 text-xs font-black !text-white no-underline hover:bg-[#b45309]"><ExternalLink className="h-3 w-3"/> {specs.asin ?? "View on Amazon"}</a> : null}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2" aria-label={`Actions for ${l.title}`}>
                        <a href={`/listing/${l.public_url_token||l.public_id||l.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center rounded-lg border-2 border-white bg-[#334155] px-3 py-2 text-xs font-black !text-white hover:bg-[#475569]">View on Bazunk</a>
                        {aliExpressUrl && <button type="button" disabled={mediaBusy} onClick={()=>void syncMedia([l.id])} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white">Sync Media</button>}
                        {aliExpressUrl && <a href={aliExpressUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border-2 border-white bg-[#334155] px-3 py-2 text-xs font-black !text-white hover:bg-[#475569]">
                          <ExternalLink className="h-3 w-3" /> View on AliExpress
                        </a>}
                        <button type="button" onClick={()=>void copyAdminListingLink(l)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#6782a8] bg-[#1b385c] px-3 py-2 text-xs font-bold text-white hover:bg-[#2e527d]"><Copy className="h-3.5 w-3.5"/>{copiedId===l.id?"Copied":"Copy public link"}</button>
                        <button type="button" onClick={()=>shareAdminListing(l)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#6782a8] bg-[#1b385c] px-3 py-2 text-xs font-bold text-white hover:bg-[#2e527d]"><Share2 className="h-3.5 w-3.5"/>Share preview</button>
                        <button type="button" onClick={()=>setSharingId(sharingId===l.id?null:l.id)} aria-expanded={sharingId===l.id} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-orange-500 bg-[#2d344b] px-3 py-2 text-xs font-bold text-white hover:bg-[#3d4f68]"><Flag className="h-3.5 w-3.5"/>Sharing &amp; trust</button>
                        <button type="button" onClick={()=>setEditingId(l.id)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border-2 border-white bg-blue-700 px-3 py-2 text-xs font-black !text-white hover:bg-blue-600 dark:bg-blue-600 dark:text-white"><Pencil className="inline h-3 w-3"/> Edit Listing</button>
                        <button type="button" disabled={rowBusy===l.id||l.status==="inactive"} onClick={()=>void hideListing(l.id)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border-2 border-white bg-amber-700 px-3 py-2 text-xs font-black !text-white hover:bg-amber-500 dark:bg-amber-600 dark:text-white disabled:cursor-not-allowed disabled:opacity-60"><EyeOff className="inline h-3 w-3"/> Hide</button>
                        <button type="button" disabled={deleteBusy||rowBusy===l.id} onClick={()=>void deleteListings([String(l.id)])} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border-2 border-white bg-red-700 px-3 py-2 text-xs font-black !text-white hover:bg-red-600 dark:bg-red-600 dark:text-white disabled:cursor-not-allowed disabled:opacity-60"><Trash2 className="inline h-3 w-3"/> Delete</button>
                      
                      </div>
                      {sharingId===l.id&&<div className="mt-3 rounded-xl border border-orange-500 bg-[#132a48] p-4 text-white"><h4 className="mb-2 text-sm font-extrabold">Sharing &amp; trust · Listing #{l.id}</h4><div className="flex flex-wrap gap-2"><button type="button" onClick={()=>void copyAdminListingLink(l)} className="rounded-lg border border-[#6b88ab] px-3 py-2 text-xs font-bold hover:bg-[#284a70]"><Link2 className="mr-1 inline h-3.5 w-3.5"/>Copy public URL</button><a href={publicListingUrl(l)} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-[#6b88ab] px-3 py-2 text-xs font-bold text-white hover:bg-[#284a70]"><ExternalLink className="mr-1 inline h-3.5 w-3.5"/>Open listing</a><a href="/admin/support" className="rounded-lg border border-orange-500 px-3 py-2 text-xs font-bold text-orange-200 hover:bg-[#284a70]"><Flag className="mr-1 inline h-3.5 w-3.5"/>Review support tickets</a></div><p className="mt-2 text-xs text-slate-200">Listing reports are submitted as support tickets. Review incoming reports in the support workspace before changing listing visibility.</p></div>}
                      {categoryEditing===l.id && <div className="bz-listing-category-editor mt-2 rounded-lg border p-2">{categoryFields}{categoryError&&<p role="alert" className="mt-2 text-xs font-bold text-red-500">{categoryError}</p>}</div>}
                      {imageEditing === l.id && <div className="mt-2 rounded-lg border border-gray-200 p-2 bg-gray-50"><input autoFocus value={imageDraft} onChange={e=>setImageDraft(e.target.value)} placeholder="https://… image URL" className="w-full rounded-md border bg-white px-2 py-1.5 text-xs text-gray-800" /><div className="mt-2 flex gap-2"><button disabled={imageSaving===l.id} onClick={()=>void saveImage(l)} className="rounded-md bg-[#4A5CE8] text-white px-2 py-1 text-[10px] font-bold disabled:opacity-50">{imageSaving===l.id?"Saving…":"Save image"}</button><button onClick={()=>{setImageEditing(null);setImageDraft("");setImageError("");}} className="rounded-md border px-2 py-1 text-[10px] font-bold">Cancel</button>{l.image&&<button disabled={imageSaving===l.id} onClick={()=>void saveImage(l,"")} className="text-[10px] text-red-600 ml-auto">Remove</button>}</div>{imageError&&<p className="text-[10px] text-red-600 mt-1">{imageError}</p>}</div>}

                      </div>
                    </td>
                  </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-xs text-gray-400">
              Showing {offset + 1}–{Math.min(offset + LIMIT, total)} of {total.toLocaleString()}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                disabled={offset === 0}
                className="px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
              >← Prev</button>
              <span className="px-3 py-1.5 text-xs text-gray-500">{page + 1} / {pages}</span>
              <button
                onClick={() => setOffset(offset + LIMIT)}
                disabled={offset + LIMIT >= total}
                className="px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
              >Next →</button>
            </div>
          </div>
        )}
      </div>
      </>}

      {editingId!==null&&<AdminListingEditor listingId={editingId} onClose={()=>setEditingId(null)} onSaved={()=>{setEditingId(null);void load();}}/>}
      </div>
    </AdminLayout>
  );
}
