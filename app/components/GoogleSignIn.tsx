'use client';
import { useEffect, useRef, useState } from 'react';

declare global { interface Window { google?: { accounts:{ id:{ initialize:(o:{client_id:string;callback:(r:{credential:string})=>void})=>void; renderButton:(el:HTMLElement,o:Record<string,unknown>)=>void } } } } }

export function GoogleSignIn({ onCredential }: { onCredential:(credential:string)=>void }) {
  const button=useRef<HTMLDivElement>(null); const [configured,setConfigured]=useState(true);
  useEffect(()=>{ let cancelled=false;
    fetch('/api/config').then(r=>r.json() as Promise<{googleClientId:string|null}>).then(({googleClientId})=>{
      if(!googleClientId){setConfigured(false);return;}
      const render=()=>{if(cancelled||!button.current||!window.google)return; window.google.accounts.id.initialize({client_id:googleClientId,callback:r=>onCredential(r.credential)}); window.google.accounts.id.renderButton(button.current,{theme:'outline',size:'large',shape:'pill',text:'continue_with',width:240});};
      if(window.google){render();return;} const script=document.createElement('script'); script.src='https://accounts.google.com/gsi/client'; script.async=true; script.onload=render; document.head.appendChild(script);
    }); return()=>{cancelled=true};
  },[onCredential]);
  return configured?<div className="google-button" ref={button}/>:<p className="auth-note">ההתחברות עם Google תופעל לאחר הגדרת האתר.</p>;
}
