import { useAuth } from "@clerk/react";
import { useCallback } from "react";

export type Role = "viewer" | "editor";
export type Occasion = "general" | "christmas" | "birthday" | "wedding";
export type CollectionSettings = {
  kind: "collection" | "wishlist";
  title: string;
  description: string;
  coverUrl: string | null;
  public: boolean;
  occasion: Occasion;
};
export type Collection = CollectionSettings & {
  slug: string;
  ownerUsername: string;
  role: "owner" | Role | null;
  following: boolean;
};
export type CollectionItem = {
  id: number;
  title?: string;
  price?: string;
  currency?: string;
  image?: string | null;
  listingPath?: string;
  available: boolean;
};
export type CollectionDetail = Collection & { items: CollectionItem[] };
export type CollectionPage = { boards: Collection[]; nextPage: number | null };

export function useCollectionRequest() {
  const { getToken, isSignedIn } = useAuth();
  return useCallback(
    async <T>(
      path = "",
      options: { method?: string; body?: object; signal?: AbortSignal } = {},
    ): Promise<T> => {
      const token = isSignedIn ? await getToken() : null;
      if (isSignedIn && !token) throw new Error("Please sign in again.");
      const response = await fetch(`/api/social/collections${path}`, {
        method: options.method ?? "GET",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: options.signal,
      });
      if (response.status === 204) return undefined as T;
      const data = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          data?.error ||
            (response.status === 404
              ? "Collection or invitation unavailable."
              : "Collections are temporarily unavailable."),
        );
      return data as T;
    },
    [getToken, isSignedIn],
  );
}

export const collectionPath = (slug: string) =>
  `/collections/${encodeURIComponent(slug)}`;
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";
