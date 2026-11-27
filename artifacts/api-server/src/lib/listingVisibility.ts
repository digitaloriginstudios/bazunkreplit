import { db, listingsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

// Server-side visibility: missing setting means visible; parent OFF overrides children.
export async function categoryVisibility(
  connection: Pick<typeof db, "execute"> = db,
) {
  await connection.execute(
    sql`CREATE TABLE IF NOT EXISTS demo_creator_settings (key TEXT PRIMARY KEY, enabled BOOLEAN NOT NULL DEFAULT FALSE)`,
  );
  await connection.execute(sql`CREATE TABLE IF NOT EXISTS demo_listing_registry (
 listing_id INTEGER PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
 seller_email TEXT NOT NULL, region TEXT NOT NULL CHECK(region IN ('uk','us')),
 enabled BOOLEAN NOT NULL DEFAULT TRUE, source_url TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  return sql`NOT EXISTS (SELECT 1 FROM demo_listing_registry d WHERE d.listing_id=${listingsTable.id}
 AND (NOT d.enabled OR NOT COALESCE((SELECT enabled FROM demo_creator_settings WHERE key='master'),FALSE)
 OR NOT COALESCE((SELECT enabled FROM demo_creator_settings WHERE key='listings'),FALSE)))
 AND NOT EXISTS (SELECT 1 FROM site_settings cv WHERE cv.value='false' AND (cv.key='category_visible_' || ${listingsTable.category} OR cv.key='category_visible_' || ${listingsTable.category} || '__' || COALESCE(${listingsTable.subcategory},'')))`;
}
