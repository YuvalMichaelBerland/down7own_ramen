import { database, ensureSchema } from '@/app/lib/database';
import { authenticateAdmin } from '@/app/lib/admin';

export async function PATCH(request:Request){
  try{
    if(!await authenticateAdmin(request))return Response.json({error:'גישת מנהל בלבד'},{status:403});
    const b=await request.json() as {id?:string;guestName?:string;guestEmail?:string;partySize?:number;preference?:string;notes?:string};
    if(!b.id)return Response.json({error:'חסר מזהה הזמנה'},{status:400});
    await ensureSchema();const db=database();
    const reservation=await db.prepare(`SELECT r.id, r.slot_id, s.capacity FROM reservations r JOIN slots s ON s.id = r.slot_id WHERE r.id = ? AND r.status = 'confirmed'`).bind(b.id).first<{id:string;slot_id:string;capacity:number}>();
    if(!reservation)return Response.json({error:'ההזמנה לא נמצאה'},{status:404});
    if(b.partySize!==undefined){
      if(!Number.isInteger(b.partySize)||b.partySize<1||b.partySize>10)return Response.json({error:'מספר סועדים לא תקין'},{status:400});
      const other=await db.prepare(`SELECT COALESCE(SUM(party_size), 0) AS sum FROM reservations WHERE slot_id = ? AND status = 'confirmed' AND id != ?`).bind(reservation.slot_id,b.id).first<{sum:number}>();
      if(Number(other?.sum||0)+b.partySize>reservation.capacity)return Response.json({error:'אין מספיק מקומות פנויים בשעה הזו'},{status:409});
      await db.prepare('UPDATE reservations SET party_size = ? WHERE id = ?').bind(b.partySize,b.id).run();
    }
    if(b.guestName!==undefined){if(!b.guestName.trim())return Response.json({error:'שם האורח חסר'},{status:400});await db.prepare('UPDATE reservations SET guest_name = ? WHERE id = ?').bind(b.guestName.trim(),b.id).run();}
    if(b.guestEmail!==undefined){if(!/^\S+@\S+\.\S+$/.test(b.guestEmail))return Response.json({error:'כתובת האימייל אינה תקינה'},{status:400});await db.prepare('UPDATE reservations SET guest_email = ? WHERE id = ?').bind(b.guestEmail.trim().toLowerCase(),b.id).run();}
    if(b.preference!==undefined){if(!['none','chicken','vegetarian'].includes(b.preference))return Response.json({error:'העדפה לא תקינה'},{status:400});await db.prepare('UPDATE reservations SET preference = ? WHERE id = ?').bind(b.preference,b.id).run();}
    if(b.notes!==undefined){if(b.notes.length>500)return Response.json({error:'ההערה ארוכה מדי'},{status:400});await db.prepare('UPDATE reservations SET notes = ? WHERE id = ?').bind(b.notes,b.id).run();}
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
