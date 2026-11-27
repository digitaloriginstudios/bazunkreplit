import { useAuth } from "@clerk/react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useParams } from "wouter";
import { Navbar } from "@/components/Navbar";
import {
  activityButton,
  activityError,
  activityField,
  productPrice,
  useSocialActivity,
  type ProductOption,
  type SocialProduct,
} from "@/lib/socialActivity";

type Poll = {
  id: string;
  question: string;
  username: string;
  expiresAt: string;
  closed: boolean;
  own: boolean;
  voted: number | null;
  options: { position: number; product: SocialProduct | null; votes: number }[];
};
type Mode = "latest" | "trending" | "closed";

function PollComposer({ onSave }: { onSave: (id: string) => void }) {
  const request = useSocialActivity();
  const [question, setQuestion] = useState("");
  const [hours, setHours] = useState(24);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductOption[]>([]);
  const [selected, setSelected] = useState<ProductOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setResults([]);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(() => {
      void request<{ products: ProductOption[] }>(
        `polls/products?q=${encodeURIComponent(trimmed)}`,
        { signal: controller.signal },
      )
        .then((data) => {
          if (!controller.signal.aborted) setResults(data.products);
        })
        .catch((err) => {
          if (!controller.signal.aborted) setError(activityError(err));
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, request]);

  async function publish(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { id } = await request<{ id: string }>("polls", {
        method: "POST",
        body: {
          question,
          hours,
          productIds: selected.map((product) => product.id),
        },
      });
      onSave(id);
    } catch (err) {
      setError(activityError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="rounded-2xl border bg-card p-4" onSubmit={publish}>
      <fieldset disabled={busy} className="space-y-3">
        <label className="block">
          Question
          <input
            className={activityField}
            required
            maxLength={180}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
        </label>
        <label className="block">
          Voting closes after
          <select
            className={activityField}
            value={hours}
            onChange={(event) => setHours(Number(event.target.value))}
          >
            <option value={1}>1 hour</option>
            <option value={24}>24 hours</option>
            <option value={72}>3 days</option>
            <option value={168}>7 days</option>
          </select>
        </label>
        <label className="block">
          Find two to four products to compare
          <input
            className={activityField}
            type="search"
            maxLength={80}
            value={query}
            onChange={(event) => {
              setError("");
              setQuery(event.target.value);
            }}
          />
        </label>
        {searching && (
          <p className="text-sm" role="status">
            Searching…
          </p>
        )}
        {results.length > 0 && (
          <ul className="max-h-44 space-y-1 overflow-auto rounded-lg border p-2">
            {results.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  className="w-full rounded p-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                  disabled={
                    selected.length === 4 ||
                    selected.some((item) => item.id === product.id)
                  }
                  onClick={() =>
                    setSelected((previous) => [...previous, product])
                  }
                >
                  {product.title}
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected.length > 0 && (
          <ol className="list-inside list-decimal space-y-2 text-sm">
            {selected.map((product) => (
              <li key={product.id}>
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
          </ol>
        )}
        {error && (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        )}
        <button
          className={activityButton}
          disabled={busy || selected.length < 2 || !question.trim()}
        >
          {busy ? "Publishing…" : "Publish poll"}
        </button>
      </fieldset>
    </form>
  );
}

function PollCard({
  poll,
  update,
  remove,
}: {
  poll: Poll;
  update: (poll: Poll) => void;
  remove: () => void;
}) {
  const request = useSocialActivity();
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState(false);
  const [error, setError] = useState("");
  const [closed, setClosed] = useState(poll.closed);
  const expires = new Date(poll.expiresAt).getTime();
  useEffect(() => {
    setClosed(poll.closed || expires <= Date.now());
    if (poll.closed || expires <= Date.now()) return;
    const timer = window.setTimeout(
      () => setClosed(true),
      expires - Date.now() + 20,
    );
    return () => window.clearTimeout(timer);
  }, [poll.closed, expires]);
  const total = poll.options.reduce((sum, option) => sum + option.votes, 0);

  async function vote(position: number) {
    setBusy(true);
    setError("");
    try {
      await request(`polls/${poll.id}/vote`, {
        method: "POST",
        body: { position },
      });
      update(await request<Poll>(`polls/${poll.id}`));
    } catch (err) {
      setError(activityError(err));
      try {
        update(await request<Poll>(`polls/${poll.id}`));
      } catch {
        /* Preserve vote error. */
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="space-y-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="break-words text-xl font-bold">
          <Link className="hover:underline" href={`/social/polls/${poll.id}`}>
            {poll.question}
          </Link>
        </h2>
        <button
          className={activityButton}
          aria-expanded={share}
          onClick={() => setShare(!share)}
        >
          Share poll
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        @{poll.username} · {closed ? "Closed" : "Closes"}{" "}
        <time dateTime={poll.expiresAt}>
          {new Date(poll.expiresAt).toLocaleString()}
        </time>{" "}
        · {total} {total === 1 ? "vote" : "votes"}
      </p>
      {share && (
        <label className="block text-sm">
          Poll link
          <input
            className={activityField}
            value={
              new URL(`/social/polls/${poll.id}`, window.location.origin).href
            }
            readOnly
            onFocus={(event) => event.target.select()}
          />
        </label>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {poll.options.map(({ product, position, votes }) => {
          const percentage = total ? Math.round((votes / total) * 100) : 0;
          return (
            <li key={position} className="space-y-2 rounded-xl border p-3">
              {product?.image && (
                <img
                  className="aspect-[4/3] w-full rounded-lg object-contain"
                  src={product.image}
                  alt=""
                  loading="lazy"
                />
              )}
              <p className="font-semibold">
                {product?.title ?? "Unavailable product"}
              </p>
              {product && <p>{productPrice(product)}</p>}
              {product?.available && (
                <Link
                  className="block text-sm underline"
                  href={`/listing/${encodeURIComponent(product.path)}`}
                >
                  View product
                </Link>
              )}
              <div className="flex items-center gap-2 text-sm">
                <progress
                  className="h-2 flex-1"
                  value={percentage}
                  max={100}
                  aria-label={`Option ${position}: ${percentage}% of votes`}
                />
                <span>{percentage}%</span>
              </div>
              {poll.voted === position && (
                <p className="text-sm font-semibold">Your vote</p>
              )}
              {!closed &&
                !poll.own &&
                poll.voted === null &&
                product?.available && (
                  <button
                    disabled={busy}
                    className={activityButton}
                    onClick={() => void vote(position)}
                  >
                    Vote for this product
                  </button>
                )}
            </li>
          );
        })}
      </ul>
      {poll.own && (
        <button
          className={activityButton}
          disabled={busy}
          onClick={async () => {
            if (!window.confirm("Delete this poll and its votes?")) return;
            setBusy(true);
            try {
              await request(`polls/${poll.id}`, { method: "DELETE" });
              remove();
            } catch (err) {
              setError(activityError(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Delete poll
        </button>
      )}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
    </article>
  );
}

function PollContent({ id }: { id?: string }) {
  const request = useSocialActivity();
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<Mode>("latest");
  const [polls, setPolls] = useState<Poll[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(
    async (page = 0, signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        if (id) {
          const result = await request<Poll>(
            `polls/${encodeURIComponent(id)}`,
            { signal },
          );
          if (!signal?.aborted) setPolls([result]);
        } else {
          const data = await request<{
            polls: Poll[];
            nextPage: number | null;
          }>(`polls?mode=${mode}&page=${page}`, { signal });
          if (!signal?.aborted) {
            setPolls((previous) =>
              page
                ? [
                    ...previous,
                    ...data.polls.filter(
                      (poll) => !previous.some((item) => item.id === poll.id),
                    ),
                  ]
                : data.polls,
            );
            setNext(data.nextPage);
          }
        }
      } catch (err) {
        if (!signal?.aborted) setError(activityError(err));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [id, mode, request],
  );

  useEffect(() => {
    const controller = new AbortController();
    setPolls([]);
    setNext(null);
    void load(0, controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-black">Product polls</h1>
        {id ? (
          <Link className={activityButton} href="/social/polls">
            All polls
          </Link>
        ) : (
          <button
            className={activityButton}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? "Close editor" : "New poll"}
          </button>
        )}
      </div>
      {!id && (
        <>
          {open && (
            <PollComposer
              onSave={(pollId) => navigate(`/social/polls/${pollId}`)}
            />
          )}
          <nav className="flex flex-wrap gap-2" aria-label="Poll filters">
            {(["latest", "trending", "closed"] as const).map((item) => (
              <button
                key={item}
                className={activityButton}
                aria-pressed={mode === item}
                disabled={loading}
                onClick={() => setMode(item)}
              >
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </nav>
        </>
      )}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {loading && <p role="status">Loading polls…</p>}
      {!loading && !error && polls.length === 0 && (
        <p className="text-muted-foreground">No polls here yet.</p>
      )}
      {polls.map((poll) => (
        <PollCard
          key={poll.id}
          poll={poll}
          update={(updated) =>
            setPolls((items) =>
              items.map((item) => (item.id === updated.id ? updated : item)),
            )
          }
          remove={() => {
            if (id) navigate("/social/polls");
            else
              setPolls((items) => items.filter((item) => item.id !== poll.id));
          }}
        />
      ))}
      {next !== null && (
        <button
          className={activityButton}
          disabled={loading}
          onClick={() => void load(next)}
        >
          More polls
        </button>
      )}
    </>
  );
}

export function ProductPollsPage() {
  const { id } = useParams<{ id: string }>();
  const { isLoaded, isSignedIn, userId } = useAuth();
  const returnPath = id
    ? `/social/polls/${encodeURIComponent(id)}`
    : "/social/polls";
  return (
    <>
      <Navbar />
      <main className="mx-auto min-h-[65vh] max-w-3xl space-y-4 px-4 py-10">
        <Link className="text-sm font-semibold underline" href="/social">
          Bazunk Social
        </Link>
        {!isLoaded ? (
          <p role="status">Loading…</p>
        ) : isSignedIn ? (
          <PollContent id={id} key={`${userId}:${id ?? "all"}`} />
        ) : (
          <div>
            <Link
              className={activityButton}
              href={`/sign-in?redirect_url=${encodeURIComponent(returnPath)}`}
            >
              Sign in to see product polls
            </Link>
          </div>
        )}
      </main>
    </>
  );
}
