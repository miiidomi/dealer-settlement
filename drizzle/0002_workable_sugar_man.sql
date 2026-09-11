ALTER TABLE `installations` ADD `salesforce_line_item_id` text;--> statement-breakpoint
ALTER TABLE `installations` ADD `salesforce_case_id` text;--> statement-breakpoint
ALTER TABLE `installations` ADD `contract_install_at` text;--> statement-breakpoint
ALTER TABLE `installations` ADD `condition` text DEFAULT '신품' NOT NULL;--> statement-breakpoint
ALTER TABLE `installations` ADD `van` text;--> statement-breakpoint
ALTER TABLE `installations` ADD `transaction_classification` text;--> statement-breakpoint
ALTER TABLE `installations` ADD `fixing` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `installations` ADD `incentive` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `installations` ADD `source` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `installations` ADD `last_synced_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_installations_salesforce_line_item_id` ON `installations` (`salesforce_line_item_id`);--> statement-breakpoint
ALTER TABLE `merchants` ADD `salesforce_id` text;--> statement-breakpoint
ALTER TABLE `merchants` ADD `last_synced_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_merchants_salesforce_id` ON `merchants` (`salesforce_id`);--> statement-breakpoint
ALTER TABLE `product_costs` ADD `condition` text DEFAULT '신품' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_product_costs_product_condition_effective` ON `product_costs` (`product_id`,`condition`,`effective_from`);