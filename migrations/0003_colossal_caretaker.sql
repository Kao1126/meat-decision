ALTER TABLE `dishes` ADD `source` text DEFAULT 'home' NOT NULL;--> statement-breakpoint
ALTER TABLE `dishes` ADD `weekend_only` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `suggestion_sets` ADD `source` text;