import { shippingCountry } from "./listingShipping.js";
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

async function call(method: string, extra: Record<string, string>, requireManaged = false, timeout = 20_000): Promise<any> {
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
      signal: AbortSignal.timeout(timeout),
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

export function dropshipSearchDiagnostic(counts: Awaited<ReturnType<typeof inspectDropshipSearch>>["counts"]): string | null {
  if (counts.priced) return null;
  if (!counts.returned) return "The official AliExpress API returned no products for these keywords.";
  if (counts.recommendations === counts.returned) return "The official AliExpress API returned only recommendations for these keywords.";
  if (!counts.matching) return "The official AliExpress API returned products with unrelated titles or incomplete details.";
  return "The official AliExpress API returned matching products without a usable USD price.";
}

export async function searchDropship(q: string, page: number, options: { requireManaged?: boolean } = {}): Promise<Product[]> {
  const { products } = await inspectDropshipSearch(q, page, options);
  return products;
}

export async function getDropshipProduct(id: string, destination: "GB" | "US" = "GB"): Promise<Product> {
  return (await fetchDropshipProduct(id, destination)).product;
}

async function fetchDropshipProduct(id: string, destination: "GB" | "US") {
  if (!/^\d{10,20}$/.test(id)) throw new AliExpressConnectionError("Invalid AliExpress product ID.");
  const result = await call("aliexpress.ds.product.get", {
    product_id: id, ship_to_country: destination, target_currency: "USD", target_language: "en", remove_personal_benefit: "true",
  });
  const raw = result.result ?? result.data ?? result;
  const product = normalize({ ...raw, product_id: id });
  if (!product.title) throw new AliExpressConnectionError("AliExpress returned no product title. Check product availability.");
  return { raw, product };
}

function members(value: unknown, key: string): any[] {
  const entries = Array.isArray(value) ? value : (value as Record<string, unknown> | null)?.[key];
  return Array.isArray(entries) ? entries.filter(Boolean) : [];
}

export async function previewDropshipProduct(id: string, destination: "GB" | "US", skuId?: string) {
  const { raw, product } = await fetchDropshipProduct(id, destination);
  const base = raw.ae_item_base_info_dto;
  const productOrigin = shippingCountry(raw.ship_from_country ?? base?.ship_from_country);
  const choices = members(raw.ae_item_sku_info_dtos, "ae_item_sku_info_d_t_o")
    .filter(sku => /^\d{1,24}$/.test(String(sku.sku_id ?? "")) && Number(sku.sku_available_stock) !== 0)
    .map(sku => {
      const properties = members(sku.ae_sku_property_dtos, "ae_sku_property_d_t_o");
      const propertyValue = (p: any) => String(p.property_value_definition_name ?? p.sku_property_value ?? "").trim();
      const warehouse = properties.find(p => String(p.sku_property_name ?? "").trim().toLowerCase() === "ships from");
      return {
        id: String(sku.sku_id),
        origin: shippingCountry(sku.ship_from_country ?? propertyValue(warehouse ?? {})) ?? productOrigin,
        label: properties.map(propertyValue).filter(Boolean).join(" · ").slice(0, 140) || "SKU " + sku.sku_id,
      };
    });
  const selected = skuId ? choices.find(choice => choice.id === skuId) : choices.length === 1 ? choices[0] : undefined;
  const origins = new Set(choices.map(choice => choice.origin));
  const origin = selected?.origin ?? (origins.size <= 1 ? choices[0]?.origin ?? productOrigin : null);
  const marketCurrency = destination === "GB" ? "GBP" : "USD";
  const attributes = members(raw.ae_item_properties, "ae_item_property")
    .filter(p => p.attr_name && p.attr_value)
    .slice(0, 24)
    .map(p => ({ key: String(p.attr_name).slice(0, 80), value: String(p.attr_value).slice(0, 240) }));
  let shipping: { origin: string | null; destination: string; amount: number; currency: string; estimate: string } | null = null;

  if (selected) {
    try {
      const freight = await call("aliexpress.ds.freight.query", {
        queryDeliveryReq: JSON.stringify({
          productId: id, selectedSkuId: selected.id, shipToCountry: destination,
          quantity: 1, currency: marketCurrency, locale: "en_US", language: "en_US",
        }),
      }, false, 8_000);
      const data = freight.result ?? freight.data ?? freight;
      if (data.success !== false && data.success !== "false") {
        const options = members(data.delivery_options ?? data.deliveryOptions, "delivery_option")
          .flatMap(option => {
            const value = option.shipping_fee ?? option.shippingFee ?? option.freight;
            const fee = typeof value === "object" && value !== null ? value.amount : value;
            const currency = String(value?.currency_code ?? value?.currency ?? option.currency ?? option.currency_code ?? "").toUpperCase();
            const amount = Number(fee);
            if (fee == null || fee === "" || !Number.isFinite(amount) || amount < 0 || currency !== marketCurrency) return [];
            const min = Number(option.min_delivery_days ?? option.minDeliveryDays);
            const max = Number(option.max_delivery_days ?? option.maxDeliveryDays);
            const estimate = Number.isInteger(min) && Number.isInteger(max) && min > 0 && max >= min
              ? (min === max ? String(min) : min + "–" + max) + " days" : "";
            return [{ origin: shippingCountry(option.ship_from_country ?? option.shipFromCountry) ?? selected.origin,
              destination, amount, currency, estimate }];
          });
        shipping = options.sort((a, b) => a.amount - b.amount)[0] ?? null;
      }
    } catch {
      // Product details remain usable when the app lacks freight permission or no quote is available.
    }
  }
  // The older freight operation requires a known dispatch country and
  // has no SKU selector, so use it only for an unambiguous product.
  if (!shipping && origin && choices.length <= 1 && Number.isSafeInteger(Number(id))) {
    try {
      const freight = await call("aliexpress.logistics.buyer.freight.calculate", {
        param_aeop_freight_calculate_for_buyer_d_t_o: JSON.stringify({
          product_id: Number(id), product_num: 1, country_code: destination,
          send_goods_country_code: origin, price_currency: marketCurrency,
        }),
      }, false, 8_000);
      const result = freight.result ?? freight.data ?? freight;
      const options = members(result.aeop_freight_calculate_result_for_buyer_d_t_o_list, "aeop_freight_calculate_result_for_buyer_dto")
        .flatMap(option => {
          const fee = option.freight?.amount;
          const currency = String(option.freight?.currency_code ?? "").toUpperCase();
          const amount = Number(fee);
          if ((option.success !== true && option.success !== "true") || fee == null || fee === "" ||
              !Number.isFinite(amount) || amount < 0 || currency !== marketCurrency) return [];
          return [{ origin, destination, amount, currency, estimate: String(option.estimated_delivery_time ?? "").slice(0, 120) }];
        });
      shipping = options.sort((a, b) => a.amount - b.amount)[0] ?? null;
    } catch {
      // A missing freight quote must not become a zero postage charge.
    }
  }
  return { product, choices, selectedSku: selected?.id ?? null, origin, shipping, attributes };
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
