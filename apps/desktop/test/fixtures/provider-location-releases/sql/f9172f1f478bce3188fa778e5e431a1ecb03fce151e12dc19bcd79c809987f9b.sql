CREATE TABLE `agent_identity` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`display_name` text,
	`max_depth` integer,
	`can_message` text,
	`can_assign_work` text,
	`can_create_agents` text,
	`can_write_rules` text,
	`provider` text,
	`model_choice` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "agent_identity_slug_folded_ck" CHECK("agent_identity"."slug" = lower("agent_identity"."slug")),
	CONSTRAINT "agent_identity_max_depth_ck" CHECK("agent_identity"."max_depth" IS NULL OR (typeof("agent_identity"."max_depth") = 'integer' AND "agent_identity"."max_depth" BETWEEN 0 AND 64)),
	CONSTRAINT "agent_identity_can_message_ck" CHECK("agent_identity"."can_message" IS NULL OR "agent_identity"."can_message" IN ('none', 'any')),
	CONSTRAINT "agent_identity_can_assign_work_ck" CHECK("agent_identity"."can_assign_work" IS NULL OR "agent_identity"."can_assign_work" IN ('none', 'any')),
	CONSTRAINT "agent_identity_can_create_agents_ck" CHECK("agent_identity"."can_create_agents" IS NULL OR "agent_identity"."can_create_agents" IN ('none', 'any')),
	CONSTRAINT "agent_identity_can_write_rules_ck" CHECK("agent_identity"."can_write_rules" IS NULL OR "agent_identity"."can_write_rules" IN ('none', 'propose', 'relay'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_identity_slug_uq` ON `agent_identity` ("slug" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `app_policy` (
	`id` text PRIMARY KEY NOT NULL,
	`spawning_enabled` integer DEFAULT 1 NOT NULL,
	`default_approval_mode` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT "app_policy_singleton_ck" CHECK("app_policy"."id" = 'policy')
);
--> statement-breakpoint
CREATE TABLE `derived_generation` (
	`session_id` text PRIMARY KEY NOT NULL,
	`active` integer NOT NULL,
	`normalizer_version` integer NOT NULL,
	`derived_through` integer NOT NULL,
	`building` integer,
	`highest` integer NOT NULL,
	`failure` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `provider_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`turn_id` text,
	`generation` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `provider_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`turn_id`) REFERENCES `turn`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_session_ordinal_uq` ON `events` (`session_id`,`generation`,`ordinal`);--> statement-breakpoint
CREATE INDEX `events_session_idx` ON `events` (`session_id`);--> statement-breakpoint
CREATE INDEX `events_turn_idx` ON `events` (`turn_id`);--> statement-breakpoint
CREATE INDEX `events_work_idx` ON `events` (`session_id`,`ordinal`) WHERE "events"."type" IN ('work_given', 'work_replied', 'work_taken_back', 'work_retitled', 'work_status_set', 'work_rebriefed', 'work_closed');--> statement-breakpoint
CREATE INDEX `events_request_routed_idx` ON `events` (`session_id`,`ordinal`) WHERE "events"."type" = 'request_routed';--> statement-breakpoint
CREATE INDEX `events_error_idx` ON `events` (`created_at`) WHERE "events"."type" = 'error';--> statement-breakpoint
CREATE INDEX `events_instruction_ask_idx` ON `events` (`created_at`) WHERE "events"."type" in ('instruction_proposed', 'instruction_settled');--> statement-breakpoint
CREATE INDEX `events_provider_clear_idx` ON `events` (`created_at`) WHERE "events"."type" = 'provider_limit_clear';--> statement-breakpoint
CREATE TABLE `external_mcp_server` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`registered_at` integer NOT NULL,
	`reach` text DEFAULT 'everyone' NOT NULL,
	CONSTRAINT "external_mcp_server_name_folded_ck" CHECK("external_mcp_server"."name" = lower("external_mcp_server"."name"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_mcp_server_name_uq` ON `external_mcp_server` ("name" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `external_mcp_server_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_id` text NOT NULL,
	`server_id` text NOT NULL,
	`granted_at` integer NOT NULL,
	FOREIGN KEY (`identity_id`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `external_mcp_server`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_mcp_server_grant_uq` ON `external_mcp_server_grant` (`identity_id`,`server_id`);--> statement-breakpoint
CREATE INDEX `external_mcp_server_grant_identity_idx` ON `external_mcp_server_grant` (`identity_id`);--> statement-breakpoint
CREATE TABLE `identity_instruction` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_id` text NOT NULL,
	`version` integer NOT NULL,
	`text` text NOT NULL,
	`wrote_it` text NOT NULL,
	`by` text NOT NULL,
	`conversation_id` text,
	`said` text,
	`brought_back` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`identity_id`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `provider_session`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "identity_instruction_version_ck" CHECK("identity_instruction"."version" >= 1),
	CONSTRAINT "identity_instruction_wrote_it_ck" CHECK("identity_instruction"."wrote_it" in ('a-person', 'an-agents-proposal', 'relayed-from-user', 'its-creator')),
	CONSTRAINT "identity_instruction_creator_is_first_ck" CHECK("identity_instruction"."wrote_it" <> 'its-creator' or "identity_instruction"."version" = 1),
	CONSTRAINT "identity_instruction_brought_back_ck" CHECK("identity_instruction"."brought_back" is null or ("identity_instruction"."brought_back" >= 1 and "identity_instruction"."brought_back" < "identity_instruction"."version")),
	CONSTRAINT "identity_instruction_person_said_nothing_ck" CHECK("identity_instruction"."wrote_it" <> 'a-person' or ("identity_instruction"."conversation_id" is null and "identity_instruction"."said" is null))
);
--> statement-breakpoint
CREATE INDEX `identity_instruction_identity_idx` ON `identity_instruction` (`identity_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `identity_instruction_version_uq` ON `identity_instruction` (`identity_id`,`version`);--> statement-breakpoint
CREATE TABLE `identity_memory_amendment` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_id` text NOT NULL,
	`seq` integer NOT NULL,
	`provider` text NOT NULL,
	`entry` text NOT NULL,
	`act` text NOT NULL,
	`by` text NOT NULL,
	`text_before` text NOT NULL,
	`text_after` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`identity_id`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "identity_memory_amendment_seq_ck" CHECK("identity_memory_amendment"."seq" >= 1),
	CONSTRAINT "identity_memory_amendment_act_ck" CHECK("identity_memory_amendment"."act" in ('removed', 'corrected')),
	CONSTRAINT "identity_memory_amendment_provider_ck" CHECK("identity_memory_amendment"."provider" in ('claude', 'codex')),
	CONSTRAINT "identity_memory_amendment_after_matches_act_ck" CHECK(("identity_memory_amendment"."act" = 'removed' and "identity_memory_amendment"."text_after" is null) or ("identity_memory_amendment"."act" = 'corrected' and "identity_memory_amendment"."text_after" is not null))
);
--> statement-breakpoint
CREATE INDEX `identity_memory_amendment_identity_idx` ON `identity_memory_amendment` (`identity_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `identity_memory_amendment_seq_uq` ON `identity_memory_amendment` (`identity_id`,`seq`);--> statement-breakpoint
CREATE TABLE `provider_session` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`external_ref` text,
	`launched_as` text,
	`cwd` text NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`approval_mode` text,
	`profile_id` text,
	`reasoning_effort` text,
	`model` text,
	`plan_mode` integer,
	`plan_ended_at` integer,
	`model_or_effort_set_by_a_person_at` integer,
	`adopted_at` integer,
	`restored_at` integer,
	`child_descent` text,
	`agent_identity_id` text,
	`parent_session_id` text,
	`closed_by_the_quit_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_identity_id`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_session_id`) REFERENCES `provider_session`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "provider_session_provider_ck" CHECK("provider_session"."provider" in ('claude', 'codex')),
	CONSTRAINT "provider_session_status_ck" CHECK("provider_session"."status" in ('idle', 'working', 'waiting_permission', 'ended', 'errored')),
	CONSTRAINT "provider_session_approval_mode_ck" CHECK("provider_session"."approval_mode" is null or "provider_session"."approval_mode" in ('ask', 'auto'))
);
--> statement-breakpoint
CREATE INDEX `provider_session_status_idx` ON `provider_session` (`status`);--> statement-breakpoint
CREATE INDEX `provider_session_identity_idx` ON `provider_session` (`agent_identity_id`);--> statement-breakpoint
CREATE INDEX `provider_session_parent_idx` ON `provider_session` (`parent_session_id`);--> statement-breakpoint
CREATE INDEX `provider_session_parent_identity_idx` ON `provider_session` (`parent_session_id`,`agent_identity_id`);--> statement-breakpoint
CREATE INDEX `provider_session_launched_as_idx` ON `provider_session` (`launched_as`);--> statement-breakpoint
CREATE TABLE `raw_frame` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`format` text NOT NULL,
	`frame` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `provider_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_frame_session_ordinal_uq` ON `raw_frame` (`session_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `raw_frame_session_idx` ON `raw_frame` (`session_id`);--> statement-breakpoint
CREATE TABLE `turn` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`prompt` text NOT NULL,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	`end_reason` text,
	`blocked_at` integer,
	`generation` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `provider_session`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "turn_end_reason_ck" CHECK("turn"."end_reason" is null or "turn"."end_reason" in ('completed', 'failed', 'interrupted', 'ended', 'unknown')),
	CONSTRAINT "turn_closed_with_reason_ck" CHECK(("turn"."closed_at" is null) = ("turn"."end_reason" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `turn_session_ordinal_uq` ON `turn` (`session_id`,`generation`,`ordinal`);--> statement-breakpoint
CREATE INDEX `turn_session_idx` ON `turn` (`session_id`);--> statement-breakpoint
CREATE TABLE `work` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`number` integer NOT NULL,
	`owner_session_id` text NOT NULL,
	`given_by_session_id` text,
	`title` text,
	`brief` text,
	`folder` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `work`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_session_id`) REFERENCES `provider_session`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`given_by_session_id`) REFERENCES `provider_session`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "work_number_ck" CHECK("work"."number" >= 1),
	CONSTRAINT "work_a_root_is_given_by_a_person_ck" CHECK("work"."parent_id" IS NOT NULL OR "work"."given_by_session_id" IS NULL),
	CONSTRAINT "work_a_piece_has_a_title_and_a_brief_ck" CHECK("work"."parent_id" IS NULL OR ("work"."title" IS NOT NULL AND "work"."brief" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_parent_number_uq` ON `work` (`parent_id`,`number`) WHERE "work"."parent_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `work_root_number_uq` ON `work` (`number`) WHERE "work"."parent_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `work_one_root_per_conversation_uq` ON `work` (`owner_session_id`) WHERE "work"."parent_id" IS NULL;--> statement-breakpoint
CREATE INDEX `work_owner_idx` ON `work` (`owner_session_id`);--> statement-breakpoint
CREATE INDEX `work_given_by_idx` ON `work` (`given_by_session_id`);--> statement-breakpoint
CREATE TABLE `work_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`role` text NOT NULL,
	`title` text,
	`summary` text,
	`name` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`added_by_session_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `work`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`added_by_session_id`) REFERENCES `provider_session`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "work_resource_role_ck" CHECK("work_resource"."role" IN ('input', 'made')),
	CONSTRAINT "work_resource_sha256_ck" CHECK(length("work_resource"."sha256") = 64 AND "work_resource"."sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "work_resource_bytes_ck" CHECK("work_resource"."bytes" >= 1)
);
--> statement-breakpoint
CREATE INDEX `work_resource_work_idx` ON `work_resource` (`work_id`);--> statement-breakpoint
CREATE TABLE `work_sequence` (
	`scope` text PRIMARY KEY NOT NULL,
	`last` integer NOT NULL,
	CONSTRAINT "work_sequence_last_ck" CHECK("work_sequence"."last" >= 1)
);
--> statement-breakpoint
--
-- ⚑ The one policy row, written by hand below what drizzle-kit generated: it writes no data rows.
-- Without it `spawnPolicy` reads off and every policy write updates nothing. `updated_at` is the
-- migration's clock and honestly so: nobody has thrown this switch.
--
INSERT OR IGNORE INTO `app_policy` (`id`, `spawning_enabled`, `updated_at`)
VALUES ('policy', 1, cast(strftime('%s', 'now') AS integer) * 1000);
