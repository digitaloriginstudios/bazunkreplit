import { useAuth } from "@clerk/react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useFeature } from "@/components/FeatureGate";
import {
  activityButton,
  activityError,
  activityField,
  productPrice,
  useSocialActivity,
  type ProductOption,
  type SocialProduct,
} from "@/lib/socialActivity";

type Story = {
  id: string;
  caption: string;
  mediaType: "image" | "video" | "embed";
  mediaUrl: string;
  promoUrl: string | null;
  expiresAt: string;
  expired: boolean;
  displayName: string;
  username: string;
  products: (SocialProduct | null)[];
  analytics: {
    views: number;
    productClicks: number;
    promoClicks: number;
  } | null;
};

function StoryComposer({
  products,
  onSave,
}: {
  products: ProductOption[];
  onSave: () => void;
}) {
  const request = useSocialActivity();
  const [mediaType, setMediaType] = useState("image");
  const [mediaUrl, setMediaUrl] = useState("");
  const [promoUrl, setPromoUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function publish(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request("stories", {
        method: "POST",
        body: { mediaType, mediaUrl, promoUrl, caption, productIds: selected },
      });
      onSave();
    } catch (err) {
      setError(activityError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={publish}
    >
      <fieldset disabled={busy} className="space-y-3">
        <label className="block">
          Story format
          <select
            className={activityField}
            value={mediaType}
            onChange={(event) => setMediaType(event.target.value)}
          >
            <option value="image">Image</option>
            <option value="video">Video</option>
          </select>
        </label>
        <label className="block">
          Media URL
          <input
            className={activityField}
            type="url"
            required
            maxLength={2048}
            value={mediaUrl}
            placeholder={
              mediaType === "image"
                ? "https://…"
                : "MP4, WebM, YouTube or Vimeo URL"
            }
            onChange={(event) => setMediaUrl(event.target.value)}
          />
        </label>
        <label className="block">
          Caption
          <input
            className={activityField}
            maxLength={240}
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
          />
        </label>
        <label className="block">
          Promotional link
          <input
            className={activityField}
            type="url"
            maxLength={2048}
            value={promoUrl}
            onChange={(event) => setPromoUrl(event.target.value)}
          />
        </label>
        <fieldset className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
          <legend>Tag up to four products</legend>
          {products.map((product) => (
            <label key={product.id} className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(product.id)}
                disabled={
                  selected.length >= 4 && !selected.includes(product.id)
                }
                onChange={(event) =>
                  setSelected((prev) =>
                    event.target.checked
                      ? [...prev, product.id]
                      : prev.filter((id) => id !== product.id),
                  )
                }
              />
              {product.title}
            </label>
          ))}
        </fieldset>
        <button className={activityButton} disabled={busy}>
          {busy ? "Publishing…" : "Publish for 24 hours"}
        </button>
        {error && (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        )}
      </fieldset>
    </form>
  );
}

function StoryPanel({ seller, manage }: { seller?: string; manage: boolean }) {
  const request = useSocialActivity();
  const [stories, setStories] = useState<Story[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [compose, setCompose] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const query = new URLSearchParams();
      if (seller && !analytics) query.set("seller", seller);
      if (analytics) query.set("mine", "1");
      const data = await request<{ stories: Story[] }>(`stories?${query}`, {
        signal,
      });
      if (!signal?.aborted) {
        setNow(Date.now());
        setStories(data.stories);
      }
    },
    [seller, analytics, request],
  );

  useEffect(() => {
    const controller = new AbortController();
    setStories([]);
    setSelected(null);
    setError("");
    void refresh(controller.signal).catch((err) => {
      if (!controller.signal.aborted) setError(activityError(err));
    });
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible")
        void refresh(controller.signal).catch(() => {});
    }, 15_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (!manage) return;
    const controller = new AbortController();
    void request<{ products: ProductOption[] }>("stories/products", {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setProducts(data.products);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [manage, request]);

  const visible = stories.filter(
    (story) => analytics || new Date(story.expiresAt).getTime() > now,
  );
  const current = visible.find((story) => story.id === selected);
  const expiresAt = current && new Date(current.expiresAt).getTime();
  useEffect(() => {
    if (!expiresAt || expiresAt <= Date.now()) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      expiresAt - Date.now() + 20,
    );
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  function track(
    story: Story,
    kind: "view" | "product" | "promo",
    listingId?: number,
  ) {
    void request(`stories/${story.id}/events`, {
      method: "POST",
      body: { kind, listingId },
    }).catch(() => {});
  }

  if (!manage && !visible.length && !error) return null;

  return (
    <section
      className="space-y-3 rounded-2xl border bg-card p-4"
      aria-label="Seller stories"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">
          {analytics ? "My story analytics" : "Seller stories"}
        </h2>
        {manage && (
          <div className="flex flex-wrap gap-2">
            {products.length > 0 && (
              <button
                className={activityButton}
                aria-expanded={compose}
                onClick={() => setCompose(!compose)}
              >
                {compose ? "Close editor" : "New story"}
              </button>
            )}
            <button
              className={activityButton}
              aria-pressed={analytics}
              onClick={() => setAnalytics(!analytics)}
            >
              {analytics ? "Browse stories" : "My story analytics"}
            </button>
          </div>
        )}
      </div>
      {compose && (
        <StoryComposer
          products={products}
          onSave={() => {
            setCompose(false);
            void refresh().catch((err) => setError(activityError(err)));
          }}
        />
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {visible.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">
          {analytics ? "No stories yet." : "No active stories."}
        </p>
      )}
      <ul className="flex gap-4 overflow-x-auto pb-1">
        {visible.map((story) => (
          <li key={story.id} className="w-20 flex-none text-center">
            <button
              className="w-full space-y-1 text-xs font-semibold"
              aria-pressed={selected === story.id}
              aria-label={`Story from ${story.displayName}`}
              onClick={() => {
                setSelected(story.id);
                if (!analytics) track(story, "view");
              }}
            >
              <span className="mx-auto grid size-14 place-items-center overflow-hidden rounded-full border-2 border-[#4A5CE8] bg-muted text-lg">
                {story.mediaType === "image" ? (
                  <img
                    className="size-full object-cover"
                    src={story.mediaUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    loading="lazy"
                  />
                ) : (
                  "▶"
                )}
              </span>
              <span className="block truncate">{story.displayName}</span>
              {analytics && (
                <span className="block text-muted-foreground">
                  {story.expired ? "Expired" : "Active"}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {current && (
        <article className="space-y-3 rounded-xl border p-3">
          <header className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">@{current.username}</p>
            <button
              className={activityButton}
              onClick={() => setSelected(null)}
            >
              Close story
            </button>
          </header>
          {analytics ? (
            <>
              <p className="break-words font-medium">
                {current.caption || "Untitled story"}
              </p>
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt>Unique views</dt>
                  <dd className="font-bold">{current.analytics?.views ?? 0}</dd>
                </div>
                <div>
                  <dt>Product clicks</dt>
                  <dd className="font-bold">
                    {current.analytics?.productClicks ?? 0}
                  </dd>
                </div>
                <div>
                  <dt>Promo clicks</dt>
                  <dd className="font-bold">
                    {current.analytics?.promoClicks ?? 0}
                  </dd>
                </div>
              </dl>
              <button
                className={activityButton}
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm("Delete this story and its analytics?"))
                    return;
                  setBusy(true);
                  try {
                    await request(`stories/${current.id}`, {
                      method: "DELETE",
                    });
                    setSelected(null);
                    await refresh();
                  } catch (err) {
                    setError(activityError(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Delete story
              </button>
            </>
          ) : (
            <>
              {current.mediaType === "image" ? (
                <img
                  className="mx-auto max-h-[55vh] rounded-lg object-contain"
                  src={current.mediaUrl}
                  alt={current.caption || "Seller story image"}
                  referrerPolicy="no-referrer"
                />
              ) : current.mediaType === "video" ? (
                <video
                  className="mx-auto max-h-[55vh] w-full rounded-lg"
                  src={current.mediaUrl}
                  controls
                  playsInline
                  preload="metadata"
                />
              ) : (
                <iframe
                  className="aspect-video w-full rounded-lg"
                  title="Seller story video"
                  src={current.mediaUrl}
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              )}
              {current.caption && (
                <p className="whitespace-pre-wrap break-words">
                  {current.caption}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {current.products.flatMap((product) =>
                  product && product.available
                    ? [
                        <a
                          key={product.id}
                          className={activityButton}
                          href={`/listing/${encodeURIComponent(product.path)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => track(current, "product", product.id)}
                        >
                          {product.title} · {productPrice(product)}
                        </a>,
                      ]
                    : [],
                )}
                {current.promoUrl && (
                  <a
                    className={activityButton}
                    href={current.promoUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                    onClick={() => track(current, "promo")}
                  >
                    Visit promotion
                  </a>
                )}
              </div>
            </>
          )}
        </article>
      )}
    </section>
  );
}

export function SellerStories({
  seller,
  manage = false,
}: {
  seller?: string;
  manage?: boolean;
}) {
  const { isSignedIn, userId } = useAuth();
  const social = useFeature("social");
  const enabled = useFeature("social_stories");
  if (!social || !enabled || !isSignedIn) return null;
  return (
    <StoryPanel
      key={`${userId}:${seller ?? "all"}`}
      seller={seller}
      manage={manage}
    />
  );
}
