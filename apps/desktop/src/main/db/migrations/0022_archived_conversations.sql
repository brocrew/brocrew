CREATE TABLE `archived_conversation` (
	`conversation_id` text PRIMARY KEY NOT NULL,
	`archived_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `imported_side_file` (
	`name` text PRIMARY KEY NOT NULL
);
