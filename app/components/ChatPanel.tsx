'use client';
import { useEffect, useRef, useState } from 'react';

type Message = { id:string; sender:'guest'|'admin'; body:string; createdAt:string };
const fmtTime = (iso:string) => new Intl.DateTimeFormat('he-IL', { hour:'2-digit', minute:'2-digit' }).format(new Date(iso));

export function ChatPanel({ url, authHeaders, self }: { url: string; authHeaders: () => Record<string,string>; self: 'guest'|'admin' }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() { const r = await fetch(url, { headers: authHeaders() }); if (r.ok && !cancelled) { const d = await r.json() as { messages:Message[] }; setMessages(d.messages || []); } }
    load();
    const interval = setInterval(load, 4000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [url, authHeaders]);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages]);

  async function send() {
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    setSending(true);
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ body: trimmed }) });
    setSending(false);
    if (r.ok) { setDraft(''); const rr = await fetch(url, { headers: authHeaders() }); if (rr.ok) { const d = await rr.json() as { messages:Message[] }; setMessages(d.messages || []); } }
  }

  return <div className="chat-panel">
    <div className="chat-messages" ref={listRef}>
      {messages.length ? messages.map((m) => <div key={m.id} className={m.sender === self ? 'chat-bubble mine' : 'chat-bubble'}><p>{m.body}</p><span>{fmtTime(m.createdAt)}</span></div>) : <p className="empty-copy">אין הודעות עדיין.</p>}
    </div>
    <div className="chat-input"><textarea value={draft} maxLength={1000} placeholder="כתבו הודעה…" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}/><button type="button" disabled={sending || !draft.trim()} onClick={send}>שליחה</button></div>
  </div>;
}
