import { database, ensureSchema } from '@/app/lib/database';
type SlotRow = { id: string; starts_at: string; ends_at: string; capacity: number; reserved: number };
export async function GET() {
  await ensureSchema();
  const result = await database().prepare(`SELECT s.id, s.starts_at, s.ends_at, s.capacity, COALESCE(SUM(CASE WHEN r.status = 'confirmed' THEN r.party_size ELSE 0 END), 0) AS reserved FROM slots s LEFT JOIN reservations r ON r.slot_id = s.id WHERE s.is_open = 1 AND s.ends_at >= ? GROUP BY s.id ORDER BY s.starts_at ASC LIMIT 60`).bind(new Date().toISOString()).all<SlotRow>();
  return Response.json({ slots: result.results.map((s) => ({ id:s.id, startsAt:s.starts_at, endsAt:s.ends_at, capacity:s.capacity, remaining:Math.max(0, s.capacity - Number(s.reserved)) })) });
}
