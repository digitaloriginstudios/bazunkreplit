import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { featureEnabled } from "../lib/featureFlags.js";
import { categoryVisibility } from "../lib/listingVisibility.js";
import { profileOwner } from "./social.js";

const router = Router();
const boards = Router();
router.use("/social/collections", boards);
const slugPattern = /^[a-z0-9-]{1,100}$/;
const tokenPattern = /^[a-f0-9]{64}$/;
const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const roles = ["viewer", "editor"];
const pageSize = 24;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Board = {
  slug: string;
  kind: "collection" | "wishlist";
  public: boolean;
  role: "owner" | "editor" | "viewer" | null;
  following: boolean;
};

const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

function notBlocked(viewer: string | null) {
  return sql`NOT EXISTS (SELECT 1 FROM social_blocks
    WHERE (blocker_id = ${viewer} AND blocked_id = b.owner_id)
       OR (blocked_id = ${viewer} AND blocker_id = b.owner_id))`;
}

function boardFields(viewer: string | null, follows: boolean) {
  return sql`b.slug, b.kind, b.title, b.description, b.cover_url AS "coverUrl", b.occasion,
    b.is_public AS public, owner_profile.username AS "ownerUsername",
    CASE WHEN b.owner_id = ${viewer} THEN 'owner' ELSE member.role END AS role,
    ${
      follows
        ? sql`EXISTS (SELECT 1 FROM social_collection_follows
      WHERE slug = b.slug AND user_id = ${viewer})`
        : sql`FALSE`
    } AS following`;
}

function visibleBoards(viewer: string | null, wishlists: boolean) {
  return sql`FROM social_collections b
    JOIN social_profiles owner_profile ON owner_profile.user_id = b.owner_id
    JOIN users owner ON owner.id = b.owner_id
    LEFT JOIN social_collection_members member ON member.slug = b.slug AND member.user_id = ${viewer}
    WHERE NOT owner.banned AND ${notBlocked(viewer)}
      AND (b.kind = 'collection' OR ${wishlists})
      AND (b.is_public OR b.owner_id = ${viewer} OR member.user_id IS NOT NULL)`;
}

async function optionalViewer(req: Request, res: Response) {
  res.set("Cache-Control", "no-store");
  return req.headers.authorization ? profileOwner(req, res) : null;
}

function settings(
  data: Record<string, unknown> | undefined,
  kind: Board["kind"],
) {
  const title = typeof data?.title === "string" ? data.title.trim() : "";
  const description =
    typeof data?.description === "string" ? data.description.trim() : "";
  const cover = typeof data?.coverUrl === "string" ? data.coverUrl.trim() : "";
  const occasion =
    kind === "wishlist" ? (data?.occasion ?? "general") : "general";
  const isPublic = kind === "collection" && data?.public === true;
  if (
    !title ||
    title.length > 80 ||
    description.length > 500 ||
    /\u0000/.test(title + description) ||
    !["general", "christmas", "birthday", "wedding"].some(
      (option) => option === occasion,
    )
  )
    return null;
  if (cover) {
    if (cover.length > 1500) return null;
    try {
      const url = new URL(cover);
      if (url.protocol !== "https:" || url.username || url.password)
        return null;
    } catch {
      return null;
    }
  }
  return {
    title,
    description,
    cover: cover || null,
    occasion: String(occasion),
    isPublic,
  };
}

boards.get("/", async (req, res) => {
  const viewer = await optionalViewer(req, res);
  if (res.headersSent) return;
  const { mode = "discover", page = "0" } = req.query;
  if (
    !["discover", "mine", "following"].some((option) => option === mode) ||
    typeof page !== "string" ||
    !/^[0-9]{1,4}$/.test(page)
  ) {
    return void res.status(400).json({ error: "Invalid collection filter." });
  }
  if (mode !== "discover" && !viewer) return void res.sendStatus(401);
  const [wishlists, follows] = await Promise.all([
    featureEnabled("social_wishlists"),
    featureEnabled("social_collection_follows"),
  ]);
  if (mode === "following" && !follows) return void res.sendStatus(503);
  const filter =
    mode === "mine"
      ? sql`b.owner_id = ${viewer} OR member.user_id IS NOT NULL`
      : mode === "following"
        ? sql`b.is_public AND EXISTS (SELECT 1 FROM social_collection_follows WHERE slug = b.slug AND user_id = ${viewer})`
        : sql`b.is_public`;
  const { rows } = await db.execute(sql`
    SELECT ${boardFields(viewer, follows)} ${visibleBoards(viewer, wishlists)}
    AND (${filter}) ORDER BY b.created_at DESC, b.slug
    LIMIT ${pageSize + 1} OFFSET ${Number(page) * pageSize}
  `);
  res.json({
    boards: rows.slice(0, pageSize),
    nextPage: rows.length > pageSize ? Number(page) + 1 : null,
  });
});

