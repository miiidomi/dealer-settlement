CREATE TABLE `billings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`merchant_id` integer NOT NULL,
	`billing_month` text NOT NULL,
	`billing_amount` integer DEFAULT 0 NOT NULL,
	`rental_revenue` integer DEFAULT 0 NOT NULL,
	`cancellation_revenue` integer DEFAULT 0 NOT NULL,
	`other_revenue` integer DEFAULT 0 NOT NULL,
	`purchase_type` text NOT NULL,
	`installment_months` integer,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_billings_merchant_month` ON `billings` (`merchant_id`,`billing_month`);--> statement-breakpoint
CREATE TABLE `dealer_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dealer_id` integer NOT NULL,
	`effective_from` text NOT NULL,
	`cost_share_rate` real NOT NULL,
	`profit_share_rate` real NOT NULL,
	`vat_separate` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`dealer_id`) REFERENCES `dealers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_dealer_rules_dealer_effective` ON `dealer_rules` (`dealer_id`,`effective_from`);--> statement-breakpoint
CREATE TABLE `dealers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `installations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`merchant_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`unit_cost_snapshot` integer NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_installations_merchant` ON `installations` (`merchant_id`);--> statement-breakpoint
CREATE TABLE `merchants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`business_number` text NOT NULL,
	`dealer_id` integer NOT NULL,
	`install_date` text NOT NULL,
	FOREIGN KEY (`dealer_id`) REFERENCES `dealers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_merchants_dealer_install` ON `merchants` (`dealer_id`,`install_date`);--> statement-breakpoint
CREATE TABLE `product_costs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`unit_cost` integer NOT NULL,
	`effective_from` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_product_costs_product_effective` ON `product_costs` (`product_id`,`effective_from`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
