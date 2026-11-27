import { useAuth } from "@clerk/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link, useSearch } from "wouter";
import { useFeature } from "@/components/FeatureGate";

type Post = {
  id: string;
  username: string;
  displayName: string;
  body: string;
  createdAt: string;
  liked: boolean;
  likeCount: number;
  saved: boolean;
  following: boolean;
  own: boolean;
};

type Comment = { id: string; username: string; body: string; own: boolean };
type Mode = "latest" | "following" | "saved";
const button =
  "rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50";
const textarea = "w-full rounded-lg border bg-background px-3 py-2";

function useSocialRequest() {
  const { getToken } = useAuth();
  return useCallback(
    async <T,>(
      path: string,
      method = "GET",
      body?: string,
      signal?: AbortSignal,
    ): Promise<T> => {
      const token = await getToken();
      if (!token) throw new Error("Please sign in again.");
      const response = await fetch(`/api/social/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify({ body }) : undefined,
        signal,
      });
      if (response.status === 204) return undefined as T;
      const data = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          data?.error || "Bazunk Social is temporarily unavailable.",
        );
      return data as T;
    },
    [getToken],
  );
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function SocialPost({
  post,
  hasProfile,
  onUpdate,
  onDelete,
}: {
  post: Post;
  hasProfile: boolean;
  onUpdate: (update: Partial<Post>) => void;
  onDelete: () => void;
}) {
  const request = useSocialRequest();
  const follows = useFeature("social_follows");
  const likes = useFeature("social_likes");
  const saves = useFeature("social_saves");
  const sharing = useFeature("social_sharing");
  const commenting = useFeature("social_comments");
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [shareLink, setShareLink] = useState("");
  const path = `posts/${post.id}`;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function loadComments(before?: string) {
    const page = await request<{ comments: Comment[]; next: string | null }>(
      `${path}/comments${before ? `?before=${before}` : ""}`,
    );
    setComments((previous) =>
      before ? [...(previous ?? []), ...page.comments] : page.comments,
    );
    setNext(page.next);
  }

  function addComment(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await request(`${path}/comments`, "POST", draft);
      setDraft("");
      await loadComments();
    });
  }

  return (
    <article className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
      <header>
        <p className="font-bold">
          {post.displayName}{" "}
          <span className="font-normal text-muted-foreground">
            @{post.username}
          </span>
        </p>
        <time
          className="text-xs text-muted-foreground"
          dateTime={post.createdAt}
        >
          {new Date(post.createdAt).toLocaleString()}
        </time>
      </header>
      <p className="whitespace-pre-wrap break-words">{post.body}</p>
      <div className="flex flex-wrap gap-2">
        {follows && hasProfile && !post.own && (
          <button
            className={button}
            disabled={busy}
            aria-pressed={post.following}
            onClick={() =>
              void run(async () => {
                await request(
                  `people/${encodeURIComponent(post.username)}/follow`,
                  post.following ? "DELETE" : "PUT",
                );
                onUpdate({ following: !post.following });
              })
            }
          >
            {post.following ? "Unfollow author" : "Follow author"}
          </button>
        )}
        {likes && (
          <button
            className={button}
            disabled={busy || !hasProfile}
            aria-pressed={post.liked}
            onClick={() =>
              void run(async () => {
                await request(`${path}/like`, post.liked ? "DELETE" : "PUT");
                onUpdate({
                  liked: !post.liked,
                  likeCount: Math.max(
                    0,
                    post.likeCount + (post.liked ? -1 : 1),
                  ),
                });
              })
            }
          >
            {post.liked ? "Unlike" : "Like"} · {post.likeCount}
          </button>
        )}
        {saves && hasProfile && (
          <button
            className={button}
            disabled={busy}
            aria-pressed={post.saved}
            onClick={() =>
              void run(async () => {
                await request(`${path}/save`, post.saved ? "DELETE" : "PUT");
                onUpdate({ saved: !post.saved });
              })
            }
          >
            {post.saved ? "Unsave" : "Save"}
          </button>
        )}
        {commenting && (
          <button
            className={button}
            disabled={busy}
            aria-expanded={comments !== null}
            onClick={() =>
              void run(async () => {
                if (comments) setComments(null);
                else await loadComments();
              })
            }
          >
            {comments ? "Hide comments" : "Comments"}
          </button>
        )}
        {sharing && (
          <button
            className={button}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const url = new URL("/social", window.location.origin);
                url.searchParams.set("post", post.id);
                try {
                  await navigator.clipboard.writeText(url.href);
                  setMessage("Link copied.");
                } catch {
                  setShareLink(url.href);
                }
              })
            }
          >
            Share
          </button>
        )}
        {post.own && (
          <button
            className={button}
            disabled={busy}
            onClick={() => {
              if (window.confirm("Delete this post and its comments?"))
                void run(async () => {
                  await request(path, "DELETE");
                  onDelete();
                });
            }}
          >
            Delete post
          </button>
        )}
      </div>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {sharing && shareLink && (
        <label className="block text-sm">
          Post link
          <input
            className={textarea}
            value={shareLink}
            readOnly
            onFocus={(event) => event.target.select()}
          />
        </label>
      )}
      {commenting && comments && (
        <section aria-label="Comments" className="space-y-3 border-t pt-3">
          {hasProfile && (
            <form className="space-y-2" onSubmit={addComment}>
              <textarea
                className={textarea}
                aria-label="Write a comment"
                placeholder="Write a comment"
                required
                rows={2}
                maxLength={500}
                value={draft}
                disabled={busy}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button className={button} disabled={busy || !draft.trim()}>
                Post comment
              </button>
            </form>
          )}
          {comments.length === 0 && (
            <p className="text-sm text-muted-foreground">No comments yet.</p>
          )}
          {comments.length > 0 && (
            <ul className="space-y-3">
              {comments.map((comment) => (
                <li key={comment.id} className="rounded-lg bg-muted p-3">
                  <p className="text-sm font-semibold">@{comment.username}</p>
                  <p className="whitespace-pre-wrap break-words">
                    {comment.body}
                  </p>
                  {comment.own && (
                    <button
                      className="mt-2 text-sm underline"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await request(
                            `${path}/comments/${comment.id}`,
                            "DELETE",
                          );
                          setComments(
                            (previous) =>
                              previous?.filter(
                                (item) => item.id !== comment.id,
                              ) ?? null,
                          );
                        })
                      }
                    >
                      Delete comment
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {next && (
            <button
              className={button}
              disabled={busy}
              onClick={() => void run(() => loadComments(next))}
            >
              Older comments
            </button>
          )}
        </section>
      )}
    </article>
  );
}

export function SocialFeed({
  hasProfile,
  relationshipVersion,
}: {
  hasProfile: boolean;
  relationshipVersion: number;
}) {
  const request = useSocialRequest();
  const following = useFeature("social_follows");
  const saves = useFeature("social_saves");
  const sharing = useFeature("social_sharing");
  const search = useSearch();
  const postId = new URLSearchParams(search).get("post");
  const [mode, setMode] = useState<Mode>("latest");
  const activeMode =
    (mode === "following" && !following) || (mode === "saved" && !saves)
      ? "latest"
      : mode;
  const [posts, setPosts] = useState<Post[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState("");
  const [refresh, setRefresh] = useState(0);
  const feedRequest = useRef<AbortController | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal, before?: string) => {
      if (postId) {
        if (!sharing || !/^[1-9][0-9]{0,17}$/.test(postId))
          throw new Error("Post unavailable.");
        const { post } = await request<{ post: Post }>(
          `posts/${postId}`,
          "GET",
          undefined,
          signal,
        );
        if (!signal?.aborted) setPosts([post]);
        return;
      }
      const page = await request<{ posts: Post[]; next: string | null }>(
        `feed?mode=${activeMode}${before ? `&before=${before}` : ""}`,
        "GET",
        undefined,
        signal,
      );
      if (signal?.aborted) return;
      setPosts((previous) =>
        before ? [...previous, ...page.posts] : page.posts,
      );
      setNext(page.next);
    },
    [activeMode, postId, request, sharing],
  );

  useEffect(() => {
    const controller = new AbortController();
    feedRequest.current = controller;
    setError("");
    setPosts([]);
    setNext(null);
    setLoading(true);
    load(controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorText(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [load, refresh, relationshipVersion]);

  async function publish(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await request("posts", "POST", draft);
      setDraft("");
      setMode("latest");
      setRefresh((value) => value + 1);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  const modes: { id: Mode; label: string }[] = [
    { id: "latest", label: "Latest" },
  ];
  if (following) modes.push({ id: "following", label: "Following" });
  if (saves) modes.push({ id: "saved", label: "Saved" });

  return (
    <section aria-label="Social feed" className="mb-6 space-y-4">
      {postId ? (
        <Link href="/social" className="text-sm font-semibold underline">
          Back to feed
        </Link>
      ) : (
        <>
          {hasProfile && (
            <form
              className="space-y-2 rounded-2xl border bg-card p-4"
              onSubmit={publish}
            >
              <label htmlFor="social-post-body" className="font-semibold">
                Write a post
              </label>
              <textarea
                id="social-post-body"
                className={textarea}
                required
                rows={3}
                maxLength={1000}
                value={draft}
                disabled={saving}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button
                className="rounded-lg bg-[#4A5CE8] px-4 py-2 font-semibold text-white disabled:opacity-50"
                disabled={saving || loading || !draft.trim()}
              >
                {saving ? "Publishing…" : "Publish"}
              </button>
            </form>
          )}
          <nav aria-label="Feed filters" className="flex gap-2">
            {modes.map((item) => (
              <button
                key={item.id}
                className={`${button} ${activeMode === item.id ? "bg-[#4A5CE8] text-white" : ""}`}
                disabled={loading}
                aria-pressed={activeMode === item.id}
                onClick={() => setMode(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {loading && <p role="status">Loading posts…</p>}
      {!loading && !error && posts.length === 0 && (
        <p className="text-muted-foreground">
          No {activeMode === "saved" ? "saved " : ""}posts yet.
        </p>
      )}
      {posts.map((post) => (
        <SocialPost
          key={post.id}
          post={post}
          hasProfile={hasProfile}
          onUpdate={(updated) =>
            setPosts((previous) =>
              previous.flatMap((item) => {
                if (
                  item.username === post.username &&
                  updated.following !== undefined
                ) {
                  if (activeMode === "following" && !updated.following)
                    return [];
                  return [{ ...item, following: updated.following }];
                }
                if (item.id !== post.id) return [item];
                if (activeMode === "saved" && updated.saved === false)
                  return [];
                return [{ ...item, ...updated }];
              }),
            )
          }
          onDelete={() =>
            setPosts((previous) =>
              previous.filter((item) => item.id !== post.id),
            )
          }
        />
      ))}
      {next && (
        <button
          className={button}
          disabled={loading}
          onClick={async () => {
            const signal = feedRequest.current?.signal;
            setLoading(true);
            try {
              await load(signal, next);
            } catch (error) {
              if (!signal?.aborted) setError(errorText(error));
            } finally {
              if (!signal?.aborted) setLoading(false);
            }
          }}
        >
          Older posts
        </button>
      )}
    </section>
  );
}
