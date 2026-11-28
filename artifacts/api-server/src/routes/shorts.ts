import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { recordAdminAudit } from "../lib/adminAudit.js";
import { requireAdmin } from "../middlewares/adminAuth.js";
import { categoryVisibility } from "../lib/listingVisibility.js";
import {
  productIds,
  socialActivityId,
  socialProduct,
  socialText,
  socialUnblocked,
} from "../lib/socialCatalog.js";
import {
  createShortUpload,
  deleteShortMedia,
  shortPlayback,
} from "../lib/shortStream.js";
import { profileOwner } from "./social.js";

const router = Router();
const shorts = Router();
router.use("/social/shorts", shorts);

const author = sql`s.author_id`;
const paidOrder = sql`o.status = 'delivered' AND o.delivered_at IS NOT NULL
  AND left(o.stripe_session_id, 8) = 'cs_live_' AND coalesce(o.refunded_total,0) = 0
  AND o.seller_email IS NOT NULL AND lower(o.buyer_email) <> lower(o.seller_email)`;
const verified = sql`(s.kind = 'short' OR EXISTS (
  SELECT 1 FROM orders o JOIN users buyer ON buyer.id = s.author_id
  WHERE o.id = s.order_id AND lower(o.buyer_email) = lower(buyer.email) AND ${paidOrder}
))`;

function visible(viewer: string) {
  return sql`FROM social_shorts s JOIN users owner ON owner.id = s.author_id
    WHERE s.status = 'published' AND NOT owner.banned AND ${socialUnblocked(viewer, author)} AND ${verified}`;
}

function providerUnavailable(res: Response) {
  res.status(503).json({
    error: "The video provider is temporarily unavailable. Try again shortly.",
  });
}

shorts.get("/", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const page = req.query.page ?? "0";
  const kind = req.query.kind;
  if (
    typeof page !== "string" ||
    !/^\d{1,4}$/.test(page) ||
    (kind !== undefined && kind !== "short" && kind !== "unboxing")
  )
    return void res.sendStatus(400);
  const visibility = await categoryVisibility();
  const { rows } = await db.execute(sql`
    SELECT s.id, s.caption, s.kind, p.username, p.display_name AS "displayName",
      ARRAY(SELECT ${socialProduct(visibility)} FROM social_short_products sp
        JOIN listings ON listings.id = sp.listing_id WHERE sp.short_id = s.id ORDER BY sp.listing_id) AS products
    FROM social_shorts s JOIN users owner ON owner.id = s.author_id
    JOIN social_profiles p ON p.user_id = s.author_id
    WHERE s.status = 'published' AND NOT owner.banned AND ${socialUnblocked(viewer, author)} AND ${verified}
      ${kind ? sql`AND s.kind = ${kind}` : sql.empty()}
    ORDER BY s.published_at DESC, s.id DESC LIMIT 13 OFFSET ${Number(page) * 12}
  `);
  res.json({
    videos: rows.slice(0, 12),
    nextPage: rows.length > 12 ? Number(page) + 1 : null,
  });
});

shorts.get("/orders", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const { rows } = await db.execute(sql`
    SELECT o.id, o.item_title AS title, o.delivered_at AS "deliveredAt"
    FROM orders o JOIN users buyer ON buyer.id = ${viewer}
    WHERE lower(o.buyer_email) = lower(buyer.email) AND ${paidOrder}
      AND NOT EXISTS (SELECT 1 FROM social_shorts s WHERE s.order_id = o.id AND s.status IN ('uploading','review','published'))
    ORDER BY o.delivered_at DESC LIMIT 50
  `);
  res.json({ orders: rows });
});

shorts.get("/products", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const query = socialText(req.query.q, 80);
  if (!query || query.length < 2) return void res.json({ products: [] });
  const visibility = await categoryVisibility();
  const { rows } =
    await db.execute(sql`SELECT listings.id, listings.title FROM listings
    WHERE listings.status = 'active' AND coalesce(listings.quantity, 1) > 0 AND ${visibility}
      AND strpos(lower(listings.title), lower(${query})) > 0
    ORDER BY listings.updated_at DESC, listings.id DESC LIMIT 20`);
  res.json({ products: rows });
});

shorts.get("/mine", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const { rows } = await db.execute(sql`
    SELECT s.id, s.caption, s.kind, s.status, s.failure, s.created_at AS "createdAt",
      json_build_object(
        'opens', count(e.short_id) FILTER (WHERE e.kind = 'open'),
        'plays', count(e.short_id) FILTER (WHERE e.kind = 'play'),
        'completions', count(e.short_id) FILTER (WHERE e.kind = 'complete'),
        'productClicks', count(e.short_id) FILTER (WHERE e.kind = 'product')
      ) AS analytics
    FROM social_shorts s LEFT JOIN social_short_events e ON e.short_id = s.id
    WHERE s.author_id = ${viewer} GROUP BY s.id ORDER BY s.created_at DESC LIMIT 40
  `);
  res.json({ videos: rows });
});

