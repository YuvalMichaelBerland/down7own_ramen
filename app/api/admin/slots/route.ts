import { database, ensureSchema } from '@/app/lib/database';
import { authenticateAdmin } from '@/app/lib/admin';

type SlotRow={id:string;starts_at:string;ends_at:string;capacity:number;is_open:number;reserved:number};
type CompletionRow={day_key:string;actual_attendees:number;completed_at:string};
type ReservationRow={id:string;guest_name:string;guest_email:string;party_size:number;notes:string;starts_at:string};
type PreferenceRow={reservation_id:string;seat_index:number;preference:string};
const dayKey=(iso:string)=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso)).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}`;};

export async function GET(request:Request){
  try{
    if(!await authenticateAdmin(request))return Response.json({isChef:false,days:[],history:[]});
    await ensureSchema();const db=database();
    const [slotResult,completionResult,reservationResult]=await Promise.all([
      db.prepare(`SELECT s.id, s.starts_at, s.ends_at, s.capacity, s.is_open, COALESCE(SUM(CASE WHEN r.status = 'confirmed' THEN r.party_size ELSE 0 END), 0) AS reserved FROM slots s LEFT JOIN reservations r ON r.slot_id = s.id GROUP BY s.id ORDER BY s.starts_at ASC LIMIT 500`).all<SlotRow>(),
      db.prepare('SELECT day_key, actual_attendees, completed_at FROM service_days ORDER BY day_key DESC').all<CompletionRow>(),
      db.prepare(`SELECT r.id, r.guest_name, r.guest_email, r.party_size, r.notes, s.starts_at FROM reservations r JOIN slots s ON s.id = r.slot_id WHERE r.status = 'confirmed' ORDER BY s.starts_at ASC`).all<ReservationRow>(),
    ]);
    const prefResult=reservationResult.results.length?await db.prepare(`SELECT reservation_id, seat_index, preference FROM reservation_preferences WHERE reservation_id IN (${reservationResult.results.map(()=>'?').join(',')}) ORDER BY seat_index ASC`).bind(...reservationResult.results.map(r=>r.id)).all<PreferenceRow>():{results:[] as PreferenceRow[]};
    const prefsByReservation=new Map<string,string[]>();
    for(const p of prefResult.results){const list=prefsByReservation.get(p.reservation_id)??[];list.push(p.preference);prefsByReservation.set(p.reservation_id,list);}
    const completions=new Map(completionResult.results.map(c=>[c.day_key,c]));
    const grouped=new Map<string,{dayKey:string;startsAt:string;endsAt:string;capacity:number;reserved:number;slotCount:number;slotIds:string[];isOpen:boolean;actualAttendees?:number;completedAt?:string;reservations:{id:string;guestName:string;guestEmail:string;partySize:number;preferences:string[];notes:string}[]}>();
    for(const slot of slotResult.results){const key=dayKey(slot.starts_at);const current=grouped.get(key);if(current){current.endsAt=slot.ends_at>current.endsAt?slot.ends_at:current.endsAt;current.capacity+=slot.capacity;current.reserved+=Number(slot.reserved);current.slotCount+=1;current.slotIds.push(slot.id);current.isOpen=current.isOpen||Boolean(slot.is_open);}else{grouped.set(key,{dayKey:key,startsAt:slot.starts_at,endsAt:slot.ends_at,capacity:slot.capacity,reserved:Number(slot.reserved),slotCount:1,slotIds:[slot.id],isOpen:Boolean(slot.is_open),reservations:[]});}}
    for(const r of reservationResult.results){const day=grouped.get(dayKey(r.starts_at));if(day)day.reservations.push({id:r.id,guestName:r.guest_name,guestEmail:r.guest_email,partySize:r.party_size,preferences:prefsByReservation.get(r.id)??Array(r.party_size).fill('none'),notes:r.notes});}
    for(const [key,completion] of completions){const day=grouped.get(key);if(day){day.actualAttendees=completion.actual_attendees;day.completedAt=completion.completed_at;day.isOpen=false;}}
    const all=[...grouped.values()];
    return Response.json({isChef:true,days:all.filter(d=>d.isOpen&&!d.completedAt),history:all.filter(d=>d.completedAt).sort((a,b)=>b.dayKey.localeCompare(a.dayKey))});
  }catch{return Response.json({isChef:false,days:[],history:[]});}
}

export async function POST(request:Request){
  try{
    if(!await authenticateAdmin(request))return Response.json({error:'גישת מנהל בלבד'},{status:403});
    const b=await request.json() as {date?:string;timezoneOffset?:number;slots?:Array<{startTime?:string;durationMinutes?:number;capacity?:number}>};
    if(!b.date||!Number.isInteger(b.timezoneOffset)||!Array.isArray(b.slots)||!b.slots.length||b.slots.length>24)return Response.json({error:'בחרו תאריך והוסיפו בין משבצת אחת ל־24 משבצות'},{status:400});
    const [y,m,d]=b.date.split('-').map(Number);
    const slots=b.slots.map(item=>{if(!/^\d{2}:\d{2}$/.test(item.startTime||'')||!Number.isInteger(item.durationMinutes)||item.durationMinutes!<15||item.durationMinutes!>180||!Number.isInteger(item.capacity)||item.capacity!<1||item.capacity!>100)throw new Error('בדקו את השעה, משך הישיבה ומספר המקומות בכל משבצת');const [h,min]=item.startTime!.split(':').map(Number);const start=new Date(Date.UTC(y,m-1,d,h,min)+b.timezoneOffset!*60_000);return{id:crypto.randomUUID(),startsAt:start.toISOString(),endsAt:new Date(start.getTime()+item.durationMinutes!*60_000).toISOString(),capacity:item.capacity!};}).sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
    if(new Set(slots.map(s=>s.startsAt)).size!==slots.length||slots.some(s=>new Date(s.startsAt)<new Date()))return Response.json({error:'כל שעה צריכה להופיע פעם אחת ולהיות בעתיד'},{status:400});
    await ensureSchema();const db=database();await db.batch(slots.map(s=>db.prepare(`INSERT INTO slots (id, starts_at, ends_at, capacity, is_open, created_at) VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(starts_at) DO UPDATE SET capacity=excluded.capacity, ends_at=excluded.ends_at, is_open=1`).bind(s.id,s.startsAt,s.endsAt,s.capacity,new Date().toISOString())));
    await db.prepare('DELETE FROM service_days WHERE day_key = ?').bind(b.date).run();
    return Response.json({created:slots.length},{status:201});
  }catch(error){return Response.json({error:error instanceof Error?error.message:'לא הצלחנו ליצור את המועדים'},{status:500});}
}

export async function PATCH(request:Request){
  try{
    const admin=await authenticateAdmin(request);if(!admin)return Response.json({error:'גישת מנהל בלבד'},{status:403});
    const {dayKey:date,actualAttendees}=await request.json() as {dayKey?:string;actualAttendees?:number};
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!Number.isInteger(actualAttendees)||actualAttendees!<0||actualAttendees!>1000)return Response.json({error:'בדקו את התאריך ומספר האורחים שהגיעו'},{status:400});
    await ensureSchema();const db=database();const rows=await db.prepare('SELECT id, starts_at FROM slots').all<{id:string;starts_at:string}>();const ids=rows.results.filter(s=>dayKey(s.starts_at)===date).map(s=>s.id);if(!ids.length)return Response.json({error:'הארוחה לא נמצאה'},{status:404});
    await db.batch([db.prepare(`INSERT INTO service_days (day_key, actual_attendees, completed_at, completed_by) VALUES (?, ?, ?, ?) ON CONFLICT(day_key) DO UPDATE SET actual_attendees=excluded.actual_attendees, completed_at=excluded.completed_at, completed_by=excluded.completed_by`).bind(date,actualAttendees,new Date().toISOString(),admin.email),...ids.map(id=>db.prepare('UPDATE slots SET is_open = 0 WHERE id = ?').bind(id))]);
    return Response.json({completed:true});
  }catch(error){return Response.json({error:error instanceof Error?error.message:'לא הצלחנו להשלים את הארוחה'},{status:500});}
}

export async function DELETE(request:Request){
  try{
    if(!await authenticateAdmin(request))return Response.json({error:'גישת מנהל בלבד'},{status:403});
    const {dayKey:date,hard}=await request.json() as {dayKey?:string;hard?:boolean};if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return Response.json({error:'חסר תאריך'},{status:400});
    await ensureSchema();const db=database();
    if(hard){
      // Permanently erases a completed day: its slots (reservations and their seat
      // preferences cascade with them) and the history record itself.
      const rows=await db.prepare('SELECT id, starts_at FROM slots').all<{id:string;starts_at:string}>();const ids=rows.results.filter(s=>dayKey(s.starts_at)===date).map(s=>s.id);
      if(!ids.length&&!(await db.prepare('SELECT day_key FROM service_days WHERE day_key = ?').bind(date).first()))return Response.json({error:'הארוחה לא נמצאה'},{status:404});
      await db.batch([...ids.map(id=>db.prepare('DELETE FROM slots WHERE id = ?').bind(id)),db.prepare('DELETE FROM service_days WHERE day_key = ?').bind(date)]);
      return Response.json({deleted:true});
    }
    const rows=await db.prepare('SELECT id, starts_at FROM slots WHERE is_open = 1').all<{id:string;starts_at:string}>();const ids=rows.results.filter(s=>dayKey(s.starts_at)===date).map(s=>s.id);if(!ids.length)return Response.json({error:'הארוחה לא נמצאה'},{status:404});await db.batch(ids.map(id=>db.prepare('UPDATE slots SET is_open = 0 WHERE id = ?').bind(id)));return Response.json({deleted:true});
  }catch(error){return Response.json({error:error instanceof Error?error.message:'לא הצלחנו למחוק את הארוחה'},{status:500});}
}
