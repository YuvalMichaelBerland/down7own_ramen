import { database, ensureSchema } from '@/app/lib/database';
import { authenticateAdmin } from '@/app/lib/admin';

type MenuOption = { id:string; label:string };

export async function GET() {
  await ensureSchema();
  const rows = await database().prepare('SELECT id, label FROM menu_options ORDER BY sort_order ASC, label ASC').bind().all<MenuOption>();
  return Response.json({ options: rows.results });
}

export async function POST(request: Request) {
  try {
    if (!await authenticateAdmin(request)) return Response.json({ error: 'גישת מנהל בלבד' }, { status: 403 });
    const { label } = await request.json() as { label?:string };
    const trimmed = label?.trim();
    if (!trimmed || trimmed.length > 40) return Response.json({ error: 'שם האפשרות לא תקין' }, { status: 400 });
    await ensureSchema(); const db = database();
    const max = await db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM menu_options').bind().first<{ m:number }>();
    const id = crypto.randomUUID();
    try { await db.prepare('INSERT INTO menu_options (id, label, sort_order, created_at) VALUES (?, ?, ?, ?)').bind(id, trimmed, Number(max?.m || 0) + 1, new Date().toISOString()).run(); }
    catch (error) { const msg = error instanceof Error ? error.message : ''; if (msg.includes('UNIQUE')) return Response.json({ error: 'האפשרות כבר קיימת' }, { status: 409 }); throw error; }
    return Response.json({ id, label: trimmed }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'לא הצלחנו להוסיף אפשרות' }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  try {
    if (!await authenticateAdmin(request)) return Response.json({ error: 'גישת מנהל בלבד' }, { status: 403 });
    const { id } = await request.json() as { id?:string };
    if (!id) return Response.json({ error: 'חסר מזהה' }, { status: 400 });
    await ensureSchema(); const db = database();
    await db.prepare('DELETE FROM menu_options WHERE id = ?').bind(id).run();
    await db.prepare(`UPDATE reservations SET preference = 'none' WHERE preference = ?`).bind(id).run();
    return Response.json({ deleted: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'לא הצלחנו להסיר אפשרות' }, { status: 500 }); }
}
