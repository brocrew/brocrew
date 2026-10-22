CREATE TABLE `identity_memory_amendment_next` (
  `id` text PRIMARY KEY NOT NULL,
  `identity_id` text NOT NULL REFERENCES `agent_identity`(`id`) ON DELETE cascade,
  `seq` integer NOT NULL,
  `provider` text NOT NULL,
  `entry` text NOT NULL,
  `act` text NOT NULL,
  `by` text NOT NULL,
  `text_before` text,
  `text_after` text,
  `created_at` integer NOT NULL,
  `source_id` text REFERENCES `identity_memory_amendment_next`(`id`),
  `outcome` text DEFAULT 'done' NOT NULL,
  `actual` text,
  `settled_by` text,
  `settled_at` integer,
  CONSTRAINT `identity_memory_amendment_seq_ck` CHECK (`seq` >= 1),
  CONSTRAINT `identity_memory_amendment_act_ck` CHECK (`act` in ('removed', 'corrected', 'restored')),
  CONSTRAINT `identity_memory_amendment_provider_ck` CHECK (`provider` in ('claude', 'codex')),
  CONSTRAINT `identity_memory_amendment_after_matches_act_ck` CHECK (
    (`act` = 'removed' and `text_before` is not null and `text_after` is null) or
    (`act` = 'corrected' and `text_before` is not null and `text_after` is not null) or
    (`act` = 'restored' and `text_before` is null and `text_after` is not null and `source_id` is not null)
  ),
  CONSTRAINT `identity_memory_amendment_source_ck` CHECK (`source_id` is null or (`source_id` <> `id` and (`act` in ('removed', 'restored') or (`act` = 'corrected' and (`outcome` = 'pending' or `actual` is not null))))),
  CONSTRAINT `identity_memory_amendment_source_person_ck` CHECK (`source_id` is null or (case when json_valid(`by`) then json_extract(`by`, '$.who') is 'a-person' else 0 end)),
  CONSTRAINT `identity_memory_amendment_outcome_ck` CHECK (`outcome` IN ('pending', 'done', 'partial', 'unchanged')),
  CONSTRAINT `identity_memory_amendment_recovery_person_ck` CHECK ((`outcome` = 'done' AND `actual` IS NULL AND `settled_by` IS NULL AND `settled_at` IS NULL) OR (CASE WHEN json_valid(`by`) THEN json_extract(`by`, '$.who') IS 'a-person' ELSE 0 END)),
  CONSTRAINT `identity_memory_amendment_recovery_ck` CHECK ((
  `outcome` IN ('pending', 'done') AND `actual` IS NULL AND `settled_by` IS NULL AND `settled_at` IS NULL
) OR (
  `outcome` IN ('done', 'partial', 'unchanged') AND `actual` IS NOT NULL AND
  `settled_by` IS NOT NULL AND `settled_at` IS NOT NULL AND
  typeof(`settled_at`) = 'integer' AND `settled_at` >= 0 AND `settled_at` <= 9007199254740991 AND
  CASE WHEN json_valid(`actual`) THEN
    json_type(`actual`) IS 'object' AND
    CASE json_type(`actual`, '$.fingerprint')
      WHEN 'null' THEN 1
      WHEN 'text' THEN length(json_extract(`actual`, '$.fingerprint')) = 64 AND json_extract(`actual`, '$.fingerprint') NOT GLOB '*[^0-9a-f]*'
      ELSE 0
    END AND
    CASE WHEN json_type(`actual`, '$.unreadable') IS NULL THEN 1
      WHEN json_type(`actual`, '$.unreadable') IS 'true' THEN
        `outcome` = 'partial' AND json_type(`actual`, '$.fingerprint') IS 'null'
      ELSE 0
    END
  ELSE 0 END AND
  CASE WHEN json_valid(`settled_by`) THEN
    json_type(`settled_by`) IS 'object' AND coalesce(json_extract(`settled_by`, '$.who'), '') IN ('a-person', 'the-app-itself')
  ELSE 0 END
))
);
--> statement-breakpoint
INSERT INTO `identity_memory_amendment_next` (`id`, `identity_id`, `seq`, `provider`, `entry`, `act`, `by`, `text_before`, `text_after`, `created_at`, `source_id`, `outcome`)
SELECT `id`, `identity_id`, `seq`, `provider`, `entry`, `act`, `by`, `text_before`, `text_after`, `created_at`, `source_id`, 'done' FROM `identity_memory_amendment`;
--> statement-breakpoint
DROP TABLE `identity_memory_amendment`;
--> statement-breakpoint
ALTER TABLE `identity_memory_amendment_next` RENAME TO `identity_memory_amendment`;
--> statement-breakpoint
CREATE INDEX `identity_memory_amendment_identity_idx` ON `identity_memory_amendment` (`identity_id`, `seq`);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_memory_amendment_seq_uq` ON `identity_memory_amendment` (`identity_id`, `seq`);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_memory_amendment_one_pending_uq` ON `identity_memory_amendment` (`identity_id`) WHERE `outcome` = 'pending';
