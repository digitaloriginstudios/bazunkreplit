import { randomUUID } from "node:crypto";
import { getAuth } from "@clerk/express";
import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { categoryVisibility } from "../lib/listingVisibility.js";
import {
  httpsLink,
  productIds,
  socialActivityId,
  socialProduct,
  socialText,
  socialUnblocked,
} from "../lib/socialCatalog.js";
import { ensureAffiliateAccounts } from "./affiliates.js";
import { profileOwner } from "./social.js";

const router = Router();
const creators = Router();
router.use("/social/creators", creators);

async function viewerFor(req: Request, res: Response) {
  res.set("Cache-Control", "no-store");
  return req.headers.authorization ? profileOwner(req, res) : null;
}

creators.get("/me", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const { userId } = getAuth(req);
  if (!userId) return void res.sendStatus(401);
  await ensureAffiliateAccounts();
  const { rows } = await db.execute(sql`
    SELECT a.status, c.slug FROM bazunk_affiliates a LEFT JOIN social_creators c
      ON c.clerk_id = a.user_id AND c.user_id = ${viewer}
    WHERE a.user_id = ${userId}
  `);
  res.json(rows[0] ?? null);
});

creators.post("/me", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const { userId } = getAuth(req);
  if (!userId) return void res.sendStatus(401);
  await ensureAffiliateAccounts();
  const slug = randomUUID();
  const { rows } = await db.execute(sql`
    INSERT INTO social_creators (user_id, clerk_id, slug)
    SELECT p.user_id, a.user_id, ${slug}
    FROM social_profiles p JOIN bazunk_affiliates a ON a.user_id = ${userId}
    WHERE p.user_id = ${viewer} AND a.status IN ('pending', 'approved')
    ON CONFLICT (user_id) DO UPDATE SET slug = social_creators.slug
      WHERE social_creators.clerk_id = excluded.clerk_id
    RETURNING slug
  `);
  if (!rows.length)
    return void res
      .status(403)
      .json({
        error:
          "Set up a social profile and submit your affiliate application first.",
      });
  res.json(rows[0]);
});

function publicCreators(viewer: string | null) {
  return sql`FROM social_creators c
    JOIN social_profiles p ON p.user_id = c.user_id
    JOIN users owner ON owner.id = c.user_id
    JOIN bazunk_affiliates a ON a.user_id = c.clerk_id
    WHERE a.status = 'approved' AND NOT owner.banned
      AND ${viewer ? socialUnblocked(viewer, sql`c.user_id`) : sql`TRUE`}`;
}

async function readPosts(viewer: string | null, slug?: string, before = 0) {
  const visibility = await categoryVisibility();
  const result = await db.execute(sql`
    WITH listed AS (
      SELECT c.user_id, c.slug, p.username, p.display_name, a.code
      ${publicCreators(viewer)} ${slug ? sql`AND c.slug = ${slug}` : sql.empty()}
    )
    SELECT post.id, post.caption, post.image_url AS "imageUrl", post.image_alt AS "imageAlt",
      creator.slug, creator.username, creator.display_name AS "displayName", creator.code,
      post.creator_id = ${viewer} AS own,
      ARRAY(SELECT ${socialProduct(visibility)} FROM social_creator_products cp
        JOIN listings ON listings.id = cp.listing_id WHERE cp.post_id = post.id ORDER BY cp.listing_id) AS products
    FROM social_creator_posts post JOIN listed creator ON creator.user_id = post.creator_id
    ORDER BY post.created_at DESC, post.id LIMIT 21 OFFSET ${before * 20}
  `);
  return {
    posts: result.rows.slice(0, 20),
    nextPage: result.rows.length > 20 ? before + 1 : null,
  };
}

creators.get("/products", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const query = socialText(req.query.q, 80);
  if (!query || query.length < 2) return void res.json({ products: [] });
  const visibility = await categoryVisibility();
  const { rows } = await db.execute(sql`
    SELECT listings.id, listings.title FROM listings
    WHERE listings.status = 'active' AND coalesce(listings.quantity, 1) > 0 AND ${visibility}
      AND strpos(lower(listings.title), lower(${query})) > 0
    ORDER BY listings.updated_at DESC, listings.id DESC LIMIT 20
  `);
  res.json({ products: rows });
});