boards.get("/:slug", async (req, res) => {
  const viewer = await optionalViewer(req, res);
  if (res.headersSent) return;
  const { slug } = req.params;
  if (!slugPattern.test(slug)) return void res.sendStatus(404);
  const [wishlists, follows, visibility] = await Promise.all([
    featureEnabled("social_wishlists"),
    featureEnabled("social_collection_follows"),
    categoryVisibility(),
  ]);
  const { rows } = await db.execute<Board & { items: unknown[] }>(sql`
    SELECT ${boardFields(viewer, follows)}, ARRAY(
      SELECT CASE WHEN listings.status = 'active' AND ${visibility}
      THEN json_build_object('id', i.listing_id, 'title', listings.title, 'price', listings.price::text,
        'currency', listings.currency, 'image', listings.image,
        'listingPath', coalesce(listings.public_url_token, listings.public_id, listings.id::text),
        'available', coalesce(listings.quantity, 1) > 0)
      ELSE json_build_object('id', i.listing_id, 'available', false) END
      FROM social_collection_items i JOIN listings ON listings.id = i.listing_id
      WHERE i.slug = b.slug
        AND ((listings.status = 'active' AND ${visibility}) OR b.owner_id = ${viewer} OR member.role = 'editor')
      ORDER BY i.added_at DESC, i.listing_id DESC
    ) AS items
    ${visibleBoards(viewer, wishlists)} AND b.slug = ${slug}
  `);
  if (!rows[0])
    return void res.status(404).json({ error: "Collection unavailable." });
  res.json(rows[0]);
});

boards.post("/", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  const kind = req.body?.kind;
  if (kind !== "collection" && kind !== "wishlist")
    return void res.sendStatus(400);
  if (
    !(await featureEnabled("social_profiles")) ||
    (kind === "wishlist" && !(await featureEnabled("social_wishlists")))
  ) {
    return void res.sendStatus(503);
  }
  const input = settings(req.body, kind);
  if (!input)
    return void res.status(400).json({
      error: "Check the title, description and HTTPS cover image URL.",
    });
  const prefix = input.title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 55)
    .replace(/-$/, "");
  const slug = `${prefix || kind}-${randomBytes(8).toString("hex")}`;
  const { rows } = await db.execute(sql`
    INSERT INTO social_collections (slug, owner_id, kind, title, description, cover_url, is_public, occasion)
    SELECT ${slug}, user_id, ${kind}, ${input.title}, ${input.description}, ${input.cover}, ${input.isPublic}, ${input.occasion}
    FROM social_profiles WHERE user_id = ${viewer} RETURNING slug
  `);
  if (!rows.length)
    return void res
      .status(403)
      .json({ error: "Set up your social profile first." });
  res.status(201).json({ slug });
});

type Access = "owner" | "editor" | "public";
type Result = { status: number; body?: object };
const unavailable: Result = {
  status: 404,
  body: { error: "Collection unavailable." },
};

function withBoard(
  access: Access,
  action: (
    tx: Tx,
    board: Board,
    viewer: string,
    req: Request,
  ) => Promise<Result>,
) {
  return async (req: Request, res: Response) => {
    const viewer = await profileOwner(req, res);
    if (!viewer) return;
    const { slug } = req.params;
    if (typeof slug !== "string" || !slugPattern.test(slug))
      return void res.sendStatus(404);
    const [wishlists, follows] = await Promise.all([
      featureEnabled("social_wishlists"),
      featureEnabled("social_collection_follows"),
    ]);
    if (access === "public" && !follows) return void res.sendStatus(503);
    const result = await db.transaction(async (tx) => {
      // Membership, visibility, invites, and editing all serialize on this board row.
      const locked = await tx.execute(
        sql`SELECT slug FROM social_collections WHERE slug = ${slug} FOR UPDATE`,
      );
      if (!locked.rows.length) return unavailable;
      const {
        rows: [board],
      } = await tx.execute<Board>(sql`
        SELECT ${boardFields(viewer, follows)} ${visibleBoards(viewer, wishlists)} AND b.slug = ${slug}
      `);
      if (!board) return unavailable;
      if (
        (access === "owner" && board.role !== "owner") ||
        (access === "editor" &&
          !["owner", "editor"].some((role) => role === board.role))
      ) {
        return {
          status: 403,
          body: {
            error: "You do not have permission to edit this collection.",
          },
        };
      }
      return action(tx, board, viewer, req);
    });
    if (result.body) res.status(result.status).json(result.body);
    else res.sendStatus(result.status);
  };
}

