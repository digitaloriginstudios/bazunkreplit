import { useState, type FormEvent } from "react";
import { useAuth } from "@clerk/react";
import { useFeature } from "@/components/FeatureGate";

type Person = {
  username: string;
  displayName: string;
  bio: string;
  following: boolean;
  own: boolean;
};

export function SocialPeople({ hasProfile }: { hasProfile: boolean }) {
  const { getToken } = useAuth();
  const follows = useFeature("social_follows");
  const reporting = useFeature("social_reports");
  const [reportingProfile, setReportingProfile] = useState(false);
  const [reason, setReason] = useState("spam");
  const blocking = useFeature("social_blocks");
  const [query, setQuery] = useState("");
  const [person, setPerson] = useState<Person | null>(null);
  const [blocks, setBlocks] = useState<{ username: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function request(path: string, method = "GET", body?: object) {
    const token = await getToken();
    if (!token) throw new Error("Please sign in again.");
    const response = await fetch(`/api/social/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body && { "Content-Type": "application/json" }),
      },
      body: body && JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Social features are unavailable.");
    return data;
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not complete that action.",
      );
    } finally {
      setBusy(false);
    }
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPerson(null);
    setReportingProfile(false);
    void run(async () => {
      const data = await request(`people/${encodeURIComponent(query.trim())}`);
      setPerson(data.profile);
    });
  }

  const button =
    "rounded-lg border px-3 py-2 font-semibold disabled:opacity-60";
  return (
    <section className="mt-5 space-y-4 rounded-2xl border bg-card p-5 sm:p-7">
      <h2 className="text-xl font-bold">Find people</h2>
      <form className="flex flex-wrap gap-2" onSubmit={search}>
        <input
          className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2"
          aria-label="Username"
          placeholder="Username"
          required
          pattern="[A-Za-z0-9_]{3,24}"
          maxLength={24}
          value={query}
          disabled={busy}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className={button} disabled={busy}>
          Find profile
        </button>
      </form>
      {error && (
        <p className="text-red-600" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {person && (
        <article className="space-y-2 border-t pt-4">
          <h3 className="font-bold">
            {person.displayName}{" "}
            <span className="font-normal text-muted-foreground">
              @{person.username}
            </span>
          </h3>
          {person.bio && <p className="break-words">{person.bio}</p>}
          {!person.own && hasProfile && (
            <div className="flex flex-wrap gap-2">
              {follows && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await request(
                        `people/${encodeURIComponent(person.username)}/follow`,
                        person.following ? "DELETE" : "PUT",
                      );
                      setPerson({ ...person, following: !person.following });
                    })
                  }
                >
                  {person.following ? "Unfollow" : "Follow"}
                </button>
              )}
              {blocking && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await request(
                        `people/${encodeURIComponent(person.username)}/block`,
                        "PUT",
                      );
                      setPerson(null);
                      setBlocks(null);
                      setNotice(`Blocked @${person.username}.`);
                    })
                  }
                >
                  Block
                </button>
              )}
              {reporting && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => {
                    setReason("spam");
                    setReportingProfile(!reportingProfile);
                  }}
                >
                  {reportingProfile ? "Cancel report" : "Report"}
                </button>
              )}
            </div>
          )}
          {reporting && reportingProfile && !person.own && hasProfile && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await request(
                    `people/${encodeURIComponent(person.username)}/report`,
                    "POST",
                    { reason },
                  );
                  setReportingProfile(false);
                  setNotice("Report submitted.");
                });
              }}
            >
              <label className="grid gap-1">
                Report reason
                <select
                  className={button}
                  value={reason}
                  disabled={busy}
                  onChange={(event) => setReason(event.target.value)}
                >
                  <option value="spam">Spam</option>
                  <option value="harassment">Harassment</option>
                  <option value="impersonation">Impersonation</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <button className={button} disabled={busy}>
                Submit report
              </button>
            </form>
          )}
        </article>
      )}
      {blocking && hasProfile && (
        <div className="space-y-2 border-t pt-4">
          <button
            className={button}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (blocks) setBlocks(null);
                else setBlocks((await request("blocks")).blocks);
              })
            }
          >
            {blocks ? "Hide blocked accounts" : "View blocked accounts"}
          </button>
          {blocks?.length === 0 && <p>No blocked accounts.</p>}
          {blocks && blocks.length > 0 && (
            <ul className="space-y-2">
              {blocks.map(({ username }) => (
                <li
                  key={username}
                  className="flex items-center justify-between gap-2"
                >
                  <span>@{username}</span>
                  <button
                    className={button}
                    disabled={busy}
                    aria-label={`Unblock @${username}`}
                    onClick={() =>
                      void run(async () => {
                        await request(
                          `people/${encodeURIComponent(username)}/block`,
                          "DELETE",
                        );
                        setBlocks(
                          blocks.filter((block) => block.username !== username),
                        );
                        setNotice(`Unblocked @${username}.`);
                      })
                    }
                  >
                    Unblock
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
