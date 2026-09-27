CREATE TABLE `llm_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`step` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`output` text NOT NULL,
	`usage` text NOT NULL,
	`hits` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
