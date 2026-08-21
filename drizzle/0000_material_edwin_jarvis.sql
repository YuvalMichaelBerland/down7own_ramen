CREATE TABLE `reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`slot_id` text NOT NULL,
	`google_subject` text NOT NULL,
	`guest_name` text NOT NULL,
	`guest_email` text NOT NULL,
	`party_size` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`slot_id`) REFERENCES `slots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reservations_slot_guest` ON `reservations` (`slot_id`,`google_subject`);--> statement-breakpoint
CREATE TABLE `slots` (
	`id` text PRIMARY KEY NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`capacity` integer NOT NULL,
	`is_open` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_slots_starts_at` ON `slots` (`starts_at`);
--> statement-breakpoint
CREATE INDEX `idx_reservations_slot_status` ON `reservations` (`slot_id`,`status`);
--> statement-breakpoint
CREATE TRIGGER `prevent_slot_overbooking`
BEFORE INSERT ON `reservations`
WHEN NEW.status = 'confirmed' AND (
	SELECT COALESCE(SUM(party_size), 0) + NEW.party_size
	FROM reservations
	WHERE slot_id = NEW.slot_id AND status = 'confirmed'
) > (SELECT capacity FROM slots WHERE id = NEW.slot_id AND is_open = 1)
BEGIN
	SELECT RAISE(ABORT, 'slot_full');
END;
