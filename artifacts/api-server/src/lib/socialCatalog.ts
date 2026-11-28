import { sql, type SQL } from "drizzle-orm";
import { listingVideoId } from "./listingVideo.js";

export const socialActivityId = listingVideoId;

export function productIds(
  input: unknown,
  min: number,
  max: number,
): number[] | null {
  if (
    !Array.isArray(input) ||
    input.length < min ||
    input.length > max ||
    input.some((id) => !Number.isInteger(id) || id < 1 || id > 2147483647) ||
    new Set(input).size !== input.length
  )
    return null;
  return input;
}

export function socialText(input: unknown, limit: number) {
  if (typeof input !== "string") return null;
  const text = input.trim();
  return text.length <= limit && !text.includes("\0") ? text : null;
}

export function httpsLink(input: unknown): URL | null {
  if (typeof input !== "string" || input.length > 2048) return null;
  try {
    const url = new URL(input);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port
      ? url
      : null;
  } catch {
    return null;
  }
}

export function socialUnblocked(viewer: string, author: SQL) {
  return sql`NOT EXISTS (SELECT 1 FROM social_blocks WHERE
    (blocker_id = ${viewer} AND blocked_id = ${author}) OR
    (blocked_id = ${viewer} AND blocker_id = ${author}))`;
}

export function socialProduct(visibility: SQL) {
  return sql`CASE WHEN listings.status = 'active' AND ${visibility}
    THEN json_build_object('id', listings.id, 'title', listings.title,
      'price', listings.price::text, 'currency', listings.currency, 'image', listings.image,
      'path', coalesce(listings.public_url_token, listings.public_id, listings.id::text),
      'available', coalesce(listings.quantity, 1) > 0)
    ELSE NULL END`;
}

export function socialSponsor(
  enabled: boolean,
  kind: "short" | "story",
  id: SQL,
) {
  return enabled
    ? sql`(SELECT label FROM social_placements WHERE kind=${kind} AND content_id=${id}::text
    AND mode='sponsor' AND starts_at<=now() AND expires_at>now() AND removed_at IS NULL LIMIT 1)`
    : sql`NULL::text`;
}
