import { database, ensureSchema } from '@/app/lib/database';
import { verifySession } from '@/app/lib/session';

type MessageRow = { id:string; sender:string; body:string; created_at:string };

function bearer(request: Request) { return request.headers.get('authorization')?.replace(/^Bearer\s+/i, ''); }

async function ownedReservation(id: string, googleSubject: string) {
  await ensureSchema();
  return database().prepare('SELECT id FROM reservations WHERE id = ? AND google_subject = ?').bind(id, googleSubject).first<{ id:string }>();
}

export async function GET(request: Request, { params }: { params: Promise<{ id:string }> }) {
  try {
    const token = bearer(request);
    if (!token) return Response.json({ error: 'התחברו כדי לראות הודעות' }, { status: 401 });
    const user = await verifySession(token);
    const { id } = await params;
    if (!await ownedReservation(id, user.sub)) return Response.json({ error: 'ההזמנה לא נמצאה' }, { status: 404 });
    const rows = await database().prepare('SELECT id, sender, body, created_at FROM messages WHERE reservation_id = ? ORDER BY created_at ASC').bind(id).all<MessageRow>();
    return Response.json({ messages: rows.results.map((m) => ({ id:m.id, sender:m.sender, body:m.body, createdAt:m.created_at })) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Could not load messages' }, { status: 401 }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id:string }> }) {
  try {
    const token = bearer(request);
    if (!token) return Response.json({ error: 'התחברו כדי לשלוח הודעה' }, { status: 401 });
    const user = await verifySession(token);
    const { id } = await params;
    if (!await ownedReservation(id, user.sub)) return Response.json({ error: 'ההזמנה לא נמצאה' }, { status: 404 });
    const { body } = await request.json() as { body?:string };
    const trimmed = body?.trim();
    if (!trimmed || trimmed.length > 1000) return Response.json({ error: 'ההודעה ריקה או ארוכה מדי' }, { status: 400 });
    const messageId = crypto.randomUUID();
    await database().prepare('INSERT INTO messages (id, reservation_id, sender, body, created_at) VALUES (?, ?, ?, ?, ?)').bind(messageId, id, 'guest', trimmed, new Date().toISOString()).run();
    return Response.json({ id: messageId }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Could not send message' }, { status: 401 }); }
}