shorts.post("/upload", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const kind = req.body?.kind;
  const caption = socialText(req.body?.caption, 500);
  const track =
    typeof req.body?.captions === "string"
      ? req.body.captions.replace(/^\uFEFF/, "")
      : "";
  const size = req.body?.bytes;
  const order = kind === "unboxing" ? socialText(req.body?.orderId, 100) : null;
  const ids = productIds(req.body?.productIds ?? [], 0, 5);
  if (
    (kind !== "short" && kind !== "unboxing") ||
    !caption ||
    !ids ||
    (kind === "unboxing" && (!order || ids.length)) ||
    Buffer.byteLength(track) > 64_000 ||
    !/^WEBVTT(?:[ \t][^\r\n]*)?\r?\n/.test(track) ||
    !track.includes(" --> ") ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > 100_000_000
  ) {
    return void res.status(400).json({
      error:
        "Add a video up to 100 MB, a description and an English WebVTT captions file. Unboxings require an eligible order.",
    });
  }
  const visibility = ids.length ? await categoryVisibility() : sql`TRUE`;
  const id = randomUUID();
  const result = await db.transaction(async (tx) => {
    const profile = await tx.execute(
      sql`SELECT user_id FROM social_profiles WHERE user_id = ${viewer} FOR UPDATE`,
    );
    if (!profile.rows.length) return "profile";
    const {
      rows: [usage],
    } = await tx.execute<{
      count: number;
    }>(sql`SELECT count(*)::int AS count FROM social_shorts
      WHERE author_id = ${viewer} AND created_at > now() - interval '24 hours'`);
    if (usage.count >= 5) return "limit";
    if (order) {
      const result =
        await tx.execute(sql`SELECT o.id FROM orders o JOIN users buyer ON buyer.id = ${viewer}
        WHERE o.id = ${order} AND lower(o.buyer_email) = lower(buyer.email) AND ${paidOrder} FOR SHARE OF o`);
      if (!result.rows.length) return "order";
    }
    if (ids.length) {
      const products =
        await tx.execute(sql`SELECT listings.id FROM listings WHERE listings.id IN
        (${sql.join(
          ids.map((item) => sql`${item}`),
          sql`, `,
        )})
        AND listings.status = 'active' AND ${visibility} ORDER BY listings.id FOR KEY SHARE`);
      if (products.rows.length !== ids.length) return "products";
    }
    const reserved =
      await tx.execute(sql`INSERT INTO social_shorts(id, author_id, kind, order_id, caption, caption_vtt)
      VALUES (${id}, ${viewer}, ${kind}, ${order}, ${caption}, ${track}) ON CONFLICT DO NOTHING RETURNING id`);
    if (!reserved.rows.length) return "duplicate";
    if (ids.length)
      await tx.execute(sql`INSERT INTO social_short_products(short_id, listing_id)
      VALUES ${sql.join(
        ids.map((listing) => sql`(${id}, ${listing})`),
        sql`, `,
      )}`);
    return "ok";
  });
  if (result === "profile")
    return void res
      .status(403)
      .json({ error: "Set up your social profile first." });
  if (result === "limit")
    return void res
      .status(429)
      .json({ error: "You can start up to five uploads every 24 hours." });
  if (result === "order")
    return void res
      .status(403)
      .json({ error: "Choose one of your delivered, paid orders." });
  if (result === "duplicate")
    return void res
      .status(409)
      .json({ error: "An unboxing already exists for this order." });
  if (result === "products")
    return void res
      .status(400)
      .json({ error: "One or more tagged products are unavailable." });
  let uid: string | undefined;
  try {
    const upload = await createShortUpload();
    uid = upload.uid;
    await db.execute(
      sql`UPDATE social_shorts SET stream_uid = ${uid} WHERE id = ${id}`,
    );
    res.status(201).json({ id, uploadUrl: upload.uploadURL });
  } catch {
    if (uid) await deleteShortMedia(uid).catch(() => {});
    await db.execute(
      sql`DELETE FROM social_shorts WHERE id = ${id} AND stream_uid IS NULL`,
    );
    providerUnavailable(res);
  }
});

shorts.delete("/:id/upload", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const { id } = req.params;
  if (!socialActivityId.test(id)) return void res.sendStatus(404);
  const result =
    await db.execute(sql`UPDATE social_shorts SET status = 'failed', failure = 'Upload cancelled.', caption_vtt = NULL
    WHERE id = ${id} AND author_id = ${viewer} AND status = 'uploading' RETURNING id`);
  res.sendStatus(result.rows.length ? 204 : 404);
});

shorts.get("/:id/playback", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  if (!socialActivityId.test(req.params.id)) return void res.sendStatus(404);
  const {
    rows: [row],
  } = await db.execute<{ stream_uid: string; caption_vtt: string | null }>(sql`
    SELECT s.stream_uid, s.caption_vtt ${visible(viewer)} AND s.id = ${req.params.id}`);
  if (!row?.stream_uid) return void res.sendStatus(404);
  try {
    res.json({
      ...(await shortPlayback(row.stream_uid)),
      captionVtt: row.caption_vtt,
    });
  } catch {
    providerUnavailable(res);
  }
});

