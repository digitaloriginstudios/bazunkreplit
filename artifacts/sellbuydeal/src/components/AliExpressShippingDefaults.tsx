import { shippingCountries } from "@/lib/listingShipping";

export const aliExpressDestinations = [
  { code: "GB", label: "UK" }, { code: "EU", label: "EU" }, { code: "US", label: "USA" },
  { code: "worldwide", label: "Worldwide" },
];
export const defaultAliExpressDestinations = aliExpressDestinations.map(destination => destination.code);

export function aliExpressShipZone(destinations: string[]) {
  const regions = destinations.filter(code => code !== "worldwide");
  return destinations.includes("worldwide") ? "worldwide" : regions.length ? "regions:" + regions.join(",") : null;
}

export function AliExpressShippingDefaults({ origin, destinations, setOrigin, setDestinations }: {
  origin: string;
  destinations: string[];
  setOrigin: (origin: string) => void;
  setDestinations: (destinations: string[]) => void;
}) {
  return <div className="space-y-2">
    <label className="block text-sm font-semibold">Ships from
      <select value={origin} onChange={event => setOrigin(event.target.value)} className="mt-1 w-full rounded-lg border p-2.5 text-sm">
        {shippingCountries.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}
      </select>
    </label>
    <fieldset>
      <legend className="text-sm font-semibold">Ships to</legend>
      <div className="flex flex-wrap gap-3 py-1 text-sm">
        {aliExpressDestinations.map(destination => <label key={destination.code} className="flex items-center gap-1.5">
          <input type="checkbox" checked={destinations.includes(destination.code)}
            onChange={event => setDestinations(event.target.checked
              ? [...destinations, destination.code] : destinations.filter(code => code !== destination.code))} />
          {destination.label}
        </label>)}
        <button type="button" className="font-semibold underline" onClick={() => setDestinations(defaultAliExpressDestinations)}>Select all</button>
      </div>
      <p className="text-xs text-gray-500">Worldwide includes every country. Set the coverage you can fulfil.</p>
    </fieldset>
  </div>;
}
