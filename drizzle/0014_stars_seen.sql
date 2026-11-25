ALTER TABLE `players` ADD `stars_seen` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `players` ADD `stars_unseen_bounty` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `players` ADD `stars_pending_level` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `players` ADD `stars_pending_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Every level reported before this column existed counts as seen: no stale celebrations on deploy.
UPDATE `players` SET `stars_seen` = `stars_reported`;
