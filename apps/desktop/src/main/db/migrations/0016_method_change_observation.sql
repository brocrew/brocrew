ALTER TABLE `identity_method_change` ADD `settled_by` text;
--> statement-breakpoint
ALTER TABLE `identity_method_change` ADD `settled_at` integer
  CONSTRAINT `identity_method_change_settlement_ck` CHECK (
    (`settled_by` IS NULL AND `settled_at` IS NULL) OR (
      `settled_by` IS NOT NULL AND `settled_at` IS NOT NULL AND
      `outcome` IN ('done', 'partial') AND typeof(`settled_at`) = 'integer' AND
      `settled_at` >= 0 AND `settled_at` <= 9007199254740991 AND
      CASE WHEN json_valid(`settled_by`) THEN
        coalesce(json_extract(`settled_by`, '$.who'), '') IN ('a-person', 'the-app-itself')
      ELSE 0 END
    )
  );
