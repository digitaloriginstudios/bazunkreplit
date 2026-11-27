import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAdmin } from "@/context/AdminContext";

export type ConversionKind = "flash" | "auction";
type Source = { id: number; title: string; price: string; currency: string };
type Result = {
  listingId: number;
  status: "converted" | "already-converted" | "skipped";
  saleId?: string;
  kind?: ConversionKind;
  reason?: string;
};

export function BulkListingConversion({ kind, listings, onClose, onComplete }: {
  kind: ConversionKind;
  listings: Source[];
  onClose: () => void;
  onComplete: (ids: number[]) => void;
}) {
  const { authFetch } = useAdmin();
  const flash = kind === "flash";
  const label = flash ? "flash sales" : "auctions";
  const [hours, setHours] = useState("24");
  const [percentage, setPercentage] = useState(flash ? "20" : "50");
  const [increment, setIncrement] = useState("1");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed || busy || results || !listings.length) return;
    setBusy(true);
    setError("");
    try {
      const response = await authFetch("/api/admin/listings/convert", {
        method: "POST",
        body: JSON.stringify({ kind, ids: listings.map(item => item.id), hours: Number(hours),
          percentage: Number(percentage), increment: Number(increment), copyStockConfirmed: flash && confirmed }),
      });
      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload.results)) throw Error(payload.error || "Could not convert listings.");
      const completed: Result[] = payload.results;
      setResults(completed);
      if (!flash) onComplete(completed.filter(item => item.status !== "skipped").map(item => item.listingId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not convert listings.");
    } finally {
      setBusy(false);
    }
  }

  const field = "mt-1 block w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-slate-950";
  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>{flash ? "Duplicate into flash sales" : "Convert to auctions"}</DialogTitle>
        <DialogDescription>
          {flash
            ? "Publish a separate one-unit flash sale for each eligible listing. Its original listing stays active with its existing stock. Listings with variants are skipped."
            : "Publish an auction and pause its original listing. Listings with multiple units, variants, or recent checkouts are skipped."}
        </DialogDescription>
        {results ? (
          <>
            <p role="status" className="font-semibold">{results.filter(row => row.status === "converted").length} of {listings.length} {flash ? "copied" : "converted"}</p>
            <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
              {results.map(row => (
                <li key={row.listingId} className="rounded-lg border px-3 py-2">
                  <strong>{listings.find(item => item.id === row.listingId)?.title ?? `Listing #${row.listingId}`}</strong>
                  <div>{row.reason ?? (row.status === "already-converted" ? "A sale already exists" : flash ? "Copied" : "Converted")}
                    {row.saleId && <Link className="ml-2 underline" href={`/${row.kind === "flash" ? "flash-sales" : "auctions"}/${row.saleId}`}>{row.saleId}</Link>}
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap justify-between gap-2">
              <Link href={flash ? "/admin/flash-sales" : "/admin/auctions"} className="underline">Manage {label}</Link>
              <button type="button" onClick={onClose} className="rounded-lg bg-blue-700 px-4 py-2 text-white">Done</button>
            </div>
          </>
        ) : (
          <form onSubmit={event => void submit(event)} className="space-y-4">
            <fieldset disabled={busy} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <label>Duration (hours)<input type="number" min="1" max="720" required value={hours} onChange={e=>setHours(e.target.value)} className={field} /></label>
                <label>{flash ? "Discount (%)" : "Starting bid (% of price)"}<input type="number" min="1" max={flash ? 99 : 100} required value={percentage} onChange={e=>setPercentage(e.target.value)} className={field} /></label>
                {!flash && <label>Bid increment (listing currency)<input type="number" min="0.01" max="99999999.99" step="0.01" required value={increment} onChange={e=>setIncrement(e.target.value)} className={field} /></label>}
              </div>
              {!flash && <p className="text-sm">Auctions have no reserve price.</p>}
              <div className="max-h-40 overflow-y-auto rounded-lg border p-2 text-sm">
                <ul className="space-y-1">{listings.map(item => {
                  const price = Math.round(Number(item.price) * 100);
                  const amount = Math.round(price * (flash ? 100 - Number(percentage) : Number(percentage)) / 100);
                  return <li key={item.id} className="flex justify-between gap-3">
                    <span>{item.title}</span><strong className="shrink-0">{item.currency} {(amount / 100).toFixed(2)}</strong>
                  </li>;
                })}</ul>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} className="mt-0.5" />
                {flash ? "I have a separate unit available for each flash sale." : "Publish eligible auctions and move their stock."}
              </label>
            </fieldset>
            {error && <p role="alert" className="font-semibold text-red-700">{error}</p>}
            <button type="submit" disabled={!confirmed || busy} className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50">
              {busy ? "Publishing…" : `${flash ? "Duplicate" : "Convert"} ${listings.length} to ${label}`}
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
