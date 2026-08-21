import { env } from 'cloudflare:workers';
import { database, ensureSchema } from './database';
import { verifyGoogleToken } from './google';

export async function authenticateAdmin(request:Request){
  await ensureSchema();
  const platformEmail=request.headers.get('oai-authenticated-user-email');
  let email=platformEmail?.toLowerCase();
  if(!email){
    const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
    if(!token)return null;
    email=(await verifyGoogleToken(token)).email.toLowerCase();
  }
  if(env.CHEF_EMAIL&&email===env.CHEF_EMAIL.toLowerCase()){
    await database().prepare(`INSERT OR IGNORE INTO admins (email, added_at, added_by) VALUES (?, ?, ?)`)
      .bind(email,new Date().toISOString(),'site-owner').run();
    return {email};
  }
  const admin=await database().prepare('SELECT email FROM admins WHERE email = ?').bind(email).first<{email:string}>();
  return admin?{email:admin.email}:null;
}
