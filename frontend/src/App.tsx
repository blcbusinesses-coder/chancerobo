import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Settings, MessageSquare, X, Eye, Hand, Plus, Projector, Minimize2, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Panel } from './Panel';
import './App.css';

interface OpenPanel { id: number; title: string; text: string; action: any }

const Markdown = ({ children }: { children: string }) => (
  <div className="tv-markdown">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
  </div>
);

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

function App() {
  const [isListening, setIsListening] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [panels, setPanels] = useState<OpenPanel[]>([]);
  const [subtitleText, setSubtitleText] = useState('');
  const [subtitles, setSubtitles] = useState(true);
  const [wakeWord, setWakeWord] = useState(false);
  const [bgListen, setBgListen] = useState(false);
  const [conversing, setConversing] = useState(false);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [usage, setUsage] = useState<any>(null);
  const [speaking, setSpeaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const panelIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const conversingRef = useRef(false);
  const speakingRef = useRef(false);
  const lastActivityRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const API = 'http://localhost:8787';

  // A reply's visual becomes its own persistent, draggable popup. Text-only
  // replies show as the transient subtitle near the orb. Popups stay until closed.
  // Show a visual: as a native floating desktop popup when running in the
  // Electron app, else as an in-page panel (browser fallback).
  const openVisual = (title: string, text: string, action: any) => {
    const desktop = (window as any).chanceDesktop;
    if (desktop?.openPopup) {
      desktop.openPopup({ title, text: subtitles ? text : '', action });
    } else {
      setPanels((prev) => [...prev, { id: ++panelIdRef.current, title, text, action }]);
    }
  };

  const showReply = (text: string, actions: any) => {
    const list = (Array.isArray(actions) ? actions : actions ? [actions] : []).filter(Boolean);
    if (list.length) {
      // One popup per visual — he can open many at once.
      list.forEach((action, i) => openVisual(String(action.type || 'CHANCE').toUpperCase(), i === 0 ? text : '', action));
      setSubtitleText('');
    } else {
      setSubtitleText(text || '');
    }
  };

  const [looking, setLooking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const orbMode = new URLSearchParams(location.search).has('orb');
  const [dim, setDim] = useState(() => Math.min(window.innerWidth, window.innerHeight));

  // 👁 Eye button: look through the webcam right now. Hits the local vision
  // service directly (no brain, no API credits) and opens the result as a panel.
  const lookThroughCamera = async () => {
    setLooking(true);
    try {
      const res = await fetch(API + '/api/vision/see', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setSubtitleText(data.error || 'Vision service is not running.');
        return;
      }
      const seen = (data.summary || []).map((s: any) => (s.count > 1 ? `${s.count} ${s.label}` : s.label)).join(', ');
      openVisual('VISION', seen ? `I can see: ${seen}.` : 'I looked, but couldn’t confidently identify anything.', { type: 'vision', ...data });
    } catch {
      setSubtitleText('Vision service is not running. Start it with: npm run vision');
    } finally {
      setLooking(false);
    }
  };

  const [handsOn, setHandsOn] = useState(false);

  // Toggle hand-tracking cursor control (index finger = pointer, pinch = click).
  // Free/local — no credits. Drop your hand to freeze the cursor, then click to stop.
  const toggleHands = async () => {
    const next = !handsOn;
    setHandsOn(next); // optimistic
    try {
      const res = await fetch(API + '/api/vision/hands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setHandsOn(false);
        setSubtitleText(data.error || 'Could not start hand control.');
        return;
      }
      setHandsOn(Boolean(data.running));
      setSubtitleText(data.running ? 'Hand control ON — index finger moves the cursor, pinch to click.' : 'Hand control off.');
    } catch {
      setHandsOn(false);
      setSubtitleText('Vision service is not running. Start it with: npm run vision');
    }
  };

  // Reflect the real hand-control state on load (survives page refreshes).
  useEffect(() => {
    fetch(API + '/api/vision/status')
      .then((r) => r.json())
      .then((d) => setHandsOn(Boolean(d?.service?.hands_running)))
      .catch(() => {});
  }, []);

  // Desktop app: drive the ambient screen-edge glow from his live state.
  useEffect(() => {
    const d = (window as any).chanceDesktop;
    if (!d?.setGlow) return;
    d.setGlow(busy ? 'working' : speaking ? 'speaking' : isListening ? 'listening' : 'idle');
  }, [busy, speaking, isListening]);

  // Desktop app: keep the renderer alive when hidden so wake-word listens in the
  // background — only when the user turns the setting on.
  useEffect(() => {
    (window as any).chanceDesktop?.setBackgroundListening?.(bgListen);
  }, [bgListen]);

  // Orb: track window size so the radial menu scales when you resize the brain.
  useEffect(() => {
    const onResize = () => setDim(Math.min(window.innerWidth, window.innerHeight));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // If Chance turns the projector ON by voice, jump this screen into projector mode.
  useEffect(() => {
    if (new URLSearchParams(location.search).has('projector')) return;
    const t = setInterval(() => {
      fetch(API + '/api/projector').then((r) => r.json()).then((d) => {
        if (d?.active) window.location.href = '/?projector=1';
      }).catch(() => {});
    }, 1500);
    return () => clearInterval(t);
  }, []);

  // View navigation (works in the Pi browser via URL; the desktop app has its own windows).
  const goOrb = () => { window.location.href = '/?orb=1'; };
  const goProjector = () => {
    fetch(API + '/api/projector/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: true }) }).catch(() => {});
    window.location.href = '/?projector=1';
  };
  const minimizeWindow = () => {
    const d = (window as any).chanceDesktop;
    if (d?.minimize) d.minimize();
    else { try { window.close(); } catch { window.location.href = '/'; } }
  };

  // Short synth chime: rising = wake, falling = sleep.
  const chime = (kind: 'wake' | 'sleep') => {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current!;
      if (ctx.state === 'suspended') ctx.resume();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = 'sine';
      const t = ctx.currentTime;
      const [a, b] = kind === 'wake' ? [620, 990] : [740, 440];
      o.frequency.setValueAtTime(a, t);
      o.frequency.exponentialRampToValueAtTime(b, t + 0.14);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.start(t);
      o.stop(t + 0.32);
    } catch { /* ignore */ }
  };

  const setConv = (v: boolean) => {
    if (v !== conversingRef.current) chime(v ? 'wake' : 'sleep');
    conversingRef.current = v;
    setConversing(v);
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Persist a setting to Supabase (via the API).
  const saveSetting = (key: string, value: any) =>
    fetch(API + '/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value }) }).catch(() => {});

  // Google account management.
  const loadAccounts = () => fetch(API + '/api/google/accounts').then((r) => r.json()).then((d) => setAccounts(d.accounts || [])).catch(() => {});
  const toggleAccount = (email: string, enabled: boolean) =>
    fetch(API + '/api/google/accounts/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, enabled }) }).then(loadAccounts);
  const removeAccount = (email: string) =>
    fetch(API + '/api/google/accounts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }).then(loadAccounts);
  const addAccount = async () => {
    const { url } = await fetch(API + '/api/google/auth-url').then((r) => r.json());
    const w = window.open(url, 'gauth', 'width=500,height=680');
    const t = setInterval(() => { if (!w || w.closed) { clearInterval(t); setTimeout(loadAccounts, 800); } }, 1000);
  };

  // MiniMax usage/cost (no live balance API — estimated from real token usage
  // + official pricing, seeded from a balance you tell it once).
  const loadUsage = () => fetch(API + '/api/minimax/usage').then((r) => r.json()).then(setUsage).catch(() => {});
  const setBalance = async () => {
    const current = usage?.startingBalanceCents != null ? (usage.startingBalanceCents / 100).toFixed(2) : '';
    const val = window.prompt('Your current MiniMax balance in USD (check platform.minimax.io):', current);
    if (val == null) return;
    const cents = Math.round(parseFloat(val) * 100);
    if (!Number.isFinite(cents)) return;
    await fetch(API + '/api/minimax/balance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cents }) });
    loadUsage();
  };

  // On load: pull saved settings + accounts + usage from Supabase.
  useEffect(() => {
    fetch(API + '/api/settings').then((r) => r.json()).then((s) => {
      if (typeof s.subtitles === 'boolean') setSubtitles(s.subtitles);
      if (typeof s.wakeWord === 'boolean') setWakeWord(s.wakeWord);
      if (typeof s.bgListen === 'boolean') setBgListen(s.bgListen);
    }).catch(() => {});
    loadAccounts();
    loadUsage();
    const t = setInterval(loadUsage, 30000);
    return () => clearInterval(t);
  }, []);

  const play = (audioUrl?: string) => {
    if (!audioUrl) return;
    const isDesktop = Boolean((window as any).chanceDesktop);
    // Desktop app force-enables autoplay, so a fresh element always plays. In a
    // plain browser, reuse the one unlocked on first interaction.
    const a = isDesktop ? new Audio() : (audioElRef.current ?? (audioElRef.current = new Audio()));
    a.muted = false;
    a.volume = 1;
    a.src = API + audioUrl;
    speakingRef.current = true;                 // ignore mic while he talks
    setSpeaking(true);                          // drives the pulse animation
    const done = () => { speakingRef.current = false; setSpeaking(false); lastActivityRef.current = Date.now(); };
    a.onended = done;
    a.onerror = () => { console.warn('[voice] audio error', a.error?.code, a.src); done(); };
    if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume().catch(() => {});
    a.play().then(() => console.log('[voice] playing', a.src)).catch((e: any) => {
      console.warn('[voice] playback failed:', e?.name, e?.message);
      done();
    });
  };

  // STOP: press the orb mid-task to abort the in-flight request (saves credits).
  const stopChance = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  };

  // Unlock browser audio on the first interaction so his replies can autoplay.
  useEffect(() => {
    const unlock = () => {
      try {
        // Prime the SAME element play() will reuse, so its autoplay grant sticks.
        const a = audioElRef.current ?? (audioElRef.current = new Audio());
        a.muted = true;
        a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(() => {});
        if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
      } catch { /* ignore */ }
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, []);

  // Toggle mic: start recording, or stop + send to /api/voice.
  const toggleMic = async () => {
    if (isListening) {
      mediaRef.current?.stop();
      setIsListening(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const fd = new FormData();
        fd.append('audio', new Blob(chunksRef.current, { type: 'audio/webm' }), 'mic.webm');
        const ac = new AbortController();
        abortRef.current = ac;
        setBusy(true);
        try {
          const data = await fetch(API + '/api/voice', { method: 'POST', body: fd, signal: ac.signal }).then((r) => r.json());
          setMessages((prev) => [
            ...prev,
            { role: 'user', content: data.transcript || '[voice]' },
            { role: 'assistant', content: data.text },
          ]);
          showReply(data.text, data.uiActions || data.uiAction);
          play(data.audioUrl);
          loadUsage();
        } catch (e: any) {
          if (e?.name !== 'AbortError') console.error(e);
        } finally {
          setBusy(false);
          abortRef.current = null;
        }
      };
      mediaRef.current = rec;
      rec.start();
      setIsListening(true);
    } catch (e) {
      console.error('mic error', e);
      setIsListening(false);
    }
  };

  const handleSend = async (text: string = inputText) => {
    if (!text.trim()) return;
    setMessages((prev) => [...prev, { role: 'user', content: text } as Message]);
    setInputText('');

    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    try {
      const res = await fetch(API + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, speak: true }),
        signal: ac.signal,
      });
      const data = await res.json();

      setMessages((prev) => [...prev, { role: 'assistant', content: data.text }]);
      showReply(data.text, data.uiActions || data.uiAction);
      play(data.audioUrl);
      loadUsage();
    } catch (e: any) {
      if (e?.name !== 'AbortError') console.error(e);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  // WAKE WORD: when on, listen continuously; anything after "Chance" becomes a command.
  useEffect(() => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!wakeWord || !SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    rec.lang = 'en-US';
    let stopped = false;

    const WAKE = /\b(?:hey\s+|yo\s+|ok\s+)?(?:chance|chances|chants|chancey|chancy|chanse|chense|chan)\b/i;
    const EXIT = /\b(stop listening|never ?mind|that'?s all|go to sleep|good ?bye|bye chance|thanks chance)\b/i;

    rec.onresult = (e: any) => {
      if (speakingRef.current) return;
      const result = e.results[e.results.length - 1];
      const alts: string[] = Array.from({ length: result.length }, (_, i) => result[i].transcript.trim());
      const phrase = alts[0] || '';
      if (!phrase) return;

      if (!conversingRef.current) {
        if (alts.some((a) => WAKE.test(a))) {
          setConv(true);
          lastActivityRef.current = Date.now();
          if (result.isFinal) {
            const cmd = phrase.replace(WAKE, '').replace(/^[\s,.:;!?-]+/, '').trim();
            if (cmd) handleSend(cmd);
          }
        }
        return;
      }

      if (!result.isFinal) return;
      if (EXIT.test(phrase)) { setConv(false); return; }
      const cmd = WAKE.test(phrase) ? phrase.replace(WAKE, '').replace(/^[\s,.:;!?-]+/, '').trim() : phrase;
      if (!cmd) return;
      lastActivityRef.current = Date.now();
      handleSend(cmd);
    };
    rec.onend = () => {
      if (!stopped && wakeWord) {
        try { rec.start(); } catch { /* already starting */ }
      }
    };
    try { rec.start(); } catch { /* ignore */ }
    setIsListening(true);

    const idle = setInterval(() => {
      if (conversingRef.current && Date.now() - lastActivityRef.current > 30_000) setConv(false);
    }, 5_000);

    return () => {
      stopped = true;
      clearInterval(idle);
      setConv(false);
      setIsListening(false);
      try { rec.stop(); } catch { /* ignore */ }
    };
  }, [wakeWord]);

  const hasPanels = panels.length > 0;

  // Press the brain: stop him if he's thinking, else start/stop listening
  // (unless wake-word mode is handling the mic).
  const onBrainClick = () => {
    if (busy) { stopChance(); return; }
    if (!wakeWord) toggleMic();
  };

  // Drag the whole window by the brain; a press with no drag counts as a click.
  const onBrainMouseDown = (e: React.MouseEvent) => {
    const d = (window as any).chanceDesktop;
    if (!d?.moveWindow) { onBrainClick(); return; }
    const offX = e.screenX - window.screenX;
    const offY = e.screenY - window.screenY;
    const downX = e.screenX, downY = e.screenY;
    let moved = false;
    const onMove = (me: MouseEvent) => {
      if (!moved && (Math.abs(me.screenX - downX) > 3 || Math.abs(me.screenY - downY) > 3)) moved = true;
      if (moved) d.moveWindow(me.screenX - offX, me.screenY - offY);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!moved) onBrainClick();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ── ORB MODE — the transparent floating brain (desktop app main window). ────
  if (orbMode) {
    const state = busy ? 'busy' : speaking ? 'speaking' : isListening ? 'listening' : '';
    const menu = [
      { key: 'sight', icon: <Eye size={19} />, title: 'Sight', lit: looking, onClick: () => lookThroughCamera() },
      { key: 'hand', icon: <Hand size={19} />, title: 'Hand tracking', lit: handsOn, onClick: () => toggleHands() },
      { key: 'chat', icon: <MessageSquare size={19} />, title: 'Chat', lit: showChat, onClick: () => { setShowSettings(false); setShowChat((v) => !v); setMenuOpen(false); } },
      { key: 'settings', icon: <Settings size={19} />, title: 'Settings', lit: showSettings, onClick: () => { setShowChat(false); setShowSettings((v) => !v); setMenuOpen(false); } },
    ];
    const angles = [160, 212, 268, 320];
    const R = dim * 0.3;
    return (
      <div
        className="orb-root"
        onWheel={(e) => (window as any).chanceDesktop?.resizeWindow?.(e.deltaY < 0 ? 26 : -26)}
      >
        <button className="orb-mini" onClick={minimizeWindow} title="Minimize"><Minimize2 size={16} /></button>
        <div className="orb-stage">
          {menu.map((m, i) => {
            const a = (angles[i] * Math.PI) / 180;
            const x = Math.cos(a) * R, y = Math.sin(a) * R;
            return (
              <button
                key={m.key}
                className={`orb-btn ${menuOpen ? 'open' : ''} ${m.lit ? 'lit' : ''}`}
                style={{ transform: menuOpen ? `translate(${x}px, ${y}px)` : 'translate(0,0)', transitionDelay: `${menuOpen ? i * 45 : 0}ms` }}
                onClick={(e) => { e.stopPropagation(); m.onClick(); }}
                title={m.title}
              >
                {m.icon}
              </button>
            );
          })}
          <div
            className={`orb-brain ${state}`}
            onMouseDown={onBrainMouseDown}
            title={busy ? 'Press to STOP' : isListening ? 'Listening — press to stop' : 'Drag to move · press to talk · scroll to resize'}
          >
            {busy && <div className="orb-ring" />}
            <img
              src="/chance-brain-hero.png"
              alt="Chance"
              className="orb-img"
              draggable={false}
              onError={(e) => { (e.target as HTMLImageElement).src = '/chance_brain2.png'; }}
            />
          </div>
          <button className={`orb-plus ${menuOpen ? 'open' : ''}`} onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }} title="Menu">
            <Plus size={18} />
          </button>
        </div>
        {subtitles && subtitleText && <div className="orb-subtitle"><Markdown>{subtitleText}</Markdown></div>}

        {showChat && (
          <div className="orb-overlay">
            <div className="orb-panel">
              <div className="orb-panel-head"><span>CHAT</span><button className="icon-btn" onClick={() => setShowChat(false)}><X size={16} /></button></div>
              <div className="orb-chat-history">
                {messages.map((m, i) => (
                  <div key={i} className={`msg ${m.role}`}>
                    <span className="sender">{m.role === 'user' ? 'YOU' : 'CHANCE'}</span>
                    {m.role === 'assistant' ? <Markdown>{m.content}</Markdown> : <p>{m.content}</p>}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <input className="orb-chat-input" value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} placeholder="Type to Chance…" />
            </div>
          </div>
        )}
        {showSettings && (
          <div className="orb-overlay">
            <div className="orb-panel">
              <div className="orb-panel-head"><span>SETTINGS</span><button className="icon-btn" onClick={() => setShowSettings(false)}><X size={16} /></button></div>
              <div className="setting-item"><label>Subtitles</label><input type="checkbox" checked={subtitles} onChange={(e) => { setSubtitles(e.target.checked); saveSetting('subtitles', e.target.checked); }} /></div>
              <div className="setting-item"><label>Wake word ("Chance")</label><input type="checkbox" checked={wakeWord} onChange={(e) => { setWakeWord(e.target.checked); saveSetting('wakeWord', e.target.checked); }} /></div>
              <div className="setting-item"><label>Keep listening in background</label><input type="checkbox" checked={bgListen} onChange={(e) => { setBgListen(e.target.checked); saveSetting('bgListen', e.target.checked); }} /></div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <h1>CHANCE SYSTEM</h1>
        <div className="controls">
          <button
            onClick={setBalance}
            title="MiniMax balance is estimated from tracked token usage (no live balance API) — click to set/update your real balance from platform.minimax.io"
            style={{
              display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px',
              borderRadius: 999, border: '1px solid #16324a', background: 'rgba(47,111,255,0.06)',
              color: '#2F6FFF', fontFamily: 'ui-monospace, monospace', fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {!usage ? 'MM …' : usage.estimatedRemainingCents != null
              ? `MM $${(usage.estimatedRemainingCents / 100).toFixed(2)}`
              : 'MM: set balance'}
            {usage?.taskCount ? <span style={{ color: '#5b7089' }}> · {usage.avgCostCentsPerTask.toFixed(2)}¢/task</span> : null}
          </button>
          <button
            onClick={lookThroughCamera}
            className={`icon-btn ${looking ? 'active' : ''}`}
            title="Look through the webcam (free — local vision, no credits)"
            disabled={looking}
          >
            <Eye size={20} />
          </button>
          <button
            onClick={toggleHands}
            className={`icon-btn ${handsOn ? 'active' : ''}`}
            title={handsOn ? 'Hand control ON — click to stop (drop your hand first to free the cursor)' : 'Start hand-tracking mouse control (free — no credits)'}
          >
            <Hand size={20} />
          </button>
          <button onClick={() => setShowChat(!showChat)} className={`icon-btn ${showChat ? 'active' : ''}`}>
            <MessageSquare size={20} />
          </button>
          <button onClick={() => setShowSettings(!showSettings)} className={`icon-btn ${showSettings ? 'active' : ''}`}>
            <Settings size={20} />
          </button>
          <button onClick={goOrb} className="icon-btn" title="Switch to floating brain (orb)">
            <Sparkles size={20} />
          </button>
          <button onClick={goProjector} className="icon-btn" title="Projector mode">
            <Projector size={20} />
          </button>
          <button onClick={minimizeWindow} className="icon-btn" title="Minimize">
            <Minimize2 size={20} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="main-display">
        <div className={`avatar-container ${hasPanels ? 'split' : 'fade-in'} ${isListening ? 'listening' : ''} ${speaking ? 'speaking' : ''} ${busy ? 'busy' : ''}`}>
          {busy && <div className="busy-ring" />}
          <div
            className="brain-core"
            onClick={busy ? stopChance : undefined}
            style={{ cursor: busy ? 'pointer' : 'default' }}
            title={busy ? 'Press to STOP' : ''}
          >
            <img
              src="/chance-brain-hero.png"
              alt="Chance Brain"
              className="chance-3d-icon"
              onError={(e) => { (e.target as HTMLImageElement).src = '/chance_brain2.png'; }}
            />
          </div>
          {busy && (
            <div style={{
              position: 'absolute', bottom: -46, left: '50%', transform: 'translateX(-50%)',
              whiteSpace: 'nowrap', letterSpacing: 2, fontSize: 12, fontWeight: 700, color: '#2F6FFF',
              textShadow: '0 0 12px rgba(47,111,255,0.6)',
            }}>
              WORKING — PRESS TO STOP
            </div>
          )}
          
          {wakeWord && (
            <div style={{
              position: 'absolute', bottom: -46, left: '50%', transform: 'translateX(-50%)',
              whiteSpace: 'nowrap', letterSpacing: 2, fontSize: 13, fontWeight: 600,
              color: conversing ? '#2F6FFF' : '#5b7089',
              textShadow: conversing ? '0 0 12px rgba(47,111,255,0.6)' : 'none',
            }}>
              {conversing ? '● LISTENING — just talk' : 'SAY "CHANCE" TO WAKE'}
            </div>
          )}
        </div>

        {/* Short/text replies: small caption near the orb (orb stays visible). */}
        {subtitles && subtitleText && (
          <div className="subtitle-overlay">
            <Markdown>{subtitleText}</Markdown>
          </div>
        )}
      </main>

      {/* Visual replies: independent free-floating popups spread across the whole
          screen. Each is draggable, resizable, full-screenable, z-ordered, and
          persists until its own X is clicked — new messages never close them. */}
      {panels.map((p, i) => (
        <Panel
          key={p.id}
          title={p.title}
          text={subtitles ? p.text : undefined}
          action={p.action}
          index={i}
          onClose={() => setPanels((ps) => ps.filter((x) => x.id !== p.id))}
        />
      ))}

      {/* Corner Mic Button */}
      <button 
        className={`corner-mic ${isListening ? 'listening' : ''}`} 
        onClick={toggleMic}
      >
        {isListening ? <Mic size={28} color="#020710" /> : <MicOff size={28} color="#2F6FFF" />}
      </button>

      {/* Side Panels */}
      {showChat && (
        <aside className="chat-panel panel">
          <div className="chat-history">
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                <span className="sender">{m.role === 'user' ? 'BECKITT' : 'CHANCE'}</span>
                {m.role === 'assistant' ? <Markdown>{m.content}</Markdown> : <p>{m.content}</p>}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="chat-input">
            <input 
              value={inputText} 
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="Type message..." 
            />
          </div>
        </aside>
      )}

      {showSettings && (
        <aside className="settings-panel panel">
          <h2>SETTINGS</h2>
          <div className="setting-item">
            <label>Subtitles</label>
            <input type="checkbox" checked={subtitles} onChange={e => { setSubtitles(e.target.checked); saveSetting('subtitles', e.target.checked); }} />
          </div>
          <div className="setting-item">
            <label>Wake word (say "Chance")</label>
            <input type="checkbox" checked={wakeWord} onChange={e => { setWakeWord(e.target.checked); saveSetting('wakeWord', e.target.checked); }} />
          </div>
          <div className="setting-item">
            <label>Keep listening in background<br /><span style={{ fontSize: 11, color: '#5b7089' }}>desktop app — wake word stays on when hidden</span></label>
            <input type="checkbox" checked={bgListen} onChange={e => { setBgListen(e.target.checked); saveSetting('bgListen', e.target.checked); }} />
          </div>

          <h2 style={{ marginTop: 22 }}>GOOGLE ACCOUNTS</h2>
          {accounts.map((a) => (
            <div className="setting-item" key={a.email} style={{ opacity: a.enabled ? 1 : 0.5 }}>
              <label style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
                <span>{a.email}</span>
                <span style={{ fontSize: 11, color: '#5b7089' }}>{a.primary ? 'Chance (primary)' : a.enabled ? 'active' : 'disabled'}</span>
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={a.enabled} disabled={a.primary} onChange={(e) => toggleAccount(a.email, e.target.checked)} title="Enable / disable" />
                {!a.primary && (
                  <button className="icon-btn" title="Remove" onClick={() => removeAccount(a.email)}><X size={14} /></button>
                )}
              </div>
            </div>
          ))}
          <button
            onClick={addAccount}
            style={{ marginTop: 10, width: '100%', padding: '10px', borderRadius: 10, border: '1px solid #2F6FFF', background: 'rgba(47,111,255,0.12)', color: '#2F6FFF', cursor: 'pointer', fontWeight: 600 }}>
            + Sign in another Google account
          </button>
        </aside>
      )}
    </div>
  );
}

export default App;
