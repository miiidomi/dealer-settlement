ALTER TABLE `dealers` ADD `van_settlement_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `dealers` ADD `settlement_list_columns` text;--> statement-breakpoint
ALTER TABLE `dealers` ADD `merchant_detail_fields` text;--> statement-breakpoint
ALTER TABLE `dealers` ADD `merchant_detail_billing_columns` text;--> statement-breakpoint
ALTER TABLE `dealers` ADD `merchant_detail_payer_columns` text;--> statement-breakpoint
ALTER TABLE `dealers` ADD `merchant_detail_installation_columns` text;