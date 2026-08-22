import { database, ensureSchema } from '@/app/lib/database';
import { verifySession } from '@/app/lib/session';

type MessageRow = { id:string; sender:string; body:string; created_at:string };

function bearer(request: Request) { return request.headers.get('authorization')?.replace(/^Bearer\s+/i, ''); }

export async function GET(request: Request) {
  try {
    const token = bearer(request);
    if (!token) return Response.json({ error: 'התחברו כדי לראות הודעות' }, { status: 401 });
    const user = await verifySession(token); await ensureSchema(); const db = database();
    const rows = await db.prepare('SELECT id, sender, body, created_at FROM messages WHERE google_subject = ? ORDER BY created_at ASC').bind(user.sub).all<MessageRow>();
    await db.prepare(`UPDATE messages SET read = 1 WHERE google_subject = ? AND sender = 'admin' AND read = 0`).bind(user.sub).run();
    return Response.json({ messages: rows.results.map((m) => ({ id:m.id, sender:m.sender, body:m.body, createdAt:m.created_at })) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Could not load messages' }, { status: 401 }); }
}

export async function POST(request: Request) {
  try {
    const token = bearer(request);
    if (!token) return Response.json({ error: 'התחברו כדי לשלוח הודעה' }, { status: 401 });
    const user = await verifySession(token);
    const { body } = await request.json() as { body?:string };
    const trimmed = body?.trim();
    if (!trimmed || trimmed.length > 1000) return Response.json({ error: 'ההודעה ריקה או ארוכה מדי' }, { status: 400 });
    await ensureSchema();
    const id = crypto.randomUUID();
    await database().prepare(`INSERT INTO messages (id, google_subject, guest_name, guest_email, sender, body, created_at, read) VALUES (?, ?, ?, ?, 'guest', ?, ?, 0)`).bind(id, user.sub, user.name, user.email, trimmed, new Date().toISOString()).run();
    return Response.json({ id }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Could not send message' }, { status: 401 }); }
}
