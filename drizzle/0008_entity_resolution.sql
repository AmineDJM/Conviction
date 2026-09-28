DROP INDEX `entities_unique_idx`;--> statement-breakpoint
ALTER TABLE `entities` ADD `resolution_key` text;--> statement-breakpoint
ALTER TABLE `entities` ADD `attributes` text;--> statement-breakpoint
CREATE UNIQUE INDEX `entities_key_idx` ON `entities` (`workspace_id`,`type`,`resolution_key`);