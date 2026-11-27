import { randomUUID } from "node:crypto";
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { categoryVisibility } from "../lib/listingVisibility.js";
import {
  productIds,
  socialActivityId,
  socialProduct,
  socialText,
  socialUnblocked,
} from "../lib/socialCatalog.js";
import { profileOwner } from "./social.js";

const router = Router();
const polls = Router();
router.use("/social/polls", polls);
const author = sql`p.author_id`;

function visiblePoll(viewer: string) {
  return sql`FROM social_polls p JOIN users owner ON owner.id = p.author_id
    JOIN social_profiles profile ON profile.user_id = p.author_id
    WHERE NOT owner.banned AND ${socialUnblocked(viewer, author)}`;
}

async function readPolls(
  viewer: string,
  id?: string,
  mode = "latest",
  page = 0,
) {
  const visibility = await categoryVisibility();
  const recent = mode === "trending" && !id;
  const selection = id
    ? sql`AND p.id = ${id}`
    : mode === "closed"
      ? sql`AND p.expires_at <= now()`
      : sql`AND p.expires_at > now()`;
  const recentCount = recent
    ? sql`(SELECT count(*) FROM social_poll_votes trend JOIN users voter ON voter.id = trend.voter_id
    WHERE trend.poll_id = p.id AND trend.created_at > now() - interval '24 hours' AND NOT voter.banned)`
    : sql`NULL::bigint`;
  const ranking = recent ? sql`recent_count DESC,` : sql.empty();
  const { rows } = await db.execute(sql`
    WITH selected AS (
      SELECT p.id, p.question, p.author_id, p.created_at, p.expires_at, profile.username,
        ${recentCount} AS recent_count
      ${visiblePoll(viewer)} ${selection}
      ORDER BY ${ranking} p.created_at DESC, p.id
      LIMIT 21 OFFSET ${page * 20}
    )
    SELECT p.id, p.question, p.username, p.expires_at AS "expiresAt", p.expires_at <= now() AS closed,
      p.author_id = ${viewer} AS own,
      (SELECT position FROM social_poll_votes WHERE poll_id = p.id AND voter_id = ${viewer}) AS voted,
      ARRAY(SELECT json_build_object('position', o.position, 'product', ${socialProduct(visibility)}, 'votes', (
          SELECT count(*) FROM social_poll_votes v JOIN users voter ON voter.id = v.voter_id
          WHERE v.poll_id = p.id AND v.position = o.position AND NOT voter.banned))
        FROM social_poll_options o LEFT JOIN listings ON listings.id = o.listing_id
        WHERE o.poll_id = p.id ORDER BY o.position
      ) AS options
    FROM selected p
    ORDER BY ${recent ? sql`p.recent_count DESC NULLS LAST,` : sql.empty()} p.created_at DESC, p.id
  `);
  return rows;
}

polls.get("/", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const { mode = "latest", page = "0" } = req.query;
  if (
    typeof mode !== "string" ||
    !["latest", "trending", "closed"].includes(mode) ||
    typeof page !== "string" ||
    !/^\d{1,4}$/.test(page)
  )
    return void res.sendStatus(400);
  const rows = await readPolls(viewer, undefined, mode, Number(page));
  res.json({
    polls: rows.slice(0, 20),
    nextPage: rows.length > 20 ? Number(page) + 1 : null,
  });
});

