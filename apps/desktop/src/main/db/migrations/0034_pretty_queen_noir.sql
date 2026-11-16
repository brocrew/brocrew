PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_provider_usage_reading` (
	`provider` text NOT NULL,
	`connection_id` text,
	`window` text NOT NULL,
	`position` integer NOT NULL,
	`used_percent` real,
	`resets_at` integer,
	`at` integer NOT NULL,
	`account` text
);
--> statement-breakpoint
INSERT INTO `__new_provider_usage_reading`("provider", "connection_id", "window", "position", "used_percent", "resets_at", "at", "account") SELECT "provider", NULL, "window", "position", "used_percent", "resets_at", "at", "account" FROM `provider_usage_reading`;--> statement-breakpoint
DROP TABLE `provider_usage_reading`;--> statement-breakpoint
ALTER TABLE `__new_provider_usage_reading` RENAME TO `provider_usage_reading`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `provider_usage_reading_connection_uq` ON `provider_usage_reading` (`provider`,`connection_id`,`window`) WHERE "provider_usage_reading"."connection_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `provider_usage_reading_legacy_uq` ON `provider_usage_reading` (`provider`,`window`) WHERE "provider_usage_reading"."connection_id" IS NULL;--> statement-breakpoint
CREATE TABLE `__new_provider_usage_read_on` (
	`provider` text NOT NULL,
	`connection_id` text,
	`tag` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_provider_usage_read_on`("provider", "connection_id", "tag") SELECT "provider", NULL, "tag" FROM `provider_usage_read_on`;--> statement-breakpoint
DROP TABLE `provider_usage_read_on`;--> statement-breakpoint
ALTER TABLE `__new_provider_usage_read_on` RENAME TO `provider_usage_read_on`;--> statement-breakpoint
CREATE UNIQUE INDEX `provider_usage_read_on_connection_uq` ON `provider_usage_read_on` (`provider`,`connection_id`) WHERE "provider_usage_read_on"."connection_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `provider_usage_read_on_legacy_uq` ON `provider_usage_read_on` (`provider`) WHERE "provider_usage_read_on"."connection_id" IS NULL;