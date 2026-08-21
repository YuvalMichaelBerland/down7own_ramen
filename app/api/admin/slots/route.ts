import { database, ensureSchema } from '@/app/lib/database';
import { env } from 'cloudflare:workers';
import { isChef, verifyGoogleToken } from '@/app/lib/google';
async function chefFrom(request:Request) {
  const platformEmail=request.headers.get('oai-authenticated-user-email');
  if(platformEmail&&env.CHEF_EMAIL&&platformEmail.toLowerCase()===env.CHEF_EMAIL.toLowerCase())return {email:platformEmail};
  const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,''); if(!token)return null;
  const user=await verifyGoogleToken(token); return isChef(user)?user:null;
}
export async function GET(request:Request){
  try{return Response.json({isChef:Boolean(await chefFrom(request))});}
  catch{return Response.json({isChef:false});}
}
export async function POST(request:Request) {
  try {
    if (!await chefFrom(request)) return Response.json({ error:'Chef access only' }, { status:403 });
    const b=await request.json() as {date?:string;startTime?:string;endTime?:string;capacity?:number;timezoneOffset?:number};
    if(!b.date||!/^\d{2}:\d{2}$/.test(b.startTime||'')||!/^\d{2}:\d{2}$/.test(b.endTime||'')||!Number.isInteger(b.capacity)||b.capacity!<1||b.capacity!>100||!Number.isInteger(b.timezoneOffset))return Response.json({error:'בדקו את התאריך, השעות ומספר המקומות'},{status:400});
    const toUtc=(time:string)=>{const [y,m,d]=b.date!.split('-').map(Number),[h,min]=time.split(':').map(Number);return new Date(Date.UTC(y,m-1,d,h,min)+b.timezoneOffset!*60_000);};
    const start=toUtc(b.startTime!),end=toUtc(b.endTime!);
    if(!Number.isFinite(start.getTime())||end<=start||start<new Date())return Response.json({error:'בחרו טווח שעות עתידי ותקין'},{status:400});
    const slots=[]; for(let cursor=start.getTime();cursor+1_800_000<=end.getTime();cursor+=1_800_000)slots.push({id:crypto.randomUUID(),startsAt:new Date(cursor).toISOString(),endsAt:new Date(cursor+1_800_000).toISOString()});
    if(!slots.length||slots.length>24)return Response.json({error:'הארוחה צריכה לכלול בין משבצת אחת ל־24 משבצות'},{status:400});
    await ensureSchema(); const db=database(); await db.batch(slots.map(s=>db.prepare(`INSERT INTO slots (id, starts_at, ends_at, capacity, is_open, created_at) VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(starts_at) DO UPDATE SET capacity=excluded.capacity, ends_at=excluded.ends_at, is_open=1`).bind(s.id,s.startsAt,s.endsAt,b.capacity,new Date().toISOString())));
    return Response.json({created:slots.length},{status:201});
  } catch(error){return Response.json({error:error instanceof Error?error.message:'לא הצלחנו ליצור את המועדים'},{status:500});}
}
