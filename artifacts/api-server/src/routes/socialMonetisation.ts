import { randomUUID } from "node:crypto";
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  ensureCreditEconomyTable,
  recordCreditEconomy,
} from "../lib/creditEconomy.js";
import { featureEnabled } from "../lib/featureFlags.js";
import { socialActivityId, socialText } from "../lib/socialCatalog.js";
import { recordAdminAudit } from "../lib/adminAudit.js";
import { requireAdmin } from "../middlewares/adminAuth.js";
import { ensureAffiliateAccounts } from "./affiliates.js";
import { profileOwner } from "./social.js";

export const socialMonetisationRouter = Router();
const social = Router();
const admin = Router();
socialMonetisationRouter.use("/social/discover", social);
socialMonetisationRouter.use("/admin/social-discovery", requireAdmin, admin);
type Kind = "post" | "short" | "story" | "creator";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const validId = (kind: Kind, id: unknown): id is string =>
  typeof id === "string" &&
  (kind === "post" ? /^[1-9][0-9]{0,17}$/.test(id) : socialActivityId.test(id));

function target(kind: Kind, id: string) {
  switch (kind) {
    case "post":
      return sql`SELECT author_id FROM social_posts WHERE id=${id} AND created_at>now()-interval '29 days' FOR SHARE`;
    case "short":
      return sql`SELECT author_id FROM social_shorts WHERE id=${id} AND kind='short' AND status='published' AND published_at>now()-interval '29 days' FOR SHARE`;
    case "story":
      return sql`SELECT seller_id AS author_id FROM social_stories WHERE id=${id} AND expires_at>now() FOR SHARE`;
    case "creator":
      return sql`SELECT c.user_id AS author_id FROM social_creators c
      JOIN bazunk_affiliates a ON a.user_id=c.clerk_id AND a.status='approved' WHERE c.slug=${id} FOR SHARE OF c,a`;
  }
}

async function lockPlacement(tx: Tx, kind: Kind, id: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`social-placement:${kind}:${id}`},0))`,
  );
  const {
    rows: [active],
  } =
    await tx.execute(sql`SELECT id FROM social_placements WHERE kind=${kind} AND content_id=${id}
    AND removed_at IS NULL AND starts_at<=clock_timestamp() AND expires_at>clock_timestamp()`);
  return Boolean(active);
}

async function prices() {
  const { rows } = await db.execute<{
    key: string;
    value: string;
  }>(sql`SELECT key,value FROM site_settings
    WHERE key IN ('social_post_boost_cost','social_short_boost_cost')`);
  const values = new Map(rows.map((row) => [row.key, Number(row.value)]));
  const cost = (key: string, fallback: number) => {
    const value = values.get(key);
    return value && Number.isInteger(value) && value >= 1 && value <= 10000
      ? value
      : fallback;
  };
  return {
    post: cost("social_post_boost_cost", 99),
    short: cost("social_short_boost_cost", 199),
  };
}

social.get("/prices", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  if (
    !(await featureEnabled("social_placements")) ||
    !(await featureEnabled("credits"))
  )
    return void res.sendStatus(404);
  res.json(await prices());
});

social.post("/boost", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const { kind, id, requestId, credits } = req.body ?? {};
  if (
    (kind !== "post" && kind !== "short") ||
    !validId(kind, id) ||
    typeof requestId !== "string" ||
    !socialActivityId.test(requestId) ||
    !Number.isInteger(credits)
  ) {
    return void res.sendStatus(400);
  }
  if (
    !(await featureEnabled("social_placements")) ||
    !(await featureEnabled("credits")) ||
    !(await featureEnabled(kind === "short" ? "social_shorts" : "social_feed"))
  )
    return void res.sendStatus(503);
  await ensureCreditEconomyTable();
  const result = await db.transaction(async (tx) => {
    // Reserve this request ID across targets before taking the placement lock.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`social-boost:${requestId}`},0))`,
    );
    const {
      rows: [previous],
    } = await tx.execute(sql`SELECT p.id, p.expires_at AS "expiresAt",
       p.kind=${kind} AND p.content_id=${id} AND lower(u.email)=lower(l.email) AND l.credits = ${-credits} AS same
       FROM social_placements p LEFT JOIN credit_economy_ledger l ON l.reference_type='social_boost' AND l.reference_id=p.id::text
       JOIN users u ON u.id=${viewer} WHERE p.id=${requestId}`);
    if (previous)
      return previous.same
        ? {
            status: 200,
            body: { id: previous.id, expiresAt: previous.expiresAt },
          }
        : {
            status: 409,
            body: { error: "That request has already been used." },
          };
    const active = await lockPlacement(tx, kind, id);
    const account = await tx.execute<{ author_id: string }>(target(kind, id));
    if (account.rows[0]?.author_id !== viewer)
      return { status: 404, body: { error: "Content is unavailable." } };
    if (active)
      return {
        status: 409,
        body: { error: "This content already has an active placement." },
      };
    const {
      rows: [setting],
    } = await tx.execute<{ value: string }>(sql`SELECT value FROM site_settings
      WHERE key=${kind === "short" ? "social_short_boost_cost" : "social_post_boost_cost"} FOR SHARE`);
    const configured = Number(setting?.value);
    const payable =
      Number.isInteger(configured) && configured >= 1 && configured <= 10000
        ? configured
        : kind === "short"
          ? 199
          : 99;
    if (credits !== payable)
      return {
        status: 409,
        body: {
          error:
            "The boost price has changed. Reload to confirm the new price.",
        },
      };
    const {
      rows: [debited],
    } = await tx.execute<{
      email: string;
      credits: string;
    }>(sql`UPDATE users SET credits=credits-${payable}
      WHERE id=${viewer} AND NOT banned AND credits>=${payable} RETURNING email,credits`);
    if (!debited)
      return { status: 402, body: { error: "Not enough Bazunk Credits." } };
    const {
      rows: [placement],
    } =
      await tx.execute(sql`INSERT INTO social_placements(id,kind,content_id,mode,expires_at)
      VALUES(${requestId},${kind},${id},'boost',now()+interval '24 hours') RETURNING id,expires_at AS "expiresAt"`);
    await recordCreditEconomy(
      {
        email: debited.email,
        kind: "spent",
        credits: -payable,
        reason: "Social boost",
        referenceType: "social_boost",
        referenceId: requestId,
        metadata: { kind, id },
      },
      tx,
    );
    return { status: 201, body: { ...placement, balance: debited.credits } };
  });
  res.status(result.status).json(result.body);
});

