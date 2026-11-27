import { sql } from "drizzle-orm";

export const storyPollMigrations = [
  [
    "social_stories",
    sql`CREATE TABLE IF NOT EXISTS social_stories (
    id UUID PRIMARY KEY,
    seller_id TEXT NOT NULL REFERENCES social_profiles(user_id) ON DELETE CASCADE,
    caption TEXT NOT NULL CHECK (char_length(caption) <= 240),
    media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'embed')),
    media_url TEXT NOT NULL,
    promo_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
  )`,
  ],
  [
    "social_stories_expiry_idx",
    sql`CREATE INDEX IF NOT EXISTS social_stories_expiry_idx ON social_stories(expires_at, created_at DESC)`,
  ],
  [
    "social_stories_seller_idx",
    sql`CREATE INDEX IF NOT EXISTS social_stories_seller_idx ON social_stories(seller_id, created_at DESC)`,
  ],
  [
    "social_story_products",
    sql`CREATE TABLE IF NOT EXISTS social_story_products (
    story_id UUID REFERENCES social_stories(id) ON DELETE CASCADE,
    listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE,
    PRIMARY KEY (story_id, listing_id)
  )`,
  ],
  [
    "social_story_events",
    sql`CREATE TABLE IF NOT EXISTS social_story_events (
    story_id UUID REFERENCES social_stories(id) ON DELETE CASCADE,
    viewer_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT CHECK (kind IN ('view', 'product', 'promo')),
    target INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (story_id, viewer_id, kind, target),
    CHECK ((kind = 'product' AND target > 0) OR (kind <> 'product' AND target = 0))
  )`,
  ],
  [
    "social_polls",
    sql`CREATE TABLE IF NOT EXISTS social_polls (
    id UUID PRIMARY KEY,
    author_id TEXT NOT NULL REFERENCES social_profiles(user_id) ON DELETE CASCADE,
    question TEXT NOT NULL CHECK (char_length(btrim(question)) BETWEEN 1 AND 180),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
  )`,
  ],
  [
    "social_polls_expiry_idx",
    sql`CREATE INDEX IF NOT EXISTS social_polls_expiry_idx ON social_polls(expires_at, created_at DESC)`,
  ],
  [
    "social_poll_options",
    sql`CREATE TABLE IF NOT EXISTS social_poll_options (
    poll_id UUID REFERENCES social_polls(id) ON DELETE CASCADE,
    position SMALLINT CHECK (position BETWEEN 1 AND 4),
    listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
    PRIMARY KEY (poll_id, position),
    UNIQUE (poll_id, listing_id)
  )`,
  ],
  [
    "social_poll_votes",
    sql`CREATE TABLE IF NOT EXISTS social_poll_votes (
    poll_id UUID,
    voter_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    position SMALLINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (poll_id, voter_id),
    FOREIGN KEY (poll_id, position) REFERENCES social_poll_options(poll_id, position) ON DELETE CASCADE
  )`,
  ],
  [
    "social_poll_votes_recent_idx",
    sql`CREATE INDEX IF NOT EXISTS social_poll_votes_recent_idx ON social_poll_votes(created_at DESC, poll_id)`,
  ],
] as const;
