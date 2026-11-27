import { useEffect, useState } from "react";
import { collectionButton } from "@/components/CollectionEditor";
import {
  errorText,
  useCollectionRequest,
  type Role,
} from "@/lib/socialCollections";

type Access = {
  members: { username: string; role: Role }[];
  invites: { id: string; role: Role; expiresAt: string }[];
};
const emptyAccess: Access = { members: [], invites: [] };

export function WishlistAccess({ slug }: { slug: string }) {
  const request = useCollectionRequest();
  const [access, setAccess] = useState(emptyAccess);
  const [role, setRole] = useState<Role>("editor");
  const [inviteLink, setInviteLink] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    request<Access>(`/${slug}/access`, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setAccess(data);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorText(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [request, slug]);

  async function change(path: string, method: string, nextRole?: Role) {
    setBusy(true);
    setError("");
    try {
      const result = await request<{ token: string }>(`/${slug}/${path}`, {
        method,
        body: nextRole ? { role: nextRole } : undefined,
      });
      if (path === "invites" && method === "POST") {
        setInviteLink(
          new URL(`/collections/join#${result.token}`, window.location.origin)
            .href,
        );
      } else if (path.startsWith("invites/")) {
        setInviteLink("");
      }
      setAccess(await request<Access>(`/${slug}/access`));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4">
      <h2 className="text-lg font-bold">Wishlist access</h2>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">
          Invite as{" "}
          <select
            className="rounded-lg border bg-background p-2"
            value={role}
            disabled={busy}
            onChange={(event) => setRole(event.target.value as Role)}
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
          </select>
        </label>
        <button
          className={collectionButton}
          disabled={busy}
          onClick={() => void change("invites", "POST", role)}
        >
          Create invitation link
        </button>
      </div>
      {inviteLink && (
        <label className="block text-sm">
          Single-use link, valid for seven days
          <input
            className="mt-1 w-full rounded-lg border bg-background p-2"
            readOnly
            value={inviteLink}
            onFocus={(event) => event.target.select()}
          />
        </label>
      )}
      {access.members.length > 0 && (
        <ul className="divide-y border-t">
          {access.members.map((member) => (
            <li
              key={member.username}
              className="flex flex-wrap items-center gap-2 py-2"
            >
              <span className="mr-auto">@{member.username}</span>
              <select
                className="rounded-lg border bg-background p-2 text-sm"
                aria-label={`Role for @${member.username}`}
                value={member.role}
                disabled={busy}
                onChange={(event) =>
                  void change(
                    `members/${encodeURIComponent(member.username)}`,
                    "PUT",
                    event.target.value as Role,
                  )
                }
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </select>
              <button
                className={collectionButton}
                disabled={busy}
                onClick={() =>
                  void change(
                    `members/${encodeURIComponent(member.username)}`,
                    "DELETE",
                  )
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {access.invites.length > 0 && (
        <ul className="divide-y border-t">
          {access.invites.map((invite) => (
            <li
              key={invite.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <span>
                {invite.role === "editor" ? "Editor" : "Viewer"} link expires{" "}
                {new Date(invite.expiresAt).toLocaleString()}
              </span>
              <button
                className={collectionButton}
                disabled={busy}
                onClick={() => void change(`invites/${invite.id}`, "DELETE")}
              >
                Revoke link
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
