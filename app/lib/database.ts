import { createClient, type Client, type InValue } from '@libsql/client';

// Minimal D1-shaped wrapper around libSQL so route handlers (written against
// db.prepare(sql).bind(...).first()/.all()/.run() and db.batch([...])) don't change.
class BoundStatement {
  constructor(protected client: Client, protected sql: string, protected args: InValue[]) {}
  async first<T>() { const r = await this.client.execute({ sql: this.sql, args: this.args }); return (r.rows[0] as unknown as T) ?? null; }
  async all<T>() { const r = await this.client.execute({ sql: this.sql, args: this.args }); return { results: r.rows as unknown as T[] }; }
  async run() { await this.client.execute({ sql: this.sql, args: this.args }); }
  toStatement() { return { sql: this.sql, args: this.args }; }
}
class PreparedStatement extends BoundStatement {
  constructor(client: Client, sql: string) { super(client, sql, []); }
  bind(...args: unknown[]) { return new BoundStatement(this.client, this.sql, args as InValue[]); }
}
class D1LikeDatabase {
  constructor(private client: Client) {}
  prepare(sql: string) { return new PreparedStatement(this.client, sql); }
  async batch(statements: BoundStatement[]) { await this.client.batch(statements.map((s) => s.toStatement())); }
}

let client: Client | undefined;
let db: D1LikeDatabase | undefined;
export function database() {
  if (!process.env.TURSO_DATABASE_URL) throw new Error('Database is unavailable: set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN)');
  client ??= createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  db ??= new D1LikeDatabase(client);
  return db;
}

const RESERVATIONS_TABLE = `CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, slot_id TEXT NOT NULL REFERENCES slots(id) ON DELETE CASCADE, google_subject TEXT NOT NULL, guest_name TEXT NOT NULL, guest_email TEXT NOT NULL, party_size INTEGER NOT NULL DEFAULT 1 CHECK (party_size > 0 AND party_size <= 10), status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')), created_at TEXT NOT NULL, preference TEXT NOT NULL DEFAULT 'none', notes TEXT NOT NULL DEFAULT '')`;
// Partial index: only CONFIRMED reservations block a repeat booking for the same slot+guest,
// so cancelling and re-booking the same slot works instead of hitting a stale UNIQUE violation.
const RESERVATIONS_UNIQUE_INDEX = `CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_slot_guest_active ON reservations(slot_id, google_subject) WHERE status = 'confirmed'`;
const OVERBOOKING_TRIGGER = `CREATE TRIGGER IF NOT EXISTS prevent_slot_overbooking BEFORE INSERT ON reservations WHEN NEW.status = 'confirmed' AND (SELECT COALESCE(SUM(party_size), 0) + NEW.party_size FROM reservations WHERE slot_id = NEW.slot_id AND status = 'confirmed') > (SELECT capacity FROM slots WHERE id = NEW.slot_id AND is_open = 1) BEGIN SELECT RAISE(ABORT, 'slot_full'); END`;
const MESSAGES_TABLE = `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, google_subject TEXT NOT NULL, guest_name TEXT NOT NULL DEFAULT '', guest_email TEXT NOT NULL DEFAULT '', sender TEXT NOT NULL CHECK (sender IN ('guest', 'admin')), body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000), created_at TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0)`;

