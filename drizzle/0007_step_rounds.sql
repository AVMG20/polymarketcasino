CREATE TABLE `step_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`game` text NOT NULL,
	`bet` integer NOT NULL,
	`stake_chips` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`state` text NOT NULL,
	`step` integer DEFAULT 0 NOT NULL,
	`payout` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`settled_at` integer,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `step_rounds_open_idx` ON `step_rounds` (`player_id`,`game`) WHERE status = 'open';--> statement-breakpoint
CREATE INDEX `step_rounds_status_idx` ON `step_rounds` (`status`,`updated_at`);