import { database, ensureSchema } from '@/app/lib/database';
import { authenticateAdmin } from '@/app/lib/admin';
export async function GET(request:Request){
  try{
    if(!await authenticateAdmin(request))return Response.json({isChef:false,slots:[]});
    await ensureSchema();
    const result=await database().prepare(`SELECT s.id, s.starts_at, s.ends_at, s.capacity, COALESCE(SUM(CASE WHEN r.status = 'confirmed' THEN r.party_size ELSE 0 END), 0) AS reserved FROM slots s LEFT JOIN reservations r ON r.slot_id = s.id WHERE s.is_open = 1 AND s.ends_at >= ? GROUP BY s.id ORDER BY s.starts_at ASC LIMIT 120`).bind(new Date().toISOString()).all<{id:string;starts_at:string;ends_at:string;capacity:number;reserved:number}>();
    return Response.json({isChef:true,slots:result.results.map(s=>({id:s.id,startsAt:s.starts_at,endsAt:s.ends_at,capacity:s.capacity,reserved:Number(s.reserved)}))});
  }
  catch{return Response.json({isChef:false});}
}
export async function POST(request:Request) {
  try {
    if (!await authenticateAdmin(request)) return Response.json({ error:'גישת מנהל בלבד' }, { status:403 });
    const b=await request.json() as {date?:string;timezoneOffset?:number;slots?:Array<{startTime?:string;durationMinutes?:number;capacity?:number}>};
    if(!b.date||!Number.isInteger(b.timezoneOffset)||!Array.isArray(b.slots)||!b.slots.length||b.slots.length>24)return Response.json({error:'בחרו תאריך והוסיפו בין משבצת אחת ל־24 משבצות'},{status:400});
    const [y,m,d]=b.date.split('-').map(Number);
    const slots=b.slots.map(item=>{
      if(!/^\d{2}:\d{2}$/.test(item.startTime||'')||!Number.isInteger(item.durationMinutes)||item.durationMinutes!<15||item.durationMinutes!>180||!Number.isInteger(item.capacity)||item.capacity!<1||item.capacity!>100)throw new Error('בדקו את השעה, משך הישיבה ומספר המקומות בכל משבצת');
      const [h,min]=item.startTime!.split(':').map(Number); const start=new Date(Date.UTC(y,m-1,d,h,min)+b.timezoneOffset!*60_000);
      return {id:crypto.randomUUID(),startsAt:start.toISOString(),endsAt:new Date(start.getTime()+item.durationMinutes!*60_000).toISOString(),capacity:item.capacity!};
    }).sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
    if(new Set(slots.map(s=>s.startsAt)).size!==slots.length||slots.some(s=>new Date(s.startsAt)<new Date()))return Response.json({error:'כל שעה צריכה להופיע פעם אחת ולהיות בעתיד'},{status:400});
    await ensureSchema(); const db=database(); await db.batch(slots.map(s=>db.prepare(`INSERT INTO slots (id, starts_at, ends_at, capacity, is_open, created_at) VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(starts_at) DO UPDATE SET capacity=excluded.capacity, ends_at=excluded.ends_at, is_open=1`).bind(s.id,s.startsAt,s.endsAt,s.capacity,new Date().toISOString())));
    return Response.json({created:slots.length},{status:201});
  } catch(error){return Response.json({error:error instanceof Error?error.message:'לא הצלחנו ליצור את המועדים'},{status:500});}
}
export async function DELETE(request:Request){
  try{
    if(!await authenticateAdmin(request))return Response.json({error:'גישת מנהל בלבד'},{status:403});
    const {id}=await request.json() as {id?:string};
    if(!id)return Response.json({error:'חסר מזהה משבצת'},{status:400});
    await ensureSchema();
    const result=await database().prepare('UPDATE slots SET is_open = 0 WHERE id = ? AND is_open = 1').bind(id).run();
    if(!result.meta.changes)return Response.json({error:'המשבצת לא נמצאה'},{status:404});
    return Response.json({deleted:true});
  }catch(error){return Response.json({error:error instanceof Error?error.message:'לא הצלחנו למחוק את המשבצת'},{status:500});}
}
