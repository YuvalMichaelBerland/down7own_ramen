import { database, ensureSchema } from './database';
import { verifyGoogleToken } from './google';

export async function authenticateAdmin(request:Request){
  await ensureSchema();
  const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
  if(!token)return null;
  const email=(await verifyGoogleToken(token)).email.toLowerCase();
  if(process.env.CHEF_EMAIL&&email===process.env.CHEF_EMAIL.toLowerCase()){
    await database().prepare(`INSERT OR IGNORE INTO admins (email, added_at, added_by) VALUES (?, ?, ?)`)
      .bind(email,new Date().toISOString(),'site-owner').run();
    return {email};
  }
  const admin=await database().prepare('SELECT email FROM admins WHERE email = ?').bind(email).first<{email:string}>();
  return admin?{email:admin.email}:null;
}
