const permittedHosts = new Set(["www.aliexpress.com", "aliexpress.com", "store.aliexpress.com", "m.aliexpress.com"]);
const allowedPage = /^\/(?:w\/|wholesale(?:[\/.-]|$)|category(?:[\/.-]|$)|store(?:[\/.-]|$)|shop\/|p\/|(?:item|i)\/)/i;
const itemPath = /^\/(?:item|i)\/(\d{10,20})(?:\.html)?\/?$/i;
const productUrl = (id: string) => `https://www.aliexpress.com/item/${id}.html`;
const maximumBytes = 3 * 1024 * 1024;
const maximumProducts = 500;

export function parseAliExpressPageUrl(input: string, base?: URL): URL | null {
  if (!input || input.length > 2048) return null;
  try {
    const url = new URL(input, base);
    if (url.protocol !== "https:" || !permittedHosts.has(url.hostname) || url.username ||
        url.password || url.port || !allowedPage.test(url.pathname)) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export function extractAliExpressPageLinks(html: string, base: URL): string[] {
  const ids = new Set<string>();
  const addLink = (value: string) => {
    const url = parseAliExpressPageUrl(value.replace(/&(?:amp|#38);/gi, "&"), base);
    const id = url?.pathname.match(itemPath)?.[1];
    if (id) ids.add(id);
  };

  // Prioritise item cards on the page over links buried in scripts and recommendations.
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<!--[\s\S]*?-->/gi, "");
  const anchors = markup.matchAll(/<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi);
  for (const match of anchors) {
    addLink(match[1] ?? match[2] ?? match[3]);
    if (ids.size >= maximumProducts) break;
  }
  if (!ids.size) {
    // Some storefronts deliver item URLs only in hydration data.
    const decoded = html.replace(/\\u002f/gi, "/").replace(/\\\//g, "/");
    const links = decoded.matchAll(/["']((?:https?:\/\/|\/\/|\/(?:item|i)\/)[^"'\s]+)["']/gi);
    for (const match of links) {
      addLink(match[1]);
      if (ids.size >= maximumProducts) break;
    }
  }
  return [...ids].map(productUrl);
}

export async function fetchAliExpressPageLinks(initial: URL) {
  const id = initial.pathname.match(itemPath)?.[1];
  if (id) return [productUrl(id)];
  let page = initial;
  const signal = AbortSignal.timeout(12_000);
  for (let redirects = 0; redirects < 4; redirects++) {
    const response = await fetch(page, { redirect: "manual", signal, headers: { Accept: "text/html" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const next = parseAliExpressPageUrl(response.headers.get("location") ?? "", page);
      if (!next) throw new Error("AliExpress redirected to a page that this tool cannot fetch.");
      page = next;
      continue;
    }
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html") || !response.body) {
      await response.body?.cancel();
      throw new Error("AliExpress did not return a public product page. Use the browser bookmarklet to collect links from the page you can see.");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let html = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const remaining = maximumBytes - bytes;
        html += decoder.decode(value.subarray(0, remaining), { stream: true });
        bytes += value.length;
        if (bytes >= maximumBytes) break;
      }
      html += decoder.decode();
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    return extractAliExpressPageLinks(html, page);
  }
  throw new Error("AliExpress redirected too many times.");
}
