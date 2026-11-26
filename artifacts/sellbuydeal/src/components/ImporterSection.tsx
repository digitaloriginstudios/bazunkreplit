import { AliExpressShippingDefaults, aliExpressShipZone, defaultAliExpressDestinations } from "./AliExpressShippingDefaults";
import { useState, useEffect, useCallback, useLayoutEffect, useRef, useId } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import "./aliexpress-import-dialog.css";
import {
  Package, RefreshCw, Trash2, ExternalLink, Edit2, Plus, X,
  AlertCircle, CheckCircle2, Clock, Loader2, ShoppingBag, Info,
  ChevronDown, ChevronUp, Search, Zap,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useAdmin } from "@/context/AdminContext";
import { ACTIVE_CATEGORIES as SITE_CATEGORIES, resolveCategory } from "@/data/categories";

interface SupplierImport {
  id: number;
  listing_id: number;
  public_id: string;
  title: string;
  bazunk_price: string;
  listing_currency?: string;
  image: string | null;
  listing_status: string;
  supplier_source: string;
  supplier_id: string;
  supplier_url: string;
  supplier_price: string;
  supplier_currency: string;
  markup_type: string;
  markup_value: string;
  last_synced_at: string | null;
  sync_status: string;
  sync_error: string | null;
  created_at: string;
}

const USD_TO_GBP = 0.79;

function calcBazunkPrice(supplierUsd: number, markupType: string, markupValue: number, rate = USD_TO_GBP): number {
  const gbp = supplierUsd * rate;
  if (markupType === "fixed") return Math.round((gbp + markupValue) * 100) / 100;
  return Math.round(gbp * (1 + markupValue / 100) * 100) / 100;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function StatusBadge({ status, error }: { status: string; error?: string | null }) {
  if (status === "ok") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">
      <CheckCircle2 className="w-3 h-3" /> Synced
    </span>
  );
  if (status === "error") return (
    <span title={error ?? undefined} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-600 text-xs font-semibold cursor-help">
      <AlertCircle className="w-3 h-3" /> Error
    </span>
  );
  if (status === "syncing") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-600 text-xs font-semibold">
      <Loader2 className="w-3 h-3 animate-spin" /> Syncing
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-semibold">
      <Clock className="w-3 h-3" /> Pending
    </span>
  );
}

interface ImportModalProps {
  onClose: () => void;
  onSuccess: () => void;
  userEmail: string;
  userName: string;
  initialUrl?: string;
  initialMarkup?: string;
  initialMarket?: "uk" | "us";
  initialQuantity?: string;
  initialOrigin?: string;
  initialDestinations?: string[];
  initialPostage?: string;
}

const CONDITIONS = ["new", "like new", "good", "fair", "poor"];

