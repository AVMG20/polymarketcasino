CREATE TABLE `casino_history` (
	`player_id` text NOT NULL,
	`hour` integer NOT NULL,
	`tourist_hours` real DEFAULT 0 NOT NULL,
	`regular_hours` real DEFAULT 0 NOT NULL,
	`highroller_hours` real DEFAULT 0 NOT NULL,
	`whale_hours` real DEFAULT 0 NOT NULL,
	`covered_ms` integer DEFAULT 0 NOT NULL,
	`income` integer DEFAULT 0 NOT NULL,
	`lost` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`player_id`, `hour`),
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `casino_profiles` ADD `campaigns` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `casino_profiles` ADD `door` text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE `casino_profiles` ADD `vip` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `casino_profiles` ADD `rules_at` integer;--> statement-breakpoint
-- Decor went from 5 levels to 12 (gated by the rooms): each old level maps to the new level its room allows,
-- with about the same look (decorLook) and no more chips than were spent: 1→2, 2→4, 3→6, 4→9, 5→12.
UPDATE `casino_profiles` SET `upgrades` = json_set(`upgrades`, '$.decor', CASE CAST(json_extract(`upgrades`, '$.decor') AS INTEGER) WHEN 1 THEN 2 WHEN 2 THEN 4 WHEN 3 THEN 6 WHEN 4 THEN 9 ELSE 12 END) WHERE CAST(json_extract(`upgrades`, '$.decor') AS INTEGER) BETWEEN 1 AND 5;--> statement-breakpoint
UPDATE `casino_constructions` SET `level` = CASE `level` WHEN 1 THEN 2 WHEN 2 THEN 4 WHEN 3 THEN 6 WHEN 4 THEN 9 ELSE 12 END WHERE `kind` = 'upgrade' AND `target` = 'decor' AND `level` BETWEEN 1 AND 5;
