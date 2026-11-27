import { useAuth } from "@clerk/react";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useFeature } from "@/components/FeatureGate";

type Seller = { own: boolean; following: boolean; hasProfile: boolean };

export function SocialSellerFollow({ email }: { email: string }) {
  const { isSignedIn, getToken, userId } = useAuth();
  const social = useFeature("social");
  const profiles = useFeature("social_profiles");
  const follows = useFeature("social_follows");
  const enabled = social && profiles && follows && isSignedIn;
  const query = `email=${encodeURIComponent(email)}`;
  const [seller, setSeller] = useState<Seller | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSeller(null);
    setError("");
    if (!enabled) return;
    const controller = new AbortController();
    void (async () => {
      const token = await getToken();
      if (!token || controller.signal.aborted) return;
      const response = await fetch(`/api/social/seller?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!response.ok) return;
      const { profile } = await response.json();
      if (!controller.signal.aborted) setSeller(profile);
    })().catch(() => {});
    return () => controller.abort();
  }, [enabled, userId, query, getToken]);

  if (!enabled || !seller || seller.own) return null;
  const button =
    "mt-3 inline-flex rounded-lg border border-[#4A5CE8] px-3 py-2 text-sm font-bold text-[#4A5CE8] disabled:opacity-50";
  if (!seller.hasProfile)
    return (
      <Link href="/social" className={button}>
        Set up a profile to follow
      </Link>
    );

  async function toggle(following: boolean) {
    setBusy(true);
    setError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("Please sign in again.");
      const response = await fetch(`/api/social/seller/follow?${query}`, {
        method: following ? "DELETE" : "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Could not update this follow.");
      }
      setSeller((current) => current && { ...current, following: !following });
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not update this follow.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className={button}
        disabled={busy}
        aria-pressed={seller.following}
        onClick={() => void toggle(seller.following)}
      >
        {seller.following ? "Unfollow seller" : "Follow seller"}
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
