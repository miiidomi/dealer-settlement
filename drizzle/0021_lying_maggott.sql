DROP INDEX `idx_dealer_commission_rules_match`;--> statement-breakpoint
ALTER TABLE `dealer_commission_rules` ADD `target_type` text DEFAULT 'productCategory' NOT NULL;--> statement-breakpoint
ALTER TABLE `dealer_commission_rules` ADD `product_id` integer REFERENCES products(id);--> statement-breakpoint
CREATE INDEX `idx_dealer_commission_rules_match` ON `dealer_commission_rules` (`dealer_id`,`target_type`,`product_id`,`product_category`,`condition`,`rental_amount`,`effective_from`);