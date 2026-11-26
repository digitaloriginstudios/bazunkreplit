import { createRoot } from "react-dom/client";
import App from "./App";
import { adminApiUrl } from "./context/AdminContext";
import { loadCategoryPresentation } from "./data/categories";
import "./index.css";
import "./design-system/brand-tokens.css";
import "./design-system/protected.css";

// The production frontend is a static Render site, so Vite's dev /api proxy
// does not exist after deployment. Keep all legacy and future relative API
// calls on the real marketplace API without requiring every component to
// duplicate the production hostname.
const API_BASE = (import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || "https://bazunk-api.onrender.com").replace(/\/$/, "");
const nativeFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === "string" && input.startsWith("/api/")) {
    return nativeFetch(`${API_BASE}${input}`, init);
  }
  if (input instanceof Request) {
    const url = new URL(input.url, window.location.origin);
    if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
      const target = `${API_BASE}${url.pathname}${url.search}${url.hash}`;
      return nativeFetch(new Request(target, input), init);
    }
  }
  return nativeFetch(input, init);
}) as typeof window.fetch;

// Clerk production keys are restricted to bazunk.com. Render's default
// hostname is not an authorized authentication origin; preserve the path,
// query and hash while directing visitors to the canonical site.
const aliExpressCallback = "/api/integrations/aliexpress/callback";
if (window.location.pathname === aliExpressCallback) {
  const query = new URLSearchParams(window.location.search);
  const code = query.get("code");
  const state = query.get("state");
  window.history.replaceState(null, "", aliExpressCallback);
  const root = document.getElementById("root")!;
  root.className = "mx-auto max-w-xl p-8";
  if (!code || !state) {
    root.textContent = "AliExpress authorisation was cancelled or is missing a code. Start again from the Bazunk admin.";
  } else {
    root.textContent = "Completing AliExpress authorisation…";
    void nativeFetch(adminApiUrl(aliExpressCallback), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, state }),
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(30_000),
    }).then(async response => {
      root.textContent = response.ok
        ? "AliExpress connected successfully. Return to the Bazunk admin and refresh the connection status."
        : "AliExpress authorisation failed or expired. Start again from the Bazunk admin.";
    }).catch(() => {
      root.textContent = "AliExpress connection unavailable. Please retry from the Bazunk admin.";
    });
  }
} else if (window.location.hostname === "bazunk-web.onrender.com") {
  window.location.replace(`https://bazunk.com${window.location.pathname}${window.location.search}${window.location.hash}`);
} else {
  // Do not hold the entire storefront behind a potentially sleeping free-tier API.
  // Keep a short window for category presentation settings, then render using
  // the bundled taxonomy if the API is slow or unavailable.
  const categoryController = new AbortController();
  const categoryTimeout = window.setTimeout(() => categoryController.abort(), 1000);
  void loadCategoryPresentation(categoryController.signal).finally(() => {
    window.clearTimeout(categoryTimeout);
    createRoot(document.getElementById("root")!).render(<App />);
  });
}
