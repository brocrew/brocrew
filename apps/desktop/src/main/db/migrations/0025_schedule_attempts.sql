CREATE TABLE `schedule_attempt` (
	`conversation_id` text PRIMARY KEY NOT NULL,
	`record` text NOT NULL,
	`at` integer NOT NULL
);