boards.put(
  "/:slug",
  withBoard("owner", async (tx, board, _viewer, req) => {
    const input = settings(req.body, board.kind);
    if (!input)
      return {
        status: 400,
        body: {
          error: "Check the title, description and HTTPS cover image URL.",
        },
      };
    await tx.execute(sql`UPDATE social_collections SET title = ${input.title}, description = ${input.description},
    cover_url = ${input.cover}, is_public = ${input.isPublic}, occasion = ${input.occasion} WHERE slug = ${board.slug}`);
    if (!input.isPublic)
      await tx.execute(
        sql`DELETE FROM social_collection_follows WHERE slug = ${board.slug}`,
      );
    return { status: 204 };
  }),
);

boards.delete(
  "/:slug",
  withBoard("owner", async (tx, board) => {
    await tx.execute(
      sql`DELETE FROM social_collections WHERE slug = ${board.slug}`,
    );
    return { status: 204 };
  }),
);

boards.all(
  "/:slug/items/:listing",
  withBoard("editor", async (tx, board, _viewer, req) => {
    const listing = Number(req.params.listing);
    if (!Number.isInteger(listing) || listing < 1 || listing > 2147483647)
      return { status: 400 };
    if (req.method === "DELETE") {
      await tx.execute(
        sql`DELETE FROM social_collection_items WHERE slug = ${board.slug} AND listing_id = ${listing}`,
      );
    } else if (req.method === "PUT") {
      const existing = await tx.execute(
        sql`SELECT 1 FROM social_collection_items WHERE slug = ${board.slug} AND listing_id = ${listing}`,
      );
      if (existing.rows.length) return { status: 204 };
      const {
        rows: [size],
      } = await tx.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM social_collection_items WHERE slug = ${board.slug}`);
      if (size.count >= 100)
        return {
          status: 409,
          body: { error: "A collection can hold up to 100 products." },
        };
      const visibility = await categoryVisibility(tx);
      const result = await tx.execute(sql`
      INSERT INTO social_collection_items (slug, listing_id)
      SELECT ${board.slug}, id FROM listings WHERE id = ${listing} AND status = 'active' AND ${visibility}
      RETURNING listing_id
    `);
      if (!result.rows.length)
        return { status: 404, body: { error: "Product unavailable." } };
    } else return { status: 405 };
    return { status: 204 };
  }),
);

boards.all(
  "/:slug/follow",
  withBoard("public", async (tx, board, viewer, req) => {
    if (!board.public || board.role === "owner") return { status: 403 };
    if (req.method === "DELETE") {
      await tx.execute(
        sql`DELETE FROM social_collection_follows WHERE slug = ${board.slug} AND user_id = ${viewer}`,
      );
    } else if (req.method === "PUT") {
      const existing = await tx.execute(
        sql`SELECT 1 FROM social_profiles WHERE user_id = ${viewer}`,
      );
      if (!existing.rows.length)
        return {
          status: 403,
          body: { error: "Set up your social profile first." },
        };
      await tx.execute(sql`INSERT INTO social_collection_follows (slug, user_id)
      VALUES (${board.slug}, ${viewer}) ON CONFLICT DO NOTHING`);
    } else return { status: 405 };
    return { status: 204 };
  }),
);

boards.get(
  "/:slug/access",
  withBoard("owner", async (tx, board) => {
    if (board.kind !== "wishlist") return unavailable;
    const members =
      await tx.execute(sql`SELECT p.username, m.role FROM social_collection_members m
    JOIN social_profiles p ON p.user_id = m.user_id WHERE m.slug = ${board.slug} ORDER BY p.username`);
    const invites =
      await tx.execute(sql`SELECT id, role, expires_at AS "expiresAt" FROM social_collection_invites
    WHERE slug = ${board.slug} AND used_at IS NULL AND expires_at > now() ORDER BY expires_at`);
    return {
      status: 200,
      body: { members: members.rows, invites: invites.rows },
    };
  }),
);

boards.post(
  "/:slug/invites",
  withBoard("owner", async (tx, board, _viewer, req) => {
    if (board.kind !== "wishlist") return unavailable;
    const role = req.body?.role;
    if (!roles.includes(role)) return { status: 400 };
    const {
      rows: [size],
    } = await tx.execute<{
      count: number;
    }>(sql`SELECT count(*)::int AS count FROM social_collection_invites
    WHERE slug = ${board.slug} AND used_at IS NULL AND expires_at > now()`);
    if (size.count >= 20)
      return {
        status: 409,
        body: { error: "Revoke an existing invitation first." },
      };
    const token = randomBytes(32).toString("hex");
    await tx.execute(sql`INSERT INTO social_collection_invites (id, slug, token_hash, role)
    VALUES (${randomUUID()}, ${board.slug}, ${tokenHash(token)}, ${role})`);
    return { status: 201, body: { token } };
  }),
);

boards.delete(
  "/:slug/invites/:id",
  withBoard("owner", async (tx, board, _viewer, req) => {
    if (board.kind !== "wishlist" || !uuidPattern.test(String(req.params.id)))
      return unavailable;
    await tx.execute(sql`DELETE FROM social_collection_invites WHERE slug = ${board.slug}
    AND id = ${req.params.id} AND used_at IS NULL`);
    return { status: 204 };
  }),
);

boards.all(
  "/:slug/members/:username",
  withBoard("owner", async (tx, board, _viewer, req) => {
    if (board.kind !== "wishlist") return unavailable;
    const username = String(req.params.username);
    const member = sql`slug = ${board.slug} AND user_id = (SELECT user_id FROM social_profiles WHERE username = ${username})`;
    if (req.method === "DELETE") {
      await tx.execute(
        sql`DELETE FROM social_collection_members WHERE ${member}`,
      );
    } else if (req.method === "PUT" && roles.includes(req.body?.role)) {
      await tx.execute(
        sql`UPDATE social_collection_members SET role = ${req.body.role} WHERE ${member}`,
      );
    } else return { status: 400 };
    return { status: 204 };
  }),
);

boards.post("/join", async (req, res) => {
  const viewer = await profileOwner(req, res);
  if (!viewer) return;
  if (!(await featureEnabled("social_wishlists")))
    return void res.sendStatus(503);
  const token = req.body?.token;
  if (typeof token !== "string" || !tokenPattern.test(token))
    return void res.sendStatus(404);
  const hash = tokenHash(token);
  const result = await db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      SELECT b.slug FROM social_collections b
      JOIN social_collection_invites i ON i.slug = b.slug
      WHERE i.token_hash = ${hash} AND b.kind = 'wishlist' FOR UPDATE OF b
    `);
    if (!locked.rows.length) return unavailable;
    const {
      rows: [invite],
    } = await tx.execute<{
      slug: string;
      role: string;
      owner: boolean;
      ownedByViewer: boolean;
      used: boolean;
    }>(sql`
      SELECT b.slug, i.role, b.owner_id = ${viewer} AS owner,
        coalesce(i.used_by = ${viewer}, FALSE) AS "ownedByViewer", i.used_at IS NOT NULL AS used
      FROM social_collection_invites i JOIN social_collections b ON b.slug = i.slug
      JOIN users owner ON owner.id = b.owner_id
      WHERE i.token_hash = ${hash} AND NOT owner.banned AND ${notBlocked(viewer)}
        AND (i.used_at IS NOT NULL OR i.expires_at > now())
    `);
    if (!invite || invite.owner || (invite.used && !invite.ownedByViewer))
      return unavailable;
    const member = await tx.execute(
      sql`SELECT 1 FROM social_collection_members WHERE slug = ${invite.slug} AND user_id = ${viewer}`,
    );
    if (invite.used && !member.rows.length) return unavailable;
    if (!invite.used) {
      const profile = await tx.execute(
        sql`SELECT 1 FROM social_profiles WHERE user_id = ${viewer}`,
      );
      if (!profile.rows.length)
        return {
          status: 403,
          body: {
            error:
              "Set up your social profile first, then reopen the invitation.",
          },
        };
      await tx.execute(sql`INSERT INTO social_collection_members (slug, user_id, role)
        VALUES (${invite.slug}, ${viewer}, ${invite.role}) ON CONFLICT DO NOTHING`);
      await tx.execute(
        sql`UPDATE social_collection_invites SET used_by = ${viewer}, used_at = now() WHERE token_hash = ${hash}`,
      );
    }
    return { status: 200, body: { slug: invite.slug } };
  });
  res.status(result.status).json(result.body);
});

router.get("/seo/collection-sitemap.xml", async (_req, res) => {
  const [social, collections] = await Promise.all([
    featureEnabled("social"),
    featureEnabled("social_collections"),
  ]);
  const rows =
    social && collections
      ? (
          await db.execute<{ slug: string }>(sql`
    SELECT b.slug FROM social_collections b JOIN users u ON u.id = b.owner_id
    WHERE b.is_public AND NOT u.banned ORDER BY b.created_at DESC LIMIT 10000
  `)
        ).rows
      : [];
  const entries = rows
    .filter((row) => slugPattern.test(row.slug))
    .map(
      ({ slug }) =>
        `<url><loc>https://www.bazunk.com/collections/${slug}</loc></url>`,
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