let schemaReady: Promise<void> | undefined;
export function ensureSchema() {
  schemaReady ??= (async () => {
    const d = database();
    await d.batch([
      d.prepare('PRAGMA foreign_keys = ON').bind(),
      d.prepare(`CREATE TABLE IF NOT EXISTS slots (id TEXT PRIMARY KEY, starts_at TEXT NOT NULL UNIQUE, ends_at TEXT NOT NULL, capacity INTEGER NOT NULL CHECK (capacity > 0 AND capacity <= 100), is_open INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`).bind(),
      d.prepare(RESERVATIONS_TABLE).bind(),
      d.prepare(`CREATE INDEX IF NOT EXISTS idx_reservations_slot_status ON reservations(slot_id, status)`).bind(),
      d.prepare(`CREATE TABLE IF NOT EXISTS reservation_preferences (id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE, seat_index INTEGER NOT NULL, preference TEXT NOT NULL DEFAULT 'none', UNIQUE(reservation_id, seat_index))`).bind(),
      d.prepare(`CREATE TABLE IF NOT EXISTS admins (email TEXT PRIMARY KEY COLLATE NOCASE, added_at TEXT NOT NULL, added_by TEXT NOT NULL)`).bind(),
      d.prepare(`CREATE TABLE IF NOT EXISTS service_days (day_key TEXT PRIMARY KEY, actual_attendees INTEGER NOT NULL CHECK (actual_attendees >= 0), completed_at TEXT NOT NULL, completed_by TEXT NOT NULL)`).bind(),
      d.prepare(`CREATE TABLE IF NOT EXISTS menu_options (id TEXT PRIMARY KEY, label TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`).bind(),
      d.prepare(OVERBOOKING_TRIGGER).bind(),
      d.prepare(`INSERT OR IGNORE INTO menu_options (id, label, sort_order, created_at) VALUES ('chicken', 'עוף', 1, ?)`).bind(new Date().toISOString()),
      d.prepare(`INSERT OR IGNORE INTO menu_options (id, label, sort_order, created_at) VALUES ('vegetarian', 'צמחוני', 2, ?)`).bind(new Date().toISOString()),
    ]);
    for (const alter of [
      `ALTER TABLE reservations ADD COLUMN preference TEXT NOT NULL DEFAULT 'none'`,
      `ALTER TABLE reservations ADD COLUMN notes TEXT NOT NULL DEFAULT ''`,
    ]) { try { await d.prepare(alter).bind().run(); } catch { /* column already exists */ } }

    // Older deployments created `preference` with a hardcoded CHECK, and/or an inline
    // UNIQUE(slot_id, google_subject) that (unlike the partial index above) also blocked
    // re-booking after a cancellation. Rebuild the table without either if still present.
    const def = await d.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reservations'`).bind().first<{ sql: string }>();
    if (def?.sql?.includes("'chicken'") || def?.sql?.includes('UNIQUE(slot_id, google_subject)')) {
      await d.batch([
        d.prepare(RESERVATIONS_TABLE.replace('reservations', 'reservations_new')).bind(),
        d.prepare(`INSERT INTO reservations_new SELECT id, slot_id, google_subject, guest_name, guest_email, party_size, status, created_at, preference, notes FROM reservations`).bind(),
        d.prepare('DROP TABLE reservations').bind(),
        d.prepare('ALTER TABLE reservations_new RENAME TO reservations').bind(),
        d.prepare(`CREATE INDEX IF NOT EXISTS idx_reservations_slot_status ON reservations(slot_id, status)`).bind(),
        d.prepare(OVERBOOKING_TRIGGER).bind(),
      ]);
    }
    await d.prepare(RESERVATIONS_UNIQUE_INDEX).bind().run();

    // Migrate any single-preference reservations (older column) into one seat row each,
    // so the per-seat model has a starting point instead of an empty table.
    const unmigrated = await d.prepare(`SELECT id, party_size, preference FROM reservations WHERE id NOT IN (SELECT DISTINCT reservation_id FROM reservation_preferences)`).bind().all<{ id:string; party_size:number; preference:string }>();
    if (unmigrated.results.length) {
      const seedStatements = unmigrated.results.flatMap((r) => Array.from({ length: r.party_size }, (_, i) =>
        d.prepare('INSERT OR IGNORE INTO reservation_preferences (id, reservation_id, seat_index, preference) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), r.id, i, i === 0 ? r.preference : 'none')));
      await d.batch(seedStatements);
    }

    // messages used to be keyed by reservation_id; guests need a thread even before booking,
    // so it's keyed by google_subject instead. Rebuild if the old shape is still there — this
    // table shipped very recently, so any pre-existing rows are test data, not real messages.
    const messagesDef = await d.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages'`).bind().first<{ sql: string }>();
    if (messagesDef?.sql?.includes('reservation_id')) { await d.prepare('DROP TABLE messages').bind().run(); }
    await d.batch([
      d.prepare(MESSAGES_TABLE).bind(),
      d.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_subject ON messages(google_subject, created_at)`).bind(),
    ]);
  })();
  return schemaReady;
}
