import { env } from 'cloudflare:workers';
import { createRemoteJWKSet, jwtVerify } from 'jose';
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export type GoogleUser = { sub: string; email: string; name: string };
export async function verifyGoogleToken(token: string): Promise<GoogleUser> {
  if (!env.GOOGLE_CLIENT_ID) throw new Error('Google sign-in is not configured');
  const { payload } = await jwtVerify(token, googleKeys, { audience: env.GOOGLE_CLIENT_ID, issuer: ['https://accounts.google.com', 'accounts.google.com'] });
  if (!payload.sub || typeof payload.email !== 'string' || payload.email_verified !== true) throw new Error('Google account is not verified');
  return { sub: payload.sub, email: payload.email, name: typeof payload.name === 'string' ? payload.name : payload.email };
}
export function isChef(user: GoogleUser) { return Boolean(env.CHEF_EMAIL && user.email.toLowerCase() === env.CHEF_EMAIL.toLowerCase()); }
