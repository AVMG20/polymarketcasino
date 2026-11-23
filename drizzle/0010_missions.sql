CREATE TABLE `daily_missions` (
	`player_id` text NOT NULL,
	`day` text NOT NULL,
	`mission` text NOT NULL,
	`slot` integer NOT NULL,
	`target` integer NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`reward` integer NOT NULL,
	`claimed_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`player_id`, `day`, `mission`),
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `casino_profiles` ADD `last_seen_at` integer;--> statement-breakpoint
ALTER TABLE `casino_profiles` ADD `last_seen` text;