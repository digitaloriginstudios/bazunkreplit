import { useAuth } from "@clerk/react";
import { useState } from "react";
import { Link } from "wouter";
import { useFeature } from "@/components/FeatureGate";
import {
  errorText,
  useCollectionRequest,
  type Collection,
  type CollectionPage,
} from "@/lib/socialCollections";

export function AddToCollection({ listingId }: { listingId: number }) {
  const enabled = useFeature("social");
  const collections = useFeature("social_collections");
  const { isSignedIn, userId } = useAuth();
  if (!enabled || !collections || !isSignedIn) return null;
  return <CollectionPicker key={userId} listingId={listingId} />;
}

function CollectionPicker({ listingId }: { listingId: number }) {
  const request = useCollectionRequest();
  const [open, setOpen] = useState(false);
  const [boards, setBoards] = useState<Collection[]>([]);
  const [selected, setSelected] = useState("");
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load(page = 0) {
    setBusy(true);
    setMessage("");
    try {
      const data = await request<CollectionPage>(`?mode=mine&page=${page}`);
      const writable = data.boards.filter(
        (board) => board.role === "owner" || board.role === "editor",
      );
      setBoards((previous) => (page ? [...previous, ...writable] : writable));
      setSelected((previous) =>
        page ? previous || writable[0]?.slug || "" : writable[0]?.slug || "",
      );
      setNext(data.nextPage);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="rounded-lg border px-3 py-2 text-sm font-semibold"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open) void load();
        }}
      >
        Add to collection
      </button>
      {open && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
          {boards.length > 0 && (
            <>
              <select
                aria-label="Choose a collection"
                className="max-w-full rounded-lg border bg-background p-2 text-sm"
                value={selected}
                disabled={busy}
                onChange={(event) => setSelected(event.target.value)}
              >
                {boards.map((board) => (
                  <option key={board.slug} value={board.slug}>
                    {board.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                disabled={busy || !selected}
                onClick={async () => {
                  setBusy(true);
                  setMessage("");
                  try {
                    await request(`/${selected}/items/${listingId}`, {
                      method: "PUT",
                    });
                    setMessage("Product added.");
                  } catch (error) {
                    setMessage(errorText(error));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Add product
              </button>
            </>
          )}
          {next !== null && (
            <button
              type="button"
              disabled={busy}
              className="text-sm underline"
              onClick={() => void load(next)}
            >
              More collections
            </button>
          )}
          {busy && !boards.length && (
            <span role="status" className="text-sm">
              Loading…
            </span>
          )}
          {!busy && !boards.length && next === null && !message && (
            <Link href="/collections" className="text-sm underline">
              Create a collection or wishlist
            </Link>
          )}
          {message && (
            <span role="status" className="text-sm">
              {message}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
