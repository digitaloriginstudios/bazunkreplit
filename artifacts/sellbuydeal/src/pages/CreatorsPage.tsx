import { useFeature } from "@/components/FeatureGate";
import { useSeoMetadata } from "@/hooks/useSeoMetadata";
import { useAuth } from "@clerk/react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useParams } from "wouter";
import { Navbar } from "@/components/Navbar";
import { SocialCreatorFollow } from "@/components/SocialSellerFollow";
import {
  activityButton,
  activityError,
  activityField,
  productPrice,
  type ProductOption,
  type SocialProduct,
} from "@/lib/socialActivity";

type Account = {
  status: "pending" | "approved" | "rejected" | "suspended";
  slug: string | null;
};
type Creator = {
  slug: string;
  username: string;
  displayName: string;
  bio: string;
};
type CreatorPost = {
  id: string;
  slug: string;
  username: string;
  displayName: string;
  own: boolean;
  caption: string;
  imageUrl: string;
  imageAlt: string;
  code: string;
  products: (SocialProduct | null)[];
};
type Posts = {
  creator?: Creator;
  posts: CreatorPost[];
  nextPage: number | null;
};
type Balance = {
  pending: string;
  approved: string;
  payable: string;
  available: number;
  paid: string;
};
type Sale = {
  order_id: string;
  order_status: string;
  commission_status: string | null;
  amount_minor: number | null;
  currency: string | null;
};
const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});
const pathFor = (slug: string) => `/creators/${encodeURIComponent(slug)}`;

