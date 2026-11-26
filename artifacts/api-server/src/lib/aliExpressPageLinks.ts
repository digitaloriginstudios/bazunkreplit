const permittedHosts = new Set(["www.aliexpress.com", "aliexpress.com", "store.aliexpress.com", "m.aliexpress.com"]);
const allowedPage = /^\/(?:w\/|wholesale(?:[\/.-]|$)|category(?:\/|$)|store(?:\/|$)|p\/|item\/)/i;
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
  const decoded = html.replace(/\\u002f/gi, "/").replace(/\\\//g, "/");
  const matches = decoded.matchAll(/(?:href\s*=\s*["']|["'])((?:https?:\/\/[^"'\s]+|\/\/[^"'\s]+|\/item\/[^"'\s]+))["']/gi);
  for (const match of matches) {
    const url = parseAliExpressPageUrl(match[1], base);
    const id = url?.pathname.match(/^\/item\/(\d{10,20})(?:\.html)?\/?$/i)?.[1];
    if (id) ids.add(id);
    if (ids.size >= maximumProducts) break;
  }
  return [...ids].map(id => "https://www.aliexpress.com/item/" + id + ".html");
}

export async function fetchAliExpressPageLinks(initial: URL) {
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
