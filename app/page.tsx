'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GoogleSignIn } from './components/GoogleSignIn';

type Slot={id:string;startsAt:string;endsAt:string;capacity:number;remaining:number};
type Confirmation={id:string;startsAt:string;partySize:number;guestName:string};
const fmtDate=(iso:string)=>new Intl.DateTimeFormat('en',{weekday:'long',month:'long',day:'numeric'}).format(new Date(iso));
const fmtTime=(iso:string)=>new Intl.DateTimeFormat('en',{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso));

export default function Home(){
  const [slots,setSlots]=useState<Slot[]>([]),[selected,setSelected]=useState<string>(),[partySize,setPartySize]=useState(1),[credential,setCredential]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[confirmation,setConfirmation]=useState<Confirmation>();
  const load=useCallback(async()=>{setLoading(true);try{const r=await fetch('/api/slots');const d=await r.json() as {slots:Slot[]};setSlots(d.slots||[]);setSelected(s=>s&&d.slots.some((x:Slot)=>x.id===s)?s:d.slots.find((x:Slot)=>x.remaining>0)?.id);}catch{setError('Could not load the next seating.');}finally{setLoading(false);}},[]);
  useEffect(()=>{load()},[load]);
  const selectedSlot=useMemo(()=>slots.find(s=>s.id===selected),[slots,selected]);
  async function reserve(){if(!selected||!credential)return;setError('');const r=await fetch('/api/reservations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({credential,slotId:selected,partySize})});const d=await r.json() as {error?:string;reservation?:Confirmation};if(!r.ok||!d.reservation){setError(d.error||'Could not reserve');await load();return;}setConfirmation(d.reservation);await load();}
  return <main>
    <nav className="nav"><a className="brand" href="#top"><span className="brand-mark">七</span><span>DOWN TOWN RAMEN</span></a><Link className="chef-link" href="/admin">Chef</Link></nav>
    <section className="hero" id="top"><div className="eyebrow"><span/> FRESH SEATINGS</div><h1>A seat at<br/>the ramen bar.</h1><p className="lede">Small-batch ramen, served across the counter. Choose a time and we’ll save your stool.</p></section>
    <section className="booking-shell" aria-labelledby="booking-title">
      <div className="date-card"><p className="kicker">NEXT SERVICE</p>{slots.length?<><div className="date-row"><div><strong>{new Date(slots[0].startsAt).getDate()}</strong><span>{new Date(slots[0].startsAt).toLocaleString('en',{month:'short'}).toUpperCase()}</span></div><div className="date-copy"><h2 id="booking-title">{fmtDate(slots[0].startsAt)}</h2><p>{fmtTime(slots[0].startsAt)}—{fmtTime(slots[slots.length-1].endsAt)} · Downtown</p></div></div><div className="details"><span>30 min seating</span><span>Limited counter seats</span></div></>:<><div className="empty-date">次</div><h2 id="booking-title">New dates soon</h2><p>Follow us on Instagram for the next service.</p></>}</div>
      <div className="slot-panel"><div className="slot-heading"><div><p className="kicker">CHOOSE A TIME</p><h3>{loading?'Loading…':slots.length?'Available seats':'No open slots'}</h3></div><span className="live"><i/> Live</span></div>
        {slots.length?<div className="slots" role="radiogroup" aria-label="Reservation time">{slots.map(s=><button key={s.id} type="button" role="radio" aria-checked={selected===s.id} disabled={s.remaining===0} className={selected===s.id?'slot selected':'slot'} onClick={()=>setSelected(s.id)}><strong>{fmtTime(s.startsAt)}</strong><span>{s.remaining===0?'Full':`${s.remaining} ${s.remaining===1?'seat':'seats'} left`}</span></button>)}</div>:<p className="empty-copy">The chef hasn’t opened a seating yet.</p>}
        {selectedSlot&&<div className="reserve-flow"><label>Guests <select value={partySize} onChange={e=>setPartySize(Number(e.target.value))}>{Array.from({length:Math.min(10,selectedSlot.remaining)},(_,i)=><option key={i+1}>{i+1}</option>)}</select></label>{credential?<button className="reserve" type="button" onClick={reserve}>Confirm {fmtTime(selectedSlot.startsAt)} for {partySize}<span>→</span></button>:<><p className="fineprint">Sign in to confirm your reservation.</p><GoogleSignIn onCredential={setCredential}/></>}</div>}
        {error&&<p className="error" role="alert">{error}</p>}
      </div>
    </section>
    <footer><span>RAMEN · MUSIC · GOOD COMPANY</span><span>Made in small batches</span></footer>
    {confirmation&&<div className="modal-backdrop" role="presentation"><section className="confirmation" role="dialog" aria-modal="true" aria-labelledby="confirmed-title"><div className="stamp">予約</div><p className="kicker">YOU’RE ON THE LIST</p><h2 id="confirmed-title">Seat confirmed.</h2><p>{confirmation.guestName}, we saved {confirmation.partySize} {confirmation.partySize===1?'seat':'seats'} for <strong>{fmtTime(confirmation.startsAt)}</strong> on {fmtDate(confirmation.startsAt)}.</p><p className="confirmation-id">Reservation {confirmation.id.slice(0,8).toUpperCase()}</p><button className="reserve" onClick={()=>setConfirmation(undefined)}>Done <span>✓</span></button></section></div>}
  </main>;
}
