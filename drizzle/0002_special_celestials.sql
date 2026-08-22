CREATE TABLE `service_days` (
	`day_key` text PRIMARY KEY NOT NULL,
	`actual_attendees` integer NOT NULL,
	`completed_at` text NOT NULL,
	`completed_by` text NOT NULL
);
