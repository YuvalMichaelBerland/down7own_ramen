import { env } from 'cloudflare:workers';
export async function GET() { return Response.json({ googleClientId: env.GOOGLE_CLIENT_ID || null }); }