creators.get("/", async (req, res) => {
  const viewer = await viewerFor(req, res);
  if (res.headersSent) return;
  const page = req.query.page ?? "0";
  if (typeof page !== "string" || !/^\d{1,4}$/.test(page))
    return void res.sendStatus(400);
  await ensureAffiliateAccounts();
  res.json(await readPosts(viewer, undefined, Number(page)));
});

creators.get("/:slug", async (req, res) => {
  const viewer = await viewerFor(req, res);
  if (res.headersSent) return;
  const { slug } = req.params;
  const page = req.query.page ?? "0";
  if (
    !socialActivityId.test(slug) ||
    typeof page !== "string" ||
    !/^\d{1,4}$/.test(page)
  )
    return void res.sendStatus(404);
  await ensureAffiliateAccounts();
  const {
    rows: [creator],
  } = await db.execute(sql`
    SELECT c.slug, p.username, p.display_name AS "displayName", p.bio
    ${publicCreators(viewer)} AND c.slug = ${slug}
  `);
  if (!creator)
    return void res
      .status(404)
      .json({ error: "Creator storefront unavailable." });
  res.json({ creator, ...(await readPosts(viewer, slug, Number(page))) });
});

creators.post("/posts", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const { userId } = getAuth(req);
  const caption = socialText(req.body?.caption, 1000);
  const image = httpsLink(req.body?.imageUrl);
  const alt = socialText(req.body?.imageAlt, 160);
  const ids = productIds(req.body?.productIds, 1, 8);
  if (!caption || !image || !alt || !ids || req.body?.disclosed !== true) {
    return void res
      .status(400)
      .json({
        error:
          "Add an HTTPS image, image description, caption, up to eight products and a commission disclosure.",
      });
  }
  await ensureAffiliateAccounts();
  const visibility = await categoryVisibility();
  const id = randomUUID();
  const result = await db.transaction(async (tx) => {
    const account = await tx.execute(sql`
      SELECT c.user_id FROM social_creators c JOIN bazunk_affiliates a ON a.user_id = c.clerk_id
      WHERE c.user_id = ${viewer} AND c.clerk_id = ${userId} AND a.status = 'approved'
      FOR UPDATE OF c FOR SHARE OF a
    `);
    if (!account.rows.length) return "approval";
    const products = await tx.execute(sql`SELECT listings.id FROM listings
      WHERE listings.id IN (${sql.join(
        ids.map((value) => sql`${value}`),
        sql`, `,
      )})
        AND listings.status = 'active' AND ${visibility} AND coalesce(listings.quantity, 1) > 0
      ORDER BY listings.id FOR KEY SHARE`);
    if (products.rows.length !== ids.length) return "products";
    await tx.execute(sql`INSERT INTO social_creator_posts(id, creator_id, caption, image_url, image_alt)
      VALUES (${id}, ${viewer}, ${caption}, ${image.href}, ${alt})`);
    await tx.execute(sql`INSERT INTO social_creator_products(post_id, listing_id)
      VALUES ${sql.join(
        ids.map((listing) => sql`(${id}, ${listing})`),
        sql`, `,
      )}`);
    return "ok";
  });
  if (result === "approval")
    return void res
      .status(403)
      .json({ error: "An approved creator account is required." });
  if (result === "products")
    return void res
      .status(400)
      .json({ error: "Choose products that are currently available." });
  res.status(201).json({ id });
});

creators.delete("/posts/:id", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const { id } = req.params;
  if (!socialActivityId.test(id)) return void res.sendStatus(404);
  const result = await db.execute(sql`DELETE FROM social_creator_posts
    WHERE id = ${id} AND creator_id = ${viewer} RETURNING id`);
  res.sendStatus(result.rows.length ? 204 : 404);
});

export default router;
