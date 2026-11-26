BEGIN;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS marketplace_country TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS delivery_country TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_currency TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS transaction_currency TEXT;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS currency TEXT;
ALTER TABLE flash_sales ADD COLUMN IF NOT EXISTS currency TEXT;
ALTER TABLE classified_ads ADD COLUMN IF NOT EXISTS currency TEXT;
INSERT INTO site_settings(key,value,updated_at) VALUES('feature_global_marketplace','false',NOW()) ON CONFLICT(key) DO NOTHING;
COMMIT;
-- No historical currency or country is inferred. Keep flag disabled until
-- mixed-currency rendering, shipping eligibility and checkout are verified.
