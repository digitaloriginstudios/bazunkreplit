import { createHmac } from "node:crypto";
import {
  aliExpressCredentials, AliExpressConnectionError, hasManagedAliExpressConnection, managedAliExpressAccessToken,
} from "./aliexpressOAuth.js";

export async function dropshipConfigured() {
  return Boolean(process.env.ALIEXPRESS_DS_ACCESS_TOKEN && aliExpressCredentials()) ||
    hasManagedAliExpressConnection();
}

type Product = {
  externalId: string;
  title: string;
  description: string;
  images: { url: string }[];
  price: { amount: number; currency: string };
  sourceUrl: string;
  rating: number;
  availability: "in_stock" | "out_of_stock" | "unknown";
};

const absolute = (value: unknown): string => {
  const url = String(value ?? "");
  return url.startsWith("//") ? "https:" + url : /^https:\/\//i.test(url) ? url : "";
};

function normalize(p: any): Product {
  const id = String(p.itemId ?? p.product_id ?? p.productId ?? p.ae_item_base_info_dto?.product_id ?? "");
  const images = [p.itemMainPic, p.product_main_image_url, ...String(p.ae_multimedia_info_dto?.image_urls ?? "").split(";"), p.image]
    .map(absolute).filter(Boolean);
  const skuData = p.ae_item_sku_info_dtos;
  const skuList = Array.isArray(skuData) ? skuData : skuData?.ae_item_sku_info_d_t_o;
  const skus: any[] = Array.isArray(skuList) ? skuList.filter(Boolean) : [];
  const pricedSkus = skus.map(sku => ({
    amount: Number(sku.offer_sale_price ?? sku.sku_price),
    currency: sku.currency_code,
  })).filter(price => Number.isFinite(price.amount) && price.amount > 0 && (!price.currency || price.currency === "USD"));
  const skuPrice = pricedSkus.length ? Math.min(...pricedSkus.map(price => price.amount)) : undefined;
  const amount = Number(p.targetSalePrice ?? p.target_sale_price ?? skuPrice ?? p.price ?? 0);
  const stock = skus.map(sku => Number(sku.sku_available_stock)).filter(Number.isFinite);
  return {
    externalId: id,
    title: String(p.title ?? p.product_title ?? p.ae_item_base_info_dto?.subject ?? ""),
    description: String(p.description ?? p.ae_item_base_info_dto?.detail ?? ""),
    images: images.map(url => ({ url })),
    price: {
      amount: Number.isFinite(amount) ? amount : 0,
      currency: String(p.targetSalePriceCurrency ?? p.target_sale_price_currency ?? "USD").toUpperCase(),
    },
    sourceUrl: absolute(p.itemUrl ?? p.product_detail_url) || (id ? "https://www.aliexpress.com/item/" + id + ".html" : ""),
    rating: Number(p.score ?? p.ae_item_base_info_dto?.avg_evaluation_rating ?? 0) || 0,
    availability: stock.length ? (stock.some(count => count > 0) ? "in_stock" : "out_of_stock") : "unknown",
  };
}

