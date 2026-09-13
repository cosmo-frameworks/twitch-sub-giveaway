CREATE UNIQUE INDEX `winners_draw_unique` ON `winners` (`giveaway_id`,`seed`,`position`);--> statement-breakpoint
CREATE INDEX `winners_giveaway_idx` ON `winners` (`giveaway_id`);