-- Claude's stream fragments go: each message they make up is stored whole, and nothing reads them.
-- Thinking that carries words stays, since nothing else holds them, and so does a malformed frame or
-- a kind this app does not know. The rows after a fragment move down by the fragments before them,
-- so a conversation's ordinals keep only the holes they already had.
CREATE TEMP TABLE `stream_fragment_cleanup` (
	`rid` integer PRIMARY KEY NOT NULL,
	`fragment` integer NOT NULL,
	`ordinal` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `stream_fragment_cleanup` (`rid`, `fragment`, `ordinal`)
SELECT `rid`, `fragment`, `ordinal` - `gone_before`
FROM (
	SELECT `rid`, `fragment`, `ordinal`,
		coalesce(sum(`fragment`) OVER (
			PARTITION BY `session_id`, `generation` ORDER BY `ordinal`
			ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
		), 0) AS `gone_before`
	FROM (
		SELECT `rowid` AS `rid`, `session_id`, `generation`, `ordinal`,
			CASE WHEN `type` = 'unknown' AND json_valid(`payload`)
				THEN coalesce(
					json_extract(`payload`, '$.provider') = 'claude'
					AND json_extract(`payload`, '$.raw.type') = 'stream_event'
					AND json_extract(`payload`, '$.category') <> 'unrecognized'
					AND length(coalesce(json_extract(`payload`, '$.raw.event.delta.thinking'), '')) = 0,
					0
				)
				ELSE 0
			END AS `fragment`
		FROM `events`
	)
)
WHERE `fragment` = 1 OR `gone_before` > 0;
--> statement-breakpoint
DELETE FROM `events`
WHERE `rowid` IN (SELECT `rid` FROM `stream_fragment_cleanup` WHERE `fragment` = 1);
--> statement-breakpoint
UPDATE `events` SET `ordinal` = -1 - `ordinal`
WHERE `rowid` IN (SELECT `rid` FROM `stream_fragment_cleanup` WHERE `fragment` = 0);
--> statement-breakpoint
UPDATE `events`
SET `ordinal` = (
	SELECT `cleanup`.`ordinal` FROM `stream_fragment_cleanup` `cleanup`
	WHERE `cleanup`.`rid` = `events`.`rowid`
)
WHERE `rowid` IN (SELECT `rid` FROM `stream_fragment_cleanup` WHERE `fragment` = 0);
--> statement-breakpoint
DROP TABLE `stream_fragment_cleanup`;
