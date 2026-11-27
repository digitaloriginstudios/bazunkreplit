import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useAdmin } from "@/context/AdminContext";

const bookmarklet = String.raw`javascript:(()=>{if(!/(^|\.)aliexpress\.com$/i.test(location.hostname))return alert("Open an AliExpress page first.");const ids=new Set;for(const link of document.links){const url=new URL(link.href),id=url.pathname.match(/^\/(?:item|i)\/(\d{10,20})(?:\.html)?\/?$/i)?.[1];if(id&&url.protocol==="https:"&&/(^|\.)aliexpress\.com$/i.test(url.hostname))ids.add(id);if(ids.size>=500)break}if(!ids.size)return alert("No product links found. Scroll to load the products and try again.");location.assign("https://www.bazunk.com/admin/importers/aliexpress#ali-links="+[...ids].join(","));})();`;

function mergeLinks(current: string, links: string[]) {
  const tokens = current.trim().split(/[\s,]+/).filter(Boolean);
  const existingIds = new Set(tokens.map(value => {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && /(^|\.)aliexpress\.com$/i.test(url.hostname))
        return url.pathname.match(/^\/(?:item|i)\/(\d{10,20})(?:\.html)?\/?$/i)?.[1];
    } catch { /* Keep existing manual input. */ }
    return undefined;
  }));
  const additions = links.filter(link => !existingIds.has(link.match(/\/(\d{10,20})\.html$/)?.[1]));
  return [...tokens, ...new Set(additions)].join("\n");
}

export function AliExpressPageLinks({ setProductUrls }: { setProductUrls: Dispatch<SetStateAction<string>> }) {
  const { authFetch } = useAdmin();
  const [page, setPage] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);
  const [showCollector, setShowCollector] = useState(false);
  const [copyNotice, setCopyNotice] = useState("");

  useEffect(() => {
    const match = window.location.hash.match(/^#ali-links=([\d,]{1,10500})$/);
    if (!match) return;
    const ids = [...new Set(match[1].split(",").filter(id => /^\d{10,20}$/.test(id)))].slice(0, 500);
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    if (!ids.length) return;
    setProductUrls(current => mergeLinks(current, ids.map(id => `https://www.aliexpress.com/item/${id}.html`)));
    setNotice(`Collected ${ids.length} product links from your AliExpress tab.`);
  }, [setProductUrls]);

  async function fetchLinks() {
    if (loading || !page.trim()) return;
    setLoading(true);
    setError(false);
    setNotice("");
    try {
      const response = await authFetch("/api/admin/aliexpress/page-links", {
        method: "POST", body: JSON.stringify({ url: page.trim() }),
      });
      const data = await response.json() as { links?: string[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to fetch product links.");
      if (!data.links?.length) {
        setShowCollector(true);
        setNotice("The page did not expose product links to Bazunk. Use the browser bookmarklet below to collect the products you can see.");
        return;
      }
      const links = data.links;
      setProductUrls(current => mergeLinks(current, links));
      setNotice(`Found ${links.length} product links. Prepare products to review the first 50.`);
    } catch (err) {
      setError(true);
      setShowCollector(true);
      setNotice(err instanceof Error ? err.message : "Unable to fetch product links.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold" htmlFor="aliexpress-page-url">AliExpress search, category or store URL</label>
      <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void fetchLinks(); }}>
        <input id="aliexpress-page-url" type="url" value={page} onChange={event => setPage(event.target.value)}
          maxLength={2048} placeholder="https://www.aliexpress.com/w/wholesale-earbuds.html"
          className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm" />
        <button type="submit" disabled={loading || !page.trim()} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50">
          {loading ? "Fetching links…" : "Fetch product links"}
        </button>
      </form>
      {notice && <p role={error ? "alert" : "status"} className="text-sm">{notice}</p>}
      <details className="text-sm" open={showCollector} onToggle={event => setShowCollector(event.currentTarget.open)}>
        <summary className="cursor-pointer font-medium">Collect from an open AliExpress tab</summary>
        <p className="my-2">Create a bookmark with this script as its URL. While signed in to Bazunk, open an AliExpress page, scroll to load the products, and click the bookmark to send the links to this importer.</p>
        <button type="button" className="rounded-lg border px-3 py-1.5" onClick={() => {
          void navigator.clipboard.writeText(bookmarklet)
            .then(() => setCopyNotice("Bookmarklet copied."))
            .catch(() => setCopyNotice("Select and copy the script below."));
        }}>Copy bookmarklet</button>
        {copyNotice && <p role="status" className="mt-2">{copyNotice}</p>}
        <textarea aria-label="AliExpress bookmarklet" className="mt-2 w-full rounded border p-2 font-mono text-xs" rows={3} readOnly value={bookmarklet} />
      </details>
    </div>
  );
}
