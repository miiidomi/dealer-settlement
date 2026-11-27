ALTER TABLE dealers ADD COLUMN settlement_vat_enabled integer NOT NULL DEFAULT 1 CHECK (settlement_vat_enabled IN (0, 1));
