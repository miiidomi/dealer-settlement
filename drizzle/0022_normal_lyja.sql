CREATE TABLE `cancellation_penalties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dealer_id` integer NOT NULL,
	`merchant_id` integer NOT NULL,
	`salesforce_case_id` text NOT NULL,
	`case_number` text,
	`status` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`payment_date` text,
	`raw_payment_date` text,
	`last_synced_at` text NOT NULL,
	FOREIGN KEY (`dealer_id`) REFERENCES `dealers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cancellation_penalties_case` ON `cancellation_penalties` (`salesforce_case_id`);--> statement-breakpoint
CREATE INDEX `idx_cancellation_penalties_dealer_date` ON `cancellation_penalties` (`dealer_id`,`payment_date`);--> statement-breakpoint
CREATE INDEX `idx_cancellation_penalties_merchant` ON `cancellation_penalties` (`merchant_id`);--> statement-breakpoint
ALTER TABLE `dealers` ADD `penalty_settlement_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `monthly_settlement_statuses` ADD `paid_snapshot` text;--> statement-breakpoint
ALTER TABLE `monthly_settlement_statuses` ADD `reviewed_snapshot` text;