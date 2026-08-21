import { env } from 'cloudflare:workers';

let schemaReady: Promise<void> | undefined;
export function database() { if (!env.DB) throw new Error('Database binding is unavailable'); return env.DB; }
export function ensureSchema() {
  schemaReady ??= (async () => {
    const db = database();
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS slots (id TEXT PRIMARY KEY, starts_at TEXT NOT NULL UNIQUE, ends_at TEXT NOT NULL, capacity INTEGER NOT NULL CHECK (capacity > 0 AND capacity <= 100), is_open INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, slot_id TEXT NOT NULL REFERENCES slots(id) ON DELETE CASCADE, google_subject TEXT NOT NULL, guest_name TEXT NOT NULL, guest_email TEXT NOT NULL, party_size INTEGER NOT NULL DEFAULT 1 CHECK (party_size > 0 AND party_size <= 10), status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')), created_at TEXT NOT NULL, UNIQUE(slot_id, google_subject))`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_reservations_slot_status ON reservations(slot_id, status)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS admins (email TEXT PRIMARY KEY COLLATE NOCASE, added_at TEXT NOT NULL, added_by TEXT NOT NULL)`),
      db.prepare(`CREATE TRIGGER IF NOT EXISTS prevent_slot_overbooking BEFORE INSERT ON reservations WHEN NEW.status = 'confirmed' AND (SELECT COALESCE(SUM(party_size), 0) + NEW.party_size FROM reservations WHERE slot_id = NEW.slot_id AND status = 'confirmed') > (SELECT capacity FROM slots WHERE id = NEW.slot_id AND is_open = 1) BEGIN SELECT RAISE(ABORT, 'slot_full'); END`),
    ]);
  })();
  return schemaReady;
}
