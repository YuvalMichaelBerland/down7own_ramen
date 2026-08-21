import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const slots = sqliteTable('slots', {
  id: text('id').primaryKey(), startsAt: text('starts_at').notNull(), endsAt: text('ends_at').notNull(),
  capacity: integer('capacity').notNull(), isOpen: integer('is_open', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
}, (table) => [uniqueIndex('idx_slots_starts_at').on(table.startsAt)]);

export const reservations = sqliteTable('reservations', {
  id: text('id').primaryKey(), slotId: text('slot_id').notNull().references(() => slots.id, { onDelete: 'cascade' }),
  googleSubject: text('google_subject').notNull(), guestName: text('guest_name').notNull(), guestEmail: text('guest_email').notNull(),
  partySize: integer('party_size').notNull().default(1), status: text('status').notNull().default('confirmed'), createdAt: text('created_at').notNull(),
}, (table) => [uniqueIndex('idx_reservations_slot_guest').on(table.slotId, table.googleSubject)]);
