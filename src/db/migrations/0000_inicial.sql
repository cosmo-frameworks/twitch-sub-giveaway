CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`giveaway_id` text NOT NULL,
	`platform` text DEFAULT 'twitch' NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`tier` text,
	`weight` integer DEFAULT 1 NOT NULL,
	`event_id` text,
	`gift_index` integer DEFAULT 0 NOT NULL,
	`occurred_at` text NOT NULL,
	`raw_payload` text,
	FOREIGN KEY (`giveaway_id`) REFERENCES `giveaways`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`platform`,`user_id`) REFERENCES `participants`(`platform`,`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entries_event_unique` ON `entries` (`giveaway_id`,`event_id`,`source`,`gift_index`) WHERE "entries"."event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `entries_giveaway_idx` ON `entries` (`giveaway_id`);--> statement-breakpoint
CREATE INDEX `entries_participant_idx` ON `entries` (`giveaway_id`,`platform`,`user_id`);--> statement-breakpoint
CREATE TABLE `giveaways` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`opened_at` text NOT NULL,
	`closed_at` text
);
--> statement-breakpoint
CREATE TABLE `participants` (
	`platform` text DEFAULT 'twitch' NOT NULL,
	`user_id` text NOT NULL,
	`login` text NOT NULL,
	`display_name` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	PRIMARY KEY(`platform`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `processed_events` (
	`message_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`received_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `winners` (
	`id` text PRIMARY KEY NOT NULL,
	`giveaway_id` text NOT NULL,
	`platform` text NOT NULL,
	`user_id` text NOT NULL,
	`position` integer NOT NULL,
	`seed` text NOT NULL,
	`drawn_at` text NOT NULL,
	FOREIGN KEY (`giveaway_id`) REFERENCES `giveaways`(`id`) ON UPDATE no action ON DELETE no action
);
