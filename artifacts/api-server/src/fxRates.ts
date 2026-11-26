import { logger } from "./lib/logger.js";

interface CacheEntry { rateToGbp: number; cachedAt: number }
const cache: Record<string, CacheEntry> = {};
const CACHE_TTL_MS = 60 * 60 * 1000;

const ZERO_DECIMAL = new Set(["KRW", "VND", "CLP", "ISK", "UGX"]);

export function smallestUnit(amount: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? Math.round(amount) : Math.round(amount * 100);
}

async function fetchRate(fromCurrency: string, strict = false): Promise<number> {
  const key = fromCurrency.toUpperCase();
  if (key === "GBP") return 1;
  const now = Date.now();
  if (cache[key] && now - cache[key].cachedAt < CACHE_TTL_MS) {
    return cache[key].rateToGbp;
  }
  try {
    const resp = await fetch(`https://api.frankfurter.app/latest?from=${key}&to=GBP`);
    if (!resp.ok) throw new Error(`Frankfurter HTTP ${resp.status}`);
    const data = await resp.json() as { rates?: Record<string, number> };
    const rate = data.rates?.["GBP"];
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) throw new Error(`No GBP rate returned for ${key}`);
    cache[key] = { rateToGbp: rate, cachedAt: now };
    return rate;
  } catch (err) {
    if (strict) throw new Error("Exchange rate unavailable; please try again later");
    logger.warn({ err, fromCurrency }, "FX rate fetch failed — falling back to cached or 1:1");
    return cache[key]?.rateToGbp ?? 1;
  }
}

export async function toGbp(amount: number, fromCurrency: string): Promise<number> {
  if (fromCurrency.toUpperCase() === "GBP") return amount;
  const rate = await fetchRate(fromCurrency);
  return amount * rate;
}

export async function convertAmount(amount: number, fromCurrency: string, toCurrency: string): Promise<number> {
  if (fromCurrency.toUpperCase() === toCurrency.toUpperCase()) return amount;
  const gbp = await toGbp(amount, fromCurrency);
  if (toCurrency.toUpperCase() === "GBP") return gbp;
  const rate = await fetchRate(toCurrency);
  return gbp / rate;
}

/** Payment conversion must never silently fall back to parity. */
export async function convertPaymentAmount(amount:number, from:string, to:string):Promise<number> {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid payment amount");
  if (from.toUpperCase() === to.toUpperCase()) return amount;
  return amount * await fetchRate(from,true) / await fetchRate(to,true);
}
