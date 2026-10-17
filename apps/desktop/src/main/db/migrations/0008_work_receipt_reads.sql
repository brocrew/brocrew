CREATE INDEX `events_kind_owner_idx` ON `events` (`type`,`session_id`,`generation`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `events_work_piece_idx` ON `events` (`session_id`, CASE WHEN json_valid(`payload`) THEN CASE WHEN json_type(`payload`, '$.piece') = 'text' AND length(CAST(json_extract(`payload`, '$.piece') AS BLOB)) BETWEEN 1 AND 512 THEN json_extract(`payload`, '$.piece') END END, `generation`, `ordinal`) WHERE `type` = 'work_reconciliation';
