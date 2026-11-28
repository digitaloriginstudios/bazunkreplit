import { useAuth } from "@clerk/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link } from "wouter";
import { Navbar } from "@/components/Navbar";
import { ShortPlayer, type ShortPlayback } from "@/components/ShortPlayer";
import {
  activityButton,
  activityError,
  activityField,
  productPrice,
  useSocialActivity,
  type ProductOption,
  type SocialProduct,
} from "@/lib/socialActivity";

type Kind = "short" | "unboxing";
type Short = {
  id: string;
  caption: string;
  kind: Kind;
  username: string;
  displayName: string;
  products: (SocialProduct | null)[];
};
type OwnShort = {
  id: string;
  caption: string;
  kind: Kind;
  status: string;
  failure: string | null;
  analytics: {
    opens: number;
    plays: number;
    completions: number;
    productClicks: number;
  };
};
type Order = { id: string; title: string; deliveredAt: string };
const reports = [
  ["spam", "Spam"],
  ["abuse", "Abuse"],
  ["copyright", "Copyright"],
  ["unsafe", "Unsafe content"],
  ["other", "Other"],
];

async function checkVideo(file: File) {
  if (file.size > 100_000_000)
    throw new Error("Choose a video no larger than 100 MB.");
  const temporary = URL.createObjectURL(file);
  const video = document.createElement("video");
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("The video could not be read.")),
        8000,
      );
      video.onloadedmetadata = () => {
        window.clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error("Use a supported video such as MP4 or WebM."));
      };
      video.preload = "metadata";
      video.src = temporary;
    });
    if (
      video.videoHeight <= video.videoWidth ||
      !Number.isFinite(video.duration) ||
      video.duration <= 0 ||
      video.duration > 90
    ) {
      throw new Error("Choose a vertical video up to 90 seconds long.");
    }
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(temporary);
  }
}

