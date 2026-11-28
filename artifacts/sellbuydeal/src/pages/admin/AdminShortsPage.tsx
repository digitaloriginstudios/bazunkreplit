import { useCallback, useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { useAdmin } from "@/context/AdminContext";
import { ShortPlayer, type ShortPlayback } from "@/components/ShortPlayer";
import { activityButton, activityError } from "@/lib/socialActivity";

type Pending = {
  id: string;
  caption: string;
  username: string;
  kind: "short" | "unboxing";
  createdAt: string;
  status: "review" | "published";
  verified: boolean;
  reports: string[];
};
type Action = "approve" | "reject" | "remove" | "dismiss";

export function AdminShortsPage() {
  const { authFetch } = useAdmin();
  const [videos, setVideos] = useState<Pending[]>([]);
  const [preview, setPreview] = useState<{
    id: string;
    media: ShortPlayback;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const request = useCallback(
    async <T,>(suffix = "", action?: Action): Promise<T> => {
      const response = await authFetch(
        `/api/admin/social-shorts${suffix}`,
        action
          ? {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action }),
            }
          : undefined,
      );
      if (response.status === 204) return undefined as T;
      const data = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(data?.error || "Moderation request failed.");
      return data as T;
    },
    [authFetch],
  );

  const load = useCallback(async () => {
    const data = await request<{ videos: Pending[] }>();
    setVideos(data.videos);
  }, [request]);

  useEffect(() => {
    void load().catch((err) => setError(activityError(err)));
  }, [load]);

  async function change(item: Pending, action: Action) {
    if (
      ["reject", "remove"].includes(action) &&
      !window.confirm(
        "Remove the video from Bazunk and delete its source media?",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await request(`/${item.id}`, action);
      setPreview(null);
      await load();
    } catch (err) {
      setError(activityError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminLayout>
      <section className="mx-auto max-w-4xl space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">Shorts moderation</h1>
          <button
            className={activityButton}
            onClick={() =>
              void load().catch((err) => setError(activityError(err)))
            }
          >
            Refresh queue
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        {!videos.length && !error && <p>No videos or reports in the queue.</p>}
        {videos.map((item) => (
          <article
            key={item.id}
            className="space-y-3 rounded-xl border bg-card p-4 text-card-foreground"
          >
            <p className="break-words font-semibold">{item.caption}</p>
            <p className="text-sm">
              @{item.username} ·{" "}
              {item.kind === "unboxing" ? "Unboxing" : "Short"} ·{" "}
              {new Date(item.createdAt).toLocaleString()}
            </p>
            {!item.verified && (
              <p className="text-sm">
                Purchase verification is no longer valid.
              </p>
            )}
            {item.reports.length > 0 && (
              <p className="text-sm">Reports: {item.reports.join(", ")}</p>
            )}
            {preview?.id === item.id && (
              <ShortPlayer
                key={preview.media.manifest}
                media={preview.media}
                title={`Moderation preview by ${item.username}`}
              />
            )}
            <div className="flex flex-wrap gap-2">
              <button
                className={activityButton}
                disabled={busy}
                onClick={async () => {
                  if (preview?.id === item.id) {
                    setPreview(null);
                    return;
                  }
                  setError("");
                  setBusy(true);
                  try {
                    setPreview({
                      id: item.id,
                      media: await request<ShortPlayback>(
                        `/${item.id}/playback`,
                      ),
                    });
                  } catch (err) {
                    setError(activityError(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {preview?.id === item.id ? "Close preview" : "Preview video"}
              </button>
              {item.status === "review" ? (
                <>
                  <button
                    className={activityButton}
                    disabled={busy || !item.verified || preview?.id !== item.id}
                    onClick={() => void change(item, "approve")}
                  >
                    Approve and publish
                  </button>
                  <button
                    className={activityButton}
                    disabled={busy}
                    onClick={() => void change(item, "reject")}
                  >
                    Reject
                  </button>
                </>
              ) : (
                <>
                  <button
                    className={activityButton}
                    disabled={busy}
                    onClick={() => void change(item, "remove")}
                  >
                    Remove video
                  </button>
                  <button
                    className={activityButton}
                    disabled={busy}
                    onClick={() => void change(item, "dismiss")}
                  >
                    Dismiss reports
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </section>
    </AdminLayout>
  );
}
