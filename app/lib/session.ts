import { SignJWT, jwtVerify } from 'jose';

export type SessionUser = { sub: string; email: string; name: string };

function secretKey() {
  if (!process.env.SESSION_SECRET) throw new Error('Session is not configured');
  return new TextEncoder().encode(process.env.SESSION_SECRET);
}

export async function issueSession(user: SessionUser) {
  return new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secretKey());
}

export async function verifySession(token: string): Promise<SessionUser> {
  const { payload } = await jwtVerify(token, secretKey());
  if (!payload.sub || typeof payload.email !== 'string') throw new Error('Invalid session');
  return { sub: payload.sub, email: payload.email, name: typeof payload.name === 'string' ? payload.name : payload.email };
}
