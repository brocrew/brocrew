CREATE TABLE `identity_own_notes` (
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
	CONSTRAINT "identity_own_notes_version_ck" CHECK("identity_own_notes"."version" >= 1),
	CONSTRAINT "identity_own_notes_text_ck" CHECK(length("identity_own_notes"."text") <= 4000 AND instr("identity_own_notes"."text", char(0)) = 0),
	CONSTRAINT "identity_own_notes_reason_ck" CHECK(length(trim("identity_own_notes"."reason")) > 0 AND length("identity_own_notes"."reason") <= 4000),
	CONSTRAINT "identity_own_notes_restore_ck" CHECK("identity_own_notes"."restored_from_version" IS NULL OR ("identity_own_notes"."restored_from_version" >= 0 AND "identity_own_notes"."restored_from_version" < "identity_own_notes"."version")),
	CONSTRAINT "identity_own_notes_actor_ck" CHECK(json_valid("identity_own_notes"."actor") AND coalesce(json_extract("identity_own_notes"."actor", '$.who') IN ('a-person', 'an-agent'), 0)),
	CONSTRAINT "identity_own_notes_author_ck" CHECK((json_extract("identity_own_notes"."actor", '$.who') = 'a-person' AND "identity_own_notes"."author" IS NULL) OR (json_extract("identity_own_notes"."actor", '$.who') = 'an-agent' AND "identity_own_notes"."author" IS NOT NULL AND json_valid("identity_own_notes"."author")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_own_notes_version_uq` ON `identity_own_notes` (`identity_id`,`version`);--> statement-breakpoint
CREATE TABLE `identity_own_notes_seen` (
	`identity_id` text PRIMARY KEY NOT NULL,
	`seen_through` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`identity_id`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "identity_own_notes_seen_ck" CHECK("identity_own_notes_seen"."seen_through" >= 0)
);
