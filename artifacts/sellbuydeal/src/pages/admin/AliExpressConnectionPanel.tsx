import { useEffect, useRef, useState } from "react";
import { useAdmin } from "@/context/AdminContext";

type Connection = {
  configured: boolean;
  redirectUri: string;
  connectedAt: string | null;
  expiresAt: string | null;
  refreshExpiresAt: string | null;
  renewedAt: string | null;
  needsAuthorization: boolean;
};

const path = "/api/admin/aliexpress/connection";
const date = (value: string) => new Date(value).toLocaleString();
const button = "rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-800";

export function AliExpressConnectionPanel() {
  const { authFetch, token } = useAdmin();
  const fetchRef = useRef(authFetch);
  fetchRef.current = authFetch;
  const [connection, setConnection] = useState<Connection | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function request<T>(suffix = "", options?: RequestInit): Promise<T> {
    const response = await fetchRef.current(path + suffix, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "AliExpress connection request failed.");
    return data as T;
  }

  useEffect(() => {
    if (!token) return;
    void request<Connection>().then(setConnection).catch(err => setError(err.message));
  }, [token]);

  async function run(operation: () => Promise<void>) {
    setPending(true);
    setError("");
    setMessage("");
    try {
      await operation();
    } catch (err) {
      setError(err instanceof Error ? err.message : "AliExpress connection request failed.");
    } finally {
      setPending(false);
    }
  }

  function authorize() {
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    void run(async () => {
      if (!popup) throw new Error("Allow pop-ups for Bazunk and try again.");
      try {
        const { url } = await request<{ url: string }>("/authorize", { method: "POST" });
        popup.location.replace(url);
        setMessage("Complete authorisation in the new tab, then refresh the connection status here.");
      } catch (err) {
        popup.close();
        throw err;
      }
    });
  }

  async function testConnection() {
    await request("/test", {
      method: "POST",
      body: JSON.stringify({ query: "usb cable" }),
    });
    setMessage("AliExpress accepted a live request using the saved connection.");
    setConnection(await request<Connection>());
  }

  const connected = Boolean(connection?.connectedAt);
  const canTest = Boolean(connection?.configured && connected && !connection.needsAuthorization);

  return (
    <section className="mb-5 space-y-3 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900" aria-labelledby="aliexpress-connection">
      <h2 id="aliexpress-connection" className="font-bold">AliExpress OAuth connection</h2>
      {connection && (
        <>
          <p className="text-sm">
            {!connection.configured ? "API credentials or encryption key missing" :
              connection.needsAuthorization ? "Reauthorisation required" : connected ? "Authorised" : "Disconnected"}
          </p>
          <dl className="space-y-1 text-sm">
            <div><dt className="inline font-medium">Callback URL </dt><dd className="inline break-all">{connection.redirectUri}</dd></div>
            {connection.expiresAt && <div><dt className="inline font-medium">Access expires </dt><dd className="inline">{date(connection.expiresAt)}</dd></div>}
            {connection.refreshExpiresAt && <div><dt className="inline font-medium">Renewal permission expires </dt><dd className="inline">{date(connection.refreshExpiresAt)}</dd></div>}
            {connection.renewedAt && <div><dt className="inline font-medium">Last renewed </dt><dd className="inline">{date(connection.renewedAt)}</dd></div>}
          </dl>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={pending || !connection?.configured} onClick={authorize}>
          {connected ? "Reauthorise" : "Authorise AliExpress"}
        </button>
        <button type="button" className={button} disabled={pending} onClick={() => void run(async () => setConnection(await request<Connection>()))}>
          Refresh status
        </button>
        <button type="button" className={button} disabled={pending || !canTest} onClick={() => void run(testConnection)}>
          Test connection
        </button>
        <button type="button" className={button} disabled={pending || !canTest} onClick={() => void run(async () => {
          setConnection(await request<Connection>("/renew", { method: "POST" }));
          setMessage("AliExpress tokens renewed.");
        })}>
          Renew tokens
        </button>
        {connected && <button type="button" className={button} disabled={pending} onClick={() => {
          if (window.confirm("Disconnect AliExpress and remove its saved OAuth tokens?")) {
            void run(async () => setConnection(await request<Connection>("", { method: "DELETE" })));
          }
        }}>Disconnect</button>}
      </div>
      {pending && <p role="status" className="text-sm">Contacting the API…</p>}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {message && <p role="status" className="text-sm">{message}</p>}
    </section>
  );
}
