CREATE TABLE `casino_likes` (
	`owner_id` text NOT NULL,
	`visitor_id` text NOT NULL,
	`day` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`owner_id`, `visitor_id`, `day`),
	FOREIGN KEY (`owner_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`visitor_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