export function ImportModal({ onClose, onSuccess, userEmail, userName, initialUrl = "", initialMarkup = "30", initialMarket = "uk", initialQuantity = "1", initialOrigin = "CN", initialDestinations = defaultAliExpressDestinations, initialPostage = "" }: ImportModalProps) {
  const { authFetch } = useAdmin();
  const [url, setUrl] = useState(initialUrl);
  const [market, setMarket] = useState(initialMarket);
  const [quantity, setQuantity] = useState(initialQuantity);
  const currencySymbol = market === "uk" ? "£" : "$";
  const [title, setTitle] = useState("");
  const [supplierPriceUsd, setSupplierPriceUsd] = useState("");
  const [supplierQuote, setSupplierQuote] = useState<{ amount: number; currency: string } | null>(null);
  const [usdToGbp, setUsdToGbp] = useState<number | null>(null);
  const [rateError, setRateError] = useState("");
  const [rateLoading, setRateLoading] = useState(false);
  const [savedPrice, setSavedPrice] = useState<number | null>(null);
  const fetchRef = useRef(authFetch);
  fetchRef.current = authFetch;
  const loadRate = useCallback(async () => {
    setRateLoading(true);
    setRateError("");
    try {
      const response = await fetchRef.current("/api/admin/aliexpress-import-rate");
      const data = await response.json() as { usdToGbp?: number; error?: string };
      if (!response.ok || typeof data.usdToGbp !== "number" || !Number.isFinite(data.usdToGbp) || data.usdToGbp <= 0) {
        throw new Error(data.error || "The USD/GBP rate is unavailable.");
      }
      setUsdToGbp(data.usdToGbp);
    } catch (err) {
      setUsdToGbp(null);
      setRateError(err instanceof Error ? err.message : "The USD/GBP rate is unavailable.");
    } finally {
      setRateLoading(false);
    }
  }, []);
  useEffect(() => { if (market === "uk") void loadRate(); }, [market, loadRate]);
  const [imageUrl, setImageUrl] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [condition, setCondition] = useState("new");
  const [description, setDescription] = useState("");
  const [markupType, setMarkupType] = useState<"percentage" | "fixed">("percentage");
  const [markupValue, setMarkupValue] = useState(initialMarkup);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewNotice, setPreviewNotice] = useState("");
  const [supplierCurrency, setSupplierCurrency] = useState("USD");
  const [lastPreviewUrl, setLastPreviewUrl] = useState("");
  type Choice = { id: string; label: string; image: string | null; priceUsd: number | null; quantity: number | null; origin: string | null };
  const [choices, setChoices] = useState<Choice[]>([]);
  const [variantEdits, setVariantEdits] = useState<Record<string, { enabled: boolean; usd: string; quantity: string }>>({});
  const [savedCount, setSavedCount] = useState(0);
  const [sku, setSku] = useState("");
  const [shipOrigin, setShipOrigin] = useState(initialOrigin);
  const [destinations, setDestinations] = useState(initialDestinations);
  const [shippingPrice, setShippingPrice] = useState(initialPostage);
  const shipZone = aliExpressShipZone(destinations);
  const [deliveryEstimate, setDeliveryEstimate] = useState("");
  const [gallery, setGallery] = useState<string[]>([]);
  const [attributes, setAttributes] = useState<{ key: string; value: string }[]>([]);
  const previewSequence = useRef(0);
  function clearShipping() {

    setDeliveryEstimate("");
  }
  const fetchPreview = useCallback(async (productUrl: string, targetMarket: "uk" | "us", selectedSku = "") => {
    if (!productUrl.trim()) return;
    const sequence = ++previewSequence.current;
    setPreviewLoading(true);
    setPreviewNotice("");
    setSupplierQuote(null);
    clearShipping();
    try {
      const query = new URLSearchParams({ url: productUrl.trim(), market: targetMarket, sku: selectedSku });
      const response = await fetchRef.current("/api/admin/aliexpress-product-preview?" + query);
      const data = await response.json() as {
        error?: string; title?: string; description?: string; imageUrl?: string; supplierPrice?: number; currency?: string;
        origin?: string; selectedSku?: string; choices?: Choice[];
        shipping?: { origin: string | null; destination: string; amount: number; estimate: string };
        images?: string[]; attributes?: { key: string; value: string }[];
      };
      if (sequence !== previewSequence.current) return;
      if (!response.ok) throw new Error(data.error || "Product details unavailable");
      if (!selectedSku) {
        if (data.title) setTitle(data.title);
        if (data.description) setDescription(data.description);
        if (data.imageUrl) setImageUrl(data.imageUrl);
        setGallery(data.images ?? []);
        setAttributes(data.attributes ?? []);
      }
      setSupplierQuote(typeof data.supplierPrice === "number" && data.supplierPrice > 0 && data.currency
        ? { amount: data.supplierPrice, currency: data.currency }
        : null);
      setSupplierCurrency(data.currency || "USD");
      setLastPreviewUrl(productUrl);
      const available = data.choices ?? [];
      const selected = available.find(choice => choice.id === data.selectedSku);
      setChoices(available);
      setVariantEdits(previous => Object.fromEntries(available.map(choice => [choice.id, previous[choice.id] ?? {
        enabled: true, usd: choice.priceUsd == null ? "" : String(choice.priceUsd),
        quantity: choice.quantity == null ? "" : String(choice.quantity),
      }])));
      setSku(data.selectedSku ?? "");
      const fetchedPrice = selected?.priceUsd ?? (data.currency === "USD" && available.length <= 1 ? data.supplierPrice : undefined);
      if (typeof fetchedPrice === "number" && Number.isFinite(fetchedPrice) && fetchedPrice > 0)
        setSupplierPriceUsd(previous => previous || String(fetchedPrice));
      if (selected?.quantity != null) setQuantity(String(selected.quantity));
      setPreviewNotice(data.shipping
        ? `AliExpress quoted ${data.shipping.amount.toFixed(2)} ${targetMarket === "uk" ? "GBP" : "USD"} for one item to the selected marketplace. Set your own general postage rule below.`
        : "Product details retrieved. Review the general shipping settings before importing.");
    } catch (error) {
      if (sequence === previewSequence.current)
        setPreviewNotice((error instanceof Error ? error.message : "Preview unavailable") + " Enter missing fields manually.");
    } finally {
      if (sequence === previewSequence.current) setPreviewLoading(false);
    }
  }, []);
  useEffect(() => { if (initialUrl) void fetchPreview(initialUrl, initialMarket); }, [initialUrl, initialMarket, fetchPreview]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [importedTitle, setImportedTitle] = useState("");

  const usd = Number(supplierPriceUsd);
  const mv = Number(markupValue);
  const listingRate = market === "uk" ? usdToGbp : 1;
  const stock = Number(quantity);
  const bazunkPreview = listingRate !== null && Number.isFinite(usd) && usd > 0 &&
    Number.isFinite(mv) && mv >= 0 && mv <= 1000
    ? calcBazunkPrice(usd, markupType, mv, listingRate)
    : null;

  const subcategories = SITE_CATEGORIES.find(c => c.slug === category)?.subcategories ?? [];
  const multi = choices.length > 1;
  const variants = choices.filter(choice => variantEdits[choice.id]?.enabled).map(choice => {
    const edit = variantEdits[choice.id];
    const priceUsd = Number(edit.usd);
    const quantity = edit.quantity === "" ? NaN : Number(edit.quantity);
    return { sku: choice.id, label: choice.label, origin: choice.origin, image: choice.image, priceUsd, quantity,
      expectedSellingPrice: listingRate === null ? 0 : calcBazunkPrice(priceUsd, markupType, mv, listingRate) };
  });
  const canSubmit = url.trim() && title.trim() && !!category && !loading && !previewLoading &&
    listingRate !== null && (market === "us" || !rateLoading) && Number.isFinite(mv) && mv >= 0 && mv <= 1000 &&
    (multi ? variants.length > 0 && variants.length <= 200 && variants.every(row => Number.isFinite(row.priceUsd) && row.priceUsd > 0 &&
      Number.isInteger(row.quantity) && row.quantity >= 0 && row.quantity <= 2147483647 && row.expectedSellingPrice > 0)
    : bazunkPreview !== null && bazunkPreview > 0 && Number.isInteger(stock) && stock > 0 && stock <= 2147483647);

  async function handleImport() {
    if (!canSubmit) return;
    setError("");
    setLoading(true);
    try {
      const r = await authFetch("/api/admin/import-aliexpress-product", {
        method: "POST",
        body: JSON.stringify({
          url: url.trim(),
          sellerEmail: userEmail,
          title: title.trim(),
          supplierPriceUsd: usd,
          market,
          quantity: multi ? 1 : stock,
          variants: multi ? variants : undefined,
          shipOrigin,
          shipZone,
          shippingPrice: shipZone ? shippingPrice : null,
          deliveryEstimate,
          images: gallery,
          attributes,
          expectedSellingPrice: bazunkPreview,
          imageUrl: imageUrl.trim() || null,
          ...resolveCategory(category, subcategory),
          condition,
          description: description.trim() || null,
          markupType,
          markupValue: mv,
        }),
      });
      const data = await r.json() as Record<string, unknown>;
      if (!r.ok) {
        if (r.status === 409 && typeof data.usdToGbp === "number") setUsdToGbp(data.usdToGbp);
        setError((data.error as string) ?? "Import failed");
      } else {
        setImportedTitle(title.trim());
        setSavedCount(typeof data.imported === "number" ? data.imported : 1);
        setSavedPrice(typeof data.sellingPrice === "number" ? data.sellingPrice : null);
        setSuccess(true);
        onSuccess();
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const inputCls = "w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#F26B21]/30 focus:border-[#F26B21]";

  return createPortal(
    <dialog
      ref={dialogRef}
      className="aliexpress-import-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#F26B21] flex items-center justify-center">
            <ShoppingBag className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 id={titleId} className="font-bold text-gray-900">Import from AliExpress</h2>
            <p id={descriptionId} className="text-xs text-gray-600">Fill in the details from the AliExpress listing</p>
          </div>
        </div>
        <button type="button" aria-label="Close AliExpress import" onClick={onClose} className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {success ? (
        <div className="px-6 py-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-7 h-7 text-emerald-600" />
          </div>
          <p className="font-bold text-gray-900 text-lg">{savedCount > 1 ? `${savedCount} options imported` : savedPrice === null ? "Imported!" : `Imported at ${currencySymbol}${savedPrice.toFixed(2)}`}</p>
          <p className="text-sm text-gray-400 mt-1 mb-6 truncate px-4">{importedTitle}</p>
          <div className="flex gap-3">
            <button onClick={() => { setSuccess(false); clearShipping(); setChoices([]); setVariantEdits({}); setSku(""); setGallery([]); setAttributes([]); setUrl(""); setTitle(""); setSupplierPriceUsd(""); setSupplierQuote(null); setImageUrl(""); setDescription(""); }} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
              Import Another
            </button>
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-bold hover:bg-gray-800 transition-colors">
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="min-h-0 overflow-y-auto overscroll-contain flex-1 px-6 py-5 space-y-4">
          {/* How-to tip */}
          <div className="bg-blue-50 rounded-xl px-4 py-3 text-xs text-blue-700 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>Open the AliExpress product page, copy the URL and the details below. Bazunk will track this supplier link and manage your markup automatically.</span>
          </div>

          {/* AliExpress URL */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">AliExpress Product URL <span className="text-red-400">*</span></label>
            <input value={url} onChange={e => { previewSequence.current++;
              setPreviewLoading(false); setPreviewNotice(""); setLastPreviewUrl(""); setUrl(e.target.value);
              setSupplierPriceUsd(""); setSupplierQuote(null); clearShipping(); setChoices([]); setVariantEdits({}); setSku("");
              setTitle(""); setDescription(""); setImageUrl(""); setGallery([]); setAttributes([]); }} placeholder="https://www.aliexpress.com/item/1005007123456789.html" className={inputCls} />
            <button type="button" disabled={previewLoading || !url.trim()} onClick={() => void fetchPreview(url, market, sku)} className="mt-2 rounded-lg bg-orange-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{previewLoading ? "Fetching product details…" : lastPreviewUrl === url ? "Refresh product details" : "Fetch product details"}</button>
            {previewNotice && <p role="status" className="mt-2 text-xs text-gray-600">{previewNotice}</p>}
            {imageUrl && <img src={imageUrl} alt="Supplier product preview" className="mt-2 h-28 w-28 rounded-lg border object-contain" />}

          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Product Title <span className="text-red-400">*</span></label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Waterproof LED Strip Lights 5m RGB" className={inputCls} />
          </div>

          {/* Price + Image */}
          <div className="grid grid-cols-2 gap-3">
            {!multi && <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Supplier Price (USD) <span className="text-red-400">*</span></label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium">$</span>
                <input type="number" min="0.01" step="0.01" value={supplierPriceUsd} onChange={e => setSupplierPriceUsd(e.target.value)} placeholder="e.g. 38.00" className={`${inputCls} pl-7`} />
              </div>
              <p className="mt-1 text-xs text-gray-600">Enter the USD price of the exact option you’re importing.
                {supplierQuote && ` API quote: ${supplierQuote.amount.toFixed(2)} ${supplierQuote.currency}.`}
              </p>
            </div>}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Category <span className="text-red-400">*</span></label>
              <select value={category} onChange={e => { setCategory(e.target.value); setSubcategory(""); }} className={`${inputCls} bg-white`}>
                <option value="">Select category</option>
                {SITE_CATEGORIES.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>
            </div>
          </div>

          {/* Subcategory (same list as Direct Sale) */}
          {subcategories.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Subcategory <span className="text-gray-400 font-normal">(optional)</span></label>
              <select value={subcategory} onChange={e => setSubcategory(e.target.value)} className={`${inputCls} bg-white`}>
                <option value="">All subcategories</option>
                {subcategories.map(s => <option key={s.slug} value={s.slug}>{s.name}</option>)}
              </select>
            </div>
          )}

          {/* Condition + Image URL */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Condition</label>
              <select value={condition} onChange={e => setCondition(e.target.value)} className={`${inputCls} bg-white`}>
                {CONDITIONS.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Image URL <span className="text-gray-400 font-normal">(optional)</span></label>
              <input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://ae01.alicdn.com/..." className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold text-gray-600">
              Marketplace
              <select value={market} onChange={e => {
                const next = e.target.value === "us" ? "us" : "uk";
                setMarket(next);
                setVariantEdits({});
                setSupplierPriceUsd("");
                void fetchPreview(url, next, sku);
                if (!url.trim()) clearShipping();
              }} className={`${inputCls} mt-1.5 bg-white`} disabled={loading || success}>
                <option value="uk">UK · GBP</option>
                <option value="us">USA · USD</option>
              </select>
            </label>
            {!multi && <label className="block text-xs font-semibold text-gray-600">
              Quantity
              <input type="number" min="1" max="2147483647" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} className={`${inputCls} mt-1.5`} />
            </label>}
          </div>

          {multi && <section className="space-y-2 rounded-xl border border-gray-200 p-3" aria-label="Product options to import">
            <h3 className="text-sm font-bold">Product options to import</h3>
            <p className="text-xs text-gray-600">Selected options share one listing and have their own prices and stock. Confirm any missing USD price or stock before importing.</p>
            {choices.map(choice => {
              const edit = variantEdits[choice.id];
              if (!edit) return null;
              const update = (change: Partial<typeof edit>) => setVariantEdits(current => ({
                ...current, [choice.id]: { ...current[choice.id], ...change },
              }));
              const price = variants.find(row => row.sku === choice.id)?.expectedSellingPrice;
              return <div key={choice.id} className="grid grid-cols-2 gap-2 rounded-lg border p-2 text-xs">
                <label className="col-span-2 flex items-center gap-2 font-semibold">
                  <input type="checkbox" checked={edit.enabled} onChange={e => update({ enabled: e.target.checked })} />{choice.label}
                </label>
                <label>Supplier USD<input type="number" min="0.01" step="0.01" value={edit.usd} disabled={!edit.enabled}
                  onChange={e => update({ usd:e.target.value })} className={inputCls} /></label>
                <label>Quantity<input type="number" min="0" step="1" value={edit.quantity} disabled={!edit.enabled}
                  onChange={e => update({ quantity:e.target.value })} className={inputCls} /></label>
                {price != null && Number.isFinite(price) && Number(edit.usd) > 0 &&
                  <p className="col-span-2">Listing price {currencySymbol}{price.toFixed(2)}</p>}
              </div>;
            })}
          </section>}

          <section className="space-y-2 rounded-xl border border-gray-200 p-3" aria-label="Shipping details">
            <h3 className="text-sm font-bold">Shipping</h3>
            <AliExpressShippingDefaults origin={shipOrigin} destinations={destinations} setOrigin={setShipOrigin} setDestinations={setDestinations} />
            <label className="block text-xs font-semibold">General postage ({market === "uk" ? "GBP" : "USD"})
              <input type="number" min="0" step="0.01" value={shippingPrice} onChange={e => setShippingPrice(e.target.value)}
                disabled={!shipZone} placeholder="Unconfirmed" className={inputCls} />
            </label>
            <label className="block text-xs font-semibold">Estimated delivery (optional)
              <input value={deliveryEstimate} onChange={e => setDeliveryEstimate(e.target.value)}
                disabled={!shipZone} placeholder="e.g. 5–8 days" className={inputCls} />
            </label>
            {(gallery.length > 1 || attributes.length > 0) && <p className="text-xs text-gray-600">
              Additional supplier photos and product specifications will be saved with the listing.
            </p>}
          </section>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Description <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Copy the product description from AliExpress…" rows={2} className={`${inputCls} resize-none`} />
          </div>

          {/* Markup */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Markup Type</label>
              <select value={markupType} onChange={e => setMarkupType(e.target.value as "percentage" | "fixed")} className={`${inputCls} bg-white`}>
                <option value="percentage">Percentage (%)</option>
                <option value="fixed">Fixed amount ({currencySymbol})</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">{markupType === "percentage" ? "Markup %" : `Add ${currencySymbol}`}</label>
              <input type="number" min="0" step={markupType === "percentage" ? "1" : "0.01"} value={markupValue} onChange={e => setMarkupValue(e.target.value)} className={inputCls} />
            </div>
          </div>

          {market === "uk" && rateLoading && <p role="status" className="text-xs text-gray-600">Checking the USD/GBP rate…</p>}
          {market === "uk" && rateError && <p role="alert" className="text-sm text-red-700">{rateError}{" "}
            <button type="button" onClick={loadRate} className="font-semibold underline">Retry rate check</button>
          </p>}

          {/* Live price preview */}
          {!multi && bazunkPreview !== null && (
            <div className="bg-[#F26B21]/8 rounded-xl px-4 py-3 flex items-center justify-between text-sm">
              <span className="text-gray-500 text-xs">
                ${usd.toFixed(2)} USD {market === "uk" && `→ £${(usd * (usdToGbp ?? 0)).toFixed(2)} GBP`}
                {markupType === "percentage" ? ` +${mv}%` : ` +${currencySymbol}${mv.toFixed(2)}`}
              </span>
              <span className="font-black text-[#F26B21] text-base">{currencySymbol}{bazunkPreview.toFixed(2)}</span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <button
            onClick={handleImport}
            disabled={!canSubmit}
            className="w-full py-2.5 rounded-xl bg-[#F26B21] text-white font-bold text-sm hover:bg-[#e0601d] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {loading ? "Importing…" : multi ? `Create listing with ${variants.length} options` : "Create Listing"}
          </button>
        </div>
      )}
    </dialog>,
    document.body,
  );
}

interface MarkupEditProps {
  item: SupplierImport;
  onSave: (markupType: string, markupValue: number) => Promise<void>;
  onClose: () => void;
}

function MarkupEditModal({ item, onSave, onClose }: MarkupEditProps) {
  const [markupType, setMarkupType] = useState(item.markup_type);
  const [markupValue, setMarkupValue] = useState(item.markup_value);
  const [saving, setSaving] = useState(false);

  const symbol = item.listing_currency === "USD" ? "$" : "£";
  const preview = calcBazunkPrice(parseFloat(item.supplier_price), markupType, parseFloat(markupValue) || 0, item.listing_currency === "USD" ? 1 : undefined);

  async function handleSave() {
    setSaving(true);
    await onSave(markupType, parseFloat(markupValue));
    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <p className="font-bold text-gray-900">Edit Markup</p>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center text-gray-500"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-sm text-gray-500 truncate mb-4">{item.title}</p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Markup Type</label>
            <select
              value={markupType}
              onChange={e => setMarkupType(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#F26B21]/30 focus:border-[#F26B21] bg-white"
            >
              <option value="percentage">Percentage (%)</option>
              <option value="fixed">Fixed amount ({symbol})</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              {markupType === "percentage" ? "Markup %" : `Add ${symbol}`}
            </label>
            <input
              type="number" min="0" step={markupType === "percentage" ? "1" : "0.01"}
              value={markupValue} onChange={e => setMarkupValue(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#F26B21]/30 focus:border-[#F26B21]"
            />
          </div>
          <div className="bg-gray-50 rounded-xl p-3 text-sm">
            <span className="text-gray-500">Supplier price: </span>
            <span className="font-semibold">${item.supplier_price} USD</span>
            <span className="text-gray-400 mx-2">→</span>
            <span className="text-gray-500">Bazunk price: </span>
            <span className="font-bold text-[#F26B21]">{symbol}{preview.toFixed(2)}</span>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full mt-4 py-2.5 rounded-xl bg-[#F26B21] text-white font-bold text-sm hover:bg-[#e0601d] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Save Changes
        </button>
      </motion.div>
    </div>
  );
}

export function ImporterSection() {
  const { user } = useAuth();
  const [imports, setImports] = useState<SupplierImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingItem, setEditingItem] = useState<SupplierImport | null>(null);
  const [syncingIds, setSyncingIds] = useState<Set<number>>(new Set());
  const [syncingAll, setSyncingAll] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [apiKeyMissing, setApiKeyMissing] = useState(false);

  const fetchImports = useCallback(async () => {
    if (!user?.email) return;
    try {
      const r = await fetch(`/api/supplier/imports?email=${encodeURIComponent(user.email)}`);
      const data = await r.json() as SupplierImport[];
      setImports(Array.isArray(data) ? data : []);
    } catch {
      setImports([]);
    } finally {
      setLoading(false);
    }
  }, [user?.email]);

  useEffect(() => { fetchImports(); }, [fetchImports]);

  async function handleSync(id: number) {
    setSyncingIds(s => new Set(s).add(id));
    try {
      const r = await fetch(`/api/supplier/imports/${id}/sync`, { method: "POST" });
      const data = await r.json() as Record<string, unknown>;
      if (r.status === 503) setApiKeyMissing(true);
      if (r.ok) await fetchImports();
      else if (data.error && !r.ok && r.status !== 503) console.warn(data.error);
    } finally {
      setSyncingIds(s => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  async function handleSyncAll() {
    setSyncingAll(true);
    try {
      const r = await fetch("/api/supplier/sync", { method: "POST" });
      if (r.status === 503) setApiKeyMissing(true);
      setTimeout(fetchImports, 3000);
    } finally {
      setSyncingAll(false);
    }
  }

  async function handleDelete(id: number, deleteListing: boolean) {
    setDeletingId(id);
    try {
      await fetch(`/api/supplier/imports/${id}?sellerEmail=${encodeURIComponent(user?.email ?? "")}&deleteListing=${deleteListing}`, {
        method: "DELETE",
      });
      await fetchImports();
    } finally {
      setDeletingId(null);
    }
  }

  async function handleMarkupSave(id: number, markupType: string, markupValue: number) {
    await fetch(`/api/supplier/imports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markupType, markupValue, sellerEmail: user?.email }),
    });
    await fetchImports();
  }

  const filtered = imports.filter(i =>
    !search || i.title.toLowerCase().includes(search.toLowerCase()) || i.supplier_id.includes(search)
  );

  const stats = {
    total: imports.length,
    synced: imports.filter(i => i.sync_status === "ok").length,
    errors: imports.filter(i => i.sync_status === "error").length,
  };

  if (!user) return null;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-black text-gray-900">AliExpress Importer</h2>
          <p className="text-sm text-gray-400 mt-0.5">Import, markup and auto-sync products from AliExpress</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSyncAll}
            disabled={syncingAll || imports.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-4 h-4 ${syncingAll ? "animate-spin" : ""}`} />
            Sync All
          </button>
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#F26B21] text-white text-sm font-bold hover:bg-[#e0601d] transition-colors"
          >
            <Plus className="w-4 h-4" />
            Import
          </button>
        </div>
      </div>

      {/* API Key missing banner */}
      <AnimatePresence>
        {apiKeyMissing && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3"
          >
            <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">RapidAPI key not configured</p>
              <p className="text-xs text-amber-600 mt-0.5">
                Add your <strong>RAPIDAPI_KEY</strong> secret to enable live imports and price syncing.
                Get a free key at <a href="https://rapidapi.com" target="_blank" rel="noopener noreferrer" className="underline">rapidapi.com</a> —
                subscribe to <strong>"Real-Time AliExpress Data"</strong>.
              </p>
            </div>
            <button onClick={() => setApiKeyMissing(false)} className="ml-auto text-amber-400 hover:text-amber-600"><X className="w-4 h-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats row */}
      {imports.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: "Imported", value: stats.total, color: "bg-[#4A5CE8]/10 text-[#4A5CE8]" },
            { label: "Synced OK", value: stats.synced, color: "bg-emerald-50 text-emerald-700" },
            { label: "Errors", value: stats.errors, color: stats.errors > 0 ? "bg-red-50 text-red-600" : "bg-gray-50 text-gray-400" },
          ].map(s => (
            <div key={s.label} className="bg-white border border-gray-100 rounded-xl p-4">
              <p className="text-xs font-medium text-gray-400">{s.label}</p>
              <p className={`text-2xl font-black mt-1 ${s.color.split(" ")[1]}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      {imports.length > 3 && (
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search imports…"
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#F26B21]/30 focus:border-[#F26B21]"
          />
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-[#F26B21]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-200 rounded-2xl py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#F26B21]/10 flex items-center justify-center mx-auto mb-4">
            <Package className="w-7 h-7 text-[#F26B21]" />
          </div>
          <p className="font-bold text-gray-900">
            {search ? "No matching imports" : "No imports yet"}
          </p>
          <p className="text-sm text-gray-400 mt-1 mb-5">
            {search ? "Try a different search term" : "Paste an AliExpress URL to import your first product"}
          </p>
          {!search && (
            <button
              onClick={() => setShowImportModal(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#F26B21] text-white text-sm font-bold hover:bg-[#e0601d] transition-colors"
            >
              <Plus className="w-4 h-4" /> Import First Product
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(item => {
            const isSyncing = syncingIds.has(item.id);
            const isDeleting = deletingId === item.id;
            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center gap-4"
              >
                {/* Image */}
                <div className="w-14 h-14 rounded-xl bg-gray-100 flex-shrink-0 overflow-hidden">
                  {item.image ? (
                    <img src={item.image} alt={item.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Package className="w-6 h-6 text-gray-300" />
                    </div>
                  )}
                </div>

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <p className="font-semibold text-gray-900 text-sm truncate flex-1">{item.title}</p>
                    <StatusBadge status={item.sync_status} error={item.sync_error} />
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 flex-wrap">
                    <span>
                      Supplier: <span className="font-medium text-gray-600">${parseFloat(item.supplier_price).toFixed(2)} USD</span>
                    </span>
                    <span>
                      Markup: <span className="font-medium text-gray-600">
                        {item.markup_type === "percentage" ? `+${item.markup_value}%` : `+£${item.markup_value}`}
                      </span>
                    </span>
                    <span className="font-semibold text-[#F26B21]">
                      Bazunk: {item.listing_currency === "USD" ? "$" : "£"}{parseFloat(item.bazunk_price).toFixed(2)}
                    </span>
                    <span className="text-gray-300">•</span>
                    <span>Synced {timeAgo(item.last_synced_at)}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <a
                    href={item.supplier_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on AliExpress"
                    className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400 hover:text-[#4A5CE8] hover:bg-[#4A5CE8]/10 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <a
                    href={`/listing/${item.public_id}`}
                    title="View Bazunk listing"
                    className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400 hover:text-[#F26B21] hover:bg-[#F26B21]/10 transition-colors"
                  >
                    <ShoppingBag className="w-3.5 h-3.5" />
                  </a>
                  <button
                    onClick={() => setEditingItem(item)}
                    title="Edit markup"
                    className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleSync(item.id)}
                    disabled={isSyncing}
                    title="Sync price now"
                    className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-40"
                  >
                    {isSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  </button>
                  <DeleteButton
                    disabled={isDeleting}
                    onDelete={(withListing) => handleDelete(item.id, withListing)}
                  />
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Sync info footer */}
      {imports.length > 0 && (
        <p className="mt-4 text-xs text-gray-400 flex items-center gap-1.5">
          <Zap className="w-3 h-3" />
          Prices auto-sync every 6 hours. Last import: {timeAgo(imports[0]?.created_at ?? null)}.
        </p>
      )}

      {/* Modals */}
      <AnimatePresence>
        {showImportModal && (
          <ImportModal
            onClose={() => setShowImportModal(false)}
            onSuccess={fetchImports}
            userEmail={user.email}
            userName={user.name ?? ""}
          />
        )}
        {editingItem && (
          <MarkupEditModal
            item={editingItem}
            onSave={(mt, mv) => handleMarkupSave(editingItem.id, mt, mv)}
            onClose={() => setEditingItem(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function DeleteButton({ onDelete, disabled }: { onDelete: (withListing: boolean) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        title="Delete import"
        className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 4 }}
              className="absolute right-0 top-10 z-50 bg-white border border-gray-100 rounded-xl shadow-lg p-3 w-52"
            >
              <p className="text-xs font-semibold text-gray-700 mb-2">Remove import?</p>
              <button
                onClick={() => { setOpen(false); onDelete(false); }}
                className="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-gray-50 text-gray-600"
              >
                Keep listing, remove tracking
              </button>
              <button
                onClick={() => { setOpen(false); onDelete(true); }}
                className="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-red-50 text-red-600 font-semibold"
              >
                Delete listing too
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
