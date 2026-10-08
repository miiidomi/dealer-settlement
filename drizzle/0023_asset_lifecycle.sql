ALTER TABLE installations ADD COLUMN is_from_asset integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE installations ADD COLUMN asset_lifecycle text;
