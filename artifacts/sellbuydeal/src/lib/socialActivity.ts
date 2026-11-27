import { useAuth } from "@clerk/react";
import { useCallback } from "react";

export type ProductOption = { id: number; title: string };
export type SocialProduct = ProductOption & {
  price: string;
  currency: string;
  image: string | null;
  path: string;
  available: boolean;
};

export const activityButton =
  "rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50";
export const activityField = "w-full rounded-lg border bg-background px-3 py-2";
export const activityError = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

export function useSocialActivity() {
  const { getToken } = useAuth();
  return useCallback(
    async <T>(
      path: string,
      options: { method?: string; body?: object; signal?: AbortSignal } = {},
    ): Promise<T> => {
      const token = await getToken();
      if (!token) throw new Error("Sign in to use Bazunk Social.");
      const response = await fetch(`/api/social/${path}`, {
        method: options.method || "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: options.signal,
      });
      if (response.status === 204) return undefined as T;
      const data = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          data?.error || "This feature is temporarily unavailable.",
        );
      return data as T;
    },
    [getToken],
  );
}

export function productPrice(product: SocialProduct) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: product.currency,
    }).format(Number(product.price));
  } catch {
    return `${product.price} ${product.currency}`;
  }
}
