const entities: Record<string, string> = {
  amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ",
  ndash: "–", mdash: "—", bull: "•", middot: "·", times: "×", deg: "°",
  pound: "£", euro: "€", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
};

export function tidyAliExpressDescription(raw: unknown): string {
  return String(raw ?? "").slice(0, 100_000)
    .replace(/<!--[^]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, "")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<br\b[^>]*>|<\/(?:p|div|h[1-6]|li|tr|ul|ol|section)\s*>/gi, "\n")
    .replace(/<\/(?:td|th)\s*>/gi, " ")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/&(#(?:x[\da-f]+|\d+)|[a-z][a-z0-9]*);/gi, (entity, name: string) => {
      if (!name.startsWith("#")) return entities[name] ?? entity;
      const hex = name[1]?.toLowerCase() === "x";
      const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
    })
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b\ufeff]/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 10_000);
}

export async function getAliExpressUsdToGbpRate(): Promise<number> {
  const response = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=GBP", { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("FX unavailable");
  const data = await response.json() as { rates?: { GBP?: number } };
  const rate = Number(data.rates?.GBP);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Invalid FX rate");
  return rate;
}