shorts.post("/:id/events", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const { id } = req.params;
  const kind = req.body?.kind;
  const target =
    kind === "product" ? productIds([req.body?.listingId], 1, 1)?.[0] : 0;
  if (
    !socialActivityId.test(id) ||
    !["open", "play", "complete", "product"].includes(kind) ||
    target === undefined
  ) {
    return void res.sendStatus(400);
  }
  const product =
    kind === "product"
      ? sql`AND EXISTS (
    SELECT 1 FROM social_short_products sp JOIN listings ON listings.id = sp.listing_id
    WHERE sp.short_id = s.id AND sp.listing_id = ${target} AND listings.status = 'active'
      AND coalesce(listings.quantity, 1) > 0 AND ${await categoryVisibility()})`
      : sql.empty();
  await db.execute(sql`INSERT INTO social_short_events (short_id, viewer_id, kind, target)
    SELECT s.id, ${viewer}, ${kind}, ${target} ${visible(viewer)}
    AND s.id = ${id} AND s.author_id <> ${viewer} ${product} ON CONFLICT DO NOTHING`);
  res.sendStatus(204);
});

shorts.post("/:id/report", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const { id } = req.params;
  const reason = req.body?.reason;
  if (
    !socialActivityId.test(id) ||
    !["spam", "abuse", "copyright", "unsafe", "other"].includes(reason)
  )
    return void res.sendStatus(400);
  const result =
    await db.execute(sql`INSERT INTO social_short_reports (short_id, reporter_id, reason)
    SELECT s.id, ${viewer}, ${reason} ${visible(viewer)} AND s.id = ${id} AND s.author_id <> ${viewer}
    ON CONFLICT (short_id, reporter_id) DO UPDATE SET reason = excluded.reason WHERE social_short_reports.resolved_at IS NULL
    RETURNING short_id`);
  res.sendStatus(result.rows.length ? 204 : 404);
});

const admin = Router();
router.use("/admin/social-shorts", requireAdmin, admin);

admin.get("/", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  const { rows } = await db.execute(sql`
    SELECT s.id, s.caption, s.kind, s.status, p.username, s.created_at AS "createdAt",
      ARRAY(SELECT r.reason FROM social_short_reports r WHERE r.short_id = s.id AND r.resolved_at IS NULL
        ORDER BY r.created_at LIMIT 50) AS reports,
      ${verified} AS verified
    FROM social_shorts s JOIN social_profiles p ON p.user_id = s.author_id
    WHERE s.status = 'review' OR EXISTS (SELECT 1 FROM social_short_reports r WHERE r.short_id = s.id AND r.resolved_at IS NULL)
    ORDER BY s.created_at LIMIT 80`);
  res.json({ videos: rows });
});

admin.get("/:id/playback", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!socialActivityId.test(req.params.id)) return void res.sendStatus(404);
  const {
    rows: [row],
  } = await db.execute<{ stream_uid: string; caption_vtt: string | null }>(sql`
    SELECT stream_uid, caption_vtt FROM social_shorts WHERE id = ${req.params.id} AND status IN ('review','published')`);
  if (!row?.stream_uid) return void res.sendStatus(404);
  try {
    res.json({
      ...(await shortPlayback(row.stream_uid)),
      captionVtt: row.caption_vtt,
    });
  } catch {
    providerUnavailable(res);
  }
});

admin.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const action = req.body?.action;
  if (
    !socialActivityId.test(id) ||
    !["approve", "reject", "remove", "dismiss"].includes(action)
  )
    return void res.sendStatus(400);
  const result = await db.transaction(async (tx) => {
    const lock = await tx.execute<{
      status: string;
      approved: boolean;
    }>(sql`
      SELECT s.status, s.stream_uid IS NOT NULL AND s.captions_ready AND NOT owner.banned AND ${verified} AS approved
      FROM social_shorts s JOIN users owner ON owner.id = s.author_id WHERE s.id = ${id} FOR UPDATE OF s`);
    const video = lock.rows[0];
    if (!video) return null;
    if (action === "approve" && (video.status !== "review" || !video.approved))
      return null;
    if (action === "reject" && video.status !== "review") return null;
    if (["remove", "dismiss"].includes(action) && video.status !== "published")
      return null;
    if (action !== "dismiss") {
      const status =
        action === "approve"
          ? "published"
          : action === "reject"
            ? "rejected"
            : "removed";
      await tx.execute(sql`UPDATE social_shorts SET status = ${status},
        caption_vtt = CASE WHEN ${status} = 'published' THEN caption_vtt ELSE NULL END,
        published_at = CASE WHEN ${status} = 'published' THEN now() ELSE published_at END WHERE id = ${id}`);
    }
    await tx.execute(
      sql`UPDATE social_short_reports SET resolved_at = now() WHERE short_id = ${id} AND resolved_at IS NULL`,
    );
    return true;
  });
  if (!result)
    return void res
      .status(409)
      .json({ error: "That moderation action is unavailable." });
  await recordAdminAudit({
    req,
    category: "content",
    action: `social_shorts.${action}`,
    targetType: "social_short",
    targetId: id,
    summary: `Short moderation: ${action}`,
  });
  res.sendStatus(204);
});

export default router;
