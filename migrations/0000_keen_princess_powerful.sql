CREATE TABLE `channel_identities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`channel` text NOT NULL,
	`external_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_identities_channel_external` ON `channel_identities` (`channel`,`external_id`);--> statement-breakpoint
CREATE TABLE `dish_ingredients` (
	`dish_id` integer NOT NULL,
	`ingredient_id` integer NOT NULL,
	PRIMARY KEY(`dish_id`, `ingredient_id`),
	FOREIGN KEY (`dish_id`) REFERENCES `dishes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dish_ingredients_ingredient` ON `dish_ingredients` (`ingredient_id`);--> statement-breakpoint
CREATE TABLE `dishes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`cuisine` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`slot` text DEFAULT 'both' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dishes_user_name` ON `dishes` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `ingredients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingredients_user_name` ON `ingredients` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `meals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`dish_id` integer NOT NULL,
	`eaten_on` text NOT NULL,
	`slot` text NOT NULL,
	`rating` integer,
	`logged_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dish_id`) REFERENCES `dishes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "meals_rating_range" CHECK("meals"."rating" IS NULL OR "meals"."rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE INDEX `meals_user_eaten_on` ON `meals` (`user_id`,`eaten_on`);--> statement-breakpoint
CREATE TABLE `preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `preferences_user_kind_value` ON `preferences` (`user_id`,`kind`,`value`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
