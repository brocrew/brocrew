CREATE TABLE `provider_session_next` (
  `id` text PRIMARY KEY NOT NULL,
  `provider` text NOT NULL,
  `connection_id` text,
  `external_ref` text,
  `launched_as` text,
  `cwd` text NOT NULL,
  `status` text NOT NULL DEFAULT 'idle',
  `approval_mode` text,
  `profile_id` text,
  `reasoning_effort` text,
  `model` text,
  `plan_mode` integer,
  `plan_ended_at` integer,
  `model_or_effort_set_by_a_person_at` integer,
  `reported_model` text,
  `reported_effort` text,
  `adopted_at` integer,
  `restored_at` integer,
  `child_descent` text,
  `agent_identity_id` text,
  `parent_session_id` text,
  `closed_by_the_quit_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`connection_id`) REFERENCES `provider_connection` (`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`agent_identity_id`) REFERENCES `agent_identity` (`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`parent_session_id`) REFERENCES `provider_session` (`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `provider_session_status_ck` CHECK ("status" in ('idle', 'working', 'waiting_permission', 'ended', 'errored')),
  CONSTRAINT `provider_session_approval_mode_ck` CHECK ("approval_mode" is null or "approval_mode" in ('ask', 'auto'))
);
--> statement-breakpoint
INSERT INTO `provider_session_next` (`id`, `provider`, `connection_id`, `external_ref`, `launched_as`, `cwd`, `status`, `approval_mode`, `profile_id`, `reasoning_effort`, `model`, `plan_mode`, `plan_ended_at`, `model_or_effort_set_by_a_person_at`, `reported_model`, `reported_effort`, `adopted_at`, `restored_at`, `child_descent`, `agent_identity_id`, `parent_session_id`, `closed_by_the_quit_at`, `created_at`, `updated_at`)
SELECT `id`, `provider`, `connection_id`, `external_ref`, `launched_as`, `cwd`, `status`, `approval_mode`, `profile_id`, `reasoning_effort`, `model`, `plan_mode`, `plan_ended_at`, `model_or_effort_set_by_a_person_at`, `reported_model`, `reported_effort`, `adopted_at`, `restored_at`, `child_descent`, `agent_identity_id`, `parent_session_id`, `closed_by_the_quit_at`, `created_at`, `updated_at` FROM `provider_session`;
--> statement-breakpoint
DROP TABLE `provider_session`;
--> statement-breakpoint
ALTER TABLE `provider_session_next` RENAME TO `provider_session`;
--> statement-breakpoint
CREATE INDEX `provider_session_status_idx` ON `provider_session` (`status`);
--> statement-breakpoint
CREATE INDEX `provider_session_identity_idx` ON `provider_session` (`agent_identity_id`);
--> statement-breakpoint
CREATE INDEX `provider_session_parent_idx` ON `provider_session` (`parent_session_id`);
--> statement-breakpoint
CREATE INDEX `provider_session_parent_identity_idx` ON `provider_session` (`parent_session_id`, `agent_identity_id`);
--> statement-breakpoint
CREATE INDEX `provider_session_launched_as_idx` ON `provider_session` (`launched_as`);
--> statement-breakpoint
CREATE TABLE `identity_memory_amendment_next` (
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
  `outcome` text NOT NULL DEFAULT 'done',
  `actual` text,
  `settled_by` text,
  `settled_at` integer,
  FOREIGN KEY (`identity_id`) REFERENCES `agent_identity` (`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`source_id`) REFERENCES `identity_memory_amendment` (`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `identity_memory_amendment_seq_ck` CHECK ("seq" >= 1),
  CONSTRAINT `identity_memory_amendment_act_ck` CHECK ("act" in ('removed', 'corrected', 'restored')),
  CONSTRAINT `identity_memory_amendment_after_matches_act_ck` CHECK (("act" = 'removed' and "text_before" is not null and "text_after" is null) or ("act" = 'corrected' and "text_before" is not null and "text_after" is not null) or ("act" = 'restored' and "text_before" is null and "text_after" is not null and "source_id" is not null)),
  CONSTRAINT `identity_memory_amendment_source_ck` CHECK ("source_id" is null or ("source_id" <> "id" and ("act" in ('removed', 'restored') or ("act" = 'corrected' and ("outcome" = 'pending' or "actual" is not null))))),
  CONSTRAINT `identity_memory_amendment_source_person_ck` CHECK ("source_id" is null or (case when json_valid("by") then json_extract("by", '$.who') is 'a-person' else 0 end)),
  CONSTRAINT `identity_memory_amendment_outcome_ck` CHECK ("outcome" IN ('pending', 'done', 'partial', 'unchanged')),
  CONSTRAINT `identity_memory_amendment_recovery_person_ck` CHECK (("outcome" = 'done' AND "actual" IS NULL AND "settled_by" IS NULL AND "settled_at" IS NULL) OR (CASE WHEN json_valid("by") THEN json_extract("by", '$.who') IS 'a-person' ELSE 0 END)),
  CONSTRAINT `identity_memory_amendment_recovery_ck` CHECK ((
  "outcome" IN ('pending', 'done') AND "actual" IS NULL AND "settled_by" IS NULL AND "settled_at" IS NULL
) OR (
  "outcome" IN ('done', 'partial', 'unchanged') AND "actual" IS NOT NULL AND
  "settled_by" IS NOT NULL AND "settled_at" IS NOT NULL AND
  typeof("settled_at") = 'integer' AND "settled_at" >= 0 AND "settled_at" <= 9007199254740991 AND
  CASE WHEN json_valid("actual") THEN
    json_type("actual") IS 'object' AND
    CASE json_type("actual", '$.fingerprint')
      WHEN 'null' THEN 1
      WHEN 'text' THEN length(json_extract("actual", '$.fingerprint')) = 64 AND json_extract("actual", '$.fingerprint') NOT GLOB '*[^0-9a-f]*'
      ELSE 0
    END AND
    CASE WHEN json_type("actual", '$.unreadable') IS NULL THEN 1
      WHEN json_type("actual", '$.unreadable') IS 'true' THEN
        "outcome" = 'partial' AND json_type("actual", '$.fingerprint') IS 'null'
      ELSE 0
    END
  ELSE 0 END AND
  CASE WHEN json_valid("settled_by") THEN
    json_type("settled_by") IS 'object' AND coalesce(json_extract("settled_by", '$.who'), '') IN ('a-person', 'the-app-itself')
  ELSE 0 END
))
);
--> statement-breakpoint
INSERT INTO `identity_memory_amendment_next` (`id`, `identity_id`, `seq`, `provider`, `entry`, `act`, `by`, `text_before`, `text_after`, `created_at`, `source_id`, `outcome`, `actual`, `settled_by`, `settled_at`)
SELECT `id`, `identity_id`, `seq`, `provider`, `entry`, `act`, `by`, `text_before`, `text_after`, `created_at`, `source_id`, `outcome`, `actual`, `settled_by`, `settled_at` FROM `identity_memory_amendment`;
--> statement-breakpoint
DROP TABLE `identity_memory_amendment`;
--> statement-breakpoint
ALTER TABLE `identity_memory_amendment_next` RENAME TO `identity_memory_amendment`;
--> statement-breakpoint
CREATE INDEX `identity_memory_amendment_identity_idx` ON `identity_memory_amendment` (`identity_id`, `seq`);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_memory_amendment_seq_uq` ON `identity_memory_amendment` (`identity_id`, `seq`);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_memory_amendment_one_pending_uq` ON `identity_memory_amendment` (`identity_id`) WHERE "identity_memory_amendment"."outcome" = 'pending';
--> statement-breakpoint
CREATE TEMP TABLE `provider_migration_foreign_keys` (`count` integer CHECK (`count` = 0));
--> statement-breakpoint
INSERT INTO `provider_migration_foreign_keys` SELECT count(*) FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE `provider_migration_foreign_keys`;
