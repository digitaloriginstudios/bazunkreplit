import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@clerk/react";
import { Link } from "wouter";
import { SocialPeople } from "@/components/SocialPeople";
import { Navbar } from "@/components/Navbar";
import { useFeature } from "@/components/FeatureGate";

type Profile = { username: string; displayName: string; bio: string };
const emptyProfile: Profile = { username: "", displayName: "", bio: "" };

async function profileRequest(
  token: string | null,
  profile?: Profile,
  signal?: AbortSignal,
) {
  if (!token) throw new Error("Please sign in again.");
  const response = await fetch("/api/social/profile", {
    method: profile ? "PUT" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: profile ? JSON.stringify(profile) : undefined,
    signal,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Social profile is unavailable.");
  return data.profile as Profile | null;
}

function SocialProfileForm() {
  const { getToken, userId } = useAuth();
  const [profile, setProfile] = useState(emptyProfile);
  const [hasProfile, setHasProfile] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const request = new AbortController();
    getToken()
      .then((token) => profileRequest(token, undefined, request.signal))
      .then((result) => {
        if (request.signal.aborted) return;
        setProfile(result ?? emptyProfile);
        setHasProfile(result !== null);
        setReady(true);
      })
      .catch((err) => {
        if (!request.signal.aborted) setError(err.message);
      });
    return () => request.abort();
  }, [getToken, userId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaved(false);
    setSaving(true);
    try {
      const result = await profileRequest(await getToken(), profile);
      if (result) {
        setProfile(result);
        setHasProfile(true);
      }
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save your profile.",
      );
    } finally {
      setSaving(false);
    }
  }

  const fieldClass = "w-full rounded-lg border bg-background px-3 py-2";
  return (
    <>
      <section className="rounded-2xl border bg-card p-5 sm:p-7">
        <h2 className="mb-4 text-xl font-bold">Your social profile</h2>
        {error && (
          <p className="mb-3 text-red-600" role="alert">
            {error}
          </p>
        )}
        {!ready && !error && <p role="status">Loading profile…</p>}
        {ready && (
          <form onSubmit={save} className="space-y-4">
            <fieldset disabled={saving} className="space-y-4">
              <label className="block font-medium">
                Username
                <input
                  className={fieldClass}
                  required
                  minLength={3}
                  maxLength={24}
                  pattern="[A-Za-z0-9_]{3,24}"
                  autoComplete="off"
                  aria-describedby="social-username-hint"
                  value={profile.username}
                  onChange={(e) => {
                    setSaved(false);
                    setProfile({ ...profile, username: e.target.value });
                  }}
                />
                <span
                  id="social-username-hint"
                  className="text-sm font-normal text-muted-foreground"
                >
                  3–24 letters, numbers or underscores.
                </span>
              </label>
              <label className="block font-medium">
                Display name
                <input
                  className={fieldClass}
                  required
                  maxLength={60}
                  value={profile.displayName}
                  onChange={(e) => {
                    setSaved(false);
                    setProfile({ ...profile, displayName: e.target.value });
                  }}
                />
              </label>
              <label className="block font-medium">
                Bio
                <textarea
                  className={fieldClass}
                  maxLength={280}
                  rows={3}
                  value={profile.bio}
                  onChange={(e) => {
                    setSaved(false);
                    setProfile({ ...profile, bio: e.target.value });
                  }}
                />
              </label>
              <button
                type="submit"
                className="rounded-xl bg-[#4A5CE8] px-4 py-2 font-semibold text-white disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save profile"}
              </button>
            </fieldset>
            {saved && <p role="status">Profile saved.</p>}
          </form>
        )}
      </section>
      {ready && <SocialPeople hasProfile={hasProfile} />}
    </>
  );
}

export function SocialPage() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const profilesEnabled = useFeature("social_profiles");
  return (
    <>
      <Navbar />
      <main className="mx-auto min-h-[65vh] max-w-2xl px-4 py-10">
        <h1 className="mb-6 text-3xl font-black">Bazunk Social</h1>
        {!profilesEnabled ? (
          <p>Social profiles are currently unavailable.</p>
        ) : !isLoaded ? (
          <p role="status">Loading…</p>
        ) : isSignedIn ? (
          <SocialProfileForm key={userId} />
        ) : (
          <Link
            href="/sign-in"
            className="rounded-xl bg-[#4A5CE8] px-4 py-2 font-semibold text-white"
          >
            Sign in to set up your profile
          </Link>
        )}
      </main>
    </>
  );
}
