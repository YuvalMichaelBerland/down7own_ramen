import { database, ensureSchema } from '@/app/lib/database';
import { authenticateAdmin } from '@/app/lib/admin';
import { menusForSlots, type MenuItem } from '@/app/lib/menus';
import { resetStalePreferences } from '@/app/lib/preferences';

type SlotRow={id:string;starts_at:string;ends_at:string;capacity:number;is_open:number;reserved:number};
type CompletionRow={day_key:string;actual_attendees:number;completed_at:string};
type ReservationRow={id:string;slot_id:string;guest_name:string;guest_email:string;guest_phone:string;party_size:number;notes:string;arrived:number;starts_at:string};
type PreferenceRow={reservation_id:string;seat_index:number;preference:string};
type AdminReservation={id:string;guestName:string;guestEmail:string;guestPhone:string;partySize:number;preferences:string[];notes:string;startsAt:string;arrived:boolean;menu:MenuItem[]};
type SlotEntry={id:string;startsAt:string;endsAt:string;capacity:number;reserved:number;menu:MenuItem[]};
const dayKey=(iso:string)=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso)).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}`;};
// A slot's window from its day, the wall-clock start time and the browser's timezone offset.
function slotWindow(date:string,startTime:string,durationMinutes:number,timezoneOffset:number){
  const [y,m,d]=date.split('-').map(Number);const [h,min]=startTime.split(':').map(Number);
  const startsAt=new Date(Date.UTC(y,m-1,d,h,min)+timezoneOffset*60_000);
  return{startsAt:startsAt.toISOString(),endsAt:new Date(startsAt.getTime()+durationMinutes*60_000).toISOString()};
}
const validSlotFields=(item:{startTime?:string;durationMinutes?:number;capacity?:number})=>/^\d{2}:\d{2}$/.test(item.startTime||'')&&Number.isInteger(item.durationMinutes)&&item.durationMinutes!>=15&&item.durationMinutes!<=180&&Number.isInteger(item.capacity)&&item.capacity!>=1&&item.capacity!<=100;
// Returns the de-duplicated dish ids when every one exists in the library, otherwise undefined.
async function knownMenuIds(raw:unknown){
  const ids=[...new Set(Array.isArray(raw)?raw:[])];
  if(!ids.length||ids.some(id=>typeof id!=='string'))return undefined;
  const known=await database().prepare(`SELECT id FROM menu_options WHERE id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).all<{id:string}>();
  return known.results.length===ids.length?ids as string[]:undefined;
}

export async function GET(request:Request){
  try{
    if(!await authenticateAdmin(request))return Response.json({isChef:false,days:[],history:[]});
    await ensureSchema();const db=database();
    const [slotResult,completionResult,reservationResult]=await Promise.all([
      db.prepare(`SELECT s.id, s.starts_at, s.ends_at, s.capacity, s.is_open, COALESCE(SUM(CASE WHEN r.status = 'confirmed' THEN r.party_size ELSE 0 END), 0) AS reserved FROM slots s LEFT JOIN reservations r ON r.slot_id = s.id GROUP BY s.id ORDER BY s.starts_at ASC LIMIT 500`).all<SlotRow>(),
      db.prepare('SELECT day_key, actual_attendees, completed_at FROM service_days ORDER BY day_key DESC').all<CompletionRow>(),
      db.prepare(`SELECT r.id, r.slot_id, r.guest_name, r.guest_email, r.guest_phone, r.party_size, r.notes, r.arrived, s.starts_at FROM reservations r JOIN slots s ON s.id = r.slot_id WHERE r.status = 'confirmed' ORDER BY s.starts_at ASC`).all<ReservationRow>(),
    ]);
    const prefResult=reservationResult.results.length?await db.prepare(`SELECT reservation_id, seat_index, preference FROM reservation_preferences WHERE reservation_id IN (${reservationResult.results.map(()=>'?').join(',')}) ORDER BY seat_index ASC`).bind(...reservationResult.results.map(r=>r.id)).all<PreferenceRow>():{results:[] as PreferenceRow[]};
    const prefsByReservation=new Map<string,string[]>();
    for(const p of prefResult.results){const list=prefsByReservation.get(p.reservation_id)??[];list.push(p.preference);prefsByReservation.set(p.reservation_id,list);}
    const menus=await menusForSlots(slotResult.results.map(s=>s.id));
    const completions=new Map(completionResult.results.map(c=>[c.day_key,c]));
    const grouped=new Map<string,{dayKey:string;startsAt:string;endsAt:string;capacity:number;reserved:number;slotCount:number;slotIds:string[];isOpen:boolean;actualAttendees?:number;completedAt?:string;menu:MenuItem[];reservations:AdminReservation[];slots:SlotEntry[]}>();
    for(const slot of slotResult.results){const key=dayKey(slot.starts_at);const current=grouped.get(key);const slotEntry:SlotEntry={id:slot.id,startsAt:slot.starts_at,endsAt:slot.ends_at,capacity:slot.capacity,reserved:Number(slot.reserved),menu:menus.get(slot.id)??[]};if(current){current.endsAt=slot.ends_at>current.endsAt?slot.ends_at:current.endsAt;current.capacity+=slot.capacity;current.reserved+=Number(slot.reserved);current.slotCount+=1;current.slotIds.push(slot.id);current.isOpen=current.isOpen||Boolean(slot.is_open);current.slots.push(slotEntry);}else{grouped.set(key,{dayKey:key,startsAt:slot.starts_at,endsAt:slot.ends_at,capacity:slot.capacity,reserved:Number(slot.reserved),slotCount:1,slotIds:[slot.id],isOpen:Boolean(slot.is_open),menu:[],reservations:[],slots:[slotEntry]});}}
    // A day's columns are the union of the dishes its slots serve.
    for(const slot of slotResult.results){const day=grouped.get(dayKey(slot.starts_at));if(day)for(const item of menus.get(slot.id)??[])if(!day.menu.some(m=>m.id===item.id))day.menu.push(item);}
    for(const day of grouped.values())day.menu.sort((a,b)=>a.label.localeCompare(b.label,'he'));
    for(const r of reservationResult.results){const day=grouped.get(dayKey(r.starts_at));if(day)day.reservations.push({id:r.id,guestName:r.guest_name,guestEmail:r.guest_email,guestPhone:r.guest_phone,partySize:r.party_size,preferences:prefsByReservation.get(r.id)??Array(r.party_size).fill('none'),notes:r.notes,startsAt:r.starts_at,arrived:Boolean(r.arrived),menu:menus.get(r.slot_id)??[]});}
    for(const [key,completion] of completions){const day=grouped.get(key);if(day){day.actualAttendees=completion.actual_attendees;day.completedAt=completion.completed_at;day.isOpen=false;}}
    const all=[...grouped.values()];
    return Response.json({isChef:true,days:all.filter(d=>d.isOpen&&!d.completedAt),history:all.filter(d=>d.completedAt).sort((a,b)=>b.dayKey.localeCompare(a.dayKey))});
  }catch{return Response.json({isChef:false,days:[],history:[]});}
}

