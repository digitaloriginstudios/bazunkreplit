import { sql } from "drizzle-orm";

// Collection references use marketplace IDs so prices and stock always come from listings.
export const collectionMigrations = [
  [
    "social_collections",
    sql`CREATE TABLE IF NOT EXISTS social_collections (
    slug TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES social_profiles(user_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('collection', 'wishlist')),
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
    description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
    cover_url TEXT,
    is_public BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT is_public OR kind = 'collection'),
    occasion TEXT NOT NULL DEFAULT 'general' CHECK (occasion IN ('general', 'christmas', 'birthday', 'wedding')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  ],
  [
    "social_collections_owner_idx",
    sql`CREATE INDEX IF NOT EXISTS social_collections_owner_idx
    ON social_collections (owner_id, created_at DESC)`,
  ],
  [
    "social_collections_public_idx",
    sql`CREATE INDEX IF NOT EXISTS social_collections_public_idx
    ON social_collections (created_at DESC, slug) WHERE is_public`,
  ],
  [
    "social_collection_items",
    sql`CREATE TABLE IF NOT EXISTS social_collection_items (
    slug TEXT REFERENCES social_collections(slug) ON DELETE CASCADE,
    listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (slug, listing_id)
  )`,
  ],
  [
    "social_collection_items_listing_idx",
    sql`CREATE INDEX IF NOT EXISTS social_collection_items_listing_idx
    ON social_collection_items (listing_id)`,
  ],
  [
    "social_collection_follows",
    sql`CREATE TABLE IF NOT EXISTS social_collection_follows (
    slug TEXT REFERENCES social_collections(slug) ON DELETE CASCADE,
    user_id TEXT REFERENCES social_profiles(user_id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, slug)
  )`,
  ],
  [
    "social_collection_follows_slug_idx",
    sql`CREATE INDEX IF NOT EXISTS social_collection_follows_slug_idx
    ON social_collection_follows (slug)`,
  ],
  [
    "social_collection_members",
    sql`CREATE TABLE IF NOT EXISTS social_collection_members (
    slug TEXT REFERENCES social_collections(slug) ON DELETE CASCADE,
    user_id TEXT REFERENCES social_profiles(user_id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
    PRIMARY KEY (slug, user_id)
  )`,
  ],
  [
    "social_collection_members_user_idx",
    sql`CREATE INDEX IF NOT EXISTS social_collection_members_user_idx
    ON social_collection_members (user_id)`,
  ],
  [
    "social_collection_invites",
    sql`CREATE TABLE IF NOT EXISTS social_collection_invites (
    id UUID PRIMARY KEY,
    slug TEXT NOT NULL REFERENCES social_collections(slug) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
    used_by TEXT REFERENCES social_profiles(user_id) ON DELETE SET NULL,
    used_at TIMESTAMPTZ
  )`,
  ],
  [
    "social_collection_invites_slug_idx",
    sql`CREATE INDEX IF NOT EXISTS social_collection_invites_slug_idx
    ON social_collection_invites (slug)`,
  ],
] as const;