polls.get("/products", async (req, res) => {
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

polls.get("/:id", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  if (!socialActivityId.test(req.params.id)) return void res.sendStatus(404);
  const rows = await readPolls(viewer, req.params.id);
  if (!rows[0])
    return void res.status(404).json({ error: "Poll unavailable." });
  res.json(rows[0]);
});

polls.post("/", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const question = socialText(req.body?.question, 180);
  const ids = productIds(req.body?.productIds, 2, 4);
  const duration = req.body?.hours;
  if (!question || !ids || ![1, 24, 72, 168].includes(duration)) {
    return void res
      .status(400)
      .json({
        error:
          "Enter a question, select two to four different products and choose a duration.",
      });
  }
  const visibility = await categoryVisibility();
  const id = randomUUID();
  const outcome = await db.transaction(async (tx) => {
    const profile = await tx.execute(
      sql`SELECT user_id FROM social_profiles WHERE user_id = ${viewer} FOR UPDATE`,
    );
    if (!profile.rows.length) return "profile";
    const active = await tx.execute<{
      count: number;
    }>(sql`SELECT count(*)::int AS count FROM social_polls
      WHERE author_id = ${viewer} AND expires_at > now()`);
    if (active.rows[0].count >= 5) return "limit";
    const products = await tx.execute(sql`SELECT listings.id FROM listings
      WHERE listings.id IN (${sql.join(
        ids.map((value) => sql`${value}`),
        sql`, `,
      )})
        AND listings.status = 'active' AND coalesce(listings.quantity, 1) > 0 AND ${visibility}
      ORDER BY listings.id FOR KEY SHARE`);
    if (products.rows.length !== ids.length) return "products";
    await tx.execute(sql`INSERT INTO social_polls (id, author_id, question, expires_at)
      VALUES (${id}, ${viewer}, ${question}, now() + ${duration} * interval '1 hour')`);
    await tx.execute(sql`INSERT INTO social_poll_options (poll_id, position, listing_id)
      VALUES ${sql.join(
        ids.map((listing, index) => sql`(${id}, ${index + 1}, ${listing})`),
        sql`, `,
      )}`);
    return "ok";
  });
  if (outcome === "profile")
    return void res
      .status(403)
      .json({ error: "Set up your social profile first." });
  if (outcome === "limit")
    return void res
      .status(409)
      .json({ error: "You can have up to five open polls." });
  if (outcome === "products")
    return void res
      .status(400)
      .json({ error: "Choose products that are currently available." });
  res.status(201).json({ id });
});

polls.post("/:id/vote", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const position = req.body?.position;
  const { id } = req.params;
  if (!socialActivityId.test(id) || ![1, 2, 3, 4].includes(position))
    return void res.sendStatus(400);
  const visibility = await categoryVisibility();
  const outcome = await db.transaction(async (tx) => {
    const {
      rows: [poll],
    } = await tx.execute<{ own: boolean }>(sql`
      SELECT p.author_id = ${viewer} AS own ${visiblePoll(viewer)}
      AND p.id = ${id} FOR SHARE OF p
    `);
    if (!poll) return "missing";
    if (poll.own) return "own";
    // Check wall-clock expiry after acquiring the poll lock. The unique key
    // makes retries idempotent and prevents a second choice across sessions.
    const { rows } = await tx.execute(sql`
      INSERT INTO social_poll_votes (poll_id, voter_id, position)
      SELECT p.id, ${viewer}, o.position FROM social_polls p
      JOIN social_poll_options o ON o.poll_id = p.id
      JOIN listings ON listings.id = o.listing_id
      WHERE p.id = ${id} AND p.expires_at > clock_timestamp() AND o.position = ${position}
        AND listings.status = 'active' AND coalesce(listings.quantity, 1) > 0 AND ${visibility}
      ON CONFLICT DO NOTHING RETURNING position
    `);
    if (rows.length) return "ok";
    const prior = await tx.execute<{ position: number }>(sql`
      SELECT position FROM social_poll_votes WHERE poll_id = ${id} AND voter_id = ${viewer}
    `);
    if (prior.rows.length)
      return prior.rows[0].position === position ? "ok" : "voted";
    return "closed";
  });
  if (outcome === "missing")
    return void res.status(404).json({ error: "Poll unavailable." });
  if (outcome === "own")
    return void res
      .status(403)
      .json({ error: "You cannot vote in your own poll." });
  if (outcome === "voted")
    return void res
      .status(409)
      .json({ error: "Your vote has already been recorded." });
  if (outcome === "closed")
    return void res
      .status(409)
      .json({ error: "This poll is closed or the option is unavailable." });
  res.sendStatus(204);
});

polls.delete("/:id", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  if (!socialActivityId.test(req.params.id)) return void res.sendStatus(404);
  const result = await db.execute(
    sql`DELETE FROM social_polls WHERE id = ${req.params.id} AND author_id = ${viewer} RETURNING id`,
  );
  res.sendStatus(result.rows.length ? 204 : 404);
});

export default router;
