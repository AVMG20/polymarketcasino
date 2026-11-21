CREATE TABLE `allowance_claims` (
	`player_id` text NOT NULL,
	`day` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`player_id`, `day`),
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `coin_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_id` text NOT NULL,
	`amount` integer NOT NULL,
	`type` text NOT NULL,
	`category` text NOT NULL,
	`refund` integer DEFAULT false NOT NULL,
	`balance_after` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `coin_transactions_player_idx` ON `coin_transactions` (`player_id`,`id`);--> statement-breakpoint
CREATE TABLE `game_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`game` text NOT NULL,
	`stake` integer NOT NULL,
	`payout` integer NOT NULL,
	`summary` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_rounds_player_idx` ON `game_rounds` (`player_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `gem_conversions` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`gems` integer NOT NULL,
	`coins` integer NOT NULL,
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
CREATE UNIQUE INDEX `gem_conversions_idempotency_key_unique` ON `gem_conversions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `gem_conversions_status_idx` ON `gem_conversions` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `launch_tokens` (
	`jti` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `launch_tokens_expires_idx` ON `launch_tokens` (`expires_at`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`image` text,
	`title` text,
	`origin` text DEFAULT 'hub' NOT NULL,
	`coins` integer DEFAULT 0 NOT NULL,
	`peak_coins` integer DEFAULT 0 NOT NULL,
	`stars_reported` integer DEFAULT 0 NOT NULL,
	`stars_seq` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