function UploadForm({ onSaved }: { onSaved: () => void }) {
  const request = useSocialActivity();
  const [kind, setKind] = useState<Kind>("short");
  const [caption, setCaption] = useState("");
  const [video, setVideo] = useState<File | null>(null);
  const [captions, setCaptions] = useState<File | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [order, setOrder] = useState("");
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [selected, setSelected] = useState<ProductOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (kind !== "unboxing") return;
    const controller = new AbortController();
    void request<{ orders: Order[] }>("shorts/orders", {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setOrders(data.orders);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(activityError(err));
      });
    return () => controller.abort();
  }, [kind, request]);

  async function search() {
    setBusy(true);
    setError("");
    try {
      const data = await request<{ products: ProductOption[] }>(
        `shorts/products?q=${encodeURIComponent(query)}`,
      );
      setProducts(data.products);
      if (!data.products.length) setError("No matching products.");
    } catch (err) {
      setError(activityError(err));
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!video || !captions) return;
    setBusy(true);
    setError("");
    let uploadId: string | undefined;
    try {
      await checkVideo(video);
      if (captions.size > 64_000)
        throw new Error("The WebVTT file must be smaller than 64 KB.");
      const { uploadUrl, id } = await request<{
        id: string;
        uploadUrl: string;
      }>("shorts/upload", {
        method: "POST",
        body: {
          kind,
          caption,
          captions: await captions.text(),
          bytes: video.size,
          orderId: kind === "unboxing" ? order : undefined,
          productIds: kind === "short" ? selected.map((item) => item.id) : [],
        },
      });
      uploadId = id;
      const form = new FormData();
      form.set("file", video);
      const response = await fetch(uploadUrl, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(300_000),
      });
      if (!response.ok)
        throw new Error(
          "The video upload failed. Try uploading the file again.",
        );
      onSaved();
    } catch (err) {
      if (uploadId)
        void request(`shorts/${uploadId}/upload`, { method: "DELETE" }).catch(
          () => {},
        );
      setError(activityError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="rounded-2xl border bg-card p-4" onSubmit={upload}>
      <fieldset disabled={busy} className="space-y-3">
        <label className="block">
          Video type
          <select
            className={activityField}
            value={kind}
            onChange={(event) => {
              setError("");
              setKind(event.target.value as Kind);
            }}
          >
            <option value="short">Short</option>
            <option value="unboxing">Verified-purchase unboxing</option>
          </select>
        </label>
        <label className="block">
          Vertical video, up to 90 seconds and 100 MB
          <input
            className={activityField}
            type="file"
            accept="video/*"
            required
            onChange={(event) => setVideo(event.target.files?.[0] ?? null)}
          />
        </label>
        <label className="block">
          English captions (.vtt)
          <input
            className={activityField}
            type="file"
            accept=".vtt,text/vtt"
            required
            onChange={(event) => setCaptions(event.target.files?.[0] ?? null)}
          />
        </label>
        <label className="block">
          Description
          <textarea
            className={activityField}
            maxLength={500}
            required
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
          />
        </label>
        {kind === "unboxing" ? (
          <label className="block">
            Delivered order
            <select
              className={activityField}
              required
              value={order}
              onChange={(event) => setOrder(event.target.value)}
            >
              <option value="">
                {orders.length ? "Choose an order" : "No eligible orders"}
              </option>
              {orders.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} ·{" "}
                  {new Date(item.deliveredAt).toLocaleDateString()}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="space-y-2">
            <div className="flex items-end gap-2">
              <label className="flex-1">
                Tag up to five products
                <input
                  className={activityField}
                  type="search"
                  maxLength={80}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      if (query.trim().length >= 2) void search();
                    }
                  }}
                />
              </label>
              <button
                type="button"
                className={activityButton}
                disabled={query.trim().length < 2}
                onClick={() => void search()}
              >
                Search
              </button>
            </div>
            {products.length > 0 && (
              <ul className="max-h-40 overflow-auto rounded-lg border p-2">
                {products.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="block w-full p-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                      disabled={
                        selected.length >= 5 ||
                        selected.some((product) => product.id === item.id)
                      }
                      onClick={() =>
                        setSelected((previous) => [...previous, item])
                      }
                    >
                      {item.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {selected.map((item) => (
              <p key={item.id} className="text-sm">
                {item.title}{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() =>
                    setSelected((previous) =>
                      previous.filter((product) => product.id !== item.id),
                    )
                  }
                >
                  Remove
                </button>
              </p>
            ))}
          </div>
        )}
        <button
          className={activityButton}
          disabled={
            !video ||
            !captions ||
            !caption.trim() ||
            (kind === "unboxing" && !order)
          }
        >
          {busy ? "Working…" : "Upload for review"}
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

function MyVideos({ revision }: { revision: number }) {
  const request = useSocialActivity();
  const [videos, setVideos] = useState<OwnShort[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    async function load() {
      try {
        const data = await request<{ videos: OwnShort[] }>("shorts/mine", {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setVideos(data.videos);
        setError("");
        const pending = data.videos.filter(
          (video) => video.status === "uploading",
        );
        if (!pending.length) return;
        timer = window.setTimeout(() => void load(), 8000);
      } catch (err) {
        if (!controller.signal.aborted) setError(activityError(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [request, revision]);

  return (
    <section className="space-y-3">
      {loading && <p role="status">Loading your videos…</p>}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {!loading && !videos.length && !error && <p>No uploads yet.</p>}
      {videos.map((video) => (
        <article
          key={video.id}
          className="space-y-2 rounded-xl border bg-card p-4"
        >
          <p className="break-words font-semibold">{video.caption}</p>
          <p className="text-sm text-muted-foreground">
            {video.status === "uploading"
              ? "Uploading or processing"
              : video.status === "review"
                ? "Awaiting moderation"
                : video.status}
          </p>
          {video.failure && (
            <p className="text-sm text-red-600">{video.failure}</p>
          )}
          {["published", "removed"].includes(video.status) && (
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {Object.entries({
                "Unique opens": video.analytics.opens,
                "Unique plays": video.analytics.plays,
                Completions: video.analytics.completions,
                "Product clicks": video.analytics.productClicks,
              }).map(([label, total]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd className="font-semibold">{total}</dd>
                </div>
              ))}
            </dl>
          )}
        </article>
      ))}
    </section>
  );
}

function ShortCard({ video, active }: { video: Short; active: boolean }) {
  const request = useSocialActivity();
  const [media, setMedia] = useState<ShortPlayback | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(false);
  const [reason, setReason] = useState("spam");
  const [notice, setNotice] = useState("");
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!active) {
      controller.current?.abort();
      setMedia(null);
      setBusy(false);
    }
    return () => controller.current?.abort();
  }, [active]);

  const track = (kind: string, listingId?: number) => {
    void request(`shorts/${video.id}/events`, {
      method: "POST",
      body: { kind, listingId },
    }).catch(() => {});
  };

  async function open() {
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    setBusy(true);
    setNotice("");
    try {
      const data = await request<ShortPlayback>(`shorts/${video.id}/playback`, {
        signal: requestController.signal,
      });
      if (!requestController.signal.aborted) {
        setMedia(data);
        track("open");
      }
    } catch (err) {
      if (!requestController.signal.aborted) setNotice(activityError(err));
    } finally {
      if (!requestController.signal.aborted) setBusy(false);
    }
  }

  return (
    <article
      data-short-id={video.id}
      aria-label={`Video by ${video.displayName}`}
      className="min-h-full snap-start space-y-2 rounded-2xl border bg-card p-3"
    >
      <p className="font-bold">
        {video.displayName}{" "}
        <span className="text-sm font-normal">@{video.username}</span>
      </p>
      {video.kind === "unboxing" && (
        <p className="text-sm font-semibold text-[#4A5CE8]">
          Verified-purchase unboxing
        </p>
      )}
      <div className="relative">
        {media && active ? (
          <ShortPlayer
            key={media.manifest}
            media={media}
            title={`Short by ${video.displayName}`}
            onPlay={() => track("play")}
            onEnded={() => track("complete")}
          />
        ) : (
          <div className="grid h-[min(43dvh,360px)] place-items-center rounded-xl bg-black text-white">
            <button
              className={activityButton}
              disabled={busy || !active}
              onClick={() => void open()}
            >
              {busy ? "Loading video…" : "Open video"}
            </button>
          </div>
        )}
        {video.products.some((product) => product?.available) && (
          <details className="absolute right-2 top-2 z-10 max-w-[85%] rounded-lg bg-black/90 p-2 text-white">
            <summary className="cursor-pointer px-2 py-1 text-sm font-semibold">
              Shop products
            </summary>
            <div className="mt-2 flex max-h-36 flex-col gap-1 overflow-auto">
              {video.products.flatMap((product) =>
                product?.available
                  ? [
                      <a
                        key={product.id}
                        className={activityButton}
                        href={`/listing/${encodeURIComponent(product.path)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => track("product", product.id)}
                      >
                        {product.title} · {productPrice(product)}
                      </a>,
                    ]
                  : [],
              )}
            </div>
          </details>
        )}
      </div>
      <p className="whitespace-pre-wrap break-words text-sm">{video.caption}</p>
      <div className="flex flex-wrap gap-2">
        <button
          className={activityButton}
          aria-expanded={report}
          onClick={() => setReport(!report)}
        >
          {report ? "Cancel report" : "Report video"}
        </button>
      </div>
      {report && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await request(`shorts/${video.id}/report`, {
                method: "POST",
                body: { reason },
              });
              setReport(false);
              setNotice("Report sent to moderation.");
            } catch (err) {
              setNotice(activityError(err));
            }
          }}
        >
          <select
            className={activityButton}
            aria-label="Report reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          >
            {reports.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button className={activityButton}>Send report</button>
        </form>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
    </article>
  );
}

function ShortFeed({ kind }: { kind?: Kind }) {
  const request = useSocialActivity();
  const [videos, setVideos] = useState<Short[]>([]);
  const [active, setActive] = useState<string>();
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const deck = useRef<HTMLDivElement>(null);
  const load = useCallback(
    async (page = 0, signal?: AbortSignal) => {
      setBusy(true);
      setError("");
      try {
        const data = await request<{
          videos: Short[];
          nextPage: number | null;
        }>(`shorts?page=${page}${kind ? `&kind=${kind}` : ""}`, { signal });
        if (signal?.aborted) return;
        setVideos((previous) =>
          page
            ? [
                ...previous,
                ...data.videos.filter(
                  (video) => !previous.some((item) => item.id === video.id),
                ),
              ]
            : data.videos,
        );
        if (!page) setActive(data.videos[0]?.id);
        setNext(data.nextPage);
      } catch (err) {
        if (!signal?.aborted) setError(activityError(err));
      } finally {
        if (!signal?.aborted) setBusy(false);
      }
    },
    [request, kind],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(0, controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const root = deck.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting && entry.intersectionRatio >= 0.55) {
            setActive((entry.target as HTMLElement).dataset.shortId);
          }
      },
      { root, threshold: 0.55 },
    );
    root
      .querySelectorAll("[data-short-id]")
      .forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [videos]);

  const index = videos.findIndex((video) => video.id === active);
  function step(direction: number) {
    const nextVideo = videos[index + direction];
    if (!nextVideo) return;
    deck.current
      ?.querySelector(`[data-short-id="${nextVideo.id}"]`)
      ?.scrollIntoView({ block: "start", behavior: "instant" });
    setActive(nextVideo.id);
  }

  return (
    <section className="space-y-2">
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {busy && !videos.length && <p role="status">Loading videos…</p>}
      {!busy && !videos.length && !error && <p>No videos yet.</p>}
      {videos.length > 0 && (
        <>
          <div className="flex gap-2">
            <button
              className={activityButton}
              disabled={index < 1}
              onClick={() => step(-1)}
            >
              Previous video
            </button>
            <button
              className={activityButton}
              disabled={index >= videos.length - 1}
              onClick={() => step(1)}
            >
              Next video
            </button>
          </div>
          <div
            ref={deck}
            className="h-[75dvh] snap-y snap-mandatory space-y-2 overflow-y-auto overscroll-contain"
            tabIndex={0}
            role="region"
            aria-label="Swipe through videos or use the arrow keys"
            onKeyDown={(event) => {
              if (
                event.target !== event.currentTarget ||
                !["ArrowDown", "ArrowUp"].includes(event.key)
              )
                return;
              event.preventDefault();
              step(event.key === "ArrowDown" ? 1 : -1);
            }}
          >
            {videos.map((video) => (
              <ShortCard
                key={video.id}
                video={video}
                active={active === video.id}
              />
            ))}
          </div>
        </>
      )}
      {next !== null && (
        <button
          className={activityButton}
          disabled={busy}
          onClick={() => void load(next)}
        >
          Load more videos
        </button>
      )}
    </section>
  );
}

function ShortsContent() {
  const [tab, setTab] = useState<"shorts" | "unboxings" | "mine">("shorts");
  const [upload, setUpload] = useState(false);
  const [revision, setRevision] = useState(0);
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-black">Bazunk Shorts</h1>
        <button
          className={activityButton}
          aria-expanded={upload}
          onClick={() => setUpload(!upload)}
        >
          {upload ? "Close uploader" : "Upload video"}
        </button>
      </header>
      {upload && (
        <UploadForm
          onSaved={() => {
            setUpload(false);
            setTab("mine");
            setRevision((value) => value + 1);
          }}
        />
      )}
      <nav className="flex flex-wrap gap-2" aria-label="Shorts filters">
        {(
          [
            ["shorts", "Shorts"],
            ["unboxings", "Unboxings"],
            ["mine", "My videos"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className={activityButton}
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "mine" ? (
        <MyVideos revision={revision} />
      ) : (
        <ShortFeed
          key={tab}
          kind={tab === "unboxings" ? "unboxing" : "short"}
        />
      )}
    </>
  );
}

export function ShortsPage() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  return (
    <>
      <Navbar />
      <main className="mx-auto min-h-[65vh] max-w-xl space-y-4 px-4 py-8">
        <Link href="/social" className="text-sm font-semibold underline">
          Bazunk Social
        </Link>
        {!isLoaded ? (
          <p role="status">Loading…</p>
        ) : isSignedIn ? (
          <ShortsContent key={userId} />
        ) : (
          <p>
            <Link
              className={activityButton}
              href="/sign-in?redirect_url=%2Fsocial%2Fshorts"
            >
              Sign in to watch Shorts
            </Link>
          </p>
        )}
      </main>
    </>
  );
}
