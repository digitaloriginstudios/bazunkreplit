import { useAuth } from "@clerk/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Navbar } from "@/components/Navbar";
import { useFeature } from "@/components/FeatureGate";
import { useMarketplaceRegion } from "@/hooks/useMarketplaceRegion";
import { useSeoMetadata } from "@/hooks/useSeoMetadata";
import { CATEGORIES } from "@/data/categories";
import {
  activityButton,
  activityError,
  activityField,
  useSocialActivity,
} from "@/lib/socialActivity";

type Mode = "for-you" | "following" | "trending" | "mine";
type Card = {
  id: string;
  kind: "post" | "short" | "story" | "creator";
  caption: string;
  image: string | null;
  slug: string | null;
  displayName: string;
  username: string;
  own: boolean;
  boostable: boolean;
  mode: "boost" | "sponsor" | null;
  label: string | null;
};
type Discovery = {
  cards: Card[];
  featured: { slug: string; displayName: string }[];
  preferred: string | null;
  nextPage: number | null;
  shares: boolean;
};
type Challenge = {
  id: string;
  title: string;
  description: string;
  reward: number;
  expiresAt: string;
  claimed: boolean;
  remaining: number;
  entries: { id: string; caption: string }[];
};
const modes = [
  ["for-you", "For You"],
  ["following", "Following"],
  ["trending", "Trending"],
  ["mine", "My content"],
] as const;
const labels = {
  post: "Post",
  short: "Short",
  story: "Story",
  creator: "Shop My Style",
};

function cardLink(card: Card, shares: boolean) {
  if (card.kind === "post") return shares ? `/social?post=${card.id}` : null;
  if (card.kind === "short") return `/social/shorts?video=${card.id}`;
  if (card.kind === "story") return `/social?story=${card.id}`;
  return card.slug ? `/creators/${card.slug}` : null;
}

