import { database, ensureSchema } from '@/app/lib/database';
import { verifySession } from '@/app/lib/session';

type ReservationRow = { id:string; slot_id:string; party_size:number; status:string; starts_at:string; ends_at:string; preference:string; notes:string };

function bearer(request: Request) { return request.headers.get('authorization')?.replace(/^Bearer\s+/i, ''); }
async function validPreference(p: unknown) {
  if (p === 'none') return true;
  if (typeof p !== 'string') return false;
  const match = await database().prepare('SELECT id FROM menu_options WHERE id = ?').bind(p).first<{ id:string }>();
  return Boolean(match);
}
function validNotes(n: unknown) { return typeof n === 'string' && n.length <= 500; }

export async function GET(request: Request) {
  try {
    const token = bearer(request);
    if (!token) return Response.json({ error: 'התחברו כדי לראות את ההזמנות שלכם' }, { status: 401 });
    const user = await verifySession(token); await ensureSchema(); const db = database();
    const rows = await db.prepare(`SELECT r.id, r.slot_id, r.party_size, r.status, r.preference, r.notes, s.starts_at, s.ends_at FROM reservations r JOIN slots s ON s.id = r.slot_id WHERE r.google_subject = ? AND r.status = 'confirmed' ORDER BY s.starts_at ASC`).bind(user.sub).all<ReservationRow>();
    return Response.json({ reservations: rows.results.map((r) => ({ id:r.id, startsAt:r.starts_at, endsAt:r.ends_at, partySize:r.party_size, preference:r.preference, notes:r.notes })) });
  } catch (error) { const msg = error instanceof Error ? error.message : 'Could not load reservations'; return Response.json({ error:msg }, { status: 401 }); }
}

export async function POST(request: Request) {
  try {
    const token = bearer(request);
    if (!token) return Response.json({ error: 'התחברו כדי לאשר הזמנה' }, { status: 401 });
    const user = await verifySession(token);
    const body = await request.json() as { slotId?:string; partySize?:number; preference?:string; notes?:string };
    if (!body.slotId || !Number.isInteger(body.partySize) || body.partySize! < 1 || body.partySize! > 10) return Response.json({ error:'Invalid reservation' }, { status:400 });
    const notes = body.notes ?? ''; if (!validNotes(notes)) return Response.json({ error:'ההערה ארוכה מדי' }, { status:400 });
    await ensureSchema(); const db = database();
    const preference = body.preference ?? 'none'; if (!await validPreference(preference)) return Response.json({ error:'העדפה לא תקינה' }, { status:400 });
    const slot = await db.prepare('SELECT id, starts_at, ends_at, capacity, is_open FROM slots WHERE id = ?').bind(body.slotId).first<{id:string; starts_at:string; ends_at:string; capacity:number; is_open:number}>();
    if (!slot || !slot.is_open || slot.ends_at < new Date().toISOString()) return Response.json({ error:'This slot is unavailable' }, { status:409 });
    const id = crypto.randomUUID();
    try { await db.prepare(`INSERT INTO reservations (id, slot_id, google_subject, guest_name, guest_email, party_size, preference, notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`).bind(id, body.slotId, user.sub, user.name, user.email, body.partySize, preference, notes, new Date().toISOString()).run(); }
    catch (error) { const msg = error instanceof Error ? error.message : ''; if (msg.includes('slot_full')) return Response.json({ error:'That slot just filled up. Please choose another time.' }, { status:409 }); if (msg.includes('UNIQUE')) return Response.json({ error:'You already have a reservation for this time.' }, { status:409 }); throw error; }
    return Response.json({ reservation:{ id, startsAt:slot.starts_at, partySize:body.partySize, guestName:user.name } }, { status:201 });
  } catch (error) { const msg = error instanceof Error ? error.message : 'Could not reserve'; return Response.json({ error:msg }, { status:401 }); }
}

export async function PATCH(request: Request) {
  try {
    const token = bearer(request);
    if (!token) return Response.json({ error: 'התחברו כדי לערוך הזמנה' }, { status: 401 });
    const user = await verifySession(token);
    const body = await request.json() as { id?:string; partySize?:number; preference?:string; notes?:string };
    if (!body.id) return Response.json({ error:'חסר מזהה הזמנה' }, { status:400 });
    if (body.partySize !== undefined && (!Number.isInteger(body.partySize) || body.partySize < 1 || body.partySize > 10)) return Response.json({ error:'מספר סועדים לא תקין' }, { status:400 });
    if (body.notes !== undefined && !validNotes(body.notes)) return Response.json({ error:'ההערה ארוכה מדי' }, { status:400 });
    await ensureSchema(); const db = database();
    if (body.preference !== undefined && !await validPreference(body.preference)) return Response.json({ error:'העדפה לא תקינה' }, { status:400 });
    const reservation = await db.prepare(`SELECT r.id, r.slot_id, r.status, s.ends_at, s.capacity FROM reservations r JOIN slots s ON s.id = r.slot_id WHERE r.id = ? AND r.google_subject = ?`).bind(body.id, user.sub).first<{ id:string; slot_id:string; status:string; ends_at:string; capacity:number }>();
    if (!reservation || reservation.status !== 'confirmed') return Response.json({ error:'ההזמנה לא נמצאה' }, { status:404 });
    if (reservation.ends_at < new Date().toISOString()) return Response.json({ error:'לא ניתן לערוך הזמנה שחלפה' }, { status:409 });
    if (body.partySize !== undefined) {
      const other = await db.prepare(`SELECT COALESCE(SUM(party_size), 0) AS sum FROM reservations WHERE slot_id = ? AND status = 'confirmed' AND id != ?`).bind(reservation.slot_id, body.id).first<{ sum:number }>();
      if (Number(other?.sum || 0) + body.partySize > reservation.capacity) return Response.json({ error:'אין מספיק מקומות פנויים בשעה הזו' }, { status:409 });
      await db.prepare('UPDATE reservations SET party_size = ? WHERE id = ?').bind(body.partySize, body.id).run();
    }
    if (body.preference !== undefined) await db.prepare('UPDATE reservations SET preference = ? WHERE id = ?').bind(body.preference, body.id).run();
    if (body.notes !== undefined) await db.prepare('UPDATE reservations SET notes = ? WHERE id = ?').bind(body.notes, body.id).run();
    return Response.json({ id: body.id });
  } catch (error) { const msg = error instanceof Error ? error.message : 'Could not update reservation'; return Response.json({ error:msg }, { status:401 }); }
}

export async function DELETE(request: Request) {
  try {
    const token = bearer(request);
    if (!token) return Response.json({ error: 'התחברו כדי לבטל הזמנה' }, { status: 401 });
    const user = await verifySession(token);
    const body = await request.json() as { id?:string };
    if (!body.id) return Response.json({ error:'חסר מזהה הזמנה' }, { status:400 });
    await ensureSchema(); const db = database();
    await db.prepare(`UPDATE reservations SET status = 'cancelled' WHERE id = ? AND google_subject = ? AND status = 'confirmed'`).bind(body.id, user.sub).run();
    return Response.json({ cancelled: true });
  } catch (error) { const msg = error instanceof Error ? error.message : 'Could not cancel reservation'; return Response.json({ error:msg }, { status:401 }); }
}
