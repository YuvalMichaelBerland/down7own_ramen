'use client';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'd7r_session';

export function useSession() {
  const [token, setToken] = useState('');
  useEffect(() => { setToken(localStorage.getItem(KEY) || ''); }, []);

  const signIn = useCallback(async (credential: string) => {
    const r = await fetch('/api/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }) });
    if (!r.ok) return;
    const { token: sessionToken } = await r.json() as { token: string };
    localStorage.setItem(KEY, sessionToken);
    setToken(sessionToken);
  }, []);

  const signOut = useCallback(() => { localStorage.removeItem(KEY); setToken(''); }, []);

  const authHeaders = useCallback((): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {}), [token]);

  // Any 401 means the stored session expired or was revoked — drop it so the sign-in button reappears.
  const fetchAuthed = useCallback(async (input: string, init: RequestInit = {}) => {
    const r = await fetch(input, { ...init, headers: { ...init.headers, ...authHeaders() } });
    if (r.status === 401) signOut();
    return r;
  }, [authHeaders, signOut]);

  return { token, signIn, signOut, authHeaders, fetchAuthed };
}