export async function POST(request:Request){
  try{
    if(!await authenticateAdmin(request))return Response.json({error:'גישת מנהל בלבד'},{status:403});
    const b=await request.json() as {date?:string;timezoneOffset?:number;menuOptionIds?:string[];slots?:Array<{startTime?:string;durationMinutes?:number;capacity?:number}>};
    if(!b.date||!Number.isInteger(b.timezoneOffset)||!Array.isArray(b.slots)||!b.slots.length||b.slots.length>24)return Response.json({error:'בחרו תאריך והוסיפו בין משבצת אחת ל־24 משבצות'},{status:400});
    const slots=b.slots.map(item=>{if(!validSlotFields(item))throw new Error('בדקו את השעה, משך הישיבה ומספר המקומות בכל משבצת');const {startsAt,endsAt}=slotWindow(b.date!,item.startTime!,item.durationMinutes!,b.timezoneOffset!);return{id:crypto.randomUUID(),startsAt,endsAt,capacity:item.capacity!};}).sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
    if(new Set(slots.map(s=>s.startsAt)).size!==slots.length||slots.some(s=>new Date(s.startsAt)<new Date()))return Response.json({error:'כל שעה צריכה להופיע פעם אחת ולהיות בעתיד'},{status:400});
    await ensureSchema();const db=database();
    const menuIds=await knownMenuIds(b.menuOptionIds);
    if(!menuIds)return Response.json({error:'בחרו לפחות אפשרות מנה אחת למועד, והיא חייבת להיות קיימת'},{status:400});
    // An open slot at the same time already exists, so publishing it again would silently overwrite it.
    const taken=await db.prepare(`SELECT starts_at FROM slots WHERE is_open = 1 AND starts_at IN (${slots.map(()=>'?').join(',')})`).bind(...slots.map(s=>s.startsAt)).all<{starts_at:string}>();
    if(taken.results.length)return Response.json({error:'כבר קיימת משבצת בשעה הזו. בחרו שעה אחרת'},{status:409});
    // Each slot gets exactly the dishes chosen for this publish, so another day's menu stays separate.
    await db.batch([
      ...slots.map(s=>db.prepare(`INSERT INTO slots (id, starts_at, ends_at, capacity, is_open, created_at) VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(starts_at) DO UPDATE SET capacity=excluded.capacity, ends_at=excluded.ends_at, is_open=1`).bind(s.id,s.startsAt,s.endsAt,s.capacity,new Date().toISOString())),
      ...slots.map(s=>db.prepare('DELETE FROM slot_menu_options WHERE slot_id IN (SELECT id FROM slots WHERE starts_at = ?)').bind(s.startsAt)),
      ...slots.map(s=>db.prepare('INSERT INTO slot_menu_options (slot_id, option_id) SELECT slots.id, json_each.value FROM slots, json_each(?) WHERE slots.starts_at = ?').bind(JSON.stringify(menuIds),s.startsAt)),
    ]);
    await resetStalePreferences();
    await db.prepare('DELETE FROM service_days WHERE day_key = ?').bind(b.date).run();
    return Response.json({created:slots.length},{status:201});
  }catch(error){return Response.json({error:error instanceof Error?error.message:'לא הצלחנו ליצור את המועדים'},{status:500});}
}