function useCreatorRequest() {
  const { isSignedIn, getToken } = useAuth();
  return useCallback(
    async <T,>(
      path: string,
      options: { body?: object; method?: string; signal?: AbortSignal } = {},
    ): Promise<T> => {
      const token = isSignedIn ? await getToken() : null;
      if (isSignedIn && !token) throw new Error("Please sign in again.");
      const response = await fetch(`/api/${path}`, {
        method: options.method,
        signal: options.signal,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      if (response.status === 204) return undefined as T;
      const data = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(data?.error || "Creator service unavailable.");
      return data as T;
    },
    [isSignedIn, getToken],
  );
}

function CreatorComposer({ onSave }: { onSave: () => void }) {
  const request = useCreatorRequest();
  const [caption, setCaption] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const [disclosed, setDisclosed] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductOption[]>([]);
  const [selected, setSelected] = useState<ProductOption[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function findProducts() {
    setBusy(true);
    setError("");
    try {
      const result = await request<{ products: ProductOption[] }>(
        `social/creators/products?q=${encodeURIComponent(query.trim())}`,
      );
      setResults(result.products);
      if (!result.products.length) setError("No matching products.");
    } catch (err) {
      setError(activityError(err));
    } finally {
      setBusy(false);
    }
  }

  async function publish(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request("social/creators/posts", {
        method: "POST",
        body: {
          caption,
          imageUrl,
          imageAlt,
          disclosed,
          productIds: selected.map((item) => item.id),
        },
      });
      onSave();
    } catch (err) {
      setError(activityError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={publish} className="rounded-2xl border bg-card p-4">
      <fieldset disabled={busy} className="space-y-3">
        <label className="block">
          Caption
          <textarea
            className={activityField}
            required
            maxLength={1000}
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
          />
        </label>
        <label className="block">
          HTTPS image URL
          <input
            className={activityField}
            type="url"
            required
            maxLength={2048}
            value={imageUrl}
            onChange={(event) => setImageUrl(event.target.value)}
          />
        </label>
        <label className="block">
          Image description
          <input
            className={activityField}
            required
            maxLength={160}
            value={imageAlt}
            onChange={(event) => setImageAlt(event.target.value)}
          />
        </label>
        <div className="flex items-end gap-2">
          <label className="flex-1">
            Find products
            <input
              className={activityField}
              type="search"
              maxLength={80}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (query.trim().length >= 2) void findProducts();
                }
              }}
            />
          </label>
          <button
            className={activityButton}
            type="button"
            disabled={query.trim().length < 2}
            onClick={() => void findProducts()}
          >
            Search
          </button>
        </div>
        {results.length > 0 && (
          <ul className="max-h-48 space-y-1 overflow-auto rounded-lg border p-2">
            {results.map((product) => (
              <li key={product.id}>
                <button
                  className="w-full rounded p-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                  type="button"
                  disabled={
                    selected.length >= 8 ||
                    selected.some((item) => item.id === product.id)
                  }
                  onClick={() => setSelected((items) => [...items, product])}
                >
                  {product.title}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-muted-foreground">
          {selected.length} of 8 product tags
        </p>
        {selected.length > 0 && (
          <ul className="space-y-1">
            {selected.map((product) => (
              <li key={product.id} className="text-sm">
                {product.title}{" "}
                <button
                  type="button"
                  className="ml-2 underline"
                  onClick={() =>
                    setSelected((items) =>
                      items.filter((item) => item.id !== product.id),
                    )
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={disclosed}
            required
            onChange={(event) => setDisclosed(event.target.checked)}
          />
          I understand this post will display an affiliate commission
          disclosure.
        </label>
        {error && (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        )}
        <button
          className={activityButton}
          disabled={busy || !selected.length || !disclosed}
        >
          Publish shoppable post
        </button>
      </fieldset>
    </form>
  );
}

function CreatorStudio() {
  const request = useCreatorRequest();
  const [, navigate] = useLocation();
  const discovery = useFeature("social_discovery");
  const creatorRewards = useFeature("social_creator_rewards");
  const credits = useFeature("credits");
  const [rewards, setRewards] = useState<
    { id: string; credits: number; reason: string }[]
  >([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [compose, setCompose] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const account = await request<Account | null>("social/creators/me", {
        signal,
      });
      if (signal?.aborted) return;
      setAccount(account);
      if (account?.status === "approved") {
        const [summary, history] = await Promise.all([
          request<Balance | null>("affiliates/summary", { signal }),
          request<Sale[]>("affiliates/history", { signal }),
        ]);
        if (!signal?.aborted) {
          setBalance(summary);
          setSales(history);
        }
      }
    },
    [request],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal)
      .catch((err) => {
        if (!controller.signal.aborted) setError(activityError(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (
      !discovery ||
      !creatorRewards ||
      !credits ||
      account?.status !== "approved"
    )
      return;
    const controller = new AbortController();
    void request<{ awards: { id: string; credits: number; reason: string }[] }>(
      "social/discover/rewards",
      { signal: controller.signal },
    )
      .then((data) => {
        if (!controller.signal.aborted) setRewards(data.awards);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [account?.status, creatorRewards, credits, discovery, request]);

  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-black">Creator Studio</h1>
      {loading && <p role="status">Loading creator account…</p>}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {!loading && !account && (
        <div className="space-y-3 rounded-2xl border bg-card p-4">
          <p>
            Apply to the Bazunk affiliate programme to become a creator.
            Applications are reviewed by Bazunk.
          </p>
          <Link className={activityButton} href="/affiliates/apply">
            Start application
          </Link>
        </div>
      )}
      {account && (
        <div className="space-y-3 rounded-2xl border bg-card p-4">
          <p>
            <strong>Application status</strong> · {account.status}
          </p>
          {!account.slug &&
            ["pending", "approved"].includes(account.status) && (
              <button
                className={activityButton}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await request("social/creators/me", { method: "POST" });
                    await refresh();
                  } catch (err) {
                    setError(activityError(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Register storefront
              </button>
            )}
          {!account.slug && (
            <p className="text-sm">
              Registration uses your{" "}
              <Link href="/social" className="underline">
                social profile
              </Link>
              .
            </p>
          )}
          {account.status === "approved" && account.slug && (
            <div className="flex flex-wrap gap-2">
              <Link className={activityButton} href={pathFor(account.slug)}>
                View storefront
              </Link>
              <button
                className={activityButton}
                aria-expanded={compose}
                onClick={() => setCompose(!compose)}
              >
                {compose ? "Close editor" : "New shoppable post"}
              </button>
            </div>
          )}
        </div>
      )}
      {compose && account?.slug && account.status === "approved" && (
        <CreatorComposer
          onSave={() => {
            setCompose(false);
            navigate(pathFor(account.slug!));
          }}
        />
      )}
      {discovery && creatorRewards && credits && rewards.length > 0 && (
        <section className="space-y-2 rounded-2xl border bg-card p-4">
          <h2 className="text-xl font-bold">Creator credit rewards</h2>
          <ul className="divide-y">
            {rewards.map((award) => (
              <li key={award.id} className="py-2 text-sm">
                {award.credits} credits · {award.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
      {balance && (
        <section className="space-y-3 rounded-2xl border bg-card p-4">
          <h2 className="text-xl font-bold">Affiliate earnings</h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["Pending", balance.pending],
                ["Approved", balance.approved],
                ["Available", balance.available],
                ["Paid", balance.paid],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="font-bold">{gbp.format(Number(value) / 100)}</dd>
              </div>
            ))}
          </dl>
          <h3 className="font-semibold">Recent referred orders</h3>
          {!sales.length && (
            <p className="text-sm text-muted-foreground">
              No referred orders yet.
            </p>
          )}
          <ul className="divide-y">
            {sales.slice(0, 10).map((sale) => (
              <li
                className="flex flex-wrap justify-between gap-2 py-2 text-sm"
                key={sale.order_id}
              >
                <span>
                  Order {sale.order_id} · {sale.order_status}
                </span>
                <span>
                  {sale.commission_status ?? "Awaiting verification"}
                  {sale.amount_minor !== null && sale.currency === "GBP"
                    ? ` · ${gbp.format(sale.amount_minor / 100)}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
          <Link
            className="text-sm font-semibold underline"
            href="/affiliates/login"
          >
            Open Affiliate Centre
          </Link>
        </section>
      )}
    </section>
  );
}

function CreatorFeed({ slug }: { slug?: string }) {
  const request = useCreatorRequest();
  const [data, setData] = useState<Posts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(
    async (page: number, signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const result = await request<Posts>(
          `social/creators${slug ? `/${encodeURIComponent(slug)}` : ""}?page=${page}`,
          { signal },
        );
        if (!signal?.aborted)
          setData((previous) =>
            page && previous
              ? {
                  ...result,
                  posts: [
                    ...previous.posts,
                    ...result.posts.filter(
                      (item) =>
                        !previous.posts.some((post) => post.id === item.id),
                    ),
                  ],
                }
              : result,
          );
      } catch (err) {
        if (!signal?.aborted) setError(activityError(err));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [request, slug],
  );

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    void load(0, controller.signal);
    return () => controller.abort();
  }, [load]);

  useSeoMetadata(
    data?.creator
      ? {
          title: `${data.creator.displayName} | Bazunk Creators`,
          description:
            data.creator.bio ||
            `Shop recommendations from ${data.creator.displayName} on Bazunk.`,
          url: `https://www.bazunk.com${pathFor(data.creator.slug)}`,
          image: data.posts[0]?.imageUrl,
        }
      : slug
        ? {
            title: "Bazunk Creators",
            description: "Explore creator storefronts on Bazunk.",
            url: `https://www.bazunk.com${pathFor(slug)}`,
            robots: "noindex, follow",
          }
        : null,
  );

  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-black">
        {data?.creator?.displayName ??
          (slug ? "Creator storefront" : "Shop My Style")}
      </h1>
      {data?.creator && (
        <>
          <p className="text-sm font-semibold text-muted-foreground">
            @{data.creator.username} · Approved Bazunk creator
          </p>
          {data.creator.bio && (
            <p className="whitespace-pre-wrap break-words">
              {data.creator.bio}
            </p>
          )}
          <SocialCreatorFollow username={data.creator.username} />
        </>
      )}
      {loading && <p role="status">Loading shoppable posts…</p>}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {data && !data.posts.length && (
        <p className="text-muted-foreground">No shoppable posts yet.</p>
      )}
      {data?.posts.map((post) => (
        <article
          key={post.id}
          className="space-y-3 rounded-2xl border bg-card p-4"
        >
          <Link className="font-bold underline" href={pathFor(post.slug)}>
            {post.displayName}
          </Link>
          <img
            className="mx-auto max-h-[65vh] w-full rounded-xl bg-muted object-contain"
            src={post.imageUrl}
            alt={post.imageAlt}
            referrerPolicy="no-referrer"
            loading="lazy"
          />
          <p className="whitespace-pre-wrap break-words">{post.caption}</p>
          <p className="text-sm font-medium">
            Affiliate links · The creator may earn commission if you buy through
            these links.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {post.products.flatMap((product) =>
              product
                ? [
                    <li
                      key={product.id}
                      className="rounded-lg border p-2 text-sm"
                    >
                      {product.available ? (
                        <a
                          className="font-semibold underline"
                          href={`/listing/${encodeURIComponent(product.path)}?affiliate=${encodeURIComponent(post.code)}`}
                        >
                          {product.title} · {productPrice(product)}
                        </a>
                      ) : (
                        <span>{product.title} · Currently unavailable</span>
                      )}
                    </li>,
                  ]
                : [],
            )}
          </ul>
          {post.own && (
            <button
              className={activityButton}
              disabled={deleting !== null}
              onClick={async () => {
                if (!window.confirm("Delete this shoppable post?")) return;
                setDeleting(post.id);
                try {
                  await request(`social/creators/posts/${post.id}`, {
                    method: "DELETE",
                  });
                  setData(
                    (current) =>
                      current && {
                        ...current,
                        posts: current.posts.filter(
                          (item) => item.id !== post.id,
                        ),
                      },
                  );
                } catch (err) {
                  setError(activityError(err));
                } finally {
                  setDeleting(null);
                }
              }}
            >
              Delete post
            </button>
          )}
        </article>
      ))}
      {data && data.nextPage !== null && (
        <button
          className={activityButton}
          disabled={loading}
          onClick={() => void load(data.nextPage!)}
        >
          More posts
        </button>
      )}
    </section>
  );
}

export function CreatorsPage({ studio = false }: { studio?: boolean }) {
  const { slug } = useParams<{ slug: string }>();
  const { isSignedIn, isLoaded, userId } = useAuth();
  return (
    <>
      <Navbar />
      <main className="mx-auto min-h-[65vh] max-w-3xl space-y-4 px-4 py-10">
        <nav
          className="flex flex-wrap items-center gap-3"
          aria-label="Creator navigation"
        >
          <Link className="text-sm font-semibold underline" href="/social">
            Bazunk Social
          </Link>
          {studio || slug ? (
            <Link className={activityButton} href="/creators">
              Shop My Style
            </Link>
          ) : null}
          {!studio && (
            <Link className={activityButton} href="/creators/studio">
              Creator Studio
            </Link>
          )}
        </nav>
        {!studio ? (
          <CreatorFeed
            key={`${userId ?? "guest"}:${slug ?? "all"}`}
            slug={slug}
          />
        ) : !isLoaded ? (
          <p role="status">Loading…</p>
        ) : isSignedIn ? (
          <CreatorStudio key={userId} />
        ) : (
          <Link
            className={activityButton}
            href="/sign-in?redirect_url=%2Fcreators%2Fstudio"
          >
            Sign in to Creator Studio
          </Link>
        )}
      </main>
    </>
  );
}
