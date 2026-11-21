CREATE TABLE `table_wagers` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`game` text NOT NULL,
	`round_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`closed_at` integer,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `table_wagers_status_idx` ON `table_wagers` (`status`,`created_at`);