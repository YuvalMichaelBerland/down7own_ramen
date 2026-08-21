import { authenticateAdmin } from '@/app/lib/admin';
import { database } from '@/app/lib/database';

export async function GET(request:Request){
  const admin=await authenticateAdmin(request); if(!admin)return Response.json({error:'גישת מנהל בלבד'},{status:403});
  const rows=await database().prepare('SELECT email, added_at FROM admins ORDER BY added_at ASC').all<{email:string;added_at:string}>();
  return Response.json({admins:rows.results});
}
export async function POST(request:Request){
  const admin=await authenticateAdmin(request); if(!admin)return Response.json({error:'גישת מנהל בלבד'},{status:403});
  const {email}=await request.json() as {email?:string}; const normalized=email?.trim().toLowerCase();
  if(!normalized||!/^\S+@\S+\.\S+$/.test(normalized))return Response.json({error:'כתובת האימייל אינה תקינה'},{status:400});
  await database().prepare('INSERT OR IGNORE INTO admins (email, added_at, added_by) VALUES (?, ?, ?)').bind(normalized,new Date().toISOString(),admin.email).run();
  return Response.json({email:normalized},{status:201});
}
export async function DELETE(request:Request){
  const admin=await authenticateAdmin(request); if(!admin)return Response.json({error:'גישת מנהל בלבד'},{status:403});
  const {email}=await request.json() as {email?:string}; const normalized=email?.trim().toLowerCase();
  const count=await database().prepare('SELECT COUNT(*) AS count FROM admins').first<{count:number}>();
  if(!normalized||Number(count?.count||0)<=1)return Response.json({error:'חייב להישאר לפחות מנהל אחד'},{status:409});
  await database().prepare('DELETE FROM admins WHERE email = ?').bind(normalized).run();
  return Response.json({removed:true});
}
