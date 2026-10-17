CREATE TABLE `provider_api_key` (
	`provider` text PRIMARY KEY NOT NULL,
	`sealed` text NOT NULL,
	`updated_at` integer NOT NULL
);
