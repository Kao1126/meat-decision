CREATE TABLE `suggestion_sets` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`dishes` text NOT NULL,
	`shown` text NOT NULL,
	`slot` text NOT NULL,
	`suggested_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
