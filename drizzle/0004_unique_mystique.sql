CREATE TABLE `van_settlements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dealer_id` integer NOT NULL,
	`settlement_month` text NOT NULL,
	`van_company` text NOT NULL,
	`transaction_count` integer DEFAULT 0 NOT NULL,
	`payment_amount` integer DEFAULT 0 NOT NULL,
	`van_fee` integer DEFAULT 0 NOT NULL,
	`source_file` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`dealer_id`) REFERENCES `dealers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_van_settlements_dealer_month_company` ON `van_settlements` (`dealer_id`,`settlement_month`,`van_company`);--> statement-breakpoint
CREATE INDEX `idx_van_settlements_dealer_month` ON `van_settlements` (`dealer_id`,`settlement_month`);