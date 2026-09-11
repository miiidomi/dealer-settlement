ALTER TABLE `installations` ADD `unit_cost_overridden` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `installations` SET `unit_cost_overridden` = 1 WHERE `source` = 'manual-excel';
