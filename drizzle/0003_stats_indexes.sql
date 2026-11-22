DROP INDEX `game_rounds_player_idx`;--> statement-breakpoint
CREATE INDEX `game_rounds_player_game_idx` ON `game_rounds` (`player_id`,`game`,`created_at`,`stake`,`payout`);--> statement-breakpoint
CREATE INDEX `coin_transactions_player_time_idx` ON `coin_transactions` (`player_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `coin_transactions_player_category_idx` ON `coin_transactions` (`player_id`,`category`,`created_at`);