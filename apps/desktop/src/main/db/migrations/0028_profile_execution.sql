CREATE TABLE `profile_execution` (
	`identity_id` text PRIMARY KEY NOT NULL,
	`entry` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profile_execution_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`services_off` integer NOT NULL,
	CONSTRAINT "profile_execution_state_one_ck" CHECK("profile_execution_state"."id" = 1),
	CONSTRAINT "profile_execution_state_off_ck" CHECK("profile_execution_state"."services_off" IN (0, 1))
);
