CREATE TABLE `message_usage` (
	`channel` text NOT NULL,
	`external_id` text NOT NULL,
	`day` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`channel`, `external_id`, `day`)
);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
