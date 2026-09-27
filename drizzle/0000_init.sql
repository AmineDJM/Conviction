CREATE TABLE `analysis_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`company_id` text NOT NULL,
	`mode` text NOT NULL,
	`kind` text DEFAULT 'DECK' NOT NULL,
	`status` text NOT NULL,
	`depth` text,
	`model` text NOT NULL,
	`prompt_versions` text NOT NULL,
	`registry_id` text NOT NULL,
	`budget_usd` real NOT NULL,
	`spent_usd` real DEFAULT 0 NOT NULL,
	`progress` text NOT NULL,
	`error` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runs_company_idx` ON `analysis_runs` (`company_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`target` text,
	`detail` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_ws_idx` ON `audit_log` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`context_company_id` text,
	`citations` text,
	`plan` text,
	`cost_usd` real,
	`latency_ms` integer,
	`first_token_ms` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `chat_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_thread_idx` ON `chat_messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `chat_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chunks` (
	`rowid` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`company_id` text,
	`version_id` text,
	`kind` text NOT NULL,
	`ref_id` text,
	`title` text NOT NULL,
	`text` text NOT NULL,
	`href` text,
	`evidence_label` text,
	`text_hash` text NOT NULL,
	`embedding` blob,
	`embedding_model` text,
	`embedding_dim` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chunks_id_unique` ON `chunks` (`id`);--> statement-breakpoint
CREATE INDEX `chunks_ws_company_idx` ON `chunks` (`workspace_id`,`company_id`);--> statement-breakpoint
CREATE INDEX `chunks_kind_idx` ON `chunks` (`workspace_id`,`kind`);--> statement-breakpoint
CREATE INDEX `chunks_hash_idx` ON `chunks` (`workspace_id`,`text_hash`);--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`norm_name` text NOT NULL,
	`slug` text NOT NULL,
	`current_version_id` text,
	`one_liner` text,
	`sector` text,
	`stage` text,
	`country` text,
	`peer_group` text,
	`decision_status` text,
	`ic_decision` text DEFAULT 'PENDING' NOT NULL,
	`execution_status` text DEFAULT 'NOT_STARTED' NOT NULL,
	`exceptional_strength` text,
	`oqi` real,
	`oqi_lower` real,
	`oqi_upper` real,
	`oqi_coverage` real,
	`evidence` text,
	`evidence_index` real,
	`power_law` real,
	`risk_headline` text,
	`risk_index` real,
	`fund_fit` real,
	`mandate` text,
	`round_usd` real,
	`post_money_usd` real,
	`base_moic` real,
	`analysis_depth` text,
	`analysis_mode` text,
	`status` text DEFAULT 'PROCESSING' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `companies_ws_idx` ON `companies` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `companies_slug_idx` ON `companies` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE TABLE `company_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`run_id` text,
	`registry_id` text NOT NULL,
	`fund_profile_id` text NOT NULL,
	`canonical` text NOT NULL,
	`derived` text NOT NULL,
	`reason` text NOT NULL,
	`summary` text,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `versions_company_no_idx` ON `company_versions` (`company_id`,`version_no`);--> statement-breakpoint
CREATE TABLE `cost_records` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`run_id` text,
	`scope` text NOT NULL,
	`step` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`reasoning_tokens` integer DEFAULT 0 NOT NULL,
	`web_searches` integer DEFAULT 0 NOT NULL,
	`tool_calls` integer DEFAULT 0 NOT NULL,
	`estimated_usd` real NOT NULL,
	`actual_usd` real NOT NULL,
	`latency_ms` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cost_run_idx` ON `cost_records` (`run_id`);--> statement-breakpoint
CREATE INDEX `cost_ws_idx` ON `cost_records` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `document_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`company_id` text NOT NULL,
	`page_no` integer NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pages_doc_idx` ON `document_pages` (`document_id`,`page_no`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`company_id` text NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`kind` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`storage_path` text NOT NULL,
	`pages` integer,
	`text_chars` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`norm_name` text NOT NULL,
	`company_id` text,
	`aliases` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entities_norm_idx` ON `entities` (`workspace_id`,`norm_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `entities_unique_idx` ON `entities` (`workspace_id`,`type`,`norm_name`);--> statement-breakpoint
CREATE TABLE `fund_knowledge` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`provenance` text NOT NULL,
	`source_ref` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `fk_ws_idx` ON `fund_knowledge` (`workspace_id`,`kind`);--> statement-breakpoint
CREATE TABLE `funds` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`profile` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `history_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`company_id` text NOT NULL,
	`version_id` text,
	`type` text NOT NULL,
	`summary` text NOT NULL,
	`payload` text,
	`actor_user_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `history_company_idx` ON `history_events` (`company_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ic_members` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`norm_name` text NOT NULL,
	`role` text NOT NULL,
	`bio` text,
	`focus` text NOT NULL,
	`documented_preferences` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ic_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`member_id` text NOT NULL,
	`meeting_id` text,
	`company_id` text,
	`kind` text NOT NULL,
	`statement` text NOT NULL,
	`quote` text,
	`topic` text,
	`provenance` text NOT NULL,
	`observed_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `ic_members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `icobs_member_idx` ON `ic_observations` (`member_id`);--> statement-breakpoint
CREATE TABLE `meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`held_at` text NOT NULL,
	`company_id` text,
	`transcript` text,
	`notes` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`user_id`, `workspace_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `memory_packs` (
	`company_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`version_id` text NOT NULL,
	`pack` text NOT NULL,
	`text` text NOT NULL,
	`token_estimate` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `metric_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`company_id` text NOT NULL,
	`version_id` text NOT NULL,
	`metric_id` text NOT NULL,
	`metric_key` text NOT NULL,
	`value` real,
	`unit` text NOT NULL,
	`state` text NOT NULL,
	`verification` text NOT NULL,
	`calculation_method` text NOT NULL,
	`period_end` text,
	`sample_size` integer,
	`flags` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `facts_key_idx` ON `metric_facts` (`workspace_id`,`metric_key`,`value`);--> statement-breakpoint
CREATE INDEX `facts_company_idx` ON `metric_facts` (`company_id`);--> statement-breakpoint
CREATE TABLE `relations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`from_entity` text NOT NULL,
	`to_entity` text NOT NULL,
	`type` text NOT NULL,
	`company_id` text,
	`source_ref` text,
	`note` text,
	FOREIGN KEY (`from_entity`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_entity`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rel_from_idx` ON `relations` (`from_entity`);--> statement-breakpoint
CREATE INDEX `rel_to_idx` ON `relations` (`to_entity`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`version_id` text NOT NULL,
	`run_id` text,
	`kind` text NOT NULL,
	`registry_id` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
