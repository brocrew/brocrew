PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_identity_memory_amendment` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_id` text NOT NULL,
	`seq` integer NOT NULL,
	`provider` text NOT NULL,
	`entry` text NOT NULL,
	`act` text NOT NULL,
	`by` text NOT NULL,
	`text_before` text,
	`text_after` text,
	`created_at` integer NOT NULL,
	`source_id` text,
	`outcome` text DEFAULT 'done' NOT NULL,
	`actual` text,
	`settled_by` text,
	`settled_at` integer,
	FOREIGN KEY (`identity_id`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `identity_memory_amendment`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "identity_memory_amendment_seq_ck" CHECK("__new_identity_memory_amendment"."seq" >= 1),
	CONSTRAINT "identity_memory_amendment_act_ck" CHECK("__new_identity_memory_amendment"."act" in ('removed', 'corrected', 'restored')),
	CONSTRAINT "identity_memory_amendment_after_matches_act_ck" CHECK(("__new_identity_memory_amendment"."act" = 'removed' and "__new_identity_memory_amendment"."text_before" is not null and "__new_identity_memory_amendment"."text_after" is null) or ("__new_identity_memory_amendment"."act" = 'corrected' and "__new_identity_memory_amendment"."text_before" is not null and "__new_identity_memory_amendment"."text_after" is not null) or ("__new_identity_memory_amendment"."act" = 'restored' and "__new_identity_memory_amendment"."text_before" is null and "__new_identity_memory_amendment"."text_after" is not null and "__new_identity_memory_amendment"."source_id" is not null)),
	CONSTRAINT "identity_memory_amendment_source_ck" CHECK("__new_identity_memory_amendment"."source_id" is null or ("__new_identity_memory_amendment"."source_id" <> "__new_identity_memory_amendment"."id" and ("__new_identity_memory_amendment"."act" in ('removed', 'restored') or ("__new_identity_memory_amendment"."act" = 'corrected' and ("__new_identity_memory_amendment"."outcome" = 'pending' or "__new_identity_memory_amendment"."actual" is not null))))),
	CONSTRAINT "identity_memory_amendment_source_person_ck" CHECK("__new_identity_memory_amendment"."source_id" is null or (case when json_valid("__new_identity_memory_amendment"."by") then (coalesce(json_extract("__new_identity_memory_amendment"."by", '$.who'), '') IN ('a-person', 'the-app-itself', 'a-caller-this-app-cannot-name') OR (json_extract("__new_identity_memory_amendment"."by", '$.who') IS 'an-agent' AND json_type("__new_identity_memory_amendment"."by", '$.agent') IS 'text' AND length(json_extract("__new_identity_memory_amendment"."by", '$.agent')) > 0)) else 0 end)),
	CONSTRAINT "identity_memory_amendment_outcome_ck" CHECK("__new_identity_memory_amendment"."outcome" IN ('pending', 'done', 'partial', 'unchanged')),
	CONSTRAINT "identity_memory_amendment_recovery_person_ck" CHECK(("__new_identity_memory_amendment"."outcome" = 'done' AND "__new_identity_memory_amendment"."actual" IS NULL AND "__new_identity_memory_amendment"."settled_by" IS NULL AND "__new_identity_memory_amendment"."settled_at" IS NULL) OR (CASE WHEN json_valid("__new_identity_memory_amendment"."by") THEN (coalesce(json_extract("__new_identity_memory_amendment"."by", '$.who'), '') IN ('a-person', 'the-app-itself', 'a-caller-this-app-cannot-name') OR (json_extract("__new_identity_memory_amendment"."by", '$.who') IS 'an-agent' AND json_type("__new_identity_memory_amendment"."by", '$.agent') IS 'text' AND length(json_extract("__new_identity_memory_amendment"."by", '$.agent')) > 0)) ELSE 0 END)),
	CONSTRAINT "identity_memory_amendment_recovery_ck" CHECK((
  "__new_identity_memory_amendment"."outcome" IN ('pending', 'done') AND "__new_identity_memory_amendment"."actual" IS NULL AND "__new_identity_memory_amendment"."settled_by" IS NULL AND "__new_identity_memory_amendment"."settled_at" IS NULL
) OR (
  "__new_identity_memory_amendment"."outcome" IN ('done', 'partial', 'unchanged') AND "__new_identity_memory_amendment"."actual" IS NOT NULL AND
  "__new_identity_memory_amendment"."settled_by" IS NOT NULL AND "__new_identity_memory_amendment"."settled_at" IS NOT NULL AND
  typeof("__new_identity_memory_amendment"."settled_at") = 'integer' AND "__new_identity_memory_amendment"."settled_at" >= 0 AND "__new_identity_memory_amendment"."settled_at" <= 9007199254740991 AND
  CASE WHEN json_valid("__new_identity_memory_amendment"."actual") THEN
    json_type("__new_identity_memory_amendment"."actual") IS 'object' AND
    CASE json_type("__new_identity_memory_amendment"."actual", '$.fingerprint')
      WHEN 'null' THEN 1
      WHEN 'text' THEN length(json_extract("__new_identity_memory_amendment"."actual", '$.fingerprint')) = 64 AND json_extract("__new_identity_memory_amendment"."actual", '$.fingerprint') NOT GLOB '*[^0-9a-f]*'
      ELSE 0
    END AND
    CASE WHEN json_type("__new_identity_memory_amendment"."actual", '$.unreadable') IS NULL THEN 1
      WHEN json_type("__new_identity_memory_amendment"."actual", '$.unreadable') IS 'true' THEN
        "__new_identity_memory_amendment"."outcome" = 'partial' AND json_type("__new_identity_memory_amendment"."actual", '$.fingerprint') IS 'null'
      ELSE 0
    END
  ELSE 0 END AND
  CASE WHEN json_valid("__new_identity_memory_amendment"."settled_by") THEN
    json_type("__new_identity_memory_amendment"."settled_by") IS 'object' AND (coalesce(json_extract("__new_identity_memory_amendment"."settled_by", '$.who'), '') IN ('a-person', 'the-app-itself', 'a-caller-this-app-cannot-name') OR (json_extract("__new_identity_memory_amendment"."settled_by", '$.who') IS 'an-agent' AND json_type("__new_identity_memory_amendment"."settled_by", '$.agent') IS 'text' AND length(json_extract("__new_identity_memory_amendment"."settled_by", '$.agent')) > 0))
  ELSE 0 END
))
);
--> statement-breakpoint
INSERT INTO `__new_identity_memory_amendment`("id", "identity_id", "seq", "provider", "entry", "act", "by", "text_before", "text_after", "created_at", "source_id", "outcome", "actual", "settled_by", "settled_at") SELECT "id", "identity_id", "seq", "provider", "entry", "act", "by", "text_before", "text_after", "created_at", "source_id", "outcome", "actual", "settled_by", "settled_at" FROM `identity_memory_amendment`;--> statement-breakpoint
DROP TABLE `identity_memory_amendment`;--> statement-breakpoint
ALTER TABLE `__new_identity_memory_amendment` RENAME TO `identity_memory_amendment`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `identity_memory_amendment_identity_idx` ON `identity_memory_amendment` (`identity_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `identity_memory_amendment_seq_uq` ON `identity_memory_amendment` (`identity_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `identity_memory_amendment_one_pending_uq` ON `identity_memory_amendment` (`identity_id`) WHERE "identity_memory_amendment"."outcome" = 'pending';--> statement-breakpoint
CREATE TABLE `__new_identity_method_change` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_id` text NOT NULL,
	`seq` integer NOT NULL,
	`operation` text NOT NULL,
	`source_id` text,
	`target` text NOT NULL,
	`files` text NOT NULL,
	`by` text NOT NULL,
	`outcome` text NOT NULL,
	`actual` text,
	`created_at` integer NOT NULL,
	`settled_by` text,
	`settled_at` integer,
	FOREIGN KEY (`identity_id`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `identity_method_change`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "identity_method_change_sequence_ck" CHECK("__new_identity_method_change"."seq" >= 1),
	CONSTRAINT "identity_method_change_operation_ck" CHECK(("__new_identity_method_change"."operation" = 'delete' AND "__new_identity_method_change"."source_id" IS NULL) OR ("__new_identity_method_change"."operation" = 'undo' AND "__new_identity_method_change"."source_id" IS NOT NULL)),
	CONSTRAINT "identity_method_change_outcome_ck" CHECK(("__new_identity_method_change"."outcome" = 'pending' AND "__new_identity_method_change"."actual" IS NULL) OR ("__new_identity_method_change"."outcome" IN ('done', 'partial') AND "__new_identity_method_change"."actual" IS NOT NULL)),
	CONSTRAINT "identity_method_change_settlement_ck" CHECK(("__new_identity_method_change"."settled_by" IS NULL AND "__new_identity_method_change"."settled_at" IS NULL) OR ("__new_identity_method_change"."settled_by" IS NOT NULL AND "__new_identity_method_change"."settled_at" IS NOT NULL AND "__new_identity_method_change"."outcome" IN ('done', 'partial') AND typeof("__new_identity_method_change"."settled_at") = 'integer' AND "__new_identity_method_change"."settled_at" >= 0 AND "__new_identity_method_change"."settled_at" <= 9007199254740991 AND CASE WHEN json_valid("__new_identity_method_change"."settled_by") THEN (coalesce(json_extract("__new_identity_method_change"."settled_by", '$.who'), '') IN ('a-person', 'the-app-itself', 'a-caller-this-app-cannot-name') OR (json_extract("__new_identity_method_change"."settled_by", '$.who') IS 'an-agent' AND json_type("__new_identity_method_change"."settled_by", '$.agent') IS 'text' AND length(json_extract("__new_identity_method_change"."settled_by", '$.agent')) > 0)) ELSE 0 END))
);
--> statement-breakpoint
INSERT INTO `__new_identity_method_change`("id", "identity_id", "seq", "operation", "source_id", "target", "files", "by", "outcome", "actual", "created_at", "settled_by", "settled_at") SELECT "id", "identity_id", "seq", "operation", "source_id", "target", "files", "by", "outcome", "actual", "created_at", "settled_by", "settled_at" FROM `identity_method_change`;--> statement-breakpoint
DROP TABLE `identity_method_change`;--> statement-breakpoint
ALTER TABLE `__new_identity_method_change` RENAME TO `identity_method_change`;--> statement-breakpoint
CREATE UNIQUE INDEX `identity_method_change_sequence_uq` ON `identity_method_change` (`identity_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `identity_method_change_pending_uq` ON `identity_method_change` (`identity_id`) WHERE `outcome` = 'pending';--> statement-breakpoint
CREATE TABLE `__new_identity_own_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_id` text NOT NULL,
	`version` integer NOT NULL,
	`text` text NOT NULL,
	`author` text,
	`actor` text NOT NULL,
	`reason` text NOT NULL,
	`restored_from_version` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`identity_id`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "identity_own_notes_version_ck" CHECK("__new_identity_own_notes"."version" >= 1),
	CONSTRAINT "identity_own_notes_text_ck" CHECK(length("__new_identity_own_notes"."text") <= 4000 AND instr("__new_identity_own_notes"."text", char(0)) = 0),
	CONSTRAINT "identity_own_notes_reason_ck" CHECK(length(trim("__new_identity_own_notes"."reason")) > 0 AND length("__new_identity_own_notes"."reason") <= 4000),
	CONSTRAINT "identity_own_notes_restore_ck" CHECK("__new_identity_own_notes"."restored_from_version" IS NULL OR ("__new_identity_own_notes"."restored_from_version" >= 0 AND "__new_identity_own_notes"."restored_from_version" < "__new_identity_own_notes"."version")),
	CONSTRAINT "identity_own_notes_actor_ck" CHECK(json_valid("__new_identity_own_notes"."actor") AND coalesce(json_extract("__new_identity_own_notes"."actor", '$.who') IN ('a-person', 'an-agent', 'the-app-itself', 'a-caller-this-app-cannot-name'), 0)),
	CONSTRAINT "identity_own_notes_author_ck" CHECK((json_extract("__new_identity_own_notes"."actor", '$.who') IN ('a-person', 'the-app-itself', 'a-caller-this-app-cannot-name') AND "__new_identity_own_notes"."author" IS NULL) OR (json_extract("__new_identity_own_notes"."actor", '$.who') = 'an-agent' AND ("__new_identity_own_notes"."author" IS NULL OR json_valid("__new_identity_own_notes"."author"))))
);
--> statement-breakpoint
INSERT INTO `__new_identity_own_notes`("id", "identity_id", "version", "text", "author", "actor", "reason", "restored_from_version", "created_at") SELECT "id", "identity_id", "version", "text", "author", "actor", "reason", "restored_from_version", "created_at" FROM `identity_own_notes`;--> statement-breakpoint
DROP TABLE `identity_own_notes`;--> statement-breakpoint
ALTER TABLE `__new_identity_own_notes` RENAME TO `identity_own_notes`;--> statement-breakpoint
CREATE UNIQUE INDEX `identity_own_notes_version_uq` ON `identity_own_notes` (`identity_id`,`version`);