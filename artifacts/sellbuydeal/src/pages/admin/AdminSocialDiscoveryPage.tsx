import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useAdmin } from "@/context/AdminContext";
import { AdminLayout } from "./AdminLayout";
import {
  activityButton,
  activityError,
  activityField,
} from "@/lib/socialActivity";

type AdminData = {
  prices: { post: number; short: number };
  placements: {
    id: string;
    kind: string;
    contentId: string;
    mode: string;
    label: string | null;
    expiresAt: string;
  }[];
  challenges: {
    id: string;
    title: string;
    reward: number;
    maxClaims: number;
    expiresAt: string;
  }[];
  awards: { id: string; username: string; credits: number; reason: string }[];
};
const field = `block text-sm ${activityField}`;

export function AdminSocialDiscoveryPage() {
  const { authFetch } = useAdmin();
  const [data, setData] = useState<AdminData | null>(null);
  const [kind, setKind] = useState("short");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const awardRequest = useRef<{ data: string; id: string } | null>(null);

  const request = useCallback(
    async <T,>(path = "", method = "GET", body?: object): Promise<T> => {
      const response = await authFetch(`/api/admin/social-discovery${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (response.status === 204) return undefined as T;
      const result = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(result?.error || "Social discovery request failed.");
      return result as T;
    },
    [authFetch],
  );
  const refresh = useCallback(
    async () => setData(await request<AdminData>()),
    [request],
  );
  useEffect(() => {
    void refresh().catch((err) => setMessage(activityError(err)));
  }, [refresh]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      await refresh();
      setMessage(success);
    } catch (err) {
      setMessage(activityError(err));
    } finally {
      setBusy(false);
    }
  }
  function form(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    return new FormData(event.currentTarget);
  }

  return (
    <AdminLayout>
      <main className="mx-auto max-w-5xl space-y-5 p-4">
        <h1 className="text-2xl font-bold">Social discovery</h1>
        {message && <p role="status">{message}</p>}
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-3 rounded-xl border bg-card p-4 text-card-foreground">
            <h2 className="text-lg font-bold">
              Sponsorships and featured creators
            </h2>
            <form
              className="space-y-2"
              onSubmit={(event) => {
                const values = form(event);
                void run(
                  () =>
                    request("/placements", "POST", {
                      kind,
                      contentId: values.get("content"),
                      hours: Number(values.get("hours")),
                      label: values.get("label"),
                    }),
                  "Placement added.",
                );
              }}
            >
              <fieldset disabled={busy} className="space-y-2">
                <label className="block text-sm">
                  Placement type
                  <select
                    className={field}
                    value={kind}
                    onChange={(event) => setKind(event.target.value)}
                  >
                    <option value="short">Sponsored Short</option>
                    <option value="story">Sponsored Story</option>
                    <option value="creator">Featured creator</option>
                  </select>
                </label>
                <label className="block text-sm">
                  Content ID from the discovery link
                  <input
                    className={field}
                    name="content"
                    required
                    maxLength={36}
                  />
                </label>
                {kind !== "creator" && (
                  <label className="block text-sm">
                    Sponsor shown to customers
                    <input
                      className={field}
                      name="label"
                      required
                      maxLength={80}
                    />
                  </label>
                )}
                <label className="block text-sm">
                  Duration in hours
                  <input
                    className={field}
                    name="hours"
                    type="number"
                    min={1}
                    max={720}
                    defaultValue={24}
                    required
                  />
                </label>
                <button className={activityButton}>Add placement</button>
              </fieldset>
            </form>
            <ul className="divide-y">
              {data?.placements.map((item) => (
                <li key={item.id} className="space-y-1 py-2 text-sm">
                  <p>
                    {item.kind} · {item.mode}
                    {item.label ? ` · ${item.label}` : ""} · Ends{" "}
                    {new Date(item.expiresAt).toLocaleString()}
                  </p>
                  <p className="break-all">{item.contentId}</p>
                  {item.mode !== "boost" && (
                    <button
                      className={activityButton}
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => request(`/placements/${item.id}`, "DELETE"),
                          "Placement ended.",
                        )
                      }
                    >
                      End placement
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section className="space-y-3 rounded-xl border bg-card p-4 text-card-foreground">
            <h2 className="text-lg font-bold">Boost pricing</h2>
            {data && (
              <form
                className="space-y-2"
                key={`${data.prices.post}:${data.prices.short}`}
                onSubmit={(event) => {
                  const values = form(event);
                  void run(
                    () =>
                      request("/prices", "PUT", {
                        post: Number(values.get("post")),
                        short: Number(values.get("short")),
                      }),
                    "Boost prices updated.",
                  );
                }}
              >
                <fieldset disabled={busy} className="space-y-2">
                  <label className="block text-sm">
                    Credits per 24-hour post boost
                    <input
                      className={field}
                      name="post"
                      type="number"
                      min={1}
                      max={10000}
                      required
                      defaultValue={data.prices.post}
                    />
                  </label>
                  <label className="block text-sm">
                    Credits per 24-hour Short boost
                    <input
                      className={field}
                      name="short"
                      type="number"
                      min={1}
                      max={10000}
                      required
                      defaultValue={data.prices.short}
                    />
                  </label>
                  <button className={activityButton}>Save prices</button>
                </fieldset>
              </form>
            )}
          </section>
          <section className="space-y-3 rounded-xl border bg-card p-4 text-card-foreground">
            <h2 className="text-lg font-bold">Shopping challenges</h2>
            <form
              className="space-y-2"
              onSubmit={(event) => {
                const values = form(event);
                const reward = Number(values.get("reward")),
                  maxClaims = Number(values.get("claims"));
                if (
                  !window.confirm(
                    `Create a challenge with up to ${reward * maxClaims} credits in rewards?`,
                  )
                )
                  return;
                void run(
                  () =>
                    request("/challenges", "POST", {
                      title: values.get("title"),
                      description: values.get("description"),
                      reward,
                      maxClaims,
                      hours: Number(values.get("hours")),
                    }),
                  "Challenge added.",
                );
              }}
            >
              <fieldset disabled={busy} className="space-y-2">
                <label className="block text-sm">
                  Challenge title
                  <input
                    className={field}
                    name="title"
                    required
                    maxLength={80}
                  />
                </label>
                <label className="block text-sm">
                  Description
                  <textarea
                    className={field}
                    name="description"
                    required
                    maxLength={500}
                  />
                </label>
                <label className="block text-sm">
                  Credits per eligible Short
                  <input
                    className={field}
                    name="reward"
                    type="number"
                    min={1}
                    max={100}
                    required
                  />
                </label>
                <label className="block text-sm">
                  Maximum claims
                  <input
                    className={field}
                    name="claims"
                    type="number"
                    min={1}
                    max={500}
                    required
                  />
                </label>
                <label className="block text-sm">
                  Duration in hours
                  <input
                    className={field}
                    name="hours"
                    type="number"
                    min={1}
                    max={720}
                    required
                    defaultValue={168}
                  />
                </label>
                <button className={activityButton}>Start challenge</button>
              </fieldset>
            </form>
            <ul className="divide-y">
              {data?.challenges.map((item) => (
                <li key={item.id} className="space-y-1 py-2 text-sm">
                  <p>
                    {item.title} · {item.reward} credits · Up to{" "}
                    {item.maxClaims} claims · Ends{" "}
                    {new Date(item.expiresAt).toLocaleString()}
                  </p>
                  <button
                    className={activityButton}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => request(`/challenges/${item.id}`, "DELETE"),
                        "Challenge closed.",
                      )
                    }
                  >
                    Close challenge
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="space-y-3 rounded-xl border bg-card p-4 text-card-foreground">
            <h2 className="text-lg font-bold">Creator rewards</h2>
            <form
              className="space-y-2"
              onSubmit={(event) => {
                const values = form(event),
                  data = {
                    creator: values.get("creator"),
                    credits: Number(values.get("credits")),
                    reason: values.get("reason"),
                  };
                if (
                  !window.confirm(
                    `Award ${data.credits} credits to this creator?`,
                  )
                )
                  return;
                const fingerprint = JSON.stringify(data);
                if (awardRequest.current?.data !== fingerprint)
                  awardRequest.current = {
                    data: fingerprint,
                    id: crypto.randomUUID(),
                  };
                const requestId = awardRequest.current.id;
                void run(async () => {
                  await request("/awards", "POST", { ...data, requestId });
                  awardRequest.current = null;
                }, "Creator reward credited.");
              }}
            >
              <fieldset disabled={busy} className="space-y-2">
                <label className="block text-sm">
                  Creator storefront ID
                  <input
                    className={field}
                    name="creator"
                    required
                    maxLength={36}
                  />
                </label>
                <label className="block text-sm">
                  Credits
                  <input
                    className={field}
                    name="credits"
                    type="number"
                    min={1}
                    max={100}
                    required
                  />
                </label>
                <label className="block text-sm">
                  Reason
                  <input
                    className={field}
                    name="reason"
                    maxLength={200}
                    required
                  />
                </label>
                <button className={activityButton}>Award credits</button>
              </fieldset>
            </form>
            <ul className="divide-y">
              {data?.awards.map((item) => (
                <li className="py-2 text-sm" key={item.id}>
                  @{item.username} · {item.credits} credits · {item.reason}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </AdminLayout>
  );
}
