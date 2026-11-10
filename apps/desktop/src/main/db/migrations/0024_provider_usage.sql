CREATE TABLE `provider_usage_read_on` (
	`provider` text PRIMARY KEY NOT NULL,
	`tag` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_usage_reading` (
	`provider` text NOT NULL,
	`window` text NOT NULL,
	`position` integer NOT NULL,
	`used_percent` real,
	`resets_at` integer,
	`at` integer NOT NULL,
	`account` text,
	PRIMARY KEY(`provider`, `window`)
);
--> statement-breakpoint
CREATE TABLE `provider_usage_window_seen` (
	`provider` text NOT NULL,
	`window` text NOT NULL,
	`position` integer NOT NULL,
	`first` integer NOT NULL,
	`last` integer NOT NULL,
	PRIMARY KEY(`provider`, `window`)
);
