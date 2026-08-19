import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, ChevronLeft } from 'lucide-react';
import { ToolView } from './ToolView';

/**
 * PROJECTOR MODE (?projector=1). Idle = black with a blue hue. Shows every visual
 * Chance puts here. A moveable + resizable MIC button lets you talk to him from
 * the wall, and wake-word can be toggled by voice command ("turn on wake word").
 */
const API = 'http://localhost:8787';

export function ProjectorView() {
  const [items, setItems] = useState<any[]>([]);
  const [listening, setListening] = useState(false);
  const [wake, setWake] = useState(false);
  const [busy, setBusy] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const listeningRef = useRef(false);
  const speakingRef = useRef(false);

  // Moveable + resizable mic button.
  const [mic, setMic] = useState({ x: window.innerWidth - 130, y: window.innerHeight - 130, size: 84 });

  // Poll projector content + the wake-word flag.
  useEffect(() => {
    let alive = true;
    const poll = () =>
      fetch(API + '/api/projector').then((r) => r.json()).then((d) => {
        if (!alive) return;
        setItems(d.items || []);
        setWake(Boolean(d.wakeWord));
      }).catch(() => {});
    poll();
    const t = setInterval(poll, 1000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const sendAudio = async (blob: Blob) => {
    setBusy(true);
    const fd = new FormData();
    fd.append('audio', blob, 'v.webm');
    const data = await fetch(API + '/api/voice', { method: 'POST', body: fd }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    if (data?.audioUrl) {
      speakingRef.current = true;
      const a = new Audio(API + data.audioUrl);
      a.onended = () => { speakingRef.current = false; };
      a.play().catch(() => { speakingRef.current = false; });
    }
    // Any visual he made auto-routes to the projector (active) — the poll shows it.
  };

  const startRec = async () => {
    if (listeningRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        sendAudio(new Blob(chunksRef.current, { type: 'audio/webm' }));
      };
      mediaRef.current = rec;
      rec.start();
      listeningRef.current = true;
      setListening(true);
    } catch { /* no mic / denied */ }
  };
  const stopRec = () => {
    mediaRef.current?.stop();
    listeningRef.current = false;
    setListening(false);
  };
  const toggleMic = () => (listeningRef.current ? stopRec() : startRec());

  // Wake word ("Chance") — real Chromium (the Pi) supports webkitSpeechRecognition.
  useEffect(() => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!wake || !SR) return;
    const rec = new SR();
    rec.continuous = true; rec.interimResults = false; rec.lang = 'en-US';
    let stopped = false;
    rec.onresult = (e: any) => {
      const said = e.results[e.results.length - 1][0].transcript.toLowerCase();
      if (said.includes('chance') && !listeningRef.current && !speakingRef.current) startRec();
    };
    rec.onend = () => { if (!stopped) { try { rec.start(); } catch { /* ignore */ } } };
    try { rec.start(); } catch { /* ignore */ }
    return () => { stopped = true; try { rec.stop(); } catch { /* ignore */ } };
  }, [wake]);

  // ── Drag + resize the mic button ──
  const onMicDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = mic.x, oy = mic.y;
    let moved = false;
    const mm = (me: MouseEvent) => {
      if (Math.abs(me.clientX - sx) > 3 || Math.abs(me.clientY - sy) > 3) moved = true;
      if (moved) setMic((m) => ({ ...m, x: ox + (me.clientX - sx), y: oy + (me.clientY - sy) }));
    };
    const mu = () => {
      window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu);
      if (!moved) toggleMic();
    };
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
  };
  const onResizeDown = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, os = mic.size;
    const mm = (me: MouseEvent) => setMic((m) => ({ ...m, size: Math.max(48, Math.min(220, os + (me.clientX - sx))) }));
    const mu = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
  };

  const back = () => {
    fetch(API + '/api/projector/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: false }) }).catch(() => {});
    window.location.href = '/?orb=1';
  };

  return (
    <div className="proj-root">
      <button className="proj-back" onClick={back} title="Back"><ChevronLeft size={22} /> Back</button>
      {wake && <div className="proj-wake">● WAKE WORD ON — say "Chance"</div>}
      {items.length === 0 ? (
        <div className="proj-empty" />
      ) : (
        <div className={`proj-grid ${items.length === 1 ? 'one' : ''}`}>
          {items.map((a, i) => (<div key={i} className="proj-card"><ToolView action={a} /></div>))}
        </div>
      )}
      <div
        className={`proj-mic ${listening ? 'on' : ''} ${busy ? 'busy' : ''}`}
        style={{ left: mic.x, top: mic.y, width: mic.size, height: mic.size }}
        onMouseDown={onMicDown}
        title="Press to talk · drag to move · drag the corner to resize"
      >
        {listening ? <Mic size={mic.size * 0.4} /> : <MicOff size={mic.size * 0.4} />}
        <div className="proj-mic-resize" onMouseDown={onResizeDown} />
      </div>
    </div>
  );
}
