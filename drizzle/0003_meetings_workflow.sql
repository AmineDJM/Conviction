CREATE TABLE `founder_meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`company_id` text NOT NULL,
	`seq` integer NOT NULL,
	`title` text NOT NULL,
	`held_at` text NOT NULL,
	`participants` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`run_id` text,
	`transcript_document_id` text,
	`recording_document_id` text,
	`transcription` text,
	`speaker_names` text NOT NULL,
	`pre_analysis_version_id` text NOT NULL,
	`pre_brief_id` text,
	`post_brief_id` text,
	`post_analysis_version_id` text,
	`extraction` text,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `founder_meetings_seq_idx` ON `founder_meetings` (`company_id`,`seq`);--> statement-breakpoint
CREATE INDEX `founder_meetings_ws_idx` ON `founder_meetings` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `meeting_briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`company_id` text NOT NULL,
	`kind` text NOT NULL,
	`version_id` text NOT NULL,
	`meeting_id` text,
	`builder_version` text NOT NULL,
	`content` text NOT NULL,
	`generation` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `meeting_briefs_version_idx` ON `meeting_briefs` (`version_id`,`kind`);--> statement-breakpoint
CREATE INDEX `meeting_briefs_company_idx` ON `meeting_briefs` (`company_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `meeting_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`idx` integer NOT NULL,
	`speaker` text,
	`start_sec` real,
	`end_sec` real,
	`text` text NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `founder_meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_segments_idx` ON `meeting_segments` (`meeting_id`,`idx`);--> statement-breakpoint
ALTER TABLE `company_versions` ADD `stage` text;--> statement-breakpoint
ALTER TABLE `company_versions` ADD `stage_seq` integer;