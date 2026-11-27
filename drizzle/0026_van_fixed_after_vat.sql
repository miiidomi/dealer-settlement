ALTER TABLE dealer_rules ADD COLUMN van_fixed_after_vat integer NOT NULL DEFAULT 0 CHECK (van_fixed_after_vat IN (0, 1));