async function call(method: string, extra: Record<string, string>, requireManaged = false): Promise<any> {
  const credentials = aliExpressCredentials();
  if (!credentials) throw new AliExpressConnectionError("AliExpress app credentials are missing.");
  const managed = await managedAliExpressAccessToken();
  const { appKey, secret } = credentials;
  const token = managed ?? (requireManaged ? undefined : process.env.ALIEXPRESS_DS_ACCESS_TOKEN);
  if (!token) throw new AliExpressConnectionError("Authorise the AliExpress connection before making API requests.");

  async function send(session: string) {
    const params: Record<string, string> = {
      app_key: appKey,
      session,
      method,
      sign_method: "sha256",
      timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
      format: "json",
      v: "2.0",
      ...extra,
    };
    const payload = Object.keys(params).sort().map(key => key + params[key]).join("");
    params.sign = createHmac("sha256", secret).update(payload).digest("hex").toUpperCase();
    const response = await fetch("https://api-sg.aliexpress.com/sync", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new AliExpressConnectionError("AliExpress API returned HTTP " + response.status + ".");
    return await response.json() as Record<string, any>;
  }

  let json = await send(token);
  const authError = String(json.error_response?.sub_code ?? json.error_response?.code ?? json.code ?? "");
  if (managed && /^(?:27|invalid-session|invalid_access_token|access_token_expired|isv\.invalid-session|isv\.session-expired)$/i.test(authError)) {
    const replacement = await managedAliExpressAccessToken({ rejectedToken: token });
    if (!replacement) throw new AliExpressConnectionError("The AliExpress connection was disconnected.");
    json = await send(replacement);
  }
  const key = method.replace(/\./g, "_") + "_response";
  const result = json[key] ?? (json.result || json.data ? json : null);
  const code = String(json.error_response?.code ?? result?.code ?? json.code ?? "");
  const responseCode = String(result?.rsp_code ?? "");
  if (json.error_response || (code && !["00", "0", "200"].includes(code)) ||
      (responseCode && !["0", "200"].includes(responseCode))) {
    const reference = /^[a-z0-9_.-]{1,48}$/i.test(code) ? " (" + code + ")" : "";
    throw new AliExpressConnectionError("AliExpress rejected the API request" + reference + ".");
  }
  if (!result) throw new AliExpressConnectionError("AliExpress returned an unexpected API response.");
  return result;
}

export async function inspectDropshipSearch(q: string, page: number, options: { requireManaged?: boolean } = {}) {
  const result = await call("aliexpress.ds.text.search", {
    keyword: q, countryCode: "GB", currency: "USD", local: "en_US", page_index: String(Math.trunc(page)), page_size: "20",
  }, options.requireManaged);
  const payload = result.data ?? result.result;
  const entries = payload?.products;
  const list: unknown = Array.isArray(entries) ? entries : entries?.selection_search_product ?? [];
  if (!Array.isArray(list)) throw new AliExpressConnectionError("AliExpress search returned an unexpected product list.");

  const keywords = q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const candidates = list.filter(item => item && String(item.type ?? "").toLowerCase() !== "recommend").map(normalize);
  const matching = candidates.filter(p => /^\d{10,20}$/.test(p.externalId) && p.title &&
    keywords.every(keyword => p.title.toLowerCase().includes(keyword)));
  const products = matching.filter(p => p.price.amount > 0 && p.price.currency === "USD");
  return {
    products,
    counts: {
      returned: list.length,
      recommendations: list.filter(item => String(item?.type ?? "").toLowerCase() === "recommend").length,
      matching: matching.length,
      priced: products.length,
    },
  };
}

export async function searchDropship(q: string, page: number, options: { requireManaged?: boolean } = {}): Promise<Product[]> {
  const { products } = await inspectDropshipSearch(q, page, options);
  return products;
}

export async function getDropshipProduct(id: string): Promise<Product> {
  if (!/^\d{10,20}$/.test(id)) throw new AliExpressConnectionError("Invalid AliExpress product ID.");
  const result = await call("aliexpress.ds.product.get", {
    product_id: id, ship_to_country: "GB", target_currency: "USD", target_language: "en", remove_personal_benefit: "true",
  });
  const raw = result.result ?? result.data ?? result;
  const product = normalize({ ...raw, product_id: id });
  if (!product.title) throw new AliExpressConnectionError("AliExpress returned no product title. Check product availability.");
  return product;
}

export function aliExpressProductId(raw: string): string | null {
  const input = raw.trim();
  if (/^\d{10,20}$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || !(url.hostname === "aliexpress.com" || url.hostname.endsWith(".aliexpress.com"))) return null;
    return url.pathname.match(/\/(?:item\/)?(\d{10,20})(?:\.html)?\/?$/)?.[1] ??
      url.searchParams.get("productId")?.match(/^\d{10,20}$/)?.[0] ?? null;
  } catch {
    return null;
  }
}
