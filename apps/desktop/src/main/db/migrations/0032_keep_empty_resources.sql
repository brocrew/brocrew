PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_work_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`role` text NOT NULL,
	`title` text,
	`summary` text,
	`name` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`added_by_session_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `work`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`added_by_session_id`) REFERENCES `provider_session`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "work_resource_role_ck" CHECK("__new_work_resource"."role" IN ('input', 'made')),
	CONSTRAINT "work_resource_sha256_ck" CHECK(length("__new_work_resource"."sha256") = 64 AND "__new_work_resource"."sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "work_resource_bytes_ck" CHECK("__new_work_resource"."bytes" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_work_resource`("id", "work_id", "role", "title", "summary", "name", "sha256", "bytes", "added_by_session_id", "created_at") SELECT "id", "work_id", "role", "title", "summary", "name", "sha256", "bytes", "added_by_session_id", "created_at" FROM `work_resource`;--> statement-breakpoint
DROP TABLE `work_resource`;--> statement-breakpoint
ALTER TABLE `__new_work_resource` RENAME TO `work_resource`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `work_resource_work_idx` ON `work_resource` (`work_id`);