ALTER TABLE `advance_payments` ADD `settlement_month` text;--> statement-breakpoint
UPDATE `advance_payments`
SET `settlement_month` = substr(`payment_date`, 1, 7)
WHERE `settlement_month` IS NULL OR `settlement_month` = '';--> statement-breakpoint
CREATE INDEX `idx_advance_payments_dealer_settlement_month` ON `advance_payments` (`dealer_id`,`settlement_month`);
