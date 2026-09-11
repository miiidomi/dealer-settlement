CREATE TABLE `advance_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dealer_id` integer NOT NULL,
	`payment_date` text NOT NULL,
	`amount` integer NOT NULL,
	`memo` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`dealer_id`) REFERENCES `dealers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_advance_payments_dealer_date` ON `advance_payments` (`dealer_id`,`payment_date`);--> statement-breakpoint
ALTER TABLE `dealers` ADD `salesforce_manager_value` text;--> statement-breakpoint
ALTER TABLE `dealers` ADD `advance_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `merchants` ADD `account_status` text;