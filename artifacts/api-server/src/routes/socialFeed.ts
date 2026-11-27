import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { featureEnabled } from "../lib/featureFlags.js";
import { profileOwner } from "./social.js";

const router = Router();
const pageSize = 20;
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{0,17}$/.test(value);

function content(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const body = value.trim();
  return body && body.length <= maxLength && !body.includes("\0") ? body : null;
}

function unblocked(
  viewer: string | ReturnType<typeof sql>,
  author: ReturnType<typeof sql>,
) {
  return sql`NOT EXISTS (
    SELECT 1 FROM social_blocks
    WHERE (blocker_id = ${viewer} AND blocked_id = ${author})
       OR (blocker_id = ${author} AND blocked_id = ${viewer})
  )`;
}

function visiblePost(viewer: string) {
  return sql`FROM social_posts p
    JOIN social_profiles profile ON profile.user_id = p.author_id
    JOIN users author ON author.id = p.author_id
    WHERE NOT author.banned AND ${unblocked(viewer, sql`p.author_id`)}`;
}

async function postFields(viewer: string) {
  const [likes, saves] = await Promise.all([
    featureEnabled("social_likes"),
    featureEnabled("social_saves"),
  ]);
  return sql`p.id::text AS id, p.body, p.created_at AS "createdAt",
    profile.username, profile.display_name AS "displayName", p.author_id = ${viewer} AS own,
    EXISTS (SELECT 1 FROM social_follows WHERE follower_id = ${viewer}
      AND followed_id = p.author_id) AS following,
    ${likes ? sql`EXISTS (SELECT 1 FROM social_post_likes WHERE post_id = p.id AND user_id = ${viewer})` : sql`FALSE`} AS liked,
    ${
      likes
        ? sql`(SELECT count(*)::int FROM social_post_likes l JOIN users liker ON liker.id = l.user_id
      WHERE l.post_id = p.id AND NOT liker.banned AND ${unblocked(viewer, sql`l.user_id`)})`
        : sql`0`
    } AS "likeCount",
    ${saves ? sql`EXISTS (SELECT 1 FROM social_post_saves WHERE post_id = p.id AND user_id = ${viewer})` : sql`FALSE`} AS saved`;
}

router.get("/social/feed", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const { mode = "latest", before } = req.query;
  if (
    !["latest", "following", "saved"].some((option) => option === mode) ||
    (before !== undefined && !validId(before))
  ) {
    return void res.status(400).json({ error: "Invalid feed filter." });
  }
  if (
    (mode === "saved" && !(await featureEnabled("social_saves"))) ||
    (mode === "following" && !(await featureEnabled("social_follows")))
  ) {
    return void res
      .status(503)
      .json({ error: "This feed is temporarily unavailable." });
  }

  const filter =
    mode === "following"
      ? sql`AND EXISTS (SELECT 1 FROM social_follows WHERE follower_id = ${viewer} AND followed_id = p.author_id)`
      : mode === "saved"
        ? sql`AND EXISTS (SELECT 1 FROM social_post_saves WHERE user_id = ${viewer} AND post_id = p.id)`
        : sql.empty();
  const { rows } = await db.execute<{ id: string }>(sql`
    SELECT ${await postFields(viewer)} ${visiblePost(viewer)} ${filter}
    ${before ? sql`AND p.id < ${before}` : sql.empty()}
    ORDER BY p.id DESC LIMIT ${pageSize + 1}
  `);
  const posts = rows.slice(0, pageSize);
  res.json({ posts, next: rows.length > pageSize ? posts.at(-1)?.id : null });
});

router.get("/social/posts/:id", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  if (!validId(req.params.id) || !(await featureEnabled("social_sharing"))) {
    return void res.status(404).json({ error: "Post unavailable." });
  }
  const { rows } = await db.execute(sql`
    SELECT ${await postFields(viewer)} ${visiblePost(viewer)} AND p.id = ${req.params.id}
  `);
  if (!rows[0])
    return void res.status(404).json({ error: "Post unavailable." });
  res.json({ post: rows[0] });
});

router.post("/social/posts", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const body = content(req.body?.body, 1000);
  if (!body)
    return void res
      .status(400)
      .json({ error: "Enter a post of up to 1,000 characters." });
  const { rows } = await db.execute(sql`
    INSERT INTO social_posts (author_id, body)
    SELECT user_id, ${body} FROM social_profiles WHERE user_id = ${viewer}
    RETURNING id::text AS id
  `);
  if (!rows[0])
    return void res
      .status(403)
      .json({ error: "Set up your social profile first." });
  res.status(201).json(rows[0]);
});