// Edits one open slot's time, length, capacity and dishes. Its day stays the same.
export async function PATCH(request:Request){
  try{
    if(!await authenticateAdmin(request))return Response.json({error:'גישת מנהל בלבד'},{status:403});
    const b=await request.json() as {slotId?:string;timezoneOffset?:number;startTime?:string;durationMinutes?:number;capacity?:number;menuOptionIds?:string[]};
    if(!b.slotId||!Number.isInteger(b.timezoneOffset)||!validSlotFields(b))return Response.json({error:'בדקו את השעה, משך הישיבה ומספר המקומות'},{status:400});
    await ensureSchema();const db=database();
    const menuIds=await knownMenuIds(b.menuOptionIds);
    if(!menuIds)return Response.json({error:'בחרו לפחות אפשרות מנה אחת למועד, והיא חייבת להיות קיימת'},{status:400});
    const slot=await db.prepare('SELECT id, starts_at, ends_at, is_open FROM slots WHERE id = ?').bind(b.slotId).first<{id:string;starts_at:string;ends_at:string;is_open:number}>();
    if(!slot)return Response.json({error:'המשבצת לא נמצאה'},{status:404});
    if(!slot.is_open||slot.ends_at<new Date().toISOString())return Response.json({error:'אי אפשר לערוך משבצת סגורה או שכבר הסתיימה'},{status:409});
    const {startsAt,endsAt}=slotWindow(dayKey(slot.starts_at),b.startTime!,b.durationMinutes!,b.timezoneOffset!);
    if(new Date(startsAt)<new Date())return Response.json({error:'השעה החדשה צריכה להיות בעתיד'},{status:400});
    const clash=await db.prepare('SELECT id FROM slots WHERE starts_at = ? AND id != ?').bind(startsAt,b.slotId).first<{id:string}>();
    if(clash)return Response.json({error:'כבר קיימת משבצת בשעה הזו. בחרו שעה אחרת'},{status:409});
    const reserved=await db.prepare(`SELECT COALESCE(SUM(party_size), 0) AS sum FROM reservations WHERE slot_id = ? AND status = 'confirmed'`).bind(b.slotId).first<{sum:number}>();
    if(Number(reserved?.sum||0)>b.capacity!)return Response.json({error:'יש יותר הזמנות ממספר המקומות שהוזן'},{status:409});
    await db.batch([
      db.prepare('UPDATE slots SET starts_at = ?, ends_at = ?, capacity = ? WHERE id = ?').bind(startsAt,endsAt,b.capacity,b.slotId),
      db.prepare('DELETE FROM slot_menu_options WHERE slot_id = ?').bind(b.slotId),
      db.prepare('INSERT INTO slot_menu_options (slot_id, option_id) SELECT slots.id, json_each.value FROM slots, json_each(?) WHERE slots.id = ?').bind(JSON.stringify(menuIds),b.slotId),
    ]);
    await resetStalePreferences();
    return Response.json({updated:true});
  }catch(error){return Response.json({error:error instanceof Error?error.message:'לא הצלחנו לעדכן את המשבצת'},{status:500});}
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
      await db.batch([...ids.map(id=>db.prepare('DELETE FROM slot_menu_options WHERE slot_id = ?').bind(id)),...ids.map(id=>db.prepare('DELETE FROM slots WHERE id = ?').bind(id)),db.prepare('DELETE FROM service_days WHERE day_key = ?').bind(date)]);
      return Response.json({deleted:true});
    }
    const rows=await db.prepare('SELECT id, starts_at FROM slots WHERE is_open = 1').all<{id:string;starts_at:string}>();const ids=rows.results.filter(s=>dayKey(s.starts_at)===date).map(s=>s.id);if(!ids.length)return Response.json({error:'הארוחה לא נמצאה'},{status:404});await db.batch(ids.map(id=>db.prepare('UPDATE slots SET is_open = 0 WHERE id = ?').bind(id)));return Response.json({deleted:true});
  }catch(error){return Response.json({error:error instanceof Error?error.message:'לא הצלחנו למחוק את הארוחה'},{status:500});}
}
