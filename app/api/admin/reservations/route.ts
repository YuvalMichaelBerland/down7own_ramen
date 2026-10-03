import { database, ensureSchema } from '@/app/lib/database';
import { authenticateAdmin } from '@/app/lib/admin';
import { resetStalePreferences, savePreferences, validPreference } from '@/app/lib/preferences';

export async function PATCH(request:Request){
  try{
    if(!await authenticateAdmin(request))return Response.json({error:'גישת מנהל בלבד'},{status:403});
    const b=await request.json() as {id?:string;slotId?:string;guestName?:string;guestEmail?:string;guestPhone?:string;partySize?:number;preferences?:string[];notes?:string;arrived?:boolean};
    if(!b.id)return Response.json({error:'חסר מזהה הזמנה'},{status:400});
    await ensureSchema();const db=database();
    const reservation=await db.prepare(`SELECT r.id, r.slot_id, r.party_size FROM reservations r WHERE r.id = ? AND r.status = 'confirmed'`).bind(b.id).first<{id:string;slot_id:string;party_size:number}>();
    if(!reservation)return Response.json({error:'ההזמנה לא נמצאה'},{status:404});
    const moving=b.slotId!==undefined&&b.slotId!==reservation.slot_id;
    const slotId=b.slotId??reservation.slot_id;
    const target=await db.prepare('SELECT id, capacity, is_open FROM slots WHERE id = ?').bind(slotId).first<{id:string;capacity:number;is_open:number}>();
    if(!target)return Response.json({error:'המשבצת לא נמצאה'},{status:404});
    if(moving&&!target.is_open)return Response.json({error:'המשבצת סגורה'},{status:409});
    if(b.partySize!==undefined&&(!Number.isInteger(b.partySize)||b.partySize<1||b.partySize>10))return Response.json({error:'מספר סועדים לא תקין'},{status:400});
    const targetPartySize=b.partySize??reservation.party_size;
    if(b.preferences!==undefined&&b.preferences.length!==targetPartySize)return Response.json({error:'מספר ההעדפות חייב להתאים למספר הסועדים'},{status:400});
    if(b.preferences!==undefined)for(const p of b.preferences)if(!await validPreference(p,slotId))return Response.json({error:'העדפה לא תקינה'},{status:400});
    if(moving||b.partySize!==undefined){
      const other=await db.prepare(`SELECT COALESCE(SUM(party_size), 0) AS sum FROM reservations WHERE slot_id = ? AND status = 'confirmed' AND id != ?`).bind(slotId,b.id).first<{sum:number}>();
      if(Number(other?.sum||0)+targetPartySize>target.capacity)return Response.json({error:'אין מספיק מקומות פנויים בשעה הזו'},{status:409});
    }
    if(moving){
      try{await db.prepare('UPDATE reservations SET slot_id = ? WHERE id = ?').bind(slotId,b.id).run();}
      catch(error){const msg=error instanceof Error?error.message:'';if(msg.includes('UNIQUE'))return Response.json({error:'לאורח הזה כבר יש הזמנה בשעה הזו'},{status:409});throw error;}
    }
    if(b.partySize!==undefined)await db.prepare('UPDATE reservations SET party_size = ? WHERE id = ?').bind(b.partySize,b.id).run();
    if(b.guestName!==undefined){if(!b.guestName.trim())return Response.json({error:'שם האורח חסר'},{status:400});await db.prepare('UPDATE reservations SET guest_name = ? WHERE id = ?').bind(b.guestName.trim(),b.id).run();}
    if(b.guestEmail!==undefined){if(!/^\S+@\S+\.\S+$/.test(b.guestEmail))return Response.json({error:'כתובת האימייל אינה תקינה'},{status:400});await db.prepare('UPDATE reservations SET guest_email = ? WHERE id = ?').bind(b.guestEmail.trim().toLowerCase(),b.id).run();}
    if(b.guestPhone!==undefined){if(!/^[0-9+\-() ]{7,20}$/.test(b.guestPhone.trim()))return Response.json({error:'מספר טלפון לא תקין'},{status:400});await db.prepare('UPDATE reservations SET guest_phone = ? WHERE id = ?').bind(b.guestPhone.trim(),b.id).run();}
    if(b.preferences!==undefined)await savePreferences(b.id,b.preferences);
    // Seat choices the new slot doesn't serve fall back to 'none'.
    if(moving)await resetStalePreferences();
    if(b.notes!==undefined){if(b.notes.length>500)return Response.json({error:'ההערה ארוכה מדי'},{status:400});await db.prepare('UPDATE reservations SET notes = ? WHERE id = ?').bind(b.notes,b.id).run();}
    if(typeof b.arrived==='boolean')await db.prepare('UPDATE reservations SET arrived = ? WHERE id = ?').bind(b.arrived?1:0,b.id).run();
    return Response.json({updated:true});
  }catch(error){return Response.json({error:error instanceof Error?error.message:'לא הצלחנו לעדכן את ההזמנה'},{status:500});}
}

export async function DELETE(request:Request){
  try{
    if(!await authenticateAdmin(request))return Response.json({error:'גישת מנהל בלבד'},{status:403});
    const {id}=await request.json() as {id?:string};
    if(!id)return Response.json({error:'חסר מזהה הזמנה'},{status:400});
    await ensureSchema();
    await database().prepare(`UPDATE reservations SET status = 'cancelled' WHERE id = ?`).bind(id).run();
    return Response.json({cancelled:true});
  }catch(error){return Response.json({error:error instanceof Error?error.message:'לא הצלחנו לבטל את ההזמנה'},{status:500});}
}
