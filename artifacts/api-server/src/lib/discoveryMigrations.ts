import { sql } from "drizzle-orm";

export const discoveryMigrations = [
  [
    "social_discovery_preferences",
    sql`CREATE TABLE IF NOT EXISTS social_discovery_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, category TEXT
  )`,
  ],
  [
    "social_placements",
    sql`CREATE TABLE IF NOT EXISTS social_placements (
    id UUID PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('post','short','story','creator')),
    content_id TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('boost','sponsor','feature')),
    label TEXT, starts_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL,
    removed_at TIMESTAMPTZ, CHECK(expires_at > starts_at)
  )`,
  ],
  [
    "social_placements_target_idx",
    sql`CREATE INDEX IF NOT EXISTS social_placements_target_idx
    ON social_placements(kind, content_id, expires_at DESC) WHERE removed_at IS NULL`,
  ],
  [
    "social_challenges",
    sql`CREATE TABLE IF NOT EXISTS social_challenges (
    id UUID PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
    reward INTEGER NOT NULL CHECK(reward BETWEEN 1 AND 100), max_claims INTEGER NOT NULL CHECK(max_claims BETWEEN 1 AND 500),
    starts_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ, CHECK(expires_at > starts_at)
  )`,
  ],
  [
    "social_challenge_claims",
    sql`CREATE TABLE IF NOT EXISTS social_challenge_claims (
    challenge_id UUID REFERENCES social_challenges(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    short_id UUID NOT NULL UNIQUE, claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(challenge_id, user_id)
  )`,
  ],
  [
    "social_creator_awards",
    sql`CREATE TABLE IF NOT EXISTS social_creator_awards (
    id UUID PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES social_creators(user_id) ON DELETE CASCADE,
    credits INTEGER NOT NULL CHECK(credits BETWEEN 1 AND 100), reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  ],
] as const;
