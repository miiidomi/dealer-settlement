ALTER TABLE dealer_rules ADD COLUMN van_fixed_amount integer;
ALTER TABLE dealer_rules ADD COLUMN van_share_rate real;
ALTER TABLE dealer_rules ADD COLUMN van_combine_july_august integer NOT NULL DEFAULT 0;
