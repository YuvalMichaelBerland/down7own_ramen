import { database, ensureSchema } from '@/app/lib/database';
import { authenticateAdmin } from '@/app/lib/admin';

type MessageRow = { id:string; sender:string; body:string; created_at:string };

export async function GET(request: Request, { params }: { params: Promise<{ id:string }> }) {
  if (!await authenticateAdmin(request)) return Response.json({ error: 'גישת מנהל בלבד' }, { status: 403 });
  await ensureSchema();
  const { id } = await params;
  const rows = await database().prepare('SELECT id, sender, body, created_at FROM messages WHERE reservation_id = ? ORDER BY created_at ASC').bind(id).all<MessageRow>();
  return Response.json({ messages: rows.results.map((m) => ({ id:m.id, sender:m.sender, body:m.body, createdAt:m.created_at })) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id:string }> }) {
  try {
    if (!await authenticateAdmin(request)) return Response.json({ error: 'גישת מנהל בלבד' }, { status: 403 });
    await ensureSchema();
    const { id } = await params;
    const reservation = await database().prepare('SELECT id FROM reservations WHERE id = ?').bind(id).first<{ id:string }>();
    if (!reservation) return Response.json({ error: 'ההזמנה לא נמצאה' }, { status: 404 });
    const { body } = await request.json() as { body?:string };
    const trimmed = body?.trim();
    if (!trimmed || trimmed.length > 1000) return Response.json({ error: 'ההודעה ריקה או ארוכה מדי' }, { status: 400 });
    const messageId = crypto.randomUUID();
    await database().prepare('INSERT INTO messages (id, reservation_id, sender, body, created_at) VALUES (?, ?, ?, ?, ?)').bind(messageId, id, 'admin', trimmed, new Date().toISOString()).run();
    return Response.json({ id: messageId }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Could not send message' }, { status: 500 }); }
}
