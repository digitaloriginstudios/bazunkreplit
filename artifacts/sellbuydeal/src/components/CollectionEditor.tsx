import { useState, type FormEvent } from "react";
import { errorText, type CollectionSettings } from "@/lib/socialCollections";

const field = "w-full rounded-lg border bg-background px-3 py-2";
export const collectionButton =
  "rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50";
export const occasions = [
  ["general", "General"],
  ["christmas", "Christmas"],
  ["birthday", "Birthday"],
  ["wedding", "Wedding"],
] as const;
const blank: CollectionSettings = {
  kind: "collection",
  title: "",
  description: "",
  coverUrl: null,
  public: false,
  occasion: "general",
};

export function CollectionEditor({
  initial,
  wishlists,
  onSave,
}: {
  initial?: CollectionSettings;
  wishlists: boolean;
  onSave: (settings: CollectionSettings) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial ?? blank);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await onSave(draft);
      setMessage("Saved.");
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="rounded-2xl border bg-card p-4" onSubmit={save}>
      <fieldset disabled={busy} className="space-y-3">
        {!initial && wishlists && (
          <label className="block">
            Type
            <select
              className={field}
              value={draft.kind}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  kind: event.target.value as CollectionSettings["kind"],
                  public: false,
                })
              }
            >
              <option value="collection">Product collection</option>
              <option value="wishlist">Shared wishlist</option>
            </select>
          </label>
        )}
        <label className="block">
          Title
          <input
            className={field}
            required
            maxLength={80}
            value={draft.title}
            onChange={(event) =>
              setDraft({ ...draft, title: event.target.value })
            }
          />
        </label>
        <label className="block">
          Description
          <textarea
            className={field}
            rows={3}
            maxLength={500}
            value={draft.description}
            onChange={(event) =>
              setDraft({ ...draft, description: event.target.value })
            }
          />
        </label>
        <label className="block">
          Cover image URL
          <input
            className={field}
            type="url"
            placeholder="https://"
            maxLength={1500}
            value={draft.coverUrl ?? ""}
            onChange={(event) =>
              setDraft({ ...draft, coverUrl: event.target.value || null })
            }
          />
        </label>
        {draft.kind === "wishlist" ? (
          <label className="block">
            Occasion
            <select
              className={field}
              value={draft.occasion}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  occasion: event.target
                    .value as CollectionSettings["occasion"],
                })
              }
            >
              {occasions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.public}
              onChange={(event) =>
                setDraft({ ...draft, public: event.target.checked })
              }
            />
            Make this collection public
          </label>
        )}
        <button
          className="rounded-lg bg-[#4A5CE8] px-4 py-2 font-semibold text-white disabled:opacity-50"
          disabled={busy || !draft.title.trim()}
        >
          {busy ? "Saving…" : initial ? "Save settings" : "Create"}
        </button>
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
      </fieldset>
    </form>
  );
}
