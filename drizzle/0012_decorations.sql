CREATE TABLE `casino_decor` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_id` text NOT NULL,
	`type` text NOT NULL,
	`x` integer,
	`y` integer,
	`special` text,
	`grant_key` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `casino_decor_special_idx` ON `casino_decor` (`player_id`,`special`);--> statement-breakpoint
CREATE UNIQUE INDEX `casino_decor_grant_idx` ON `casino_decor` (`player_id`,`grant_key`);--> statement-breakpoint
ALTER TABLE `casino_profiles` ADD `placements` text DEFAULT '{}' NOT NULL;