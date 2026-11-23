DROP INDEX `game_rounds_player_game_idx`;--> statement-breakpoint
ALTER TABLE `game_rounds` ADD `stake_chips` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `game_rounds` SET `stake_chips` = `stake` WHERE `funding` = 'chips';--> statement-breakpoint
CREATE INDEX `game_rounds_player_game_idx` ON `game_rounds` (`player_id`,`game`,`created_at`,`stake`,`stake_chips`,`payout`);--> statement-breakpoint
ALTER TABLE `table_wagers` ADD `amount_chips` integer DEFAULT 0 NOT NULL;