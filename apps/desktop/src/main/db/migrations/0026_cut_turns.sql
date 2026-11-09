CREATE TABLE `cut_life` (
	`conversation_id` text PRIMARY KEY NOT NULL,
	`record` text NOT NULL,
	`since` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cut_turn` (
	`id` text PRIMARY KEY NOT NULL,
	`record` text NOT NULL,
	`at` integer NOT NULL
);
