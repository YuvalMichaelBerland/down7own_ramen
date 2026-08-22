import { database, ensureSchema } from '@/app/lib/database';
import { authenticateAdmin } from '@/app/lib/admin';

type ThreadRow = { google_subject:string; guest_name:string; guest_email:string; last:string; unread:number };
type MessageRow = { id:string; sender:string; body:string; created_at:string };

export async function GET(request: Request) {
  if (!await authenticateAdmin(request)) return Response.json({ error: 'גישת מנהל בלבד' }, { status: 403 });
  await ensureSchema(); const db = database();
  const subject = new URL(request.url).searchParams.get('subject');
  if (subject) {
    const rows = await db.prepare('SELECT id, sender, body, created_at FROM messages WHERE google_subject = ? ORDER BY created_at ASC').bind(subject).all<MessageRow>();
    await db.prepare(`UPDATE messages SET read = 1 WHERE google_subject = ? AND sender = 'guest' AND read = 0`).bind(subject).run();
    return Response.json({ messages: rows.results.map((m) => ({ id:m.id, sender:m.sender, body:m.body, createdAt:m.created_at })) });
  }
  const rows = await db.prepare(`SELECT google_subject, MAX(CASE WHEN guest_name != '' THEN guest_name END) AS guest_name, MAX(CASE WHEN guest_email != '' THEN guest_email END) AS guest_email, MAX(created_at) AS last, SUM(CASE WHEN sender = 'guest' AND read = 0 THEN 1 ELSE 0 END) AS unread FROM messages GROUP BY google_subject ORDER BY last DESC`).bind().all<ThreadRow>();
  return Response.json({ threads: rows.results.map((t) => ({ subject:t.google_subject, guestName:t.guest_name, guestEmail:t.guest_email, lastAt:t.last, unread:Number(t.unread) })) });
}

export async function POST(request: Request) {
  try {
    if (!await authenticateAdmin(request)) return Response.json({ error: 'גישת מנהל בלבד' }, { status: 403 });
    const subject = new URL(request.url).searchParams.get('subject');
    const { body } = await request.json() as { body?:string };
    const trimmed = body?.trim();
    if (!subject || !trimmed || trimmed.length > 1000) return Response.json({ error: 'ההודעה ריקה או ארוכה מדי' }, { status: 400 });
    await ensureSchema();
    const id = crypto.randomUUID();
    await database().prepare(`INSERT INTO messages (id, google_subject, sender, body, created_at, read) VALUES (?, ?, 'admin', ?, ?, 0)`).bind(id, subject, trimmed, new Date().toISOString()).run();
    return Response.json({ id }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Could not send message' }, { status: 500 }); }
}
