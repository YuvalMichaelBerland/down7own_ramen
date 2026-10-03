'use client';
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { GoogleSignIn } from '../components/GoogleSignIn';
import { ChatPanel } from '../components/ChatPanel';
import { useSession } from '../lib/useSession';

type Admin={email:string;added_at:string};
type PlannedSlot={key:string;startTime:string;durationMinutes:number;capacity:number};
type MenuOption={id:string;label:string};
type ReservationRow={id:string;guestName:string;guestEmail:string;guestPhone:string;partySize:number;preferences:string[];notes:string;startsAt:string;arrived:boolean;menu:MenuOption[]};
type Thread={subject:string;guestName:string;guestEmail:string;lastAt:string;unread:number};
type SlotInfo={id:string;startsAt:string;endsAt:string;capacity:number;reserved:number;menu:MenuOption[]};
type SlotEdit={id:string;startTime:string;durationMinutes:number;capacity:number;menuIds:string[]};
type ServiceDay={dayKey:string;startsAt:string;endsAt:string;capacity:number;reserved:number;slotCount:number;actualAttendees?:number;completedAt?:string;menu:MenuOption[];reservations:ReservationRow[];slots:SlotInfo[]};
const newSlot=(startTime='19:00',capacity=10,durationMinutes=30):PlannedSlot=>({key:crypto.randomUUID(),startTime,durationMinutes,capacity});
const fmtDate=(iso:string)=>new Intl.DateTimeFormat('he-IL',{weekday:'short',day:'numeric',month:'short'}).format(new Date(iso));
const fmtTime=(iso:string)=>new Intl.DateTimeFormat('he-IL',{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso));
const timeOfDay=(iso:string)=>new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso));
const parseDayKey=(k:string)=>{const [y,m,d]=k.split('-').map(Number);return new Date(y,m-1,d);};
const startOfWeek=(d:Date)=>{const date=new Date(d);date.setDate(date.getDate()-date.getDay());date.setHours(0,0,0,0);return date;};
const csvEscape=(v:string)=>`"${String(v).replace(/"/g,'""')}"`;
function buildWeekCsv(days:ServiceDay[]){
  const lines:string[]=[];
  for(const day of [...days].sort((a,b)=>a.dayKey.localeCompare(b.dayKey))){
    const menu=day.menu;
    lines.push(csvEscape(fmtDate(day.startsAt)));
    lines.push(['שעה','שם מלא','טלפון',...menu.map(o=>o.label),'הערה'].map(csvEscape).join(','));
    const sorted=[...day.reservations].sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
    const totals=menu.map(()=>0);
    for(const slot of [...day.slots].sort((a,b)=>a.startsAt.localeCompare(b.startsAt))){
      const slotReservations=sorted.filter(r=>r.startsAt===slot.startsAt);
      if(!slotReservations.length){lines.push([fmtTime(slot.startsAt),'','',...menu.map(()=>''),`פנוי (${slot.capacity})`].map(csvEscape).join(','));continue;}
      for(const r of slotReservations){
        const counts=menu.map(o=>r.preferences.filter(p=>p===o.id).length);
        counts.forEach((c,i)=>{totals[i]+=c;});
        lines.push([fmtTime(r.startsAt),r.guestName,r.guestPhone,...counts.map(String),r.notes||''].map(csvEscape).join(','));
      }
    }
    lines.push(['','סה״כ',String(sorted.reduce((s,r)=>s+r.partySize,0)),...totals.map(String),''].map(csvEscape).join(','));
    lines.push('');
  }
  return '﻿'+lines.join('\r\n');
}

