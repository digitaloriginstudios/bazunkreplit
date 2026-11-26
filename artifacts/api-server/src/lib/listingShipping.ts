const countryAliases: Record<string, string> = {
  uk: "GB", "united kingdom": "GB", "great britain": "GB",
  usa: "US", "united states": "US", "united states of america": "US",
  china: "CN", "european union": "EU", canada: "CA", australia: "AU",
  "new zealand": "NZ", mexico: "MX", ireland: "IE", france: "FR", germany: "DE",
};
const countries = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
const regions: Record<string, string[]> = {
  "eu-only": "IE FR DE ES IT NL BE PT AT DK SE FI PL CZ GR RO HU SK SI HR BG EE LV LT LU MT CY".split(" "),
  "north-america": ["US", "CA", "MX"],
  asia: ["CN", "JP", "KR", "SG", "MY", "TH", "VN", "PH", "ID", "AU", "NZ"],
};
regions.eu = ["GB", ...regions["eu-only"]];
regions.europe = ["GB", "NO", "CH", "IS", "LI", ...regions["eu-only"]];

export function shippingCountry(raw: unknown): string | null {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  const code = countryAliases[value] ?? value.toUpperCase();
  return /^[A-Z]{2}$/.test(code) && countries.of(code) ? code : null;
}

export function shippingZone(raw: unknown): string | null {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  const aliases: Record<string, string> = {
    "uk & eu": "eu", "european union": "eu-only", "north america": "north-america",
    "asia pacific": "asia", international: "worldwide",
  };
  const zone = aliases[value] ?? value;
  if (["domestic", "worldwide", ...Object.keys(regions)].includes(zone)) return zone;
  const country = shippingCountry(zone.replace(/^country:/, ""));
  return country === "EU" ? "eu-only" : country ? "country:" + country : null;
}

export function listingShipping(origin: unknown, zone: unknown, location: unknown, rawSpecs: unknown) {
  let specs: Record<string, unknown> = {};
  try {
    const parsed = typeof rawSpecs === "string" ? JSON.parse(rawSpecs) : rawSpecs;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) specs = parsed;
  } catch { /* Existing non-JSON specifications contain no delivery data. */ }
  return {
    shipOrigin: (origin || shippingCountry(specs.ships_from ?? specs.source_country) || null) as string | null,
    shipZone: (zone || shippingZone(specs.ships_to) || null) as string | null,
    shipOriginOther: (location || specs.ships_from_location || specs.source_item_location || null) as string | null,
  };
}

export function shipsToCountry(zone: string | null, origin: string | null, destination: string): boolean {
  const coverage = shippingZone(zone);
  if (!coverage) return false;
  if (coverage === "worldwide") return true;
  if (coverage === "domestic") return shippingCountry(origin) === destination;
  if (coverage.startsWith("country:")) return coverage.slice(8) === destination;
  return regions[coverage]?.includes(destination) ?? false;
}
