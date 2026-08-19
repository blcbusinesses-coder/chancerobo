import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, ChevronLeft } from 'lucide-react';
import { ToolView } from './ToolView';

/**
 * PROJECTOR MODE (?projector=1). Black + blue hue when idle; shows every visual
 * Chance sends. Items are draggable/resizable by mouse AND by HAND GESTURE
 * (point to hover, pinch to grab & move) when gesture control is running.
 */
const API = 'http://localhost:8787';
type Rect = { x: number; y: number; w: number; h: number };

function defaultRect(index: number): Rect {
  const w = Math.min(window.innerWidth * 0.42, 700), h = Math.min(window.innerHeight * 0.5, 500);
  const col = index % 2, row = Math.floor(index / 2) % 2;
  return { x: 40 + col * (w + 50), y: 60 + row * (h + 40), w, h };
}

function ProjCard({ action, rect, setRect }: { action: any; rect: Rect; setRect: (r: Rect) => void }) {
  const drag = (e: React.MouseEvent) => {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = rect.x, oy = rect.y;
    const mm = (me: MouseEvent) => setRect({ ...rect, x: ox + (me.clientX - sx), y: oy + (me.clientY - sy) });
    const mu = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
  };
  const resize = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ow = rect.w, oh = rect.h;
    const mm = (me: MouseEvent) => setRect({ ...rect, w: Math.max(220, ow + (me.clientX - sx)), h: Math.max(160, oh + (me.clientY - sy)) });
    const mu = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
  };
  return (
    <div className="proj-card" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
      <div className="proj-card-head" onMouseDown={drag} title="Drag to move" />
      <div className="proj-card-body"><ToolView action={action} /></div>
      <div className="proj-card-resize" onMouseDown={resize} title="Drag to resize" />
    </div>
  );
}

export function ProjectorView() {
  const [items, setItems] = useState<any[]>([]);
  const [rects, setRects] = useState<Rect[]>([]);
  const [listening, setListening] = useState(false);
  const [wake, setWake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number; pinch: boolean; active: boolean }>({ x: 0.5, y: 0.5, pinch: false, active: false });
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const listeningRef = useRef(false);
  const speakingRef = useRef(false);
  const grabRef = useRef<{ idx: number; dx: number; dy: number } | null>(null);
  const rectsRef = useRef<Rect[]>([]);
  rectsRef.current = rects;

  const [mic, setMic] = useState({ x: window.innerWidth - 130, y: window.innerHeight - 130, size: 84 });

  // Poll projector: items, wake word, and the hand-gesture cursor.
  useEffect(() => {
    let alive = true;
    const poll = () => fetch(API + '/api/projector').then((r) => r.json()).then((d) => {
      if (!alive) return;
      setItems(d.items || []);
      setRects((prev) => (d.items || []).map((_: any, i: number) => prev[i] || defaultRect(i)));
      setWake(Boolean(d.wakeWord));
      if (d.gesture) setCursor(d.gesture);
    }).catch(() => {});
    poll();
    const t = setInterval(poll, 600);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Gesture: pinch grabs the card under the cursor and moves it; release drops.
  useEffect(() => {
    if (!cursor.active) { grabRef.current = null; return; }
    const px = cursor.x * window.innerWidth, py = cursor.y * window.innerHeight;
    if (cursor.pinch) {
      if (!grabRef.current) {
        const idx = [...rectsRef.current].map((r, i) => ({ r, i })).reverse()
          .find(({ r }) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h)?.i;
        if (idx != null) grabRef.current = { idx, dx: px - rectsRef.current[idx].x, dy: py - rectsRef.current[idx].y };
      }
      if (grabRef.current) {
        const g = grabRef.current;
        setRects((prev) => prev.map((r, i) => (i === g.idx ? { ...r, x: px - g.dx, y: py - g.dy } : r)));
      }
    } else {
      grabRef.current = null;
    }
  }, [cursor]);

  const sendAudio = async (blob: Blob) => {
    setBusy(true);
    const fd = new FormData(); fd.append('audio', blob, 'v.webm');
    const data = await fetch(API + '/api/voice', { method: 'POST', body: fd }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    if (data?.audioUrl) { speakingRef.current = true; const a = new Audio(API + data.audioUrl); a.onended = () => { speakingRef.current = false; }; a.play().catch(() => { speakingRef.current = false; }); }
  };
  const startRec = async () => {
    if (listeningRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); sendAudio(new Blob(chunksRef.current, { type: 'audio/webm' })); };
      mediaRef.current = rec; rec.start(); listeningRef.current = true; setListening(true);
    } catch { /* no mic */ }
  };
  const stopRec = () => { mediaRef.current?.stop(); listeningRef.current = false; setListening(false); };
  const toggleMic = () => (listeningRef.current ? stopRec() : startRec());

  useEffect(() => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!wake || !SR) return;
    const rec = new SR(); rec.continuous = true; rec.interimResults = false; rec.lang = 'en-US';
    let stopped = false;
    rec.onresult = (e: any) => { const s = e.results[e.results.length - 1][0].transcript.toLowerCase(); if (s.includes('chance') && !listeningRef.current && !speakingRef.current) startRec(); };
    rec.onend = () => { if (!stopped) { try { rec.start(); } catch { /* ignore */ } } };
    try { rec.start(); } catch { /* ignore */ }
    return () => { stopped = true; try { rec.stop(); } catch { /* ignore */ } };
  }, [wake]);

  const onMicDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = mic.x, oy = mic.y; let moved = false;
    const mm = (me: MouseEvent) => { if (Math.abs(me.clientX - sx) > 3 || Math.abs(me.clientY - sy) > 3) moved = true; if (moved) setMic((m) => ({ ...m, x: ox + (me.clientX - sx), y: oy + (me.clientY - sy) })); };
    const mu = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); if (!moved) toggleMic(); };
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
      {items.length === 0 ? <div className="proj-empty" /> : items.map((a, i) => (
        <ProjCard key={i} action={a} rect={rects[i] || defaultRect(i)} setRect={(r) => setRects((prev) => prev.map((x, j) => (j === i ? r : x)))} />
      ))}
      {cursor.active && (
        <div className={`proj-hand ${cursor.pinch ? 'pinch' : ''}`} style={{ left: cursor.x * window.innerWidth, top: cursor.y * window.innerHeight }} />
      )}
      <div className={`proj-mic ${listening ? 'on' : ''} ${busy ? 'busy' : ''}`} style={{ left: mic.x, top: mic.y, width: mic.size, height: mic.size }} onMouseDown={onMicDown} title="Press to talk · drag to move · corner to resize">
        {listening ? <Mic size={mic.size * 0.4} /> : <MicOff size={mic.size * 0.4} />}
        <div className="proj-mic-resize" onMouseDown={onResizeDown} />
      </div>
    </div>
  );
}
