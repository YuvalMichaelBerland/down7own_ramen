import { database } from './database';

export async function validPreference(p: unknown) {
  if (p === 'none') return true;
  if (typeof p !== 'string') return false;
  const match = await database().prepare('SELECT id FROM menu_options WHERE id = ?').bind(p).first<{ id:string }>();
  return Boolean(match);
}

export async function savePreferences(reservationId: string, preferences: string[]) {
  const db = database();
  await db.prepare('DELETE FROM reservation_preferences WHERE reservation_id = ?').bind(reservationId).run();
  await db.batch(preferences.map((p, i) => db.prepare('INSERT INTO reservation_preferences (id, reservation_id, seat_index, preference) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), reservationId, i, p)));
}