router.delete("/social/posts/:id", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  if (!validId(req.params.id))
    return void res.status(404).json({ error: "Post unavailable." });
  const result = await db.execute(sql`
    DELETE FROM social_posts WHERE id = ${req.params.id} AND author_id = ${viewer} RETURNING id
  `);
  if (!result.rows.length)
    return void res.status(404).json({ error: "Post unavailable." });
  res.sendStatus(204);
});

router.get("/social/posts/:id/comments", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const { id } = req.params;
  const { before } = req.query;
  if (!validId(id) || (before !== undefined && !validId(before))) {
    return void res.status(400).json({ error: "Invalid comments request." });
  }
  const { rows } = await db.execute<{
    id: string;
    comments: { id: string }[];
  }>(sql`
    SELECT p.id::text AS id, ARRAY(
      SELECT json_build_object('id', c.id::text, 'body', c.body,
        'createdAt', c.created_at, 'username', cp.username, 'own', c.author_id = ${viewer})
      FROM social_post_comments c
      JOIN social_profiles cp ON cp.user_id = c.author_id
      JOIN users commenter ON commenter.id = c.author_id
      WHERE c.post_id = p.id AND NOT commenter.banned AND ${unblocked(viewer, sql`c.author_id`)}
        AND ${unblocked(sql`p.author_id`, sql`c.author_id`)}
      ${before ? sql`AND c.id < ${before}` : sql.empty()}
      ORDER BY c.id DESC LIMIT ${pageSize + 1}
    ) AS comments
    ${visiblePost(viewer)} AND p.id = ${id}
  `);
  if (!rows[0])
    return void res.status(404).json({ error: "Post unavailable." });
  const comments = rows[0].comments.slice(0, pageSize);
  res.json({
    comments,
    next: rows[0].comments.length > pageSize ? comments.at(-1)?.id : null,
  });
});

router.delete("/social/posts/:id/comments/:comment", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const { id, comment } = req.params;
  if (!validId(id) || !validId(comment))
    return void res.status(404).json({ error: "Comment unavailable." });
  const { rows } = await db.execute(sql`
    DELETE FROM social_post_comments WHERE id = ${comment} AND post_id = ${id}
      AND author_id = ${viewer} RETURNING id
  `);
  if (!rows.length)
    return void res.status(404).json({ error: "Comment unavailable." });
  res.sendStatus(204);
});

router.all("/social/posts/:id/:action", async (req, res, next) => {
  const { id, action } = req.params;
  const commenting = action === "comments" && req.method === "POST";
  const reacting =
    (action === "like" || action === "save") &&
    ["PUT", "DELETE"].includes(req.method);
  if (!commenting && !reacting) return void next();
  if (
    !(await featureEnabled(
      commenting
        ? "social_comments"
        : action === "like"
          ? "social_likes"
          : "social_saves",
    ))
  ) {
    return void res
      .status(503)
      .json({ error: "This action is temporarily unavailable." });
  }
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  if (!validId(id))
    return void res.status(404).json({ error: "Post unavailable." });
  const body = commenting ? content(req.body?.body, 500) : null;
  if (commenting && !body)
    return void res
      .status(400)
      .json({ error: "Enter a comment of up to 500 characters." });

  const result = await db.transaction(async (tx) => {
    // Serialize writes with the same profile locks used by blocking.
    const profiles = await tx.execute<{ user_id: string }>(sql`
      SELECT user_id FROM social_profiles
      WHERE user_id = ${viewer} OR user_id = (SELECT author_id FROM social_posts WHERE id = ${id})
      ORDER BY user_id FOR UPDATE
    `);
    if (!profiles.rows.some((profile) => profile.user_id === viewer))
      return "profile";
    const post = await tx.execute(sql`
      SELECT p.id ${visiblePost(viewer)} AND p.id = ${id} FOR KEY SHARE OF p
    `);
    if (!post.rows.length) return "missing";

    if (commenting) {
      await tx.execute(
        sql`INSERT INTO social_post_comments (post_id, author_id, body) VALUES (${id}, ${viewer}, ${body})`,
      );
    } else {
      const table =
        action === "like"
          ? sql.identifier("social_post_likes")
          : sql.identifier("social_post_saves");
      if (req.method === "PUT") {
        await tx.execute(
          sql`INSERT INTO ${table} (post_id, user_id) VALUES (${id}, ${viewer}) ON CONFLICT DO NOTHING`,
        );
      } else {
        await tx.execute(
          sql`DELETE FROM ${table} WHERE post_id = ${id} AND user_id = ${viewer}`,
        );
      }
    }
    return "ok";
  });
  if (result === "profile")
    return void res
      .status(403)
      .json({ error: "Set up your social profile first." });
  if (result === "missing")
    return void res.status(404).json({ error: "Post unavailable." });
  res.sendStatus(commenting ? 201 : 204);
});

export default router;
