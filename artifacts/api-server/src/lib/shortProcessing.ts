import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { featureEnabled } from "./featureFlags.js";
import { logger } from "./logger.js";
import {
  deleteShortMedia,
  shortEncoding,
  shortSeconds,
  uploadMinutes,
  uploadShortCaptions,
} from "./shortStream.js";

type Pending = {
  id: string;
  stream_uid: string;
  caption_vtt: string | null;
  status: string;
  created_at: Date;
};

async function processMedia(row: Pending) {
  if (row.status !== "uploading") {
    await deleteShortMedia(row.stream_uid);
    await db.execute(sql`UPDATE social_shorts SET stream_uid = NULL
      WHERE id = ${row.id} AND stream_uid = ${row.stream_uid} AND status IN ('rejected','removed','failed')`);
    return;
  }
  const media = await shortEncoding(row.stream_uid);
  const timedOut =
    Date.now() >
    new Date(row.created_at).getTime() + (uploadMinutes + 15) * 60_000;
  const portrait =
    Number(media.input?.width) > 0 &&
    Number(media.input?.height) > Number(media.input?.width);
  const valid =
    portrait &&
    Number(media.duration) > 0 &&
    Number(media.duration) <= shortSeconds &&
    media.requireSignedURLs === true &&
    Number(media.size ?? 0) <= 100_000_000;
  const failure =
    media.status?.state === "error"
      ? "The video could not be processed."
      : timedOut && media.status?.state === "pendingupload"
        ? "The upload link expired."
        : media.readyToStream && !valid
          ? "Use a vertical video up to 90 seconds and 100 MB."
          : null;
  if (failure) {
    await db.execute(sql`UPDATE social_shorts SET status = 'failed', failure = ${failure}, caption_vtt = NULL
      WHERE id = ${row.id} AND status = 'uploading'`);
  } else if (media.readyToStream && row.caption_vtt) {
    await uploadShortCaptions(row.stream_uid, row.caption_vtt);
    await db.execute(sql`UPDATE social_shorts SET status = 'review', captions_ready = true
      WHERE id = ${row.id} AND status = 'uploading'`);
  }
}

export async function processPendingShorts() {
  await db.execute(sql`UPDATE social_shorts SET status = 'failed', failure = 'Upload or processing expired.', caption_vtt = NULL
    WHERE status = 'uploading' AND created_at < now() - interval '24 hours'`);
  const { rows } = await db.execute<Pending>(sql`
    WITH selected AS (
      SELECT id FROM social_shorts WHERE status IN ('uploading','failed','rejected','removed')
        AND stream_uid IS NOT NULL AND (processing_checked_at IS NULL OR processing_checked_at < now() - interval '45 seconds')
      ORDER BY processing_checked_at NULLS FIRST, created_at LIMIT 6 FOR UPDATE SKIP LOCKED
    )
    UPDATE social_shorts s SET processing_checked_at = now() FROM selected
    WHERE s.id = selected.id RETURNING s.id, s.stream_uid, s.caption_vtt, s.status, s.created_at
  `);
  await Promise.all(
    rows.map((row) =>
      processMedia(row).catch(() => {
        logger.warn({ shortId: row.id }, "Short video processing will retry");
      }),
    ),
  );
}

export function startShortProcessing() {
  if (!process.env.CLOUDFLARE_STREAM_API_TOKEN) return;
  async function tick() {
    try {
      if (
        (await featureEnabled("social")) &&
        (await featureEnabled("social_shorts"))
      )
        await processPendingShorts();
    } catch {
      logger.warn("Short video processing is temporarily unavailable");
    } finally {
      setTimeout(() => void tick(), 15_000).unref();
    }
  }
  void tick();
}
