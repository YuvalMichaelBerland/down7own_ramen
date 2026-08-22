'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { GoogleSignIn } from '../components/GoogleSignIn';

type Admin={email:string;added_at:string};
type PlannedSlot={key:string;startTime:string;durationMinutes:number;capacity:number};
type ReservationRow={id:string;guestName:string;guestEmail:string;partySize:number};
type ServiceDay={dayKey:string;startsAt:string;endsAt:string;capacity:number;reserved:number;slotCount:number;actualAttendees?:number;completedAt?:string;reservations:ReservationRow[]};
const newSlot=(startTime='19:00',capacity=10,durationMinutes=30):PlannedSlot=>({key:crypto.randomUUID(),startTime,durationMinutes,capacity});
const fmtDate=(iso:string)=>new Intl.DateTimeFormat('he-IL',{weekday:'short',day:'numeric',month:'short'}).format(new Date(iso));
const fmtTime=(iso:string)=>new Intl.DateTimeFormat('he-IL',{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso));

export default function Admin(){
  const [credential,setCredential]=useState('');
  const [platformAdmin,setPlatformAdmin]=useState<boolean|null>(null);
  const [date,setDate]=useState('');
  const [slots,setSlots]=useState<PlannedSlot[]>([newSlot()]);
  const [rangeStart,setRangeStart]=useState('19:00');
  const [rangeEnd,setRangeEnd]=useState('21:00');
  const [interval,setInterval]=useState(30);
  const [rangeCapacity,setRangeCapacity]=useState(10);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [admins,setAdmins]=useState<Admin[]>([]);
  const [newAdmin,setNewAdmin]=useState('');
  const [published,setPublished]=useState<ServiceDay[]>([]);
  const [history,setHistory]=useState<ServiceDay[]>([]);
  const authHeaders=useCallback(():Record<string,string>=>credential?{authorization:`Bearer ${credential}`}:{},[credential]);
  const loadAdmins=useCallback(async()=>{const r=await fetch('/api/admin/admins',{headers:authHeaders()});if(r.ok){const d=await r.json() as {admins:Admin[]};setAdmins(d.admins);}},[authHeaders]);
  const loadPublished=useCallback(async()=>{try{const r=await fetch('/api/admin/slots',{headers:authHeaders()});const d=await r.json() as {isChef:boolean;days?:ServiceDay[];history?:ServiceDay[]};setPlatformAdmin(d.isChef);setPublished(d.days||[]);setHistory(d.history||[]);}catch{setPlatformAdmin(false);}},[authHeaders]);
  useEffect(()=>{loadPublished();},[loadPublished]);
  const authorized=platformAdmin||Boolean(credential);
  useEffect(()=>{if(authorized)loadAdmins();},[authorized,loadAdmins]);
  function updateSlot(key:string,patch:Partial<PlannedSlot>){setSlots(current=>current.map(s=>s.key===key?{...s,...patch}:s));}
  function generate(){const [sh,sm]=rangeStart.split(':').map(Number),[eh,em]=rangeEnd.split(':').map(Number);const start=sh*60+sm,end=eh*60+em;if(end<=start){setMessage('שעת הסיום צריכה להיות אחרי שעת ההתחלה.');return;}const generated:PlannedSlot[]=[];for(let minute=start;minute<end&&generated.length<24;minute+=interval){generated.push(newSlot(`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`,rangeCapacity,interval));}setSlots(generated);setMessage('אפשר לערוך, למחוק או להוסיף משבצות לפני הפרסום.');}
  async function create(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage('');const timezoneOffset=new Date(`${date}T${slots[0]?.startTime||'00:00'}:00`).getTimezoneOffset();const r=await fetch('/api/admin/slots',{method:'POST',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({date,timezoneOffset,slots:slots.map(({startTime,durationMinutes,capacity})=>({startTime,durationMinutes,capacity}))})});const d=await r.json() as {created?:number;error?:string};setMessage(r.ok?`${d.created} משבצות פורסמו להזמנה.`:d.error||'לא הצלחנו לפתוח את המועדים');setBusy(false);if(r.ok)await loadPublished();}
  async function deleteDay(day:ServiceDay){if(!window.confirm(`למחוק את כל זמני ההזמנה של ${fmtDate(day.startsAt)}?`))return;const r=await fetch('/api/admin/slots',{method:'DELETE',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({dayKey:day.dayKey})});const d=await r.json() as {error?:string};setMessage(r.ok?'הארוחה נמחקה.':d.error||'לא הצלחנו למחוק את הארוחה');if(r.ok)await loadPublished();}
  async function completeDay(day:ServiceDay,e:React.FormEvent<HTMLFormElement>){e.preventDefault();const actualAttendees=Number(new FormData(e.currentTarget).get('actualAttendees'));const r=await fetch('/api/admin/slots',{method:'PATCH',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({dayKey:day.dayKey,actualAttendees})});const d=await r.json() as {error?:string};setMessage(r.ok?'הארוחה סומנה כהושלמה.':d.error||'לא הצלחנו לעדכן את הארוחה');if(r.ok)await loadPublished();}
  async function addAdmin(e:React.FormEvent){e.preventDefault();const r=await fetch('/api/admin/admins',{method:'POST',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({email:newAdmin})});const d=await r.json() as {error?:string};if(!r.ok){setMessage(d.error||'לא הצלחנו להוסיף מנהל');return;}setNewAdmin('');setMessage('המנהל נוסף בהצלחה.');await loadAdmins();}
  async function removeAdmin(email:string){const r=await fetch('/api/admin/admins',{method:'DELETE',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({email})});const d=await r.json() as {error?:string};if(!r.ok){setMessage(d.error||'לא הצלחנו להסיר מנהל');return;}await loadAdmins();}
  async function updateReservation(id:string,patch:Partial<Pick<ReservationRow,'guestName'|'guestEmail'|'partySize'>>){const r=await fetch('/api/admin/reservations',{method:'PATCH',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({id,...patch})});const d=await r.json() as {error?:string};if(!r.ok){setMessage(d.error||'לא הצלחנו לעדכן את ההזמנה');return;}await loadPublished();}
  async function cancelReservation(id:string){if(!window.confirm('לבטל את ההזמנה הזו?'))return;const r=await fetch('/api/admin/reservations',{method:'DELETE',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({id})});const d=await r.json() as {error?:string};if(!r.ok){setMessage(d.error||'לא הצלחנו לבטל את ההזמנה');return;}await loadPublished();}
  const totalActual=history.reduce((sum,d)=>sum+(d.actualAttendees||0),0),totalReserved=history.reduce((sum,d)=>sum+d.reserved,0);
  return <main className="admin-page">
    <nav className="nav"><Link className="brand" href="/"><img src="/ramen-logo.png" alt="Down7own Ramen"/><span>DOWN7OWN RAMEN</span></Link><Link className="chef-link" href="/">לתצוגת אורחים</Link></nav>
    <section className="admin-wrap">
      <div className="admin-heading"><h1>פתיחת זמני הזמנה</h1><p>צרו סדרת שעות במהירות, ואז התאימו כל משבצת בנפרד — שעה, משך ישיבה ומספר אורחים.</p></div>
      <div className="admin-column">
        <div className="admin-card slot-builder">
          {platformAdmin===null?<p className="empty-copy">בודק הרשאת מנהל…</p>:!authorized?<><p className="kicker">כניסת מנהלים</p><h2>התחברות עם Google</h2><p className="empty-copy">מנהלים מורשים יכולים להתחבר עם חשבון Gmail ולפתוח מועדים.</p><GoogleSignIn onCredential={setCredential}/></>:<form onSubmit={create}>
            <p className="kicker">תכנון משבצות</p>
            <label>תאריך<input required type="date" value={date} min={new Date().toISOString().slice(0,10)} onChange={e=>setDate(e.target.value)}/></label>
            <div className="generator"><div className="form-row"><label>משעה<input type="time" value={rangeStart} onChange={e=>setRangeStart(e.target.value)}/></label><label>עד שעה<input type="time" value={rangeEnd} onChange={e=>setRangeEnd(e.target.value)}/></label></div><div className="form-row"><label>מרווח<select value={interval} onChange={e=>setInterval(Number(e.target.value))}><option value="30">כל 30 דקות</option><option value="60">כל שעה</option><option value="90">כל שעה וחצי</option></select></label><label>אורחים למשבצת<input type="number" min="1" max="100" value={rangeCapacity} onChange={e=>setRangeCapacity(Number(e.target.value))}/></label></div><button className="generate-button" type="button" onClick={generate}>יצירת סדרה</button></div>
            <div className="planned-slots"><div className="slot-labels"><span>שעה</span><span>משך</span><span>אורחים</span><span/></div>{slots.map(slot=><div className="planned-slot" key={slot.key}><input aria-label="שעת התחלה" type="time" step="900" value={slot.startTime} onChange={e=>updateSlot(slot.key,{startTime:e.target.value})}/><select aria-label="משך הישיבה" value={slot.durationMinutes} onChange={e=>updateSlot(slot.key,{durationMinutes:Number(e.target.value)})}><option value="30">30 דק׳</option><option value="45">45 דק׳</option><option value="60">שעה</option><option value="90">שעה וחצי</option></select><input aria-label="מספר אורחים" type="number" min="1" max="100" value={slot.capacity} onChange={e=>updateSlot(slot.key,{capacity:Number(e.target.value)})}/><button type="button" onClick={()=>setSlots(current=>current.filter(s=>s.key!==slot.key))} aria-label={`מחיקת ${slot.startTime}`}>×</button></div>)}</div>
            <button className="add-slot" type="button" onClick={()=>setSlots(current=>[...current,newSlot(current.at(-1)?.startTime||'19:00',current.at(-1)?.capacity||10,current.at(-1)?.durationMinutes||30)])}>+ הוספת משבצת ידנית</button><button className="reserve" disabled={busy||!slots.length}>{busy?'מפרסם…':'פרסום המשבצות'}<span>←</span></button>
          </form>}
        </div>
        {authorized&&<div className="admin-card published-card"><p className="kicker">ארוחות שפורסמו</p><h2>מועדים פתוחים</h2>{published.length?<div className="published-list">{published.map(day=><div className="published-day" key={day.dayKey}><div className="day-summary"><div><strong>{fmtDate(day.startsAt)}</strong><span>{fmtTime(day.startsAt)}–{fmtTime(day.endsAt)} · {day.reserved}/{day.capacity} מוזמנים · {day.slotCount} משבצות</span></div><button type="button" onClick={()=>deleteDay(day)}>מחיקה</button></div><form className="complete-day" onSubmit={e=>completeDay(day,e)}><label>כמה הגיעו בפועל?<input name="actualAttendees" type="number" min="0" max="1000" defaultValue={day.reserved}/></label><button type="submit">סימון כהושלם</button></form></div>)}</div>:<p className="empty-copy">אין כרגע מועדים פתוחים.</p>}</div>}
        {authorized&&<div className="admin-card history-card"><p className="kicker">נתוני עבר</p><h2>היסטוריית ארוחות</h2><div className="dashboard-stats"><div><strong>{history.length}</strong><span>ארוחות</span></div><div><strong>{totalReserved}</strong><span>הזמנות</span></div><div><strong>{totalActual}</strong><span>הגיעו בפועל</span></div></div>{history.length?<div className="history-list">{history.map(day=><div key={day.dayKey}><div><strong>{fmtDate(day.startsAt)}</strong><span>{day.reserved} הוזמנו · {day.capacity} מקומות</span></div><form onSubmit={e=>completeDay(day,e)}><input aria-label="מספר שהגיעו בפועל" name="actualAttendees" type="number" min="0" max="1000" defaultValue={day.actualAttendees}/><button type="submit">עדכון</button></form></div>)}</div>:<p className="empty-copy">הנתונים יופיעו כאן אחרי סימון הארוחה הראשונה כהושלמה.</p>}</div>}
        {authorized&&<div className="admin-card reservations-card"><p className="kicker">הזמנות לפי תאריך</p><h2>אורחים</h2>{[...published,...history].length?[...published,...history].sort((a,b)=>b.startsAt.localeCompare(a.startsAt)).map(day=><div className="reservations-day" key={day.dayKey}><strong>{fmtDate(day.startsAt)}</strong>{day.reservations.length?<table className="reservations-table"><thead><tr><th>מזהה</th><th>אימייל</th><th>סועדים</th><th/></tr></thead><tbody>{day.reservations.map(r=><tr key={r.id}><td>{r.id.slice(0,8).toUpperCase()}</td><td><input defaultValue={r.guestEmail} onBlur={e=>e.target.value!==r.guestEmail&&updateReservation(r.id,{guestEmail:e.target.value})}/></td><td><select defaultValue={r.partySize} onChange={e=>updateReservation(r.id,{partySize:Number(e.target.value)})}>{Array.from({length:10},(_,i)=><option key={i+1}>{i+1}</option>)}</select></td><td><button type="button" onClick={()=>cancelReservation(r.id)}>ביטול</button></td></tr>)}</tbody></table>:<p className="empty-copy">אין הזמנות ליום זה.</p>}</div>):<p className="empty-copy">אין עדיין הזמנות.</p>}</div>}
        {authorized&&<div className="admin-card admins-card"><p className="kicker">מנהלי האתר</p><h2>הרשאות Gmail</h2><form className="add-admin" onSubmit={addAdmin}><label>הוספת מנהל לפי אימייל<input required type="email" placeholder="name@gmail.com" value={newAdmin} onChange={e=>setNewAdmin(e.target.value)}/></label><button type="submit">הוספה</button></form><div className="admin-list">{admins.map(a=><div key={a.email}><span>{a.email}</span><button type="button" onClick={()=>removeAdmin(a.email)} aria-label={`הסרת ${a.email}`}>הסרה</button></div>)}</div></div>}
        {message&&<p className="form-message" role="status">{message}</p>}
      </div>
    </section>
  </main>;
}
