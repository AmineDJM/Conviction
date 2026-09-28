CREATE TABLE `analysis_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`company_id` text NOT NULL,
	`version_id` text NOT NULL,
	`better_questions` integer NOT NULL,
	`important_risks` integer NOT NULL,
	`missing_evidence` integer NOT NULL,
	`market_insight` integer NOT NULL,
	`minutes_saved` integer,
	`note` text,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analysis_feedback_unique_idx` ON `analysis_feedback` (`version_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `analysis_feedback_ws_idx` ON `analysis_feedback` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `question_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`company_id` text NOT NULL,
	`version_id` text NOT NULL,
	`question_id` text NOT NULL,
	`question_text` text NOT NULL,
	`tier` text NOT NULL,
	`verdict` text NOT NULL,
	`note` text,
	`source` text NOT NULL,
	`meeting_id` text,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_feedback_unique_idx` ON `question_feedback` (`version_id`,`question_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `question_feedback_ws_idx` ON `question_feedback` (`workspace_id`,`created_at`);