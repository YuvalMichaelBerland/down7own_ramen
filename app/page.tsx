'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GoogleSignIn } from './components/GoogleSignIn';

type Slot={id:string;startsAt:string;endsAt:string;capacity:number;remaining:number};
type Confirmation={id:string;startsAt:string;partySize:number;guestName:string};
const fmtDate=(iso:string)=>new Intl.DateTimeFormat('he-IL',{weekday:'long',month:'long',day:'numeric'}).format(new Date(iso));
const fmtTime=(iso:string)=>new Intl.DateTimeFormat('he-IL',{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso));
const dateKey=(iso:string)=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso)).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}`;};

export default function Home(){
  const [slots,setSlots]=useState<Slot[]>([]),[activeDate,setActiveDate]=useState(''),[selected,setSelected]=useState<string>(),[partySize,setPartySize]=useState(1),[credential,setCredential]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[confirmation,setConfirmation]=useState<Confirmation>();
  const load=useCallback(async()=>{setLoading(true);try{const r=await fetch('/api/slots');const d=await r.json() as {slots:Slot[]};const loaded=d.slots||[];setSlots(loaded);setActiveDate(current=>current&&loaded.some(s=>dateKey(s.startsAt)===current)?current:(loaded[0]?dateKey(loaded[0].startsAt):''));}catch{setError('לא הצלחנו לטעון את המועדים הקרובים.');}finally{setLoading(false);}},[]);
  useEffect(()=>{load()},[load]);
  const dates=useMemo(()=>Array.from(new Map(slots.map(s=>[dateKey(s.startsAt),s])).entries()),[slots]);
  const dateSlots=useMemo(()=>slots.filter(s=>dateKey(s.startsAt)===activeDate),[slots,activeDate]);
  useEffect(()=>{setSelected(current=>current&&dateSlots.some(s=>s.id===current)?current:dateSlots.find(s=>s.remaining>0)?.id);setPartySize(1);},[activeDate,dateSlots]);
  const selectedSlot=useMemo(()=>dateSlots.find(s=>s.id===selected),[dateSlots,selected]);
  async function reserve(){if(!selected||!credential)return;setError('');const r=await fetch('/api/reservations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({credential,slotId:selected,partySize})});const d=await r.json() as {error?:string;reservation?:Confirmation};if(!r.ok||!d.reservation){setError(d.error||'Could not reserve');await load();return;}setConfirmation(d.reservation);await load();}
  return <main>
    <nav className="nav"><a className="brand" href="#top"><img src="/ramen-logo.png" alt="Down7own Ramen"/><span>DOWN7OWN RAMEN</span></a></nav>
    <section className="hero" id="top" aria-label="Down7own Ramen"><img src="/ramen-hero.png" alt="קערת ראמן של Down7own Ramen"/><div className="hero-label"><span/> המועדים הקרובים</div></section>
    {dates.length>1&&<div className="date-tabs" aria-label="בחירת תאריך">{dates.map(([key,slot])=><button key={key} type="button" className={activeDate===key?'active':''} onClick={()=>setActiveDate(key)}>{fmtDate(slot.startsAt)}</button>)}</div>}
    <section className="booking-shell" aria-labelledby="booking-title">
      <div className="date-card"><p className="kicker">הארוחה הבאה</p>{dateSlots.length?<><div className="date-row"><div><strong>{new Date(dateSlots[0].startsAt).getDate()}</strong><span>{new Date(dateSlots[0].startsAt).toLocaleString('he-IL',{month:'short'})}</span></div><div className="date-copy"><h2 id="booking-title">{fmtDate(dateSlots[0].startsAt)}</h2><p>{fmtTime(dateSlots[0].startsAt)}—{fmtTime(dateSlots[dateSlots.length-1].endsAt)} · דאון טאון</p></div></div><div className="details"><span>משך הישיבה לפי המועד</span><span>מספר מקומות מוגבל</span></div></>:<><div className="empty-date">次</div><h2 id="booking-title">מועדים חדשים בקרוב</h2><p>עקבו אחרינו באינסטגרם לעדכון על הארוחה הבאה.</p></>}</div>
      <div className="slot-panel"><div className="slot-heading"><div><p className="kicker">בחרו שעה</p><h3>{loading?'טוען…':slots.length?'מקומות פנויים':'אין מועדים פתוחים'}</h3></div><span className="live"><i/> בזמן אמת</span></div>
        {dateSlots.length?<div className="slots" role="radiogroup" aria-label="שעת הזמנה">{dateSlots.map(s=><button key={s.id} type="button" role="radio" aria-checked={selected===s.id} disabled={s.remaining===0} className={selected===s.id?'slot selected':'slot'} onClick={()=>setSelected(s.id)}><strong>{fmtTime(s.startsAt)}</strong><span>{s.remaining===0?'מלא':'פנוי'}</span></button>)}</div>:<p className="empty-copy">השף עדיין לא פתח מועד חדש להזמנות.</p>}
        {selectedSlot&&<div className="reserve-flow"><label>מספר סועדים <select value={partySize} onChange={e=>setPartySize(Number(e.target.value))}>{Array.from({length:Math.min(10,selectedSlot.remaining)},(_,i)=><option key={i+1}>{i+1}</option>)}</select></label>{credential?<button className="reserve" type="button" onClick={reserve}>אישור הזמנה ל־{fmtTime(selectedSlot.startsAt)}<span>←</span></button>:<><p className="fineprint">כדי לאשר את ההזמנה, התחברו עם Google.</p><GoogleSignIn onCredential={setCredential}/></>}</div>}
        {error&&<p className="error" role="alert">{error}</p>}
      </div>
    </section>
    {confirmation&&<div className="modal-backdrop" role="presentation"><section className="confirmation" role="dialog" aria-modal="true" aria-labelledby="confirmed-title"><div className="stamp">予約</div><p className="kicker">אתם ברשימה</p><h2 id="confirmed-title">המקום נשמר.</h2><p>{confirmation.guestName}, שמרנו {confirmation.partySize} מקומות לשעה <strong>{fmtTime(confirmation.startsAt)}</strong>, {fmtDate(confirmation.startsAt)}.</p><p className="confirmation-id">הזמנה {confirmation.id.slice(0,8).toUpperCase()}</p><button className="reserve" onClick={()=>setConfirmation(undefined)}>סיום <span>✓</span></button></section></div>}
  </main>;
}
