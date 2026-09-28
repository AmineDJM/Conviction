CREATE TABLE `formation_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`company_id` text NOT NULL,
	`version_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`kind` text NOT NULL,
	`variant` text NOT NULL,
	`skills` text NOT NULL,
	`difficulty` real NOT NULL,
	`level` integer NOT NULL,
	`expert` integer DEFAULT false NOT NULL,
	`patterns` text NOT NULL,
	`exercise` text NOT NULL,
	`answer` text NOT NULL,
	`confidence` real NOT NULL,
	`answered_at` text NOT NULL,
	`answer_hash` text NOT NULL,
	`status` text DEFAULT 'ANSWERED' NOT NULL,
	`grade` text,
	`score` real,
	`correct` integer,
	`grade_method` text,
	`grade_cost_usd` real DEFAULT 0 NOT NULL,
	`graded_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `formation_attempts_user_idx` ON `formation_attempts` (`workspace_id`,`user_id`,`answered_at`);--> statement-breakpoint
CREATE INDEX `formation_attempts_company_idx` ON `formation_attempts` (`company_id`,`answered_at`);--> statement-breakpoint
CREATE INDEX `formation_attempts_exercise_idx` ON `formation_attempts` (`user_id`,`exercise_id`);--> statement-breakpoint
CREATE TABLE `formation_mistakes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`company_id` text NOT NULL,
	`kind` text NOT NULL,
	`evidence` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `formation_attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `formation_mistakes_user_idx` ON `formation_mistakes` (`workspace_id`,`user_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `formation_mistakes_attempt_kind_idx` ON `formation_mistakes` (`attempt_id`,`kind`);