import { randomUUID } from "node:crypto";
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { categoryVisibility } from "../lib/listingVisibility.js";
import { listingVideoEmbed } from "../lib/listingVideo.js";
import {
  httpsLink,
  productIds,
  socialActivityId,
  socialProduct,
  socialText,
  socialUnblocked,
} from "../lib/socialCatalog.js";
import { profileOwner } from "./social.js";

const router = Router();
const stories = Router();
router.use("/social/stories", stories);
const author = sql`s.seller_id`;

stories.get("/", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const { seller, mine } = req.query;
  if (
    seller !== undefined &&
    (typeof seller !== "string" || seller.length > 320 || !seller.includes("@"))
  ) {
    return void res.sendStatus(400);
  }
  const owned = mine === "1";
  const visibility = await categoryVisibility();
  const sellerFilter =
    typeof seller === "string"
      ? sql`AND lower(owner.email) = ${seller.trim().toLowerCase()}`
      : sql.empty();
  const { rows } = await db.execute(sql`
    SELECT s.id, s.caption, s.media_type AS "mediaType", s.media_url AS "mediaUrl", s.promo_url AS "promoUrl",
      s.expires_at AS "expiresAt", s.expires_at <= now() AS expired, p.username, p.display_name AS "displayName",
      ARRAY(SELECT ${socialProduct(visibility)} FROM social_story_products sp
        JOIN listings ON listings.id = sp.listing_id WHERE sp.story_id = s.id ORDER BY sp.listing_id) AS products,
      CASE WHEN s.seller_id = ${viewer} THEN json_build_object(
        'views', (SELECT count(*) FROM social_story_events WHERE story_id = s.id AND kind = 'view'),
        'productClicks', (SELECT count(*) FROM social_story_events WHERE story_id = s.id AND kind = 'product'),
        'promoClicks', (SELECT count(*) FROM social_story_events WHERE story_id = s.id AND kind = 'promo')
      ) END AS analytics
    FROM social_stories s
    JOIN users owner ON owner.id = s.seller_id
    JOIN social_profiles p ON p.user_id = s.seller_id
    WHERE NOT owner.banned AND ${socialUnblocked(viewer, author)}
      AND ${owned ? sql`s.seller_id = ${viewer}` : sql`s.expires_at > now()`}
      ${sellerFilter}
    ORDER BY s.created_at DESC, s.id LIMIT 40
  `);
  res.json({ stories: rows });
});

stories.get("/products", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const visibility = await categoryVisibility();
  const { rows } = await db.execute(sql`
    SELECT listings.id, listings.title FROM listings JOIN users owner ON owner.id = ${viewer}
    WHERE lower(listings.seller_email) = lower(owner.email) AND listings.status = 'active' AND ${visibility}
    ORDER BY listings.updated_at DESC, listings.id DESC LIMIT 100
  `);
  res.json({ products: rows });
});

stories.post("/", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const caption = socialText(req.body?.caption ?? "", 240);
  const promo = req.body?.promoUrl ? httpsLink(req.body.promoUrl) : null;
  const url = httpsLink(req.body?.mediaUrl);
  const kind = req.body?.mediaType;
  const embed = kind === "video" ? listingVideoEmbed(req.body?.mediaUrl) : null;
  const ids = productIds(req.body?.productIds ?? [], 0, 4);
  if (
    caption === null ||
    !url ||
    !ids ||
    !["image", "video"].includes(kind) ||
    (req.body?.promoUrl && !promo) ||
    (kind === "video" && !embed && !/\.(mp4|webm)$/i.test(url.pathname))
  ) {
    return void res
      .status(400)
      .json({
        error:
          "Use an HTTPS image, MP4, WebM, YouTube or Vimeo link and up to four of your products.",
      });
  }
  const visibility = await categoryVisibility();
  const id = randomUUID();
  const result = await db.transaction(async (tx) => {
    const account = await tx.execute(
      sql`SELECT user_id FROM social_profiles WHERE user_id = ${viewer} FOR UPDATE`,
    );
    if (!account.rows.length) return "profile";
    const products = await tx.execute(sql`
      SELECT listings.id FROM listings JOIN users owner ON owner.id = ${viewer}
      WHERE lower(listings.seller_email) = lower(owner.email) AND listings.status = 'active' AND ${visibility}
        ${
          ids.length
            ? sql`AND listings.id IN (${sql.join(
                ids.map((value) => sql`${value}`),
                sql`, `,
              )})`
            : sql.empty()
        }
      LIMIT ${Math.max(1, ids.length)} FOR KEY SHARE OF listings
    `);
    if (!products.rows.length || products.rows.length < ids.length)
      return "products";
    const active = await tx.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM social_stories WHERE seller_id = ${viewer} AND expires_at > now()
    `);
    if (active.rows[0].count >= 5) return "limit";
    await tx.execute(sql`INSERT INTO social_stories (id, seller_id, caption, media_type, media_url, promo_url)
      VALUES (${id}, ${viewer}, ${caption}, ${embed ? "embed" : kind}, ${embed ?? url.href}, ${promo?.href ?? null})`);
    if (ids.length)
      await tx.execute(sql`INSERT INTO social_story_products (story_id, listing_id)
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
  if (result === "products")
    return void res
      .status(403)
      .json({
        error:
          "Stories require an active seller listing. Tags must be your active products.",
      });
  if (result === "limit")
    return void res
      .status(409)
      .json({ error: "You can have up to five active stories." });
  res.status(201).json({ id });
});

stories.delete("/:id", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  if (!socialActivityId.test(req.params.id)) return void res.sendStatus(404);
  const result = await db.execute(
    sql`DELETE FROM social_stories WHERE id = ${req.params.id} AND seller_id = ${viewer} RETURNING id`,
  );
  res.sendStatus(result.rows.length ? 204 : 404);
});

stories.post("/:id/events", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const kind = req.body?.kind;
  const target =
    kind === "product" ? productIds([req.body?.listingId], 1, 1)?.[0] : 0;
  if (
    !socialActivityId.test(req.params.id) ||
    !["view", "product", "promo"].includes(kind) ||
    target === undefined
  ) {
    return void res.sendStatus(400);
  }
  const visibility =
    kind === "product" ? await categoryVisibility() : sql`TRUE`;
  const targetPresent =
    kind === "product"
      ? sql`AND EXISTS (SELECT 1 FROM social_story_products sp JOIN listings ON listings.id = sp.listing_id
      WHERE sp.story_id = s.id AND sp.listing_id = ${target} AND listings.status = 'active' AND ${visibility})`
      : kind === "promo"
        ? sql`AND s.promo_url IS NOT NULL`
        : sql.empty();
  await db.execute(sql`INSERT INTO social_story_events (story_id, viewer_id, kind, target)
    SELECT s.id, ${viewer}, ${kind}, ${target} FROM social_stories s JOIN users owner ON owner.id = s.seller_id
    WHERE s.id = ${req.params.id} AND s.seller_id <> ${viewer} AND s.expires_at > now()
      AND NOT owner.banned AND ${socialUnblocked(viewer, author)} ${targetPresent}
    ON CONFLICT DO NOTHING`);
  res.sendStatus(204);
});

export default router;
