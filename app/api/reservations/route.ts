import { database, ensureSchema } from '@/app/lib/database';
import { verifySession } from '@/app/lib/session';
import { savePreferences, validPreference } from '@/app/lib/preferences';
import { menusForSlots } from '@/app/lib/menus';

type ReservationRow = { id:string; slot_id:string; party_size:number; status:string; starts_at:string; ends_at:string; notes:string; guest_name:string; guest_phone:string };
type PreferenceRow = { reservation_id:string; seat_index:number; preference:string };

function bearer(request: Request) { return request.headers.get('authorization')?.replace(/^Bearer\s+/i, ''); }
function validNotes(n: unknown) { return typeof n === 'string' && n.length <= 500; }
function validName(n: unknown) { return typeof n === 'string' && n.trim().length > 0 && n.trim().length <= 80; }
function validPhone(p: unknown) { return typeof p === 'string' && /^[0-9+\-() ]{7,20}$/.test(p.trim()); }

export async function GET(request: Request) {
  try {
    const token = bearer(request);
    if (!token) return Response.json({ error: 'התחברו כדי לראות את ההזמנות שלכם' }, { status: 401 });
    const user = await verifySession(token); await ensureSchema(); const db = database();
    // A reservation stops being "active" for the guest once its slot's time has
    // passed, or the chef has closed/completed that service — either way it should
    // disappear from "my reservations" instead of lingering as still-editable.
    const rows = await db.prepare(`SELECT r.id, r.slot_id, r.party_size, r.status, r.notes, r.guest_name, r.guest_phone, s.starts_at, s.ends_at FROM reservations r JOIN slots s ON s.id = r.slot_id WHERE r.google_subject = ? AND r.status = 'confirmed' AND s.is_open = 1 AND s.ends_at >= ? ORDER BY s.starts_at ASC`).bind(user.sub, new Date().toISOString()).all<ReservationRow>();
    const prefRows = rows.results.length ? await db.prepare(`SELECT reservation_id, seat_index, preference FROM reservation_preferences WHERE reservation_id IN (${rows.results.map(() => '?').join(',')}) ORDER BY seat_index ASC`).bind(...rows.results.map((r) => r.id)).all<PreferenceRow>() : { results: [] as PreferenceRow[] };
    const prefsByReservation = new Map<string, string[]>();
    for (const p of prefRows.results) { const list = prefsByReservation.get(p.reservation_id) ?? []; list.push(p.preference); prefsByReservation.set(p.reservation_id, list); }
    const menus = await menusForSlots(rows.results.map((r) => r.slot_id));
    return Response.json({ reservations: rows.results.map((r) => ({ id:r.id, startsAt:r.starts_at, endsAt:r.ends_at, partySize:r.party_size, notes:r.notes, guestName:r.guest_name, guestPhone:r.guest_phone, menu:menus.get(r.slot_id) ?? [], preferences: prefsByReservation.get(r.id) ?? Array(r.party_size).fill('none') })) });
  } catch (error) { const msg = error instanceof Error ? error.message : 'Could not load reservations'; return Response.json({ error:msg }, { status: 401 }); }
}

export async function POST(request: Request) {
  try {
    const token = bearer(request);
    if (!token) return Response.json({ error: 'התחברו כדי לאשר הזמנה' }, { status: 401 });
    const user = await verifySession(token);
    const body = await request.json() as { slotId?:string; partySize?:number; preferences?:string[]; notes?:string; guestName?:string; guestPhone?:string };
    if (!body.slotId || !Number.isInteger(body.partySize) || body.partySize! < 1 || body.partySize! > 10) return Response.json({ error:'Invalid reservation' }, { status:400 });
    if (!validName(body.guestName)) return Response.json({ error:'נא למלא שם מלא' }, { status:400 });
    if (!validPhone(body.guestPhone)) return Response.json({ error:'נא למלא מספר טלפון תקין' }, { status:400 });
    const notes = body.notes ?? ''; if (!validNotes(notes)) return Response.json({ error:'ההערה ארוכה מדי' }, { status:400 });
    const preferences = body.preferences ?? Array(body.partySize).fill('none');
    if (preferences.length !== body.partySize) return Response.json({ error:'מספר ההעדפות חייב להתאים למספר הסועדים' }, { status:400 });
    await ensureSchema(); const db = database();
    const slot = await db.prepare('SELECT id, starts_at, ends_at, capacity, is_open FROM slots WHERE id = ?').bind(body.slotId).first<{id:string; starts_at:string; ends_at:string; capacity:number; is_open:number}>();
    if (!slot || !slot.is_open || slot.ends_at < new Date().toISOString()) return Response.json({ error:'This slot is unavailable' }, { status:409 });
    for (const p of preferences) if (!await validPreference(p, slot.id)) return Response.json({ error:'העדפה לא תקינה' }, { status:400 });
    const id = crypto.randomUUID();
    const guestName = body.guestName!.trim(); const guestPhone = body.guestPhone!.trim();
    try { await db.prepare(`INSERT INTO reservations (id, slot_id, google_subject, guest_name, guest_email, guest_phone, party_size, notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`).bind(id, body.slotId, user.sub, guestName, user.email, guestPhone, body.partySize, notes, new Date().toISOString()).run(); }
    catch (error) { const msg = error instanceof Error ? error.message : ''; if (msg.includes('slot_full')) return Response.json({ error:'That slot just filled up. Please choose another time.' }, { status:409 }); if (msg.includes('UNIQUE')) return Response.json({ error:'You already have a reservation for this time.' }, { status:409 }); throw error; }
    await savePreferences(id, preferences);
    return Response.json({ reservation:{ id, startsAt:slot.starts_at, partySize:body.partySize, guestName } }, { status:201 });
  } catch (error) { const msg = error instanceof Error ? error.message : 'Could not reserve'; return Response.json({ error:msg }, { status:401 }); }
}

