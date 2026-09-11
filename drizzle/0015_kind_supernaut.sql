CREATE TABLE `dealer_category_costs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dealer_id` integer NOT NULL,
	`product_category` text NOT NULL,
	`unit_cost` integer NOT NULL,
	`condition` text DEFAULT '신품' NOT NULL,
	`effective_from` text NOT NULL,
	FOREIGN KEY (`dealer_id`) REFERENCES `dealers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_dealer_category_costs_dealer_category_effective` ON `dealer_category_costs` (`dealer_id`,`product_category`,`effective_from`);--> statement-breakpoint
CREATE INDEX `idx_dealer_category_costs_match` ON `dealer_category_costs` (`dealer_id`,`product_category`,`condition`,`effective_from`);