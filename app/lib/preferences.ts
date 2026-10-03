import { database } from './database';

// 'none' is always allowed; any other dish must be served by the reservation's slot.
export async function validPreference(p: unknown, slotId: string) {
  if (p === 'none') return true;
  if (typeof p !== 'string') return false;
  const match = await database().prepare('SELECT option_id FROM slot_menu_options WHERE slot_id = ? AND option_id = ?').bind(slotId, p).first<{ option_id:string }>();
  return Boolean(match);
}

export async function savePreferences(reservationId: string, preferences: string[]) {
  const db = database();
  await db.prepare('DELETE FROM reservation_preferences WHERE reservation_id = ?').bind(reservationId).run();
  await db.batch(preferences.map((p, i) => db.prepare('INSERT INTO reservation_preferences (id, reservation_id, seat_index, preference) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), reservationId, i, p)));
}

// Seat choices whose dish is no longer served by their slot (removed from the library or
// from that day's menu) fall back to 'none' so guests and the chef don't see a stale value.
export async function resetStalePreferences() {
  await database().prepare(`UPDATE reservation_preferences SET preference = 'none' WHERE preference <> 'none' AND NOT EXISTS (SELECT 1 FROM reservations r JOIN slot_menu_options sm ON sm.slot_id = r.slot_id AND sm.option_id = reservation_preferences.preference WHERE r.id = reservation_preferences.reservation_id)`).bind().run();
}
