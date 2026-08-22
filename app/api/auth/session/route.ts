import { verifyGoogleToken } from '@/app/lib/google';
import { issueSession } from '@/app/lib/session';

export async function POST(request: Request) {
  try {
    const { credential } = await request.json() as { credential?: string };
    if (!credential) return Response.json({ error: 'Missing credential' }, { status: 400 });
    const user = await verifyGoogleToken(credential);
    const token = await issueSession(user);
    return Response.json({ token, email: user.email, name: user.name });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Sign-in failed' }, { status: 401 }); }
}