export async function PATCH(request: Request) {
  try {
    const token = bearer(request);
    if (!token) return Response.json({ error: 'התחברו כדי לערוך הזמנה' }, { status: 401 });
    const user = await verifySession(token);
    const body = await request.json() as { id?:string; partySize?:number; preferences?:string[]; notes?:string; guestName?:string; guestPhone?:string };
    if (!body.id) return Response.json({ error:'חסר מזהה הזמנה' }, { status:400 });
    if (body.partySize !== undefined && (!Number.isInteger(body.partySize) || body.partySize < 1 || body.partySize > 10)) return Response.json({ error:'מספר סועדים לא תקין' }, { status:400 });
    if (body.notes !== undefined && !validNotes(body.notes)) return Response.json({ error:'ההערה ארוכה מדי' }, { status:400 });
    if (body.guestName !== undefined && !validName(body.guestName)) return Response.json({ error:'נא למלא שם מלא' }, { status:400 });
    if (body.guestPhone !== undefined && !validPhone(body.guestPhone)) return Response.json({ error:'נא למלא מספר טלפון תקין' }, { status:400 });
    await ensureSchema(); const db = database();
    const reservation = await db.prepare(`SELECT r.id, r.slot_id, r.party_size, r.status, s.ends_at, s.is_open, s.capacity FROM reservations r JOIN slots s ON s.id = r.slot_id WHERE r.id = ? AND r.google_subject = ?`).bind(body.id, user.sub).first<{ id:string; slot_id:string; party_size:number; status:string; ends_at:string; is_open:number; capacity:number }>();
    if (!reservation || reservation.status !== 'confirmed') return Response.json({ error:'ההזמנה לא נמצאה' }, { status:404 });
    if (reservation.ends_at < new Date().toISOString() || !reservation.is_open) return Response.json({ error:'לא ניתן לערוך הזמנה שהסתיימה' }, { status:409 });
    const targetPartySize = body.partySize ?? reservation.party_size;
    let preferences = body.preferences;
    if (preferences !== undefined && preferences.length !== targetPartySize) return Response.json({ error:'מספר ההעדפות חייב להתאים למספר הסועדים' }, { status:400 });
    if (preferences !== undefined) for (const p of preferences) if (!await validPreference(p, reservation.slot_id)) return Response.json({ error:'העדפה לא תקינה' }, { status:400 });
    if (body.partySize !== undefined) {
      const other = await db.prepare(`SELECT COALESCE(SUM(party_size), 0) AS sum FROM reservations WHERE slot_id = ? AND status = 'confirmed' AND id != ?`).bind(reservation.slot_id, body.id).first<{ sum:number }>();
      if (Number(other?.sum || 0) + body.partySize > reservation.capacity) return Response.json({ error:'אין מספיק מקומות פנויים בשעה הזו' }, { status:409 });
      await db.prepare('UPDATE reservations SET party_size = ? WHERE id = ?').bind(body.partySize, body.id).run();
      if (preferences === undefined) {
        const current = await db.prepare('SELECT preference FROM reservation_preferences WHERE reservation_id = ? ORDER BY seat_index ASC').bind(body.id).all<{ preference:string }>();
        const list = current.results.map((r) => r.preference);
        preferences = list.length > targetPartySize ? list.slice(0, targetPartySize) : [...list, ...Array(targetPartySize - list.length).fill('none')];
      }
    }
    if (preferences !== undefined) await savePreferences(body.id, preferences);
    if (body.notes !== undefined) await db.prepare('UPDATE reservations SET notes = ? WHERE id = ?').bind(body.notes, body.id).run();
    if (body.guestName !== undefined) await db.prepare('UPDATE reservations SET guest_name = ? WHERE id = ?').bind(body.guestName.trim(), body.id).run();
    if (body.guestPhone !== undefined) await db.prepare('UPDATE reservations SET guest_phone = ? WHERE id = ?').bind(body.guestPhone.trim(), body.id).run();
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
    const reservation = await db.prepare(`SELECT r.id, s.ends_at, s.is_open FROM reservations r JOIN slots s ON s.id = r.slot_id WHERE r.id = ? AND r.google_subject = ? AND r.status = 'confirmed'`).bind(body.id, user.sub).first<{ id:string; ends_at:string; is_open:number }>();
    if (!reservation) return Response.json({ error:'ההזמנה לא נמצאה' }, { status:404 });
    if (reservation.ends_at < new Date().toISOString() || !reservation.is_open) return Response.json({ error:'לא ניתן לבטל הזמנה שהסתיימה' }, { status:409 });
    await db.prepare(`UPDATE reservations SET status = 'cancelled' WHERE id = ? AND google_subject = ? AND status = 'confirmed'`).bind(body.id, user.sub).run();
    return Response.json({ cancelled: true });
  } catch (error) { const msg = error instanceof Error ? error.message : 'Could not cancel reservation'; return Response.json({ error:msg }, { status:401 }); }
}
