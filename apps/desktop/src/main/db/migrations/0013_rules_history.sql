CREATE TABLE `identity_instruction_next` (
  `id` text PRIMARY KEY NOT NULL,
  `identity_id` text NOT NULL REFERENCES `agent_identity`(`id`) ON DELETE cascade,
  `version` integer NOT NULL,
  `text` text NOT NULL,
  `wrote_it` text NOT NULL,
  `author` text,
  `by` text NOT NULL,
  `conversation_id` text REFERENCES `provider_session`(`id`) ON DELETE set null,
  `said` text,
  `brought_back` integer,
  `created_at` integer NOT NULL,
  CONSTRAINT `identity_instruction_version_ck` CHECK (`version` >= 1),
  CONSTRAINT `identity_instruction_wrote_it_ck` CHECK (`wrote_it` in ('a-person', 'an-agents-proposal', 'relayed-from-user', 'its-creator', 'an-agent-direct')),
  CONSTRAINT `identity_instruction_creator_is_first_ck` CHECK (`wrote_it` <> 'its-creator' or `version` = 1),
  CONSTRAINT `identity_instruction_brought_back_ck` CHECK (`brought_back` is null or (`brought_back` >= 1 and `brought_back` < `version`)),
  CONSTRAINT `identity_instruction_person_said_nothing_ck` CHECK (`wrote_it` <> 'a-person' or (`conversation_id` is null and `said` is null))
);
--> statement-breakpoint
INSERT INTO `identity_instruction_next` (`id`, `identity_id`, `version`, `text`, `wrote_it`, `by`, `conversation_id`, `said`, `brought_back`, `created_at`)
SELECT `id`, `identity_id`, `version`, `text`, `wrote_it`, `by`, `conversation_id`, `said`, `brought_back`, `created_at` FROM `identity_instruction`;
--> statement-breakpoint
DROP TABLE `identity_instruction`;
--> statement-breakpoint
ALTER TABLE `identity_instruction_next` RENAME TO `identity_instruction`;
--> statement-breakpoint
CREATE INDEX `identity_instruction_identity_idx` ON `identity_instruction` (`identity_id`, `version`);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_instruction_version_uq` ON `identity_instruction` (`identity_id`, `version`);
--> statement-breakpoint
CREATE TABLE `identity_instruction_seen` (
  `identity_id` text PRIMARY KEY NOT NULL REFERENCES `agent_identity`(`id`) ON DELETE cascade,
  `seen_through` integer NOT NULL DEFAULT 0,
  CONSTRAINT `identity_instruction_seen_version_ck` CHECK (`seen_through` >= 0)
);
