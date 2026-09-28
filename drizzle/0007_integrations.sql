CREATE TABLE `integration_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`account_id` text,
	`account_email` text,
	`scopes` text NOT NULL,
	`tokens` blob NOT NULL,
	`access_expires_at` text,
	`refreshed_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`,`workspace_id`) REFERENCES `memberships`(`user_id`,`workspace_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_connections_user_idx` ON `integration_connections` (`workspace_id`,`user_id`,`provider`);--> statement-breakpoint
CREATE TABLE `integration_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`item_id` text NOT NULL,
	`kind` text NOT NULL,
	`company_id` text NOT NULL,
	`meeting_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `integration_imports_ext_idx` ON `integration_imports` (`workspace_id`,`provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `integration_imports_user_idx` ON `integration_imports` (`workspace_id`,`user_id`,`provider`,`created_at`);--> statement-breakpoint
CREATE TABLE `integration_oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`session_hash` text NOT NULL,
	`verifier` blob NOT NULL,
	`redirect_uri` text NOT NULL,
	`return_to` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`,`workspace_id`) REFERENCES `memberships`(`user_id`,`workspace_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `integration_oauth_states_exp_idx` ON `integration_oauth_states` (`expires_at`);