CREATE TABLE `provider_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`name` text NOT NULL,
	`auth_method` text NOT NULL,
	`credential_source` text NOT NULL,
	`base_url` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`contract_version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "provider_connection_auth_ck" CHECK("provider_connection"."auth_method" IN ('sign-in', 'api-key')),
	CONSTRAINT "provider_connection_source_ck" CHECK(("provider_connection"."auth_method" = 'sign-in' AND "provider_connection"."credential_source" = 'provider-sign-in') OR ("provider_connection"."auth_method" = 'api-key' AND "provider_connection"."credential_source" = 'provider-api-key')),
	CONSTRAINT "provider_connection_enabled_ck" CHECK("provider_connection"."enabled" IN (0, 1)),
	CONSTRAINT "provider_connection_version_ck" CHECK("provider_connection"."contract_version" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_connection_name_uq` ON `provider_connection` (`provider`,"name" COLLATE NOCASE);--> statement-breakpoint
ALTER TABLE `agent_identity` ADD `connection_id` text REFERENCES provider_connection(id);--> statement-breakpoint
ALTER TABLE `provider_session` ADD `connection_id` text REFERENCES provider_connection(id);
--> statement-breakpoint
INSERT INTO `provider_connection` (`id`, `provider`, `name`, `auth_method`, `credential_source`)
VALUES
  ('claude:sign-in', 'claude', 'subscription', 'sign-in', 'provider-sign-in'),
  ('claude:api-key', 'claude', 'API key', 'api-key', 'provider-api-key'),
  ('codex:sign-in', 'codex', 'ChatGPT', 'sign-in', 'provider-sign-in'),
  ('codex:api-key', 'codex', 'API key', 'api-key', 'provider-api-key');
