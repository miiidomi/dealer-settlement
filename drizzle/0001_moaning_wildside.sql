CREATE TABLE `dealer_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`dealer_id` integer,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`dealer_id`) REFERENCES `dealers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_dealer_members_user` ON `dealer_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_dealer_members_dealer` ON `dealer_members` (`dealer_id`);--> statement-breakpoint
CREATE TABLE `payer_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`merchant_id` integer NOT NULL,
	`payer_number` text NOT NULL,
	`label` text,
	`monthly_charge` integer DEFAULT 0 NOT NULL,
	`billing_type` text DEFAULT 'rental' NOT NULL,
	`installment_months` integer,
	`start_month` text NOT NULL,
	`end_month` text,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payer_accounts_number` ON `payer_accounts` (`payer_number`);--> statement-breakpoint
CREATE INDEX `idx_payer_accounts_merchant` ON `payer_accounts` (`merchant_id`);--> statement-breakpoint
CREATE TABLE `payment_imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dealer_id` integer,
	`file_name` text NOT NULL,
	`imported_by` text NOT NULL,
	`total_rows` integer NOT NULL,
	`matched_rows` integer NOT NULL,
	`unmatched_rows` integer NOT NULL,
	`duplicate_rows` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`dealer_id`) REFERENCES `dealers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_payment_imports_dealer_created` ON `payment_imports` (`dealer_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payer_account_id` integer NOT NULL,
	`merchant_id` integer NOT NULL,
	`billing_month` text NOT NULL,
	`payment_date` text NOT NULL,
	`gross_amount` integer NOT NULL,
	`supply_amount` integer NOT NULL,
	`vat_amount` integer NOT NULL,
	`source_file` text NOT NULL,
	`external_key` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`payer_account_id`) REFERENCES `payer_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_payments_merchant_month` ON `payments` (`merchant_id`,`billing_month`);--> statement-breakpoint
CREATE INDEX `idx_payments_payer_date` ON `payments` (`payer_account_id`,`payment_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payments_external_key` ON `payments` (`external_key`);