social.get("/rewards", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  if (
    !(await featureEnabled("social_creator_rewards")) ||
    !(await featureEnabled("credits"))
  )
    return void res.sendStatus(404);
  const { rows } =
    await db.execute(sql`SELECT id,credits,reason,created_at AS "createdAt" FROM social_creator_awards
    WHERE creator_id=${viewer} ORDER BY created_at DESC LIMIT 30`);
  res.json({ awards: rows });
});

social.get("/challenges", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  if (
    !(await featureEnabled("social_challenges")) ||
    !(await featureEnabled("credits"))
  )
    return void res.sendStatus(404);
  const { rows } = await db.execute(sql`
    SELECT c.id,c.title,c.description,c.reward,c.expires_at AS "expiresAt",
      EXISTS(SELECT 1 FROM social_challenge_claims q WHERE q.challenge_id=c.id AND q.user_id=${viewer}) AS claimed,
      greatest(0,c.max_claims-(SELECT count(*)::int FROM social_challenge_claims q WHERE q.challenge_id=c.id)) AS remaining,
      ARRAY(SELECT json_build_object('id',s.id,'caption',s.caption) FROM social_shorts s
        WHERE s.author_id=${viewer} AND s.kind='short' AND s.status='published'
          AND s.created_at>=c.starts_at AND s.published_at<c.expires_at
          AND NOT EXISTS(SELECT 1 FROM social_challenge_claims used WHERE used.short_id=s.id)
        ORDER BY s.published_at DESC LIMIT 20) AS entries
    FROM social_challenges c WHERE starts_at<=now() AND expires_at>now() AND closed_at IS NULL
    ORDER BY expires_at LIMIT 30`);
  res.json({ challenges: rows });
});

