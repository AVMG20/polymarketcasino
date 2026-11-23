CREATE TABLE `casino_cosmetics` (
	`player_id` text NOT NULL,
	`item` text NOT NULL,
	`paid` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`player_id`, `item`),
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `casino_profiles` ADD `avatar` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `casino_profiles` ADD `skins` text DEFAULT '{}' NOT NULL;