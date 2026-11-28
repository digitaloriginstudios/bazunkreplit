import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { categoryVisibility } from "./listingVisibility.js";
import { ensureFeeSchema } from "./checkoutQuote.js";

export type ConversionSettings = {
  kind: "flash" | "auction";
  ids: number[];
  hours: number;
  percentage: number;
  increment: number;
};

type ListingResult = {
  listingId: number;
  status: "converted" | "already-converted" | "skipped";
  saleId?: string;
  kind?: ConversionSettings["kind"];
  amount?: string;
  currency?: string;
  reason?: string;
};

type SourceListing = {
  id: number; title: string; description: string | null; image: string | null;
  category: string; condition: string; seller_email: string; seller_name: string | null;
  price: string; currency: string; status: string; quantity: number; specifications: string | null;
  visible: boolean; seller_exists: boolean;
};

export async function convertListings(settings: ConversionSettings): Promise<ListingResult[]> {
  if (settings.kind === "auction") await ensureFeeSchema();
  const visible = await categoryVisibility();
  return db.transaction(async tx => {
    // This uses the same row-lock order as saving a checkout snapshot.
    const rows = (await tx.execute(sql`SELECT listings.*, (${visible}) AS visible,
      EXISTS (SELECT 1 FROM users u WHERE LOWER(u.email)=LOWER(listings.seller_email)) AS seller_exists
      FROM listings WHERE listings.id = ANY(${"{" + settings.ids.join(",") + "}"}::int[]) ORDER BY listings.id FOR UPDATE OF listings`)).rows;
    const listings = new Map((rows as unknown as SourceListing[]).map(row => [row.id, row]));
    const prior = (await tx.execute(sql`SELECT listing_id,kind,sale_id FROM listing_sale_conversions
      WHERE listing_id = ANY(${"{" + settings.ids.join(",") + "}"}::int[])`)).rows;
    const converted = new Map(prior.map(row => [Number(row.listing_id), row]));
    if (settings.kind === "flash") {
      const copies = await tx.execute(sql`SELECT c.listing_id, 'flash' AS kind, c.sale_id FROM listing_flash_sale_copies c
        JOIN flash_sales sale ON sale.id=c.sale_id
        WHERE sale.status IN ('active','upcoming') AND sale.ends_at > NOW() AND c.listing_id = ANY(${"{" + settings.ids.join(",") + "}"}::int[])`);
      for (const copy of copies.rows) converted.set(Number(copy.listing_id), copy);
    }
    // Web and mobile cart sessions can remain payable for up to 24 hours.
    const recent = settings.kind === "flash" ? [] : (await tx.execute(sql`SELECT DISTINCT unit->>'id' AS id FROM checkout_fee_snapshots s
      CROSS JOIN LATERAL jsonb_array_elements(s.payload->'units') unit
      WHERE s.created_at >= NOW() - INTERVAL '25 hours'
        AND unit->>'id' = ANY(${"{" + settings.ids.join(",") + "}"}::text[])`)).rows;
    const checkoutIds = new Set(recent.map(row => Number(row.id)));
    const end = new Date(Date.now() + settings.hours * 3600000).toISOString();
    const results: ListingResult[] = [];

    for (const listingId of settings.ids) {
      const previous = converted.get(listingId);
      if (previous) {
        results.push({ listingId, status: "already-converted", kind: previous.kind as ConversionSettings["kind"], saleId: String(previous.sale_id) });
        continue;
      }
      const row = listings.get(listingId);
      function skip(reason: string) { results.push({ listingId, status: "skipped", reason }); }
      if (!row) { skip("Listing was not found."); continue; }
      if (row.status !== "active" || !row.visible) { skip("Listing must be active and visible."); continue; }
      if (!row.seller_exists) { skip("The listing has no current seller account."); continue; }
      if (checkoutIds.has(listingId)) { skip("A recent checkout may still be payable. Try again after it expires."); continue; }

      let specs: Record<string, unknown> = {};
      try { specs = JSON.parse(row.specifications || "{}") ?? {}; } catch { /* Legacy free-text specifications. */ }
      if (specs.demo_creator === true || specs.demo_creator === "true") { skip("Demo listings cannot be converted."); continue; }
      if ([specs.aliexpress_options, specs.variants].some(value => Array.isArray(value) && value.length)) {
        skip("Special sales require a single product option."); continue;
      }
      if (settings.kind === "auction" && Number(row.quantity) !== 1) {
        skip("Auction conversion needs exactly one unit in stock."); continue;
      }
      const source = String(specs.source ?? "");
      const region = specs.marketplace_region ?? (["Amazon UK", "eBay UK"].includes(source) ? "uk"
        : ["Amazon US", "eBay US"].includes(source) ? "us" : null);
      const currency = row.currency?.toUpperCase();
      if ((region !== "uk" && region !== "us") || (currency !== "GBP" && currency !== "USD")) {
        skip("Set a supported marketplace and currency first."); continue;
      }
      const priceMinor = Math.round(Number(row.price) * 100);
      const amountMinor = Math.round(priceMinor * (settings.kind === "flash" ? 100 - settings.percentage : settings.percentage) / 100);
      if (!Number.isSafeInteger(priceMinor) || amountMinor < 1 || (settings.kind === "flash" && amountMinor >= priceMinor)) {
        skip("The chosen percentage does not produce a valid price."); continue;
      }
      const amount = (amountMinor / 100).toFixed(2);
      const sellerName = row.seller_name || row.seller_email.split("@")[0];
      const saleId = (settings.kind === "flash" ? "FS-" : "AUC-") + randomUUID().slice(0, 8).toUpperCase();

      if (settings.kind === "flash") {
        await tx.execute(sql`INSERT INTO flash_sales
          (id,seller_email,seller_name,title,description,image,category,original_price,sale_price,discount_percent,
            starts_at,ends_at,status,sale_type,marketplace_region,currency,created_at,updated_at)
          VALUES (${saleId},${row.seller_email},${sellerName},${row.title},${row.description},${row.image},${row.category},
            ${row.price},${amount},${Math.round((priceMinor-amountMinor)*100/priceMinor)},
            NOW(),${end},'active','standard',${region},${currency},NOW(),NOW())`);
      } else {
        const gallery = Array.isArray(specs.admin_gallery_images)
          ? specs.admin_gallery_images.filter((image): image is string => typeof image === "string") : [];
        const images = [...new Set([row.image, ...gallery].filter(Boolean))].slice(0, 12);
        await tx.execute(sql`INSERT INTO auctions
          (id,title,description,images,category,condition,seller_email,seller_name,starting_bid,bid_increment,
            end_time,extend_enabled,status,marketplace_region,currency,created_at,updated_at)
          VALUES (${saleId},${row.title},${row.description},${JSON.stringify(images)}::jsonb,${row.category},${row.condition},
            ${row.seller_email},${sellerName},${amount},${settings.increment.toFixed(2)},${end},
            FALSE,'active',${region},${currency},NOW(),NOW())`);
      }
      if (settings.kind === "flash") {
        await tx.execute(sql`INSERT INTO listing_flash_sale_copies (listing_id,sale_id) VALUES (${listingId},${saleId})
          ON CONFLICT (listing_id) DO UPDATE SET sale_id=EXCLUDED.sale_id,created_at=NOW()`);
      } else {
        await tx.execute(sql`INSERT INTO listing_sale_conversions (listing_id,kind,sale_id) VALUES (${listingId},'auction',${saleId})`);
        await tx.execute(sql`UPDATE listings SET status='inactive', quantity=0, updated_at=NOW() WHERE id=${listingId}`);
      }
      results.push({ listingId, status: "converted", kind: settings.kind, saleId, amount, currency });
    }
    return results;
  });
}
