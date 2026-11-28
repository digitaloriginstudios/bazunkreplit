import { sql } from "drizzle-orm";

export const shortMigrations = [
  [
    "social_shorts",
    sql`CREATE TABLE IF NOT EXISTS social_shorts (
    id UUID PRIMARY KEY, author_id TEXT NOT NULL REFERENCES social_profiles(user_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('short','unboxing')),
    order_id TEXT, stream_uid TEXT UNIQUE, caption TEXT NOT NULL,
    caption_vtt TEXT, captions_ready BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','review','published','rejected','removed','failed')),
    failure TEXT, processing_checked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), published_at TIMESTAMPTZ,
    CHECK ((kind = 'unboxing') = (order_id IS NOT NULL))
  )`,
  ],
  [
    "social_shorts_order_idx",
    sql`CREATE UNIQUE INDEX IF NOT EXISTS social_shorts_order_idx
    ON social_shorts (order_id) WHERE order_id IS NOT NULL AND status IN ('uploading','review','published')`,
  ],
  [
    "social_shorts_feed_idx",
    sql`CREATE INDEX IF NOT EXISTS social_shorts_feed_idx
    ON social_shorts (published_at DESC, id DESC) WHERE status = 'published'`,
  ],
  [
    "social_shorts_author_idx",
    sql`CREATE INDEX IF NOT EXISTS social_shorts_author_idx
    ON social_shorts (author_id, created_at DESC)`,
  ],
  [
    "social_short_products",
    sql`CREATE TABLE IF NOT EXISTS social_short_products (
    short_id UUID REFERENCES social_shorts(id) ON DELETE CASCADE,
    listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE,
    PRIMARY KEY(short_id, listing_id)
  )`,
  ],
  [
    "social_short_reports",
    sql`CREATE TABLE IF NOT EXISTS social_short_reports (
    short_id UUID REFERENCES social_shorts(id) ON DELETE CASCADE,
    reporter_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL CHECK (reason IN ('spam','abuse','copyright','unsafe','other')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), resolved_at TIMESTAMPTZ,
    PRIMARY KEY(short_id, reporter_id)
  )`,
  ],
  [
    "social_short_reports_open_idx",
    sql`CREATE INDEX IF NOT EXISTS social_short_reports_open_idx
    ON social_short_reports(short_id) WHERE resolved_at IS NULL`,
  ],
  [
    "social_short_events",
    sql`CREATE TABLE IF NOT EXISTS social_short_events (
    short_id UUID REFERENCES social_shorts(id) ON DELETE CASCADE,
    viewer_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT CHECK (kind IN ('open','play','complete','product')),
    target INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(short_id, viewer_id, kind, target),
    CHECK ((kind = 'product' AND target > 0) OR (kind <> 'product' AND target = 0))
  )`,
  ],
] as const;
