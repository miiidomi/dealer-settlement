PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_dealer_commission_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dealer_id` integer NOT NULL,
	`product_category` text NOT NULL,
	`condition` text DEFAULT '신품' NOT NULL,
	`rental_amount` integer NOT NULL,
	`contract_term_months` integer DEFAULT 36 NOT NULL,
	`commission_amount` integer NOT NULL,
	`effective_from` text NOT NULL,
	FOREIGN KEY (`dealer_id`) REFERENCES `dealers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
DROP TABLE `dealer_commission_rules`;--> statement-breakpoint
ALTER TABLE `__new_dealer_commission_rules` RENAME TO `dealer_commission_rules`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_dealer_commission_rules_dealer_category_effective` ON `dealer_commission_rules` (`dealer_id`,`product_category`,`effective_from`);--> statement-breakpoint
CREATE INDEX `idx_dealer_commission_rules_match` ON `dealer_commission_rules` (`dealer_id`,`product_category`,`condition`,`rental_amount`,`effective_from`);
