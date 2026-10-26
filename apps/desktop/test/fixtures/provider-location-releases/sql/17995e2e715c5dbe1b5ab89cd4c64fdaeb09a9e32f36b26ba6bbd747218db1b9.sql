CREATE TABLE `provider_model_setting` (
	`provider` text PRIMARY KEY NOT NULL,
	`hand_added` text,
	`last_model` text,
	`last_effort` text,
	`agent_models` text,
	`agent_highest_effort` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `provider_session` ADD `reported_model` text;--> statement-breakpoint
ALTER TABLE `provider_session` ADD `reported_effort` text;