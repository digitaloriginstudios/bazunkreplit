import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const listingVideoId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const listingVideoLimit = 8 * 1024 * 1024;

let tablesReady: Promise<unknown> | undefined;
export function ensureListingVideoTables() {
  return tablesReady ??= db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(48271931)`);
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS listing_media_assets (
      id TEXT PRIMARY KEY, filename TEXT NOT NULL, mime TEXT NOT NULL, data_base64 TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS listing_video_uploads (
      seller_email TEXT PRIMARY KEY, id UUID NOT NULL, mime TEXT NOT NULL, data_base64 TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  }).catch(error => { tablesReady = undefined; throw error; });
}

export function listingVideoEmbed(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 2048) return null;
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.replace(/^www\./, "");
    const parts = url.pathname.split("/").filter(Boolean);
    if (host === "youtu.be" || ["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) {
      const id = host === "youtu.be" ? parts[0] : parts[0] === "watch" ? url.searchParams.get("v") :
        ["shorts", "embed", "live"].includes(parts[0]) ? parts[1] : null;
      return id && /^[\w-]{11}$/.test(id) ? "https://www.youtube-nocookie.com/embed/" + id : null;
    }
    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const [id, pathHash] = parts[0] === "video" ? parts.slice(1) : parts;
      if (!/^\d{1,15}$/.test(id)) return null;
      const hash = url.searchParams.get("h") ?? pathHash;
      return "https://player.vimeo.com/video/" + id + (hash && /^[a-f0-9]{6,32}$/i.test(hash) ? "?h=" + hash : "");
    }
  } catch { return null; }
  return null;
}
