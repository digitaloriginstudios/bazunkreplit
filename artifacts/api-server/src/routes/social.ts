import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { authenticatedSellerEmail } from "../lib/authenticatedSeller.js";

import { featureEnabled } from "../lib/featureFlags.js";

const router = Router();

export async function profileOwner(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  const email = await authenticatedSellerEmail(req, res);
  if (!email) return null;
  const { rows } = await db.execute<{ id: string; banned: boolean }>(
    sql`SELECT id, banned FROM users WHERE LOWER(email) = ${email} ORDER BY (email = ${email}) DESC, id LIMIT 1`,
  );
  const account = rows[0];
  if (!account || account.banned) {
    res.status(403).json({ error: "An active Bazunk account is required." });
    return null;
  }
  return account.id;
}

router.get("/social/profile", async (req, res) => {
  const userId = await profileOwner(req, res);
  if (!userId) return;
  const { rows } = await db.execute(sql`
    SELECT username, display_name AS "displayName", bio
    FROM social_profiles WHERE user_id = ${userId}
  `);
  res.json({ profile: rows[0] ?? null });
});

router.put("/social/profile", async (req, res) => {
  const userId = await profileOwner(req, res);
  if (!userId) return;
  const username =
    typeof req.body?.username === "string"
      ? req.body.username.trim().toLowerCase()
      : "";
  const displayName =
    typeof req.body?.displayName === "string"
      ? req.body.displayName.trim()
      : "";
  const bio = typeof req.body?.bio === "string" ? req.body.bio.trim() : "";
  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    return void res.status(400).json({
      error: "Use 3–24 letters, numbers or underscores for your username.",
    });
  }
  if (
    !displayName ||
    displayName.length > 60 ||
    bio.length > 280 ||
    /\u0000/.test(displayName + bio)
  ) {
    return void res.status(400).json({
      error:
        "Enter a display name of up to 60 characters and a bio of up to 280 characters.",
    });
  }

  try {
    const { rows } = await db.execute(sql`
      INSERT INTO social_profiles (user_id, username, display_name, bio)
      VALUES (${userId}, ${username}, ${displayName}, ${bio})
      ON CONFLICT (user_id) DO UPDATE SET
        username = excluded.username, display_name = excluded.display_name, bio = excluded.bio
      RETURNING username, display_name AS "displayName", bio
    `);
    res.json({ profile: rows[0] });
  } catch (error) {
    const cause = error instanceof Error ? (error.cause ?? error) : error;
    if (
      typeof cause === "object" &&
      cause &&
      "code" in cause &&
      cause.code === "23505"
    ) {
      return void res
        .status(409)
        .json({ error: "That username is already taken." });
    }
    throw error;
  }
});

function sellerAccount(email: string) {
  const normalized = email.trim().toLowerCase();
  return sql`SELECT id FROM users WHERE LOWER(email) = ${normalized}
    AND EXISTS (SELECT 1 FROM listings
      WHERE LOWER(seller_email) = ${normalized} AND status = 'active')
    ORDER BY (email = ${normalized}) DESC, id LIMIT 1`;
}

router.get(["/social/people/:username", "/social/seller"], async (req, res) => {
  const viewerId = await profileOwner(req, res);
  if (!viewerId) return;
  const { email } = req.query;
  const username = req.params.username;
  if (
    !username &&
    (typeof email !== "string" || email.length > 320 || !email.includes("@"))
  ) {
    return void res.status(400).json({ error: "Invalid seller." });
  }
  const target = username
    ? sql`p.username = ${String(username).toLowerCase()}`
    : sql`p.user_id = (${sellerAccount(String(email))})`;
  const { rows } = await db.execute(sql`
    SELECT p.username, p.display_name AS "displayName", p.bio,
      (p.user_id = ${viewerId}) AS own,
      EXISTS (SELECT 1 FROM social_profiles WHERE user_id = ${viewerId}) AS "hasProfile",
      EXISTS (SELECT 1 FROM social_follows WHERE follower_id = ${viewerId}
        AND followed_id = p.user_id) AS following
    FROM social_profiles p JOIN users u ON u.id = p.user_id
    WHERE ${target} AND NOT u.banned
      AND NOT EXISTS (SELECT 1 FROM social_blocks
        WHERE (blocker_id = ${viewerId} AND blocked_id = p.user_id)
           OR (blocker_id = p.user_id AND blocked_id = ${viewerId}))
  `);
  if (!rows[0])
    return void res.status(404).json({ error: "Social profile unavailable." });
  const { own, hasProfile, following } = rows[0];
  res.json({ profile: username ? rows[0] : { own, hasProfile, following } });
});

