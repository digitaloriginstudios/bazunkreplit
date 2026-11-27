import { sql } from "drizzle-orm";

export const creatorMigrations = [
  [
    "social_creators",
    sql`CREATE TABLE IF NOT EXISTS social_creators (
    user_id TEXT PRIMARY KEY REFERENCES social_profiles(user_id) ON DELETE CASCADE,
    clerk_id TEXT NOT NULL UNIQUE,
    slug UUID NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  ],
  [
    "social_creator_posts",
    sql`CREATE TABLE IF NOT EXISTS social_creator_posts (
    id UUID PRIMARY KEY,
    creator_id TEXT NOT NULL REFERENCES social_creators(user_id) ON DELETE CASCADE,
    caption TEXT NOT NULL CHECK (char_length(caption) BETWEEN 1 AND 1000),
    image_url TEXT NOT NULL,
    image_alt TEXT NOT NULL CHECK (char_length(image_alt) BETWEEN 1 AND 160),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  ],
  [
    "social_creator_posts_latest_idx",
    sql`CREATE INDEX IF NOT EXISTS social_creator_posts_latest_idx
    ON social_creator_posts(created_at DESC, id)`,
  ],
  [
    "social_creator_posts_author_idx",
    sql`CREATE INDEX IF NOT EXISTS social_creator_posts_author_idx
    ON social_creator_posts(creator_id, created_at DESC, id)`,
  ],
  [
    "social_creator_products",
    sql`CREATE TABLE IF NOT EXISTS social_creator_products (
    post_id UUID REFERENCES social_creator_posts(id) ON DELETE CASCADE,
    listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE,
    PRIMARY KEY(post_id, listing_id)
  )`,
  ],
] as const;