export default function Admin(){
  const { token, signIn, authHeaders } = useSession();
  const [platformAdmin,setPlatformAdmin]=useState<boolean|null>(null);
  const [date,setDate]=useState('');
  const [slots,setSlots]=useState<PlannedSlot[]>([newSlot()]);
  const [rangeStart,setRangeStart]=useState('19:00');
  const [rangeEnd,setRangeEnd]=useState('21:00');
  const [slotInterval,setSlotInterval]=useState(30);
  const [rangeCapacity,setRangeCapacity]=useState(10);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [admins,setAdmins]=useState<Admin[]>([]);
  const [newAdmin,setNewAdmin]=useState('');
  const [published,setPublished]=useState<ServiceDay[]>([]);
  const [history,setHistory]=useState<ServiceDay[]>([]);
  const [menuOptions,setMenuOptions]=useState<MenuOption[]>([]);
  const [newOption,setNewOption]=useState('');
  const [threads,setThreads]=useState<Thread[]>([]);
  const [chatSubject,setChatSubject]=useState<string>();
  const [weekOffset,setWeekOffset]=useState(0);
  const [weekAutoSet,setWeekAutoSet]=useState(false);
  // Dishes for the day being published; undefined means "all of them" until the chef changes it.
  const [dayMenu,setDayMenu]=useState<string[]>();
  const [editingSlot,setEditingSlot]=useState<SlotEdit>();
  const activeMenu=(dayMenu??menuOptions.map(o=>o.id)).filter(id=>menuOptions.some(o=>o.id===id));
  function toggleDayMenu(id:string){setDayMenu(activeMenu.includes(id)?activeMenu.filter(x=>x!==id):[...activeMenu,id]);}
  const loadMenuOptions=useCallback(async()=>{const r=await fetch('/api/menu-options');if(r.ok){const d=await r.json() as {options:MenuOption[]};setMenuOptions(d.options||[]);}},[]);
  useEffect(()=>{loadMenuOptions();},[loadMenuOptions]);
  const loadThreads=useCallback(async()=>{const r=await fetch('/api/admin/messages',{headers:authHeaders()});if(r.ok){const d=await r.json() as {threads:Thread[]};setThreads(d.threads||[]);}},[authHeaders]);
  async function completeChat(subject:string){if(!window.confirm('לסיים ולמחוק את השיחה?'))return;const r=await fetch(`/api/admin/messages?subject=${encodeURIComponent(subject)}`,{method:'DELETE',headers:authHeaders()});if(!r.ok){setMessage('לא הצלחנו לסיים את השיחה');return;}if(chatSubject===subject)setChatSubject(undefined);await loadThreads();}
  useEffect(()=>{if(authHeaders().authorization){loadThreads();const t=setInterval(loadThreads,10000);return()=>clearInterval(t);}},[authHeaders,loadThreads]);
  async function addOption(e:React.FormEvent){e.preventDefault();const r=await fetch('/api/menu-options',{method:'POST',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({label:newOption})});const d=await r.json() as {error?:string};if(!r.ok){setMessage(d.error||'לא הצלחנו להוסיף אפשרות');return;}setNewOption('');await loadMenuOptions();}
  async function removeOption(id:string){const r=await fetch('/api/menu-options',{method:'DELETE',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({id})});const d=await r.json() as {error?:string};if(!r.ok){setMessage(d.error||'לא הצלחנו להסיר אפשרות');return;}await loadMenuOptions();await loadPublished();}
  const loadAdmins=useCallback(async()=>{const r=await fetch('/api/admin/admins',{headers:authHeaders()});if(r.ok){const d=await r.json() as {admins:Admin[]};setAdmins(d.admins);}},[authHeaders]);
  const loadPublished=useCallback(async()=>{try{const r=await fetch('/api/admin/slots',{headers:authHeaders()});const d=await r.json() as {isChef:boolean;days?:ServiceDay[];history?:ServiceDay[]};setPlatformAdmin(d.isChef);setPublished(d.days||[]);setHistory(d.history||[]);}catch{setPlatformAdmin(false);}},[authHeaders]);
  useEffect(()=>{loadPublished();},[loadPublished]);
  const authorized=platformAdmin||Boolean(token);
  useEffect(()=>{if(authorized)loadAdmins();},[authorized,loadAdmins]);
  function updateSlot(key:string,patch:Partial<PlannedSlot>){setSlots(current=>current.map(s=>s.key===key?{...s,...patch}:s));}
  function generate(){const [sh,sm]=rangeStart.split(':').map(Number),[eh,em]=rangeEnd.split(':').map(Number);const start=sh*60+sm,end=eh*60+em;if(end<=start){setMessage('שעת הסיום צריכה להיות אחרי שעת ההתחלה.');return;}const generated:PlannedSlot[]=[];for(let minute=start;minute<end&&generated.length<24;minute+=slotInterval){generated.push(newSlot(`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`,rangeCapacity,slotInterval));}setSlots(generated);setMessage('אפשר לערוך, למחוק או להוסיף משבצות לפני הפרסום.');}
  async function create(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage('');const timezoneOffset=new Date(`${date}T${slots[0]?.startTime||'00:00'}:00`).getTimezoneOffset();const r=await fetch('/api/admin/slots',{method:'POST',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({date,timezoneOffset,menuOptionIds:activeMenu,slots:slots.map(({startTime,durationMinutes,capacity})=>({startTime,durationMinutes,capacity}))})});const d=await r.json() as {created?:number;error?:string};setMessage(r.ok?`${d.created} משבצות פורסמו להזמנה.`:d.error||'לא הצלחנו לפתוח את המועדים');setBusy(false);if(r.ok)await loadPublished();}
  async function deleteDay(day:ServiceDay){if(!window.confirm(`למחוק את כל זמני ההזמנה של ${fmtDate(day.startsAt)}?`))return;const r=await fetch('/api/admin/slots',{method:'DELETE',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({dayKey:day.dayKey})});const d=await r.json() as {error?:string};setMessage(r.ok?'הארוחה נמחקה.':d.error||'לא הצלחנו למחוק את הארוחה');if(r.ok)await loadPublished();}
  async function deleteHistory(day:ServiceDay){if(!window.confirm(`למחוק לצמיתות את הרשומה ההיסטורית של ${fmtDate(day.startsAt)}? הפעולה אינה הפיכה.`))return;const r=await fetch('/api/admin/slots',{method:'DELETE',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({dayKey:day.dayKey,hard:true})});const d=await r.json() as {error?:string};setMessage(r.ok?'הרשומה נמחקה.':d.error||'לא הצלחנו למחוק את הרשומה');if(r.ok)await loadPublished();}
  function startEditSlot(slot:SlotInfo){setEditingSlot({id:slot.id,startTime:timeOfDay(slot.startsAt),durationMinutes:Math.round((new Date(slot.endsAt).getTime()-new Date(slot.startsAt).getTime())/60000),capacity:slot.capacity,menuIds:slot.menu.map(o=>o.id)});}
  function toggleEditMenu(id:string){setEditingSlot(current=>current&&{...current,menuIds:current.menuIds.includes(id)?current.menuIds.filter(x=>x!==id):[...current.menuIds,id]});}
  async function saveSlotEdit(day:ServiceDay,e:React.FormEvent){e.preventDefault();if(!editingSlot)return;if(!editingSlot.menuIds.length){setMessage('בחרו לפחות אפשרות מנה אחת למועד');return;}const r=await fetch('/api/admin/slots',{method:'PATCH',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({slotId:editingSlot.id,timezoneOffset:new Date(`${day.dayKey}T${editingSlot.startTime}:00`).getTimezoneOffset(),startTime:editingSlot.startTime,durationMinutes:editingSlot.durationMinutes,capacity:editingSlot.capacity,menuOptionIds:editingSlot.menuIds})});const d=await r.json() as {error?:string};setMessage(r.ok?'המשבצת עודכנה.':d.error||'לא הצלחנו לעדכן את המשבצת');if(r.ok){setEditingSlot(undefined);await loadPublished();}}
  async function addAdmin(e:React.FormEvent){e.preventDefault();const r=await fetch('/api/admin/admins',{method:'POST',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({email:newAdmin})});const d=await r.json() as {error?:string};if(!r.ok){setMessage(d.error||'לא הצלחנו להוסיף מנהל');return;}setNewAdmin('');setMessage('המנהל נוסף בהצלחה.');await loadAdmins();}
  async function removeAdmin(email:string){const r=await fetch('/api/admin/admins',{method:'DELETE',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({email})});const d=await r.json() as {error?:string};if(!r.ok){setMessage(d.error||'לא הצלחנו להסיר מנהל');return;}await loadAdmins();}
  async function updateReservation(id:string,patch:Partial<Pick<ReservationRow,'guestName'|'guestEmail'|'guestPhone'|'partySize'|'preferences'|'notes'|'arrived'>>&{slotId?:string},local:Partial<ReservationRow>={}){const r=await fetch('/api/admin/reservations',{method:'PATCH',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({id,...patch})});const d=await r.json() as {error?:string};if(!r.ok){setMessage(d.error||'לא הצלחנו לעדכן את ההזמנה');return;}setPublished(current=>current.map(day=>({...day,reservations:day.reservations.map(x=>x.id===id?{...x,...patch,...local}:x)})));await loadPublished();}
  async function changeDishCount(r:ReservationRow,dishId:string,value:number){const dishes=r.menu.map(o=>o.id);const counts=new Map(dishes.map(d=>[d,r.preferences.filter(p=>p===d).length]));counts.set(dishId,Math.min(10,Math.max(0,value)));const none=r.preferences.filter(p=>p==='none').length;const preferences=[...dishes.flatMap(d=>Array(counts.get(d)??0).fill(d)),...Array(none).fill('none')];if(!preferences.length){setMessage('אפשר להשאיר לפחות מנה אחת בהזמנה');return;}if(preferences.length>10){setMessage('הזמנה יכולה לכלול עד 10 סועדים');return;}await updateReservation(r.id,{partySize:preferences.length,preferences},{partySize:preferences.length,preferences});}
  async function moveReservation(r:ReservationRow,slot:SlotInfo){await updateReservation(r.id,{slotId:slot.id},{startsAt:slot.startsAt});}
  async function cancelReservation(id:string){if(!window.confirm('לבטל את ההזמנה הזו?'))return;const r=await fetch('/api/admin/reservations',{method:'DELETE',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({id})});const d=await r.json() as {error?:string};if(!r.ok){setMessage(d.error||'לא הצלחנו לבטל את ההזמנה');return;}await loadPublished();}
  useEffect(()=>{if(weekAutoSet||!published.length)return;const earliest=[...published].sort((a,b)=>a.dayKey.localeCompare(b.dayKey))[0];const diffWeeks=Math.round((startOfWeek(parseDayKey(earliest.dayKey)).getTime()-startOfWeek(new Date()).getTime())/(7*86400000));setWeekOffset(diffWeeks);setWeekAutoSet(true);},[published,weekAutoSet]);
  const weekStart=useMemo(()=>{const s=startOfWeek(new Date());s.setDate(s.getDate()+weekOffset*7);return s;},[weekOffset]);
  const weekDays=useMemo(()=>{const weekStartTime=weekStart.getTime();return [...published,...history].filter(d=>startOfWeek(parseDayKey(d.dayKey)).getTime()===weekStartTime).sort((a,b)=>a.dayKey.localeCompare(b.dayKey));},[published,history,weekStart]);
  const weekEnd=useMemo(()=>{const e=new Date(weekStart);e.setDate(e.getDate()+6);return e;},[weekStart]);
  const weekRangeLabel=`${weekStart.toLocaleDateString('he-IL',{day:'numeric',month:'short'})} – ${weekEnd.toLocaleDateString('he-IL',{day:'numeric',month:'short'})}`;
  function exportWeek(){const csv=buildWeekCsv(weekDays);const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`דוח-שבועי-${weekStart.toISOString().slice(0,10)}.csv`;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);}
  return <main className="admin-page">
    <nav className="nav"><div className="admin-brand-block"><div className="brand"><img src="/ramen-logo.png" alt="Down7own Ramen"/><span>DOWN7OWN RAMEN</span></div><p className="eyebrow"><span/>ניהול מסעדה</p></div><Link className="chef-link" href="/">לתצוגת אורחים</Link></nav>
    <section className="admin-wrap">
      <div className="admin-column">
        <div className="admin-top-row">
        <div className="admin-card slot-builder">
          {platformAdmin===null?<p className="empty-copy">בודק הרשאת מנהל…</p>:!authorized?<><p className="kicker">כניסת מנהלים</p><h2>התחברות עם Google</h2><p className="empty-copy">מנהלים מורשים יכולים להתחבר עם חשבון Gmail ולפתוח מועדים.</p><GoogleSignIn onCredential={signIn}/></>:<form onSubmit={create}>
            <p className="kicker">תכנון משבצות</p>
            <label>תאריך<input required type="date" value={date} min={new Date().toISOString().slice(0,10)} onChange={e=>setDate(e.target.value)}/></label>
            <div className="generator"><div className="form-row"><label>משעה<input type="time" value={rangeStart} onChange={e=>setRangeStart(e.target.value)}/></label><label>עד שעה<input type="time" value={rangeEnd} onChange={e=>setRangeEnd(e.target.value)}/></label></div><div className="form-row"><label>מרווח<select value={slotInterval} onChange={e=>setSlotInterval(Number(e.target.value))}><option value="30">כל 30 דקות</option><option value="60">כל שעה</option><option value="90">כל שעה וחצי</option></select></label><label>אורחים למשבצת<input type="number" min="1" max="100" value={rangeCapacity} onChange={e=>setRangeCapacity(Number(e.target.value))}/></label></div><button className="generate-button" type="button" onClick={generate}>יצירת סדרה</button></div>
            <div className="planned-slots"><div className="slot-labels"><span>שעה</span><span>משך</span><span>אורחים</span><span/></div>{slots.map(slot=><div className="planned-slot" key={slot.key}><input aria-label="שעת התחלה" type="time" step="900" value={slot.startTime} onChange={e=>updateSlot(slot.key,{startTime:e.target.value})}/><select aria-label="משך הישיבה" value={slot.durationMinutes} onChange={e=>updateSlot(slot.key,{durationMinutes:Number(e.target.value)})}><option value="30">30 דק׳</option><option value="45">45 דק׳</option><option value="60">שעה</option><option value="90">שעה וחצי</option></select><input aria-label="מספר אורחים" type="number" min="1" max="100" value={slot.capacity} onChange={e=>updateSlot(slot.key,{capacity:Number(e.target.value)})}/><button type="button" onClick={()=>setSlots(current=>current.filter(s=>s.key!==slot.key))} aria-label={`מחיקת ${slot.startTime}`}>×</button></div>)}</div>
            <div className="day-menu"><span className="day-menu-label">אפשרויות מנה למועד הזה</span><div className="day-menu-options">{menuOptions.map(o=><button key={o.id} type="button" className="menu-chip" aria-pressed={activeMenu.includes(o.id)} onClick={()=>toggleDayMenu(o.id)}>{o.label}</button>)}</div>{!activeMenu.length&&<p className="field-hint">בחרו לפחות אפשרות אחת כדי לפרסם</p>}</div>
            <button className="add-slot" type="button" onClick={()=>setSlots(current=>[...current,newSlot(current.at(-1)?.startTime||'19:00',current.at(-1)?.capacity||10,current.at(-1)?.durationMinutes||30)])}>+ הוספת משבצת ידנית</button><button className="reserve" disabled={busy||!slots.length||!activeMenu.length}>{busy?'מפרסם…':'פרסום המשבצות'}<span>←</span></button>
          </form>}
        </div>
        {authorized&&<div className="admin-card menu-card"><p className="kicker">תפריט</p><h2>אפשרויות מנה</h2><form className="add-admin" onSubmit={addOption}><label>הוספת אפשרות<input required placeholder="למשל: דגים" value={newOption} onChange={e=>setNewOption(e.target.value)}/></label><button type="submit">הוספה</button></form><div className="admin-list">{menuOptions.map(o=><div key={o.id}><span>{o.label}</span><button type="button" onClick={()=>removeOption(o.id)} aria-label={`הסרת ${o.label}`}>הסרה</button></div>)}</div></div>}
        </div>
        {authorized&&<div className="admin-card week-card">
          <div className="week-header">
            <div><p className="kicker">דוח שבועי</p><h2>תצוגת שבוע</h2></div>
            <button type="button" className="export-button" onClick={exportWeek} disabled={!weekDays.length}>ייצוא לאקסל</button>
          </div>
          <div className="week-nav"><button type="button" onClick={()=>setWeekOffset(w=>w-1)}>‹ קודם</button><span>{weekRangeLabel}</span><button type="button" onClick={()=>setWeekOffset(w=>w+1)}>הבא ›</button>{weekOffset!==0&&<button type="button" onClick={()=>setWeekOffset(0)}>השבוע</button>}</div>
          {weekDays.length?<div className="week-days">{weekDays.map(day=>{
            const sorted=[...day.reservations].sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
            const totals=day.menu.map(o=>sorted.reduce((sum,r)=>sum+r.preferences.filter(p=>p===o.id).length,0));
            const isOpen=!day.completedAt;
            const daySlots=[...day.slots].sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
            return <div className="week-day-block" key={day.dayKey}>
              <div className="week-day-head">
                <h3>{fmtDate(day.startsAt)}{!isOpen&&<span className="day-status">הושלם</span>}</h3>
                <span className="week-day-sub">{fmtTime(day.startsAt)}–{fmtTime(day.endsAt)} · {day.reserved}/{day.capacity} מוזמנים{!isOpen&&day.actualAttendees!==undefined?` · הגיעו בפועל: ${day.actualAttendees}`:''}</span>
              </div>
              <div className="week-day-actions">
                {isOpen?<button type="button" onClick={()=>deleteDay(day)}>מחיקת יום</button>:<button type="button" className="history-delete" onClick={()=>deleteHistory(day)}>מחיקה לצמיתות</button>}
              </div>
              {isOpen&&day.slots.length>0&&<div className="slot-manage">{[...day.slots].sort((a,b)=>a.startsAt.localeCompare(b.startsAt)).map(slot=>editingSlot?.id===slot.id?<form key={slot.id} className="slot-edit" onSubmit={e=>saveSlotEdit(day,e)}>
                <div className="slot-edit-fields">
                  <label>שעה<input type="time" required value={editingSlot.startTime} onChange={e=>setEditingSlot({...editingSlot,startTime:e.target.value})}/></label>
                  <label>משך<select value={editingSlot.durationMinutes} onChange={e=>setEditingSlot({...editingSlot,durationMinutes:Number(e.target.value)})}><option value="30">30 דק׳</option><option value="45">45 דק׳</option><option value="60">שעה</option><option value="90">שעה וחצי</option></select></label>
                  <label>אורחים<input type="number" min="1" max="100" value={editingSlot.capacity} onChange={e=>setEditingSlot({...editingSlot,capacity:Number(e.target.value)})}/></label>
                </div>
                <div className="day-menu-options">{menuOptions.map(o=><button key={o.id} type="button" className="menu-chip" aria-pressed={editingSlot.menuIds.includes(o.id)} onClick={()=>toggleEditMenu(o.id)}>{o.label}</button>)}</div>
                <div className="slot-edit-actions"><button type="submit">שמירה</button><button type="button" onClick={()=>setEditingSlot(undefined)}>ביטול</button></div>
              </form>:<div key={slot.id} className="slot-row"><span>{fmtTime(slot.startsAt)}–{fmtTime(slot.endsAt)} · {slot.capacity} מקומות · {slot.reserved} מוזמנים</span><button type="button" onClick={()=>startEditSlot(slot)}>עריכה</button></div>)}</div>}
              {day.slots.length?<div className="table-scroll"><table className="week-table sheet"><thead>
                <tr><th rowSpan={2}>שעה</th><th rowSpan={2}>שם המזמין</th><th rowSpan={2}>טלפון</th>{day.menu.length>0&&<th colSpan={day.menu.length}>מספר מנות</th>}<th rowSpan={2}>הערות</th><th rowSpan={2}>אישור הגעה</th><th rowSpan={2}>סה״כ</th><th rowSpan={2}>העברה · ביטול</th></tr>
                <tr>{day.menu.map(o=><th key={o.id}>{o.label}</th>)}</tr>
              </thead><tbody>
                {daySlots.map(slot=>{
                  const slotReservations=sorted.filter(r=>r.startsAt===slot.startsAt);
                  if(!slotReservations.length)return <tr key={slot.id} className="sheet-group"><td className="sheet-time">{fmtTime(slot.startsAt)}</td><td colSpan={day.menu.length+4} className="empty-copy">פנוי · {slot.capacity} מקומות</td><td className="sheet-total"/><td/></tr>;
                  const slotTotal=slotReservations.reduce((sum,r)=>sum+r.partySize,0);
                  return <Fragment key={slot.id}>{slotReservations.map((r,i)=><tr key={r.id} className={i===0?'sheet-group':undefined}>
                    {i===0&&<td rowSpan={slotReservations.length} className="sheet-time">{fmtTime(slot.startsAt)}</td>}
                    <td><input defaultValue={r.guestName} onBlur={e=>e.target.value.trim()&&e.target.value!==r.guestName&&updateReservation(r.id,{guestName:e.target.value})}/></td>
                    <td><input defaultValue={r.guestPhone} onBlur={e=>e.target.value!==r.guestPhone&&updateReservation(r.id,{guestPhone:e.target.value})}/></td>
                    {day.menu.map(o=>{const count=r.preferences.filter(p=>p===o.id).length;return <td key={o.id}>{r.menu.some(m=>m.id===o.id)?<input className="dish-input" type="number" min="0" max="10" aria-label={`${o.label}, ${r.guestName}`} defaultValue={count||''} onBlur={e=>{const next=Math.floor(Number(e.target.value)||0);if(next!==count)changeDishCount(r,o.id,next);}}/>:<span className="sheet-na">–</span>}</td>;})}
                    <td><input defaultValue={r.notes} onBlur={e=>e.target.value!==r.notes&&updateReservation(r.id,{notes:e.target.value})}/></td>
                    <td><input type="checkbox" className="arrived-check" aria-label="אישור הגעה" checked={r.arrived} onChange={e=>updateReservation(r.id,{arrived:e.target.checked})}/></td>
                    {i===0&&<td rowSpan={slotReservations.length} className="sheet-total">{slotTotal}</td>}
                    <td className="row-actions"><select aria-label="העברה לשעה אחרת" value="" onChange={e=>{const target=daySlots.find(x=>x.id===e.target.value);if(target)moveReservation(r,target);}}><option value="">העברה…</option>{daySlots.filter(x=>x.id!==slot.id).map(x=><option key={x.id} value={x.id}>{fmtTime(x.startsAt)}</option>)}</select><button type="button" onClick={()=>cancelReservation(r.id)}>ביטול</button></td>
                  </tr>)}</Fragment>;
                })}
                <tr className="week-total-row"><td colSpan={3}>סה״כ · {sorted.reduce((sum,r)=>sum+r.partySize,0)} סועדים</td>{totals.map((t,i)=><td key={i}>{t}</td>)}<td/><td/><td/><td/></tr>
              </tbody></table></div>:<p className="empty-copy">אין משבצות ליום זה.</p>}
            </div>;
          })}</div>:<p className="empty-copy">אין ארוחות מתוכננות לשבוע זה.</p>}
        </div>}
        {authorized&&<div className="admin-card messages-card"><p className="kicker">פניות</p><h2>הודעות</h2><p className="empty-copy thread-hint">שיחות ללא פעילות נמחקות אוטומטית אחרי 3 ימים.</p>{threads.length?<div className="thread-list">{threads.map(t=><div key={t.subject} className="thread-row"><div className="thread-header"><button type="button" onClick={()=>setChatSubject(chatSubject===t.subject?undefined:t.subject)}><span>{t.guestName||t.guestEmail||'אורח'}</span>{t.unread>0&&<span className="badge-dot"/>}</button><button type="button" className="thread-complete" onClick={()=>completeChat(t.subject)}>סיום שיחה</button></div>{chatSubject===t.subject&&<ChatPanel url={`/api/admin/messages?subject=${encodeURIComponent(t.subject)}`} authHeaders={authHeaders} self="admin"/>}</div>)}</div>:<p className="empty-copy">אין עדיין פניות.</p>}</div>}
        {authorized&&<div className="admin-card admins-card"><p className="kicker">מנהלי האתר</p><h2>הרשאות Gmail</h2><form className="add-admin" onSubmit={addAdmin}><label>הוספת מנהל לפי אימייל<input required type="email" placeholder="name@gmail.com" value={newAdmin} onChange={e=>setNewAdmin(e.target.value)}/></label><button type="submit">הוספה</button></form><div className="admin-list">{admins.map(a=><div key={a.email}><span>{a.email}</span><button type="button" onClick={()=>removeAdmin(a.email)} aria-label={`הסרת ${a.email}`}>הסרה</button></div>)}</div></div>}
        {message&&<p className="form-message" role="status">{message}</p>}
      </div>
    </section>
  </main>;
}
