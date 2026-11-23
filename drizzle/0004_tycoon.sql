CREATE TABLE `casino_constructions` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`level` integer NOT NULL,
	`started_at` integer NOT NULL,
	`ready_at` integer NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `casino_constructions_target_idx` ON `casino_constructions` (`player_id`,`kind`,`target`);--> statement-breakpoint
CREATE INDEX `casino_constructions_ready_idx` ON `casino_constructions` (`player_id`,`ready_at`);--> statement-breakpoint
CREATE TABLE `casino_profiles` (
	`player_id` text PRIMARY KEY NOT NULL,
	`chips` integer DEFAULT 0 NOT NULL,
	`zones` text NOT NULL,
	`games` text NOT NULL,
	`upgrades` text NOT NULL,
	`golden` text NOT NULL,
	`builders` integer DEFAULT 1 NOT NULL,
	`cage_stored` integer DEFAULT 0 NOT NULL,
	`cage_at` integer NOT NULL,
	`rush_until` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chip_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_id` text NOT NULL,
	`amount` integer NOT NULL,
	`type` text NOT NULL,
	`reason` text NOT NULL,
	`balance_after` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chip_transactions_player_idx` ON `chip_transactions` (`player_id`,`id`);--> statement-breakpoint
CREATE TABLE `gem_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`item` text NOT NULL,
	`target` text DEFAULT '' NOT NULL,
	`gems` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`idempotency_key` text NOT NULL,
	`spend_id` text,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`settled_at` integer,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gem_purchases_idempotency_key_unique` ON `gem_purchases` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `gem_purchases_status_idx` ON `gem_purchases` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `gem_purchases_pending_idx` ON `gem_purchases` (`player_id`,`item`,`target`) WHERE status = 'pending';--> statement-breakpoint
DROP INDEX `game_rounds_player_game_idx`;--> statement-breakpoint
ALTER TABLE `game_rounds` ADD `funding` text DEFAULT 'coins' NOT NULL;--> statement-breakpoint
CREATE INDEX `game_rounds_player_game_idx` ON `game_rounds` (`player_id`,`game`,`created_at`,`stake`,`payout`,`funding`);--> statement-breakpoint
-- A table from an earlier, deleted prototype of My Casino.
DROP TABLE IF EXISTS `tycoon_profiles`;
