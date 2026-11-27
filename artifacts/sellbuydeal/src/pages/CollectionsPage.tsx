import { useAuth } from "@clerk/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { Navbar } from "@/components/Navbar";
import { useFeature } from "@/components/FeatureGate";
import {
  CollectionEditor,
  collectionButton,
  occasions,
} from "@/components/CollectionEditor";
import { WishlistAccess } from "@/components/WishlistAccess";
import { useSeoMetadata } from "@/hooks/useSeoMetadata";
import {
  collectionPath,
  errorText,
  useCollectionRequest,
  type Collection,
  type CollectionDetail,
  type CollectionItem,
  type CollectionPage,
} from "@/lib/socialCollections";

const origin = "https://www.bazunk.com";
const layout = "mx-auto min-h-[65vh] max-w-5xl space-y-5 px-4 py-10";
const signIn = (path: string) =>
  `/sign-in?redirect_url=${encodeURIComponent(path)}`;

function Cover({ url }: { url: string }) {
  return (
    <img
      className="aspect-[3/1] w-full rounded-xl bg-muted object-cover"
      src={url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}

type Mode = "discover" | "mine" | "following";

export function CollectionsPage() {
  const { userId } = useAuth();
  return <CollectionDirectory key={userId ?? "guest"} />;
}

function CollectionDirectory() {
  const { isSignedIn } = useAuth();
  const profiles = useFeature("social_profiles");
  const wishlists = useFeature("social_wishlists");
  const follows = useFeature("social_collection_follows");
  const request = useCollectionRequest();
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<Mode>("discover");
  const activeMode =
    !isSignedIn || (mode === "following" && !follows) ? "discover" : mode;
  const [boards, setBoards] = useState<Collection[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [creating, setCreating] = useState(false);
  useSeoMetadata({
    title: "Product collections | Bazunk",
    description: "Explore product collections curated by the Bazunk community.",
    url: `${origin}/collections`,
  });

  const load = useCallback(
    async (page: number, signal?: AbortSignal) => {
      setBusy(true);
      setError("");
      try {
        const result = await request<CollectionPage>(
          `?mode=${activeMode}&page=${page}`,
          { signal },
        );
        if (signal?.aborted) return;
        setBoards((previous) =>
          page === 0 ? result.boards : [...previous, ...result.boards],
        );
        setNext(result.nextPage);
      } catch (err) {
        if (!signal?.aborted) setError(errorText(err));
      } finally {
        if (!signal?.aborted) setBusy(false);
      }
    },
    [activeMode, request],
  );

  useEffect(() => {
    const controller = new AbortController();
    setBoards([]);
    setNext(null);
    void load(0, controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <>
      <Navbar />
      <main className={layout}>
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-3xl font-black">Collections</h1>
          {isSignedIn && profiles && (
            <button
              className={collectionButton}
              aria-expanded={creating}
              onClick={() => setCreating(!creating)}
            >
              {creating ? "Close editor" : "New collection or wishlist"}
            </button>
          )}
          {!isSignedIn && (
            <Link href={signIn("/collections")} className={collectionButton}>
              Sign in
            </Link>
          )}
        </header>
        {creating && isSignedIn && profiles && (
          <CollectionEditor
            wishlists={wishlists}
            onSave={async (settings) => {
              const { slug } = await request<{ slug: string }>("", {
                method: "POST",
                body: settings,
              });
              navigate(collectionPath(slug));
            }}
          />
        )}
        {isSignedIn && (
          <nav aria-label="Collection filters" className="flex flex-wrap gap-2">
            <button
              className={collectionButton}
              disabled={busy}
              aria-pressed={activeMode === "discover"}
              onClick={() => setMode("discover")}
            >
              Discover
            </button>
            <button
              className={collectionButton}
              disabled={busy}
              aria-pressed={activeMode === "mine"}
              onClick={() => setMode("mine")}
            >
              My collections
            </button>
            {follows && (
              <button
                className={collectionButton}
                disabled={busy}
                aria-pressed={activeMode === "following"}
                onClick={() => setMode("following")}
              >
                Following
              </button>
            )}
          </nav>
        )}
        {error && (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        )}
        {busy && <p role="status">Loading collections…</p>}
        {!busy && !error && !boards.length && (
          <p className="text-muted-foreground">No collections here yet.</p>
        )}
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((board) => (
            <li key={board.slug} className="rounded-2xl border bg-card p-4">
              <Link
                href={collectionPath(board.slug)}
                className="block space-y-2"
              >
                {board.coverUrl && <Cover url={board.coverUrl} />}
                <h2 className="break-words text-lg font-bold">{board.title}</h2>
                <p className="text-sm text-muted-foreground">
                  @{board.ownerUsername} ·{" "}
                  {board.kind === "wishlist"
                    ? "Wishlist"
                    : board.public
                      ? "Public"
                      : "Private"}
                </p>
                {board.description && (
                  <p className="line-clamp-3 break-words text-sm">
                    {board.description}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
        {next !== null && (
          <button
            className={collectionButton}
            disabled={busy}
            onClick={() => void load(next)}
          >
            More collections
          </button>
        )}
      </main>
    </>
  );
}

function productPrice(item: CollectionItem) {
  if (!item.price || !item.currency) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: item.currency,
    }).format(Number(item.price));
  } catch {
    return `${item.price} ${item.currency}`;
  }
}

function CollectionDetailView({ slug }: { slug: string }) {
  const { isSignedIn } = useAuth();
  const follows = useFeature("social_collection_follows");
  const request = useCollectionRequest();
  const [, navigate] = useLocation();
  const [board, setBoard] = useState<CollectionDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [share, setShare] = useState(false);
  const publicPath = collectionPath(slug);
  const readVersion = useRef(0);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++readVersion.current;
      try {
        const detail = await request<CollectionDetail>(
          `/${encodeURIComponent(slug)}`,
          { signal },
        );
        if (!signal?.aborted && version === readVersion.current)
          setBoard(detail);
      } catch (err) {
        if (!signal?.aborted && version === readVersion.current) throw err;
      }
    },
    [request, slug],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setBoard(null);
    setError("");
    function refresh() {
      return load(controller.signal).catch((err) => {
        if (!controller.signal.aborted) {
          setBoard(null);
          setError(errorText(err));
        }
      });
    }
    void refresh().finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      readVersion.current++;
    };
  }, [load]);

  useSeoMetadata({
    title: board?.public
      ? `${board.title} | Bazunk Collections`
      : "Bazunk Collections",
    description: board?.public
      ? board.description || `Explore ${board.title}, curated on Bazunk.`
      : "Product collections on Bazunk.",
    url: `${origin}${publicPath}`,
    image: board?.public ? (board.coverUrl ?? undefined) : undefined,
    robots: board?.public ? "index, follow" : "noindex, follow",
  });

  async function change(path: string, method: string) {
    setBusy(true);
    setError("");
    try {
      await request(`/${slug}${path}`, { method });
      if (!path && method === "DELETE") navigate("/collections");
      else await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const owner = board?.role === "owner";
  const editor = owner || board?.role === "editor";

  return (
    <>
      <Navbar />
      <main className={layout}>
        <Link href="/collections" className="text-sm font-semibold underline">
          All collections
        </Link>
        {loading && <p role="status">Loading collection…</p>}
        {error && (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        )}
        {board && (
          <>
            {board.coverUrl && <Cover url={board.coverUrl} />}
            <header className="space-y-2">
              <h1 className="break-words text-3xl font-black">{board.title}</h1>
              <p className="text-sm text-muted-foreground">
                @{board.ownerUsername} ·{" "}
                {board.kind === "wishlist"
                  ? `${occasions.find(([value]) => value === board.occasion)?.[1] ?? "General"} wishlist`
                  : board.public
                    ? "Public collection"
                    : "Private collection"}
              </p>
              {board.description && (
                <p className="whitespace-pre-wrap break-words">
                  {board.description}
                </p>
              )}
            </header>
            <div className="flex flex-wrap gap-2">
              {board.public && (
                <button
                  className={collectionButton}
                  aria-expanded={share}
                  onClick={() => setShare(!share)}
                >
                  Share collection
                </button>
              )}
              {board.public &&
                follows &&
                !owner &&
                (isSignedIn ? (
                  <button
                    className={collectionButton}
                    disabled={busy}
                    aria-pressed={board.following}
                    onClick={() =>
                      void change("/follow", board.following ? "DELETE" : "PUT")
                    }
                  >
                    {board.following ? "Unfollow" : "Follow collection"}
                  </button>
                ) : (
                  <Link className={collectionButton} href={signIn(publicPath)}>
                    Sign in to follow
                  </Link>
                ))}
              {owner && (
                <button
                  className={collectionButton}
                  aria-expanded={editing}
                  onClick={() => setEditing(!editing)}
                >
                  Collection settings
                </button>
              )}
            </div>
            {board.public && share && (
              <label className="block text-sm">
                Public collection link
                <input
                  className="mt-1 w-full rounded-lg border bg-background p-2"
                  readOnly
                  value={new URL(publicPath, window.location.origin).href}
                  onFocus={(event) => event.target.select()}
                />
              </label>
            )}
            {owner && editing && (
              <>
                <CollectionEditor
                  initial={board}
                  wishlists={board.kind === "wishlist"}
                  onSave={async (settings) => {
                    await request(`/${slug}`, {
                      method: "PUT",
                      body: settings,
                    });
                    await load();
                  }}
                />
                <button
                  className={collectionButton}
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Delete this collection and remove its items and access links?",
                      )
                    )
                      void change("", "DELETE");
                  }}
                >
                  Delete collection
                </button>
              </>
            )}
            {owner && board.kind === "wishlist" && (
              <WishlistAccess slug={slug} />
            )}
            {editor && (
              <p className="text-sm text-muted-foreground">
                From a product page, choose <strong>Add to collection</strong>.{" "}
                <Link className="underline" href="/browse">
                  Browse products
                </Link>
              </p>
            )}
            {board.items.length === 0 && (
              <p className="text-muted-foreground">No products yet.</p>
            )}
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {board.items.map((item) => (
                <li
                  key={item.id}
                  className="space-y-2 rounded-xl border bg-card p-4"
                >
                  {item.image && (
                    <img
                      className="aspect-[4/3] w-full rounded-lg object-contain"
                      src={item.image}
                      alt=""
                      loading="lazy"
                    />
                  )}
                  <h2 className="break-words font-bold">
                    {item.title ?? "Unavailable product"}
                  </h2>
                  {item.price && <p>{productPrice(item)}</p>}
                  {item.available && item.listingPath ? (
                    <Link
                      href={`/listing/${encodeURIComponent(item.listingPath)}`}
                      className="block text-sm underline"
                    >
                      View product
                    </Link>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Currently unavailable
                    </p>
                  )}
                  {editor && (
                    <button
                      className={collectionButton}
                      disabled={busy}
                      onClick={() => void change(`/items/${item.id}`, "DELETE")}
                    >
                      Remove product
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </>
  );
}

export function CollectionDetailPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const { userId } = useAuth();
  return (
    <CollectionDetailView key={`${slug}:${userId ?? "guest"}`} slug={slug} />
  );
}

const inviteKey = "bazunk-collection-invite";

export function CollectionJoinPage() {
  const { isSignedIn } = useAuth();
  const request = useCollectionRequest();
  const [, navigate] = useLocation();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useSeoMetadata({
    title: "Wishlist invitation | Bazunk",
    description: "Join a shared wishlist on Bazunk.",
    url: `${origin}/collections/join`,
    robots: "noindex, nofollow",
  });

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (/^[a-f0-9]{64}$/.test(hash)) {
      setToken(hash);
      sessionStorage.setItem(inviteKey, hash);
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
    } else {
      setToken(sessionStorage.getItem(inviteKey) ?? "");
    }
  }, []);

  async function join() {
    setBusy(true);
    setError("");
    try {
      const { slug } = await request<{ slug: string }>("/join", {
        method: "POST",
        body: { token },
      });
      sessionStorage.removeItem(inviteKey);
      navigate(collectionPath(slug), { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Navbar />
      <main className={layout}>
        <h1 className="text-3xl font-black">Wishlist invitation</h1>
        {!token ? (
          <p>Open a wishlist invitation link to join.</p>
        ) : isSignedIn ? (
          <button
            className={collectionButton}
            disabled={busy}
            onClick={() => void join()}
          >
            {busy ? "Joining…" : "Accept invitation"}
          </button>
        ) : (
          <Link className={collectionButton} href={signIn("/collections/join")}>
            Sign in to accept
          </Link>
        )}
        {error && (
          <p role="alert" className="text-red-600">
            {error}{" "}
            <Link className="underline" href="/social">
              Social profile
            </Link>
          </p>
        )}
      </main>
    </>
  );
}
