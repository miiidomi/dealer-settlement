ALTER TABLE installations ADD COLUMN is_from_asset_override integer;
--> statement-breakpoint
ALTER TABLE installations ADD COLUMN asset_lifecycle_override text;
