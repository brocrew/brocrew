CREATE TABLE `skill_catalogue_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	CONSTRAINT "skill_catalogue_state_ck" CHECK("skill_catalogue_state"."id" = 1 AND typeof("skill_catalogue_state"."revision") = 'integer' AND "skill_catalogue_state"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE `skill_current` (
	`id` text PRIMARY KEY NOT NULL,
	`alias` text NOT NULL,
	`current_version` text NOT NULL,
	`active` integer NOT NULL,
	FOREIGN KEY (`id`,`current_version`) REFERENCES `skill_version`(`skill_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "skill_current_active_ck" CHECK("skill_current"."active" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_current_alias_uq` ON `skill_current` (`alias`);--> statement-breakpoint
CREATE TABLE `skill_selection` (
	`identity_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`choice` text NOT NULL,
	FOREIGN KEY (`identity_id`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skill_current`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "skill_selection_choice_ck" CHECK("skill_selection"."choice" IN ('default', 'on', 'off'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_selection_identity_uq` ON `skill_selection` (`identity_id`,`skill_id`);--> statement-breakpoint
CREATE INDEX `skill_selection_skill_idx` ON `skill_selection` (`skill_id`);--> statement-breakpoint
CREATE TABLE `skill_version` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`version_key` text NOT NULL,
	`metadata` text NOT NULL,
	`body` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`plugin_id` text,
	`package_version` text,
	`package_sha256` text,
	`package_manifest_sha256` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "skill_version_metadata_ck" CHECK(json_valid("skill_version"."metadata") AND length(CAST("skill_version"."metadata" AS BLOB)) <= 8192),
	CONSTRAINT "skill_version_bytes_ck" CHECK(typeof("skill_version"."bytes") = 'integer' AND "skill_version"."bytes" BETWEEN 1 AND 65536 AND length(CAST("skill_version"."body" AS BLOB)) = "skill_version"."bytes"),
	CONSTRAINT "skill_version_package_ck" CHECK(("skill_version"."plugin_id" IS NULL AND "skill_version"."package_version" IS NULL AND "skill_version"."package_sha256" IS NULL AND "skill_version"."package_manifest_sha256" IS NULL) OR ("skill_version"."plugin_id" IS NOT NULL AND "skill_version"."package_version" IS NOT NULL AND "skill_version"."package_sha256" IS NOT NULL AND "skill_version"."package_manifest_sha256" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_version_release_uq` ON `skill_version` (`skill_id`,`version_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `skill_version_owner_uq` ON `skill_version` (`skill_id`,`id`);--> statement-breakpoint
CREATE INDEX `skill_version_package_idx` ON `skill_version` (`plugin_id`,`package_version`);--> statement-breakpoint
CREATE TRIGGER `skill_version_no_update` BEFORE UPDATE ON `skill_version` BEGIN SELECT RAISE(ABORT, 'immutable skill version'); END;
--> statement-breakpoint
CREATE TRIGGER `skill_version_no_delete` BEFORE DELETE ON `skill_version` BEGIN SELECT RAISE(ABORT, 'immutable skill version'); END;
