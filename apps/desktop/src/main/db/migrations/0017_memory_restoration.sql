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
  CONSTRAINT `identity_memory_amendment_seq_ck` CHECK (`seq` >= 1),
  CONSTRAINT `identity_memory_amendment_act_ck` CHECK (`act` in ('removed', 'corrected', 'restored')),
  CONSTRAINT `identity_memory_amendment_provider_ck` CHECK (`provider` in ('claude', 'codex')),
  CONSTRAINT `identity_memory_amendment_after_matches_act_ck` CHECK (
    (`act` = 'removed' and `text_before` is not null and `text_after` is null) or
    (`act` = 'corrected' and `text_before` is not null and `text_after` is not null) or
    (`act` = 'restored' and `text_before` is null and `text_after` is not null and `source_id` is not null)
  ),
  CONSTRAINT `identity_memory_amendment_source_ck` CHECK (`source_id` is null or (`source_id` <> `id` and `act` in ('removed', 'restored'))),
  CONSTRAINT `identity_memory_amendment_source_person_ck` CHECK (`source_id` is null or (case when json_valid(`by`) then json_extract(`by`, '$.who') is 'a-person' else 0 end))
);
--> statement-breakpoint
INSERT INTO `identity_memory_amendment_next` (`id`, `identity_id`, `seq`, `provider`, `entry`, `act`, `by`, `text_before`, `text_after`, `created_at`)
SELECT `id`, `identity_id`, `seq`, `provider`, `entry`, `act`, `by`, `text_before`, `text_after`, `created_at` FROM `identity_memory_amendment`;
--> statement-breakpoint
DROP TABLE `identity_memory_amendment`;
--> statement-breakpoint
ALTER TABLE `identity_memory_amendment_next` RENAME TO `identity_memory_amendment`;
--> statement-breakpoint
CREATE INDEX `identity_memory_amendment_identity_idx` ON `identity_memory_amendment` (`identity_id`, `seq`);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_memory_amendment_seq_uq` ON `identity_memory_amendment` (`identity_id`, `seq`);
