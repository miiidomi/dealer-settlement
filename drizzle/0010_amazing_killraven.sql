CREATE TABLE `dealer_commission_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dealer_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`condition` text DEFAULT '신품' NOT NULL,
	`rental_amount_gross` integer NOT NULL,
	`contract_term_months` integer DEFAULT 36 NOT NULL,
	`commission_amount` integer NOT NULL,
	`effective_from` text NOT NULL,
	FOREIGN KEY (`dealer_id`) REFERENCES `dealers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_dealer_commission_rules_dealer_product_effective` ON `dealer_commission_rules` (`dealer_id`,`product_id`,`effective_from`);--> statement-breakpoint
CREATE INDEX `idx_dealer_commission_rules_match` ON `dealer_commission_rules` (`dealer_id`,`product_id`,`condition`,`rental_amount_gross`,`effective_from`);--> statement-breakpoint
CREATE TABLE `dealer_product_costs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dealer_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`unit_cost` integer NOT NULL,
	`condition` text DEFAULT '신품' NOT NULL,
	`effective_from` text NOT NULL,
	FOREIGN KEY (`dealer_id`) REFERENCES `dealers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_dealer_product_costs_dealer_product_effective` ON `dealer_product_costs` (`dealer_id`,`product_id`,`effective_from`);--> statement-breakpoint
CREATE INDEX `idx_dealer_product_costs_dealer_product_condition_effective` ON `dealer_product_costs` (`dealer_id`,`product_id`,`condition`,`effective_from`);--> statement-breakpoint
ALTER TABLE `dealers` ADD `flat_commission_enabled` integer DEFAULT false NOT NULL;