router.get("/social/blocks", async (req, res) => {
  const viewerId = await profileOwner(req, res);
  if (!viewerId) return;
  const { rows } = await db.execute(sql`
    SELECT p.username FROM social_blocks b JOIN social_profiles p ON p.user_id = b.blocked_id
    WHERE b.blocker_id = ${viewerId} ORDER BY p.username
  `);
  res.json({ blocks: rows });
});

router.post("/social/people/:username/report", async (req, res) => {
  if (!(await featureEnabled("social_reports"))) {
    return void res
      .status(503)
      .json({ error: "Reporting is temporarily unavailable." });
  }
  const viewerId = await profileOwner(req, res);
  if (!viewerId) return;
  const reason = req.body?.reason;
  if (!["spam", "harassment", "impersonation", "other"].includes(reason)) {
    return void res.status(400).json({ error: "Select a report reason." });
  }

  const { rows } = await db.execute(sql`
    SELECT target.user_id, EXISTS (
      SELECT 1 FROM social_profiles WHERE user_id = ${viewerId}
    ) AS reporter_exists
    FROM social_profiles target
    WHERE target.username = ${req.params.username.toLowerCase()} AND target.user_id <> ${viewerId}
  `);
  const target = rows[0];
  if (!target)
    return void res.status(404).json({ error: "Social profile unavailable." });
  if (!target.reporter_exists)
    return void res
      .status(403)
      .json({ error: "Set up your social profile first." });

  await db.execute(sql`
    INSERT INTO social_reports (reporter_id, reported_id, reason)
    VALUES (${viewerId}, ${target.user_id}, ${reason}) ON CONFLICT DO NOTHING
  `);
  res.json({ ok: true });
});

router.all(
  ["/social/people/:username/:action", "/social/seller/follow"],
  async (req, res, next) => {
    const { username, action = "follow" } = req.params;
    if (
      (action !== "follow" && action !== "block") ||
      (req.method !== "PUT" && req.method !== "DELETE")
    )
      return void next();
    const enabled = await featureEnabled(
      action === "follow" ? "social_follows" : "social_blocks",
    );
    if (!enabled)
      return void res
        .status(503)
        .json({ error: "Feature temporarily unavailable" });

    const viewerId = await profileOwner(req, res);
    if (!viewerId) return;
    const { email } = req.query;
    if (
      !username &&
      (typeof email !== "string" || email.length > 320 || !email.includes("@"))
    ) {
      return void res.status(400).json({ error: "Invalid seller." });
    }
    const targetFilter = username
      ? sql`p.username = ${String(username).toLowerCase()}`
      : sql`p.user_id = (${sellerAccount(String(email))})`;
    const add = req.method === "PUT";
    const result = await db.transaction(async (tx) => {
      // Lock the same profile rows in ID order for both actions so a follow
      // cannot be inserted concurrently with the block that should remove it.
      const { rows } = await tx.execute<{ id: string; own: boolean }>(sql`
      SELECT p.user_id AS id, (p.user_id = ${viewerId}) AS own
      FROM social_profiles p JOIN users u ON u.id = p.user_id
      WHERE (p.user_id = ${viewerId} OR ${targetFilter})
        AND (NOT u.banned OR ${!add})
      ORDER BY p.user_id FOR UPDATE OF p
    `);
      if (!rows.some((row) => row.own)) return "profile_required";
      const target = rows.find((row) => !row.own);
      if (!target) return "not_found";

      if (action === "block") {
        if (add) {
          await tx.execute(sql`INSERT INTO social_blocks (blocker_id, blocked_id)
          VALUES (${viewerId}, ${target.id}) ON CONFLICT DO NOTHING`);
          await tx.execute(sql`DELETE FROM social_follows
          WHERE (follower_id = ${viewerId} AND followed_id = ${target.id})
             OR (follower_id = ${target.id} AND followed_id = ${viewerId})`);
        } else {
          await tx.execute(sql`DELETE FROM social_blocks
          WHERE blocker_id = ${viewerId} AND blocked_id = ${target.id}`);
        }
      } else if (add) {
        const blocked = await tx.execute(sql`SELECT 1 FROM social_blocks
        WHERE (blocker_id = ${viewerId} AND blocked_id = ${target.id})
           OR (blocker_id = ${target.id} AND blocked_id = ${viewerId})`);
        if (blocked.rows.length) return "not_found";
        await tx.execute(sql`INSERT INTO social_follows (follower_id, followed_id)
        VALUES (${viewerId}, ${target.id}) ON CONFLICT DO NOTHING`);
      } else {
        await tx.execute(sql`DELETE FROM social_follows
        WHERE follower_id = ${viewerId} AND followed_id = ${target.id}`);
      }
      return "ok";
    });

    if (result === "profile_required")
      return void res
        .status(403)
        .json({ error: "Set up your social profile first." });
    if (result === "not_found")
      return void res
        .status(404)
        .json({ error: "Social profile unavailable." });
    res.json({ ok: true });
  },
);

export default router;
