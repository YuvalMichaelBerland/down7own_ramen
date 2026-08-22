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

let schemaReady: Promise<void> | undefined;
export function ensureSchema() {
  schemaReady ??= (async () => {
    const d = database();
    await d.batch([
      d.prepare('PRAGMA foreign_keys = ON').bind(),
      d.prepare(`CREATE TABLE IF NOT EXISTS slots (id TEXT PRIMARY KEY, starts_at TEXT NOT NULL UNIQUE, ends_at TEXT NOT NULL, capacity INTEGER NOT NULL CHECK (capacity > 0 AND capacity <= 100), is_open INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`).bind(),
      d.prepare(`CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, slot_id TEXT NOT NULL REFERENCES slots(id) ON DELETE CASCADE, google_subject TEXT NOT NULL, guest_name TEXT NOT NULL, guest_email TEXT NOT NULL, party_size INTEGER NOT NULL DEFAULT 1 CHECK (party_size > 0 AND party_size <= 10), status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')), created_at TEXT NOT NULL, UNIQUE(slot_id, google_subject))`).bind(),
      d.prepare(`CREATE INDEX IF NOT EXISTS idx_reservations_slot_status ON reservations(slot_id, status)`).bind(),
      d.prepare(`CREATE TABLE IF NOT EXISTS admins (email TEXT PRIMARY KEY COLLATE NOCASE, added_at TEXT NOT NULL, added_by TEXT NOT NULL)`).bind(),
      d.prepare(`CREATE TABLE IF NOT EXISTS service_days (day_key TEXT PRIMARY KEY, actual_attendees INTEGER NOT NULL CHECK (actual_attendees >= 0), completed_at TEXT NOT NULL, completed_by TEXT NOT NULL)`).bind(),
      d.prepare(`CREATE TRIGGER IF NOT EXISTS prevent_slot_overbooking BEFORE INSERT ON reservations WHEN NEW.status = 'confirmed' AND (SELECT COALESCE(SUM(party_size), 0) + NEW.party_size FROM reservations WHERE slot_id = NEW.slot_id AND status = 'confirmed') > (SELECT capacity FROM slots WHERE id = NEW.slot_id AND is_open = 1) BEGIN SELECT RAISE(ABORT, 'slot_full'); END`).bind(),
    ]);
  })();
  return schemaReady;
}
