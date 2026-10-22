CREATE TABLE `identity_method_change` (
  `id` text PRIMARY KEY NOT NULL,
  `identity_id` text NOT NULL REFERENCES `agent_identity`(`id`) ON DELETE cascade,
  `seq` integer NOT NULL,
  `operation` text NOT NULL,
  `source_id` text REFERENCES `identity_method_change`(`id`),
  `target` text NOT NULL,
  `files` text NOT NULL,
  `by` text NOT NULL,
  `outcome` text NOT NULL,
  `actual` text,
  `created_at` integer NOT NULL,
  CONSTRAINT `identity_method_change_sequence_ck` CHECK (`seq` >= 1),
  CONSTRAINT `identity_method_change_operation_ck` CHECK ((`operation` = 'delete' AND `source_id` IS NULL) OR (`operation` = 'undo' AND `source_id` IS NOT NULL)),
  CONSTRAINT `identity_method_change_outcome_ck` CHECK ((`outcome` = 'pending' AND `actual` IS NULL) OR (`outcome` IN ('done', 'partial') AND `actual` IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_method_change_sequence_uq` ON `identity_method_change` (`identity_id`, `seq`);