function Boost({
  card,
  cost,
  onSaved,
}: {
  card: Card;
  cost: number;
  onSaved: () => void;
}) {
  const request = useSocialActivity();
  const key = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        className={activityButton}
        disabled={busy}
        onClick={async () => {
          if (
            !window.confirm(
              `Spend ${cost} Bazunk Credits to boost this ${card.kind} for 24 hours?`,
            )
          )
            return;
          key.current ??= crypto.randomUUID();
          setBusy(true);
          setError("");
          try {
            await request("discover/boost", {
              method: "POST",
              body: {
                kind: card.kind,
                id: card.id,
                credits: cost,
                requestId: key.current,
              },
            });
            onSaved();
          } catch (err) {
            setError(activityError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        Boost for {cost} credits
      </button>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function ChallengeCard({
  item,
  refresh,
}: {
  item: Challenge;
  refresh: () => void;
}) {
  const request = useSocialActivity();
  const [short, setShort] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <article className="space-y-2 rounded-xl border bg-card p-4">
      <h3 className="font-semibold">{item.title}</h3>
      <p className="whitespace-pre-wrap break-words text-sm">
        {item.description}
      </p>
      <p className="text-sm text-muted-foreground">
        {item.reward} credits · {item.remaining} claims left · Ends{" "}
        {new Date(item.expiresAt).toLocaleString()}
      </p>
      {item.claimed ? (
        <p role="status">Reward claimed.</p>
      ) : item.remaining === 0 ? (
        <p>All rewards claimed.</p>
      ) : item.entries.length === 0 ? (
        <p className="text-sm">
          Publish an approved Short during this challenge to become eligible.{" "}
          <Link className="underline" href="/social/shorts">
            Open Shorts
          </Link>
        </p>
      ) : (
        <form
          className="space-y-2"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              await request(`discover/challenges/${item.id}/claim`, {
                method: "POST",
                body: { shortId: short },
              });
              refresh();
            } catch (err) {
              setError(activityError(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="block text-sm">
            Eligible Short
            <select
              className={activityField}
              value={short}
              onChange={(e) => setShort(e.target.value)}
              required
            >
              <option value="">Choose a Short</option>
              {item.entries.map((entry) => (
                <option value={entry.id} key={entry.id}>
                  {entry.caption}
                </option>
              ))}
            </select>
          </label>
          <button className={activityButton} disabled={busy || !short}>
            Claim reward
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </article>
  );
}

function DiscoveryContent() {
  const request = useSocialActivity();
  const following = useFeature("social_follows");
  const placements = useFeature("social_placements");
  const challengeOn = useFeature("social_challenges");
  const credits = useFeature("credits");
  const [market] = useMarketplaceRegion();
  const [mode, setMode] = useState<Mode>("for-you");
  const [region, setRegion] = useState("all");
  const [category, setCategory] = useState("");
  const [data, setData] = useState<Discovery | null>(null);
  const [costs, setCosts] = useState<{ post: number; short: number } | null>(
    null,
  );
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [showChallenges, setShowChallenges] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [challengeError, setChallengeError] = useState("");
  const [notice, setNotice] = useState("");
  const activeMode = mode === "following" && !following ? "for-you" : mode;
  const refresh = () => setRevision((value) => value + 1);
  const load = useCallback(
    async (page = 0, signal?: AbortSignal) => {
      setBusy(true);
      setError("");
      try {
        const query = new URLSearchParams({
          mode: activeMode,
          region,
          page: String(page),
        });
        if (category) query.set("category", category);
        const result = await request<Discovery>(`discover?${query}`, {
          signal,
        });
        if (!signal?.aborted)
          setData((previous) =>
            page && previous
              ? {
                  ...result,
                  cards: [
                    ...previous.cards,
                    ...result.cards.filter(
                      (card) =>
                        !previous.cards.some(
                          (item) =>
                            item.id === card.id && item.kind === card.kind,
                        ),
                    ),
                  ],
                }
              : result,
          );
      } catch (err) {
        if (!signal?.aborted) setError(activityError(err));
      } finally {
        if (!signal?.aborted) setBusy(false);
      }
    },
    [activeMode, region, category, request],
  );
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    void load(0, controller.signal);
    return () => controller.abort();
  }, [load, revision]);
  useEffect(() => {
    const controller = new AbortController();
    if (placements && credits)
      void request<{ post: number; short: number }>("discover/prices", {
        signal: controller.signal,
      })
        .then((result) => {
          if (!controller.signal.aborted) setCosts(result);
        })
        .catch(() => {
          if (!controller.signal.aborted) setCosts(null);
        });
    return () => controller.abort();
  }, [placements, credits, request, revision]);
  useEffect(() => {
    if (!showChallenges || !challengeOn || !credits) return;
    const controller = new AbortController();
    setChallengeError("");
    void request<{ challenges: Challenge[] }>("discover/challenges", {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setChallenges(result.challenges);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setChallengeError(activityError(err));
      });
    return () => controller.abort();
  }, [showChallenges, challengeOn, credits, request, revision]);

  async function savePreference(value: string | null) {
    setNotice("");
    try {
      await request("discover/preferences", {
        method: "PUT",
        body: { category: value },
      });
      setNotice(value ? "Preference saved." : "Preference cleared.");
      refresh();
    } catch (err) {
      setNotice(activityError(err));
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-black">Discover</h1>
        {challengeOn && credits && (
          <button
            className={activityButton}
            aria-expanded={showChallenges}
            onClick={() => setShowChallenges(!showChallenges)}
          >
            Shopping challenges
          </button>
        )}
      </div>
      {showChallenges && challengeOn && credits && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold">Shopping challenges</h2>
          {challengeError && <p role="alert">{challengeError}</p>}
          {!challenges.length && !challengeError && (
            <p>No challenges available.</p>
          )}
          {challenges.map((item) => (
            <ChallengeCard key={item.id} item={item} refresh={refresh} />
          ))}
        </section>
      )}
      {!!data?.featured.length && (
        <section className="space-y-2">
          <h2 className="text-xl font-bold">Featured creators</h2>
          <div className="flex flex-wrap gap-2">
            {data.featured.map((item) => (
              <Link
                key={item.slug}
                className={activityButton}
                href={`/creators/${item.slug}`}
              >
                {item.displayName}
              </Link>
            ))}
          </div>
        </section>
      )}
      <nav className="flex flex-wrap gap-2" aria-label="Discovery feeds">
        {modes
          .filter(([value]) => value !== "following" || following)
          .map(([value, label]) => (
            <button
              key={value}
              className={activityButton}
              disabled={busy}
              aria-pressed={activeMode === value}
              onClick={() => setMode(value)}
            >
              {label}
            </button>
          ))}
      </nav>
      <div className="flex flex-wrap gap-2">
        <label className="min-w-40 flex-1 text-sm">
          Market
          <select
            className={activityField}
            value={region}
            disabled={busy}
            onChange={(e) => setRegion(e.target.value)}
          >
            <option value="all">All markets</option>
            <option value="uk">
              United Kingdom{market === "uk" ? " (current)" : ""}
            </option>
            <option value="us">
              United States{market === "us" ? " (current)" : ""}
            </option>
          </select>
        </label>
        <label className="min-w-40 flex-1 text-sm">
          Category
          <select
            className={activityField}
            value={category}
            disabled={busy}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {CATEGORIES.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        {category && category !== data?.preferred && (
          <button
            className={activityButton}
            onClick={() => void savePreference(category)}
          >
            Prefer this category in For You
          </button>
        )}
        {data?.preferred && (
          <button
            className={activityButton}
            onClick={() => void savePreference(null)}
          >
            Clear category preference
          </button>
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="text-red-600" role="alert">
          {error}
        </p>
      )}
      {busy && <p role="status">Loading discovery feed…</p>}
      {!busy && !error && !data?.cards.length && (
        <p>No content matches these filters.</p>
      )}
      {data?.cards.map((card) => {
        const href = cardLink(card, data.shares);
        return (
          <article
            key={`${card.kind}:${card.id}`}
            className="space-y-3 rounded-2xl border bg-card p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">
                {card.displayName}{" "}
                <span className="text-sm font-normal">@{card.username}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                {labels[card.kind]}
                {card.mode === "sponsor"
                  ? ` · Sponsored by ${card.label}`
                  : card.mode === "boost"
                    ? " · Boosted"
                    : ""}
              </p>
            </div>
            {card.image && (
              <img
                className="max-h-96 w-full rounded-lg bg-muted object-contain"
                loading="lazy"
                src={card.image}
                referrerPolicy="no-referrer"
                alt=""
              />
            )}
            {card.caption && (
              <p className="whitespace-pre-wrap break-words">{card.caption}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {href && (
                <Link className={activityButton} href={href}>
                  Open {labels[card.kind]}
                </Link>
              )}
              {placements &&
                credits &&
                costs &&
                card.own &&
                card.boostable &&
                !card.mode &&
                (card.kind === "post" || card.kind === "short") && (
                  <Boost
                    card={card}
                    cost={costs[card.kind]}
                    onSaved={() => {
                      setNotice("Boost activated.");
                      refresh();
                    }}
                  />
                )}
            </div>
          </article>
        );
      })}
      {data?.nextPage != null && (
        <button
          className={activityButton}
          disabled={busy}
          onClick={() => void load(data.nextPage!)}
        >
          Load more
        </button>
      )}
    </>
  );
}

export function SocialDiscoveryPage() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  useSeoMetadata({
    title: "Discover | Bazunk Social",
    description: "Discover product posts, creators and Shorts on Bazunk.",
    url: "https://www.bazunk.com/social/discover",
    robots: "noindex, follow",
  });
  return (
    <>
      <Navbar />
      <main className="mx-auto min-h-[65vh] max-w-3xl space-y-4 px-4 py-8">
        <Link href="/social" className="text-sm font-semibold underline">
          Bazunk Social
        </Link>
        {!isLoaded ? (
          <p role="status">Loading…</p>
        ) : isSignedIn ? (
          <DiscoveryContent key={userId} />
        ) : (
          <Link
            href="/sign-in?redirect_url=%2Fsocial%2Fdiscover"
            className={activityButton}
          >
            Sign in to discover
          </Link>
        )}
      </main>
    </>
  );
}
