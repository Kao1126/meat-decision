DROP INDEX `dishes_user_name`;--> statement-breakpoint
CREATE UNIQUE INDEX `dishes_user_name` ON `dishes` (`user_id`,lower("name"));