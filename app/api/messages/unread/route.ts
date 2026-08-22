import { database, ensureSchema } from '@/app/lib/database';
import { verifySession } from '@/app/lib/session';

export async function GET(request: Request) {
  try {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return Response.json({ unread: false });
    const user = await verifySession(token); await ensureSchema();
    const row = await database().prepare(`SELECT 1 AS x FROM messages WHERE google_subject = ? AND sender = 'admin' AND read = 0 LIMIT 1`).bind(user.sub).first();
    return Response.json({ unread: Boolean(row) });
  } catch { return Response.json({ unread: false }); }
}
