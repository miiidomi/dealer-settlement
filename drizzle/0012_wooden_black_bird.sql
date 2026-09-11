CREATE TABLE `monthly_settlement_statuses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dealer_id` integer NOT NULL,
	`settlement_month` text NOT NULL,
	`settlement_date` text,
	`paid` integer DEFAULT false NOT NULL,
	`tax_invoice_issued_at` text,
	`memo` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`dealer_id`) REFERENCES `dealers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_monthly_settlement_statuses_dealer_month` ON `monthly_settlement_statuses` (`dealer_id`,`settlement_month`);--> statement-breakpoint
CREATE INDEX `idx_monthly_settlement_statuses_dealer` ON `monthly_settlement_statuses` (`dealer_id`);--> statement-breakpoint
ALTER TABLE `dealers` ADD `bank_name` text;--> statement-breakpoint
ALTER TABLE `dealers` ADD `bank_account_number` text;