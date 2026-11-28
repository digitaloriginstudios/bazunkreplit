import { Router } from "express";
import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { ensureAffiliateAccounts } from "./affiliates.js";
import { featureEnabled } from "../lib/featureFlags.js";
import {
  categoryVisibility,
  listingRegionFilter,
} from "../lib/listingVisibility.js";
import { socialText, socialUnblocked } from "../lib/socialCatalog.js";
import { profileOwner } from "./social.js";
import { verifiedShort } from "./shorts.js";
import { socialMonetisationRouter } from "./socialMonetisation.js";

const router = Router();
const discover = Router();
router.use("/social/discover", discover);
router.use(socialMonetisationRouter);
const categoryPattern = /^[a-z0-9][a-z0-9-]{0,79}$/;

discover.put("/preferences", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const category = req.body?.category;
  if (
    category !== null &&
    (typeof category !== "string" || !categoryPattern.test(category))
  )
    return void res.sendStatus(400);
  await db.execute(sql`INSERT INTO social_discovery_preferences(user_id, category) VALUES (${viewer}, ${category})
    ON CONFLICT(user_id) DO UPDATE SET category = excluded.category`);
  res.sendStatus(204);
});

discover.get("/", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const { mode = "for-you", region = "all", category, page = "0" } = req.query;
  if (
    typeof mode !== "string" ||
    !["for-you", "following", "trending", "mine"].includes(mode) ||
    typeof region !== "string" ||
    !["all", "uk", "us"].includes(region) ||
    (category !== undefined &&
      (typeof category !== "string" || !categoryPattern.test(category))) ||
    typeof page !== "string" ||
    !/^\d{1,3}$/.test(page)
  )
    return void res.sendStatus(400);

  const [
    posts,
    shorts,
    stories,
    creators,
    follows,
    placements,
    shares,
    likes,
    comments,
    saves,
  ] = await Promise.all(
    [
      "social_feed",
      "social_shorts",
      "social_stories",
      "social_creators",
      "social_follows",
      "social_placements",
      "social_sharing",
      "social_likes",
      "social_comments",
      "social_saves",
    ].map(featureEnabled),
  );
  if (mode === "following" && !follows)
    return void res
      .status(503)
      .json({ error: "Following is temporarily unavailable." });
  if (creators) await ensureAffiliateAccounts();

  const visibleListing = await categoryVisibility();
  const regional = listingRegionFilter(region) ?? sql`TRUE`;
  const {
    rows: [preference],
  } = await db.execute<{ category: string | null }>(
    sql`SELECT category FROM social_discovery_preferences WHERE user_id = ${viewer}`,
  );
  const preferred = preference?.category ?? null;
  const catalog = (
    table: string,
    foreign: string,
    id: SQL,
    match: boolean,
  ) => sql`
    SELECT 1 FROM ${sql.identifier(table)} tag JOIN listings ON listings.id = tag.listing_id
    WHERE tag.${sql.identifier(foreign)} = ${id} AND listings.status = 'active'
      AND coalesce(listings.quantity, 1) > 0 AND ${visibleListing} AND ${regional}
      ${match ? sql`AND listings.category = ${category ?? preferred}` : sql.empty()}
  `;
  const paths = (
    label: "short" | "story" | "creator",
    table: string,
    foreign: string,
    id: SQL,
  ) => sql`
    EXISTS (${catalog(table, foreign, id, false)}) AS regional,
    EXISTS (${catalog(table, foreign, id, true)}) AS category_match,
    ${label}::text AS kind
  `;
  const audience = (author: SQL) => sql`
    AND EXISTS (SELECT 1 FROM users account WHERE account.id=${author} AND NOT account.banned)
    AND ${socialUnblocked(viewer, author)}
    ${
      mode === "mine"
        ? sql`AND ${author}=${viewer}`
        : mode === "following"
          ? sql`AND EXISTS(SELECT 1 FROM social_follows WHERE follower_id=${viewer} AND followed_id=${author})`
          : sql.empty()
    }
  `;
  const scope = (table: string, foreign: string, id: SQL) =>
    region === "all" && !category
      ? sql.empty()
      : sql`AND EXISTS(${catalog(table, foreign, id, Boolean(category))})`;
  const priority = (kind: string, id: SQL) =>
    placements && mode === "for-you"
      ? sql`EXISTS(SELECT 1 FROM social_placements placement
      WHERE placement.kind=${kind} AND placement.content_id=${id}::text AND removed_at IS NULL
        AND starts_at<=now() AND expires_at>now()) DESC,`
      : sql.empty();
  const sources: SQL[] = [];
  if (posts && region === "all" && !category)
    sources.push(sql`(
    SELECT p.id::text AS id, p.author_id, p.body AS caption, p.created_at AS activity_at,
      NULL::text AS image, NULL::text AS slug, true AS regional, false AS category_match, 'post'::text AS kind, p.created_at > now()-interval '29 days' AS boostable,
      ${likes ? sql`(SELECT count(*) FROM social_post_likes l WHERE l.post_id = p.id)` : sql`0`} +
      ${comments ? sql`(SELECT count(*) FROM social_post_comments c WHERE c.post_id = p.id AND c.created_at > now()-interval '7 days')` : sql`0`} AS engagement
    FROM social_posts p WHERE p.created_at > now()-interval '30 days' ${audience(sql`p.author_id`)}
    ORDER BY ${priority("post", sql`p.id`)} p.created_at DESC LIMIT 200
  )`);
  if (shorts)
    sources.push(sql`(
    SELECT s.id::text, s.author_id, s.caption, s.published_at, NULL::text, NULL::text,
      ${paths("short", "social_short_products", "short_id", sql`s.id`)}, s.kind='short' AND s.published_at > now()-interval '29 days',
      (SELECT count(*) FROM social_short_events e WHERE e.short_id = s.id AND e.kind IN ('play','complete','product')
        AND e.created_at > now()-interval '7 days')
    FROM social_shorts s WHERE s.status='published' AND s.published_at > now()-interval '30 days' AND ${verifiedShort} ${audience(sql`s.author_id`)} ${scope("social_short_products", "short_id", sql`s.id`)}
    ORDER BY ${priority("short", sql`s.id`)} s.published_at DESC LIMIT 200
  )`);
  if (stories)
    sources.push(sql`(
    SELECT s.id::text, s.seller_id, s.caption, s.created_at,
      CASE WHEN s.media_type='image' THEN s.media_url END, NULL::text,
      ${paths("story", "social_story_products", "story_id", sql`s.id`)}, false,
      (SELECT count(*) FROM social_story_events e WHERE e.story_id=s.id)
    FROM social_stories s WHERE s.expires_at > now() ${audience(sql`s.seller_id`)} ${scope("social_story_products", "story_id", sql`s.id`)}
    ORDER BY ${priority("story", sql`s.id`)} s.created_at DESC LIMIT 200
  )`);
  if (creators)
    sources.push(sql`(
    SELECT p.id::text, p.creator_id, p.caption, p.created_at, p.image_url, c.slug::text,
      ${paths("creator", "social_creator_products", "post_id", sql`p.id`)}, false,
      0::bigint
    FROM social_creator_posts p JOIN social_creators c ON c.user_id=p.creator_id
    JOIN bazunk_affiliates a ON a.user_id=c.clerk_id AND a.status='approved'
    WHERE p.created_at > now()-interval '30 days' ${audience(sql`p.creator_id`)} ${scope("social_creator_products", "post_id", sql`p.id`)}
    ORDER BY p.created_at DESC LIMIT 200
  )`);

  const featured =
    creators && placements
      ? (
          await db.execute(sql`
    SELECT p.display_name AS "displayName", p.username, c.slug FROM social_placements placement
    JOIN social_creators c ON c.slug::text=placement.content_id JOIN users owner ON owner.id=c.user_id
    JOIN social_profiles p ON p.user_id=c.user_id
    JOIN bazunk_affiliates a ON a.user_id=c.clerk_id AND a.status='approved'
    WHERE placement.kind='creator' AND placement.mode='feature' AND placement.removed_at IS NULL
      AND placement.starts_at <= now() AND placement.expires_at>now() AND NOT owner.banned
      AND ${socialUnblocked(viewer, sql`owner.id`)}
    ORDER BY placement.starts_at DESC LIMIT 12
  `)
        ).rows
      : [];
  if (!sources.length)
    return void res.json({
      cards: [],
      featured,
      preferred,
      nextPage: null,
      shares,
      follows,
    });

  const ranked =
    mode === "trending"
      ? sql`engagement DESC,`
      : mode === "for-you"
        ? sql`category_match DESC, following DESC, affinity DESC,`
        : sql.empty();
  const { rows } = await db.execute(sql`
    WITH candidates(id,author_id,caption,activity_at,image,slug,regional,category_match,kind,boostable,engagement) AS
      (${sql.join(sources, sql` UNION ALL `)}),
    visible AS (
      SELECT c.*, profile.username, profile.display_name AS "displayName", c.author_id=${viewer} AS own,
        ${follows ? sql`EXISTS(SELECT 1 FROM social_follows WHERE follower_id=${viewer} AND followed_id=c.author_id)` : sql`false`} AS following,
        ${
          saves
            ? sql`EXISTS(SELECT 1 FROM social_post_saves saved JOIN social_posts p ON p.id=saved.post_id
          WHERE saved.user_id=${viewer} AND p.author_id=c.author_id)`
            : sql`false`
        } AS affinity,
        ${placements ? sql`placement.mode, placement.label` : sql`NULL::text AS mode, NULL::text AS label`}
      FROM candidates c JOIN users owner ON owner.id=c.author_id JOIN social_profiles profile ON profile.user_id=c.author_id
      ${
        placements
          ? sql`LEFT JOIN LATERAL (
        SELECT mode,label FROM social_placements WHERE kind=c.kind AND content_id=c.id AND removed_at IS NULL
          AND starts_at<=now() AND expires_at>now() ORDER BY starts_at DESC LIMIT 1
      ) placement ON true`
          : sql.empty()
      }
      WHERE NOT owner.banned AND ${socialUnblocked(viewer, sql`c.author_id`)}
        ${region !== "all" ? sql`AND c.regional` : sql.empty()}
        ${category ? sql`AND c.category_match` : sql.empty()}
        ${mode === "trending" ? sql`AND c.activity_at > now()-interval '7 days'` : sql.empty()}
    ), ranked AS (
      SELECT *, row_number() OVER (ORDER BY ${ranked} activity_at DESC,id,kind) AS position,
        row_number() OVER (PARTITION BY (mode IS NOT NULL) ORDER BY ${ranked} activity_at DESC,id,kind) AS placement_position
      FROM visible WHERE ${mode === "following" ? sql`following` : mode === "mine" ? sql`own` : sql`true`}
    )
    SELECT id,kind,caption,image,slug,username,"displayName",own,mode,label,boostable
    FROM ranked
    ORDER BY CASE WHEN ${mode === "for-you"} AND mode IS NOT NULL AND placement_position <= 3
      THEN least(position, placement_position * 6 + 1) ELSE position END, position
    LIMIT 21 OFFSET ${Number(page) * 20}
  `);
  res.json({
    cards: rows.slice(0, 20),
    featured,
    preferred,
    nextPage: rows.length > 20 ? Number(page) + 1 : null,
    shares,
    follows,
  });
});

router.get("/seo/creator-sitemap.xml", async (_req, res) => {
  const [social, creators] = await Promise.all([
    featureEnabled("social"),
    featureEnabled("social_creators"),
  ]);
  let slugs: { slug: string }[] = [];
  if (social && creators) {
    await ensureAffiliateAccounts();
    ({ rows: slugs } = await db.execute<{ slug: string }>(sql`
      SELECT c.slug FROM social_creators c JOIN users u ON u.id=c.user_id
      JOIN bazunk_affiliates a ON a.user_id=c.clerk_id AND a.status='approved'
      WHERE NOT u.banned ORDER BY c.slug LIMIT 10000
    `));
  }
  const entries = slugs
    .filter(({ slug }) => /^[a-f0-9-]{36}$/.test(slug))
    .map(
      ({ slug }) =>
        `<url><loc>https://www.bazunk.com/creators/${slug}</loc></url>`,
    )
    .join("");
  res
    .type("application/xml")
    .set("Cache-Control", "no-store")
    .send(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`,
    );
});

export default router;