social.post("/challenges/:id/claim", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  if (
    !(await featureEnabled("social_challenges")) ||
    !(await featureEnabled("credits")) ||
    !(await featureEnabled("social_shorts"))
  )
    return void res.sendStatus(503);
  const { id } = req.params;
  const short = req.body?.shortId;
  if (
    !socialActivityId.test(id) ||
    typeof short !== "string" ||
    !socialActivityId.test(short)
  )
    return void res.sendStatus(400);
  await ensureCreditEconomyTable();
  const result = await db.transaction(async (tx) => {
    const {
      rows: [challenge],
    } = await tx.execute<{
      reward: number;
      max_claims: number;
      active: boolean;
    }>(sql`
      SELECT reward,max_claims,closed_at IS NULL AND starts_at<=clock_timestamp() AND expires_at>clock_timestamp() AS active
      FROM social_challenges WHERE id=${id} FOR UPDATE`);
    if (!challenge) return "unavailable";
    const prior = await tx.execute(
      sql`SELECT 1 FROM social_challenge_claims WHERE challenge_id=${id} AND user_id=${viewer}`,
    );
    if (prior.rows.length) return "ok";
    if (!challenge.active) return "unavailable";
    const {
      rows: [used],
    } = await tx.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM social_challenge_claims WHERE challenge_id=${id}`,
    );
    if (used.count >= challenge.max_claims) return "unavailable";
    const entry =
      await tx.execute(sql`SELECT s.id FROM social_shorts s JOIN social_challenges c ON c.id=${id}
      WHERE s.id=${short} AND s.author_id=${viewer} AND s.kind='short' AND s.status='published'
        AND s.created_at>=c.starts_at AND s.published_at<c.expires_at FOR SHARE OF s`);
    if (!entry.rows.length) return "ineligible";
    const saved =
      await tx.execute(sql`INSERT INTO social_challenge_claims(challenge_id,user_id,short_id)
      VALUES(${id},${viewer},${short}) ON CONFLICT DO NOTHING RETURNING short_id`);
    if (!saved.rows.length) return "ineligible";
    const {
      rows: [account],
    } = await tx.execute<{
      email: string;
    }>(sql`UPDATE users SET credits=credits+${challenge.reward}
      WHERE id=${viewer} AND NOT banned RETURNING email`);
    if (!account) throw new Error("Challenge recipient unavailable");
    await recordCreditEconomy(
      {
        email: account.email,
        kind: "earned",
        credits: challenge.reward,
        reason: "Social shopping challenge",
        referenceType: "social_challenge",
        referenceId: id,
        metadata: { short },
      },
      tx,
    );
    return "ok";
  });
  if (result !== "ok")
    return void res.status(409).json({
      error:
        result === "ineligible"
          ? "Choose an eligible Short you have not used for another challenge."
          : "This challenge is no longer accepting claims.",
    });
  res.json({ ok: true });
});

admin.get("/", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  const [placement, challenge, award, costs] = await Promise.all([
    db.execute(sql`SELECT id,kind,content_id AS "contentId",mode,label,expires_at AS "expiresAt" FROM social_placements
      WHERE removed_at IS NULL AND expires_at>now() ORDER BY starts_at DESC LIMIT 50`),
    db.execute(sql`SELECT id,title,reward,max_claims AS "maxClaims",expires_at AS "expiresAt" FROM social_challenges
      WHERE closed_at IS NULL AND expires_at>now() ORDER BY starts_at DESC LIMIT 50`),
    db.execute(sql`SELECT a.id,p.username,a.credits,a.reason FROM social_creator_awards a JOIN social_profiles p ON p.user_id=a.creator_id
      ORDER BY a.created_at DESC LIMIT 30`),
    prices(),
  ]);
  res.json({
    placements: placement.rows,
    challenges: challenge.rows,
    awards: award.rows,
    prices: costs,
  });
});

admin.put("/prices", async (req, res) => {
  const { post, short } = req.body ?? {};
  if (
    ![post, short].every(
      (value) => Number.isInteger(value) && value >= 1 && value <= 10000,
    )
  )
    return void res.sendStatus(400);
  await db.execute(sql`INSERT INTO site_settings(key,value) VALUES ('social_post_boost_cost',${String(post)}),('social_short_boost_cost',${String(short)})
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  await recordAdminAudit({
    req,
    category: "social",
    action: "social.boost_prices",
    summary: "Changed social boost prices",
    after: { post, short },
  });
  res.sendStatus(204);
});

admin.post("/placements", async (req, res) => {
  const { kind, contentId, hours } = req.body ?? {};
  const label = socialText(req.body?.label ?? "", 80);
  if (
    (kind !== "short" && kind !== "story" && kind !== "creator") ||
    !validId(kind, contentId) ||
    !Number.isInteger(hours) ||
    hours < 1 ||
    hours > 720 ||
    label === null ||
    (kind !== "creator" && !label)
  )
    return void res.sendStatus(400);
  if (kind === "creator") await ensureAffiliateAccounts();
  const id = randomUUID();
  const result = await db.transaction(async (tx) => {
    if (await lockPlacement(tx, kind, contentId)) return false;
    const {
      rows: [item],
    } = await tx.execute<{ author_id: string }>(target(kind, contentId));
    if (!item) return false;
    const owner = await tx.execute(
      sql`SELECT id FROM users WHERE id=${item.author_id} AND NOT banned`,
    );
    if (!owner.rows.length) return false;
    await tx.execute(sql`INSERT INTO social_placements(id,kind,content_id,mode,label,expires_at)
      VALUES(${id},${kind},${contentId},${kind === "creator" ? "feature" : "sponsor"},${label || null},now()+${hours}*interval '1 hour')`);
    return true;
  });
  if (!result)
    return void res.status(409).json({
      error:
        "The selected content is unavailable or already has an active placement.",
    });
  await recordAdminAudit({
    req,
    category: "social",
    action: "social.placement_added",
    targetId: id,
    summary: "Added a social placement",
    after: { kind, contentId, hours, label },
  });
  res.status(201).json({ id });
});

admin.delete("/placements/:id", async (req, res) => {
  const { id } = req.params;
  if (!socialActivityId.test(id)) return void res.sendStatus(404);
  const result =
    await db.execute(sql`UPDATE social_placements SET removed_at=now()
    WHERE id=${id} AND mode<>'boost' AND removed_at IS NULL RETURNING id`);
  if (!result.rows.length) return void res.sendStatus(404);
  await recordAdminAudit({
    req,
    category: "social",
    action: "social.placement_removed",
    targetId: id,
    summary: "Ended a social placement",
  });
  res.sendStatus(204);
});

admin.post("/challenges", async (req, res) => {
  const title = socialText(req.body?.title, 80),
    description = socialText(req.body?.description, 500);
  const { reward, maxClaims, hours } = req.body ?? {};
  if (
    !title ||
    !description ||
    !Number.isInteger(reward) ||
    reward < 1 ||
    reward > 100 ||
    !Number.isInteger(maxClaims) ||
    maxClaims < 1 ||
    maxClaims > 500 ||
    !Number.isInteger(hours) ||
    hours < 1 ||
    hours > 720
  )
    return void res.sendStatus(400);
  const id = randomUUID();
  await db.execute(sql`INSERT INTO social_challenges(id,title,description,reward,max_claims,expires_at)
    VALUES(${id},${title},${description},${reward},${maxClaims},now()+${hours}*interval '1 hour')`);
  await recordAdminAudit({
    req,
    category: "social",
    action: "social.challenge_created",
    targetId: id,
    summary: "Created a social shopping challenge",
    after: { reward, maxClaims, hours },
  });
  res.status(201).json({ id });
});

admin.delete("/challenges/:id", async (req, res) => {
  const { id } = req.params;
  if (!socialActivityId.test(id)) return void res.sendStatus(404);
  const result = await db.execute(
    sql`UPDATE social_challenges SET closed_at=now() WHERE id=${id} AND closed_at IS NULL RETURNING id`,
  );
  if (!result.rows.length) return void res.sendStatus(404);
  await recordAdminAudit({
    req,
    category: "social",
    action: "social.challenge_closed",
    targetId: id,
    summary: "Closed a social shopping challenge",
  });
  res.sendStatus(204);
});

admin.post("/awards", async (req, res) => {
  const { creator, credits, requestId } = req.body ?? {};
  const reason = socialText(req.body?.reason, 200);
  if (
    !validId("creator", creator) ||
    !validId("creator", requestId) ||
    !Number.isInteger(credits) ||
    credits < 1 ||
    credits > 100 ||
    !reason
  )
    return void res.sendStatus(400);
  if (
    !(await featureEnabled("social_creator_rewards")) ||
    !(await featureEnabled("credits")) ||
    !(await featureEnabled("social_creators"))
  )
    return void res.sendStatus(503);
  await ensureAffiliateAccounts();
  await ensureCreditEconomyTable();
  const result = await db.transaction(async (tx) => {
    const {
      rows: [owner],
    } = await tx.execute<{ author_id: string }>(target("creator", creator));
    if (!owner) return "unavailable";
    const award =
      await tx.execute(sql`INSERT INTO social_creator_awards(id,creator_id,credits,reason)
       VALUES(${requestId},${owner.author_id},${credits},${reason}) ON CONFLICT DO NOTHING RETURNING id`);
    if (!award.rows.length) {
      const prior =
        await tx.execute(sql`SELECT id FROM social_creator_awards WHERE id=${requestId}
        AND creator_id=${owner.author_id} AND credits=${credits} AND reason=${reason}`);
      return prior.rows.length ? "prior" : "unavailable";
    }
    const {
      rows: [account],
    } = await tx.execute<{
      email: string;
    }>(sql`UPDATE users SET credits=credits+${credits}
       WHERE id=${owner.author_id} AND NOT banned RETURNING email`);
    if (!account) throw new Error("Creator reward recipient unavailable");
    await recordCreditEconomy(
      {
        email: account.email,
        kind: "earned",
        credits,
        reason,
        referenceType: "social_creator_reward",
        referenceId: requestId,
      },
      tx,
    );
    return "ok";
  });
  if (result === "unavailable")
    return void res
      .status(409)
      .json({ error: "Creator or reward request is unavailable." });
  if (result === "ok")
    await recordAdminAudit({
      req,
      category: "social",
      action: "social.creator_reward",
      targetId: creator,
      summary: "Awarded creator credits",
      after: { credits, reason, requestId },
    });
  res.status(result === "ok" ? 201 : 200).json({ id: requestId });
});
