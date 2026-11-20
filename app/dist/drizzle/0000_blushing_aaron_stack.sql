CREATE TABLE `capture_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`created_at` text NOT NULL,
	`captured_at` text,
	`count` integer NOT NULL,
	`producer` text NOT NULL,
	`raw_key` text NOT NULL,
	`receipt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `capture_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`label` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE TABLE `capture_items` (
	`id` text PRIMARY KEY NOT NULL,
	`message_ids` text NOT NULL,
	`kind` text NOT NULL,
	`domain` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`due_at` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `capture_items_type_date` ON `capture_items` (`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `capture_items_due` ON `capture_items` (`status`,`due_at`);--> statement-breakpoint
CREATE TABLE `capture_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`body` text NOT NULL,
	`batch_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `capture_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`revision` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capture_version_unique` ON `capture_versions` (`item_id`,`revision`);