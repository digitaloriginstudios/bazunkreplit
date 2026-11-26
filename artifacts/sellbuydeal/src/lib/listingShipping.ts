import { MARKET_COUNTRIES } from "@/context/CurrencyContext";

export const shippingCountries = [
  ...MARKET_COUNTRIES,
  { code: "CN", name: "China" }, { code: "MX", name: "Mexico" },
  { code: "JP", name: "Japan" }, { code: "KR", name: "South Korea" },
  { code: "SG", name: "Singapore" }, { code: "IN", name: "India" },
  { code: "PL", name: "Poland" }, { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" }, { code: "DK", name: "Denmark" },
];
export const shippingZones: Record<string, string> = {
  eu: "UK & EU", "eu-only": "European Union", europe: "Europe",
  "north-america": "North America", asia: "Asia Pacific", worldwide: "Worldwide",
  international: "Worldwide",
};
const regions = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
const eu = "IE FR DE ES IT NL BE PT AT DK SE FI PL CZ GR RO HU SK SI HR BG EE LV LT LU MT CY".split(" ");

export function shippingCountryLabel(code?: string): string {
  if (!code) return "";
  const upper = code.toUpperCase() === "UK" ? "GB" : code.toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? regions.of(upper) ?? code : code;
}

export function shippingZoneLabel(zone?: string, origin?: string): string {
  if (!zone) return "";
  if (zone === "domestic") return shippingCountryLabel(origin) || "Domestic only";
  if (zone.startsWith("country:")) return shippingCountryLabel(zone.slice(8));
  if (zone.startsWith("regions:")) return zone.slice(8).split(",").map(shippingCountryLabel).join(", ");
  return shippingZones[zone] ?? "";
}

export function shipsToCountry(zone: string, origin: string, country: string): boolean {
  if (zone === "worldwide" || zone === "international") return true;
  if (zone === "domestic") return (origin === "UK" ? "GB" : origin === "China" ? "CN" : origin) === country;
  if (zone.startsWith("country:")) return zone.slice(8) === country;
  if (zone.startsWith("regions:")) {
    const codes = zone.slice(8).split(",");
    return codes.includes(country) || codes.includes("EU") && eu.includes(country);
  }
  if (zone === "eu-only") return eu.includes(country);
  if (zone === "eu") return country === "GB" || eu.includes(country);
  if (zone === "europe") return ["GB", "NO", "CH", "IS", "LI", ...eu].includes(country);
  if (zone === "north-america") return ["US", "CA", "MX"].includes(country);
  if (zone === "asia") return ["CN", "JP", "KR", "SG", "MY", "TH", "VN", "PH", "ID", "AU", "NZ"].includes(country);
  return false;
}
