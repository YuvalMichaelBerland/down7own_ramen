import { database, ensureSchema } from '@/app/lib/database';
import { isChef, verifyGoogleToken } from '@/app/lib/google';
async function chefFrom(request:Request) { const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,''); if(!token)return null; const user=await verifyGoogleToken(token); return isChef(user)?user:null; }
export async function POST(request:Request) {
  try {
    if (!await chefFrom(request)) return Response.json({ error:'Chef access only' }, { status:403 });
    const b=await request.json() as {date?:string;startTime?:string;endTime?:string;capacity?:number};
    if(!b.date||!/^\d{2}:\d{2}$/.test(b.startTime||'')||!/^\d{2}:\d{2}$/.test(b.endTime||'')||!Number.isInteger(b.capacity)||b.capacity!<1||b.capacity!>100)return Response.json({error:'Check the date, times, and capacity'},{status:400});
    const start=new Date(`${b.date}T${b.startTime}:00`),end=new Date(`${b.date}T${b.endTime}:00`);
    if(!Number.isFinite(start.getTime())||end<=start||start<new Date())return Response.json({error:'Choose a valid future service window'},{status:400});
    const slots=[]; for(let cursor=start.getTime();cursor+1_800_000<=end.getTime();cursor+=1_800_000)slots.push({id:crypto.randomUUID(),startsAt:new Date(cursor).toISOString(),endsAt:new Date(cursor+1_800_000).toISOString()});
    if(!slots.length||slots.length>24)return Response.json({error:'Service must contain 1–24 half-hour slots'},{status:400});
    await ensureSchema(); const db=database(); await db.batch(slots.map(s=>db.prepare(`INSERT INTO slots (id, starts_at, ends_at, capacity, is_open, created_at) VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(starts_at) DO UPDATE SET capacity=excluded.capacity, ends_at=excluded.ends_at, is_open=1`).bind(s.id,s.startsAt,s.endsAt,b.capacity,new Date().toISOString())));
    return Response.json({created:slots.length},{status:201});
  } catch(error){return Response.json({error:error instanceof Error?error.message:'Could not create slots'},{status:500});}
}
