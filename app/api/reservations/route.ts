import { database, ensureSchema } from '@/app/lib/database';
import { verifyGoogleToken } from '@/app/lib/google';
export async function POST(request: Request) {
  try {
    const body = await request.json() as { credential?:string; slotId?:string; partySize?:number };
    if (!body.credential || !body.slotId || !Number.isInteger(body.partySize) || body.partySize! < 1 || body.partySize! > 10) return Response.json({ error:'Invalid reservation' }, { status:400 });
    const user = await verifyGoogleToken(body.credential); await ensureSchema(); const db = database();
    const slot = await db.prepare('SELECT id, starts_at, ends_at, capacity, is_open FROM slots WHERE id = ?').bind(body.slotId).first<{id:string; starts_at:string; ends_at:string; capacity:number; is_open:number}>();
    if (!slot || !slot.is_open || slot.ends_at < new Date().toISOString()) return Response.json({ error:'This slot is unavailable' }, { status:409 });
    const id = crypto.randomUUID();
    try { await db.prepare(`INSERT INTO reservations (id, slot_id, google_subject, guest_name, guest_email, party_size, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?)`).bind(id, body.slotId, user.sub, user.name, user.email, body.partySize, new Date().toISOString()).run(); }
    catch (error) { const msg = error instanceof Error ? error.message : ''; if (msg.includes('slot_full')) return Response.json({ error:'That slot just filled up. Please choose another time.' }, { status:409 }); if (msg.includes('UNIQUE')) return Response.json({ error:'You already have a reservation for this time.' }, { status:409 }); throw error; }
    return Response.json({ reservation:{ id, startsAt:slot.starts_at, partySize:body.partySize, guestName:user.name } }, { status:201 });
  } catch (error) { const msg = error instanceof Error ? error.message : 'Could not reserve'; return Response.json({ error:msg }, { status:msg.includes('Google') ? 401 : 500 }); }
}
