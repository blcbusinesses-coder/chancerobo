import { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import QRCode from 'qrcode';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';

const COLORS = ['#2F6FFF', '#FFB300', '#7C4DFF', '#29E0A8', '#FF5C7C', '#5B9CFF', '#FF9F45'];

function ChartView({ chartType, title, data }: any) {
  const d = (data || []).map((x: any) => ({ name: String(x.label ?? x.name ?? ''), value: Number(x.value) }));
  const axis = { stroke: '#5b7089', fontSize: 12 };
  return (
    <div>
      {title && <h3 className="tv-title">{title}</h3>}
      <ResponsiveContainer width="100%" height={340}>
        {chartType === 'pie' ? (
          <PieChart>
            <Pie data={d} dataKey="value" nameKey="name" outerRadius={120} label>
              {d.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={{ background: '#0b1b2e', border: '1px solid #2F6FFF' }} />
          </PieChart>
        ) : chartType === 'bar' ? (
          <BarChart data={d}>
            <CartesianGrid strokeDasharray="3 3" stroke="#16324a" />
            <XAxis dataKey="name" {...axis} /><YAxis {...axis} />
            <Tooltip contentStyle={{ background: '#0b1b2e', border: '1px solid #2F6FFF' }} cursor={{ fill: 'rgba(47,111,255,0.08)' }} />
            <Bar dataKey="value" fill="#2F6FFF" radius={[4, 4, 0, 0]} />
          </BarChart>
        ) : (
          <LineChart data={d}>
            <CartesianGrid strokeDasharray="3 3" stroke="#16324a" />
            <XAxis dataKey="name" {...axis} /><YAxis {...axis} />
            <Tooltip contentStyle={{ background: '#0b1b2e', border: '1px solid #2F6FFF' }} />
            <Line dataKey="value" stroke="#2F6FFF" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function StockView({ action }: any) {
  const up = (action.change ?? 0) >= 0;
  const col = up ? '#29E0A8' : '#FF5C7C';
  const cur = action.currency === 'USD' ? '$' : (action.currency ? action.currency + ' ' : '$');
  const d = (action.chart || []).map((x: any) => ({ name: x.label, value: x.value }));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: '#2F6FFF' }}>{action.symbol}</span>
        <span style={{ color: '#8fb4ff', fontSize: 13 }}>{action.name}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 30, fontWeight: 800 }}>{cur}{Number(action.price).toFixed(2)}</span>
        <span style={{ color: col, fontWeight: 700 }}>
          {up ? '▲' : '▼'} {cur}{Math.abs(Number(action.change)).toFixed(2)} ({Number(action.changePercent).toFixed(2)}%)
        </span>
        <span style={{ color: '#5b7089', fontSize: 12, marginLeft: 'auto' }}>{String(action.range).toUpperCase()}</span>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={d}>
          <CartesianGrid strokeDasharray="3 3" stroke="#16324a" />
          <XAxis dataKey="name" stroke="#5b7089" fontSize={11} minTickGap={40} />
          <YAxis stroke="#5b7089" fontSize={11} domain={['auto', 'auto']} width={54} />
          <Tooltip contentStyle={{ background: '#0b1b2e', border: `1px solid ${col}` }} />
          <Line dataKey="value" stroke={col} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function timeAgo(dateStr?: string): string {
  if (!dateStr) return '';
  const t = Date.parse(dateStr);
  if (isNaN(t)) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function NewsView({ action }: any) {
  const items = action.items || [];
  return (
    <div>
      {action.heading && <h3 className="tv-title">{action.heading}</h3>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((a: any, i: number) => (
          <a
            key={i}
            href={a.url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'block', padding: '12px 14px', borderRadius: 10,
              border: '1px solid #16324a', background: 'rgba(47,111,255,0.05)',
              textDecoration: 'none', color: 'inherit',
            }}
          >
            <div style={{ fontWeight: 700, color: '#e6f1ff', lineHeight: 1.35, marginBottom: 4 }}>{a.title}</div>
            <div style={{ fontSize: 12, color: '#5b9cff' }}>
              {a.source}{a.publishedAt ? <span style={{ color: '#5b7089' }}> · {timeAgo(a.publishedAt)}</span> : null}
            </div>
            {a.snippet && <div style={{ fontSize: 12.5, color: '#8fb4ff', marginTop: 5, opacity: 0.85 }}>{a.snippet}</div>}
          </a>
        ))}
      </div>
    </div>
  );
}

function ArticleView({ action }: any) {
  return (
    <div>
      <h3 className="tv-title" style={{ marginBottom: 4 }}>{action.title}</h3>
      <div style={{ fontSize: 12.5, color: '#5b9cff', marginBottom: 14 }}>
        {action.source}
        {action.url && (
          <> · <a href={action.url} target="_blank" rel="noreferrer" style={{ color: '#2F6FFF' }}>open original ↗</a></>
        )}
      </div>
      <div style={{ lineHeight: 1.62, color: '#cfe0ff', fontSize: 14, whiteSpace: 'pre-wrap' }}>
        {String(action.content || '')}
      </div>
    </div>
  );
}

function VisionView({ action }: any) {
  const summary = action.summary || [];
  return (
    <div>
      {action.imageData && (
        <img
          src={action.imageData}
          alt="what Chance sees"
          style={{ width: '100%', borderRadius: 10, border: '1px solid #16324a', display: 'block' }}
        />
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        {summary.length ? (
          summary.map((s: any, i: number) => (
            <span
              key={i}
              style={{
                padding: '5px 11px', borderRadius: 999, fontSize: 13, fontWeight: 600,
                border: '1px solid #2F6FFF', background: 'rgba(47,111,255,0.12)', color: '#8fb4ff',
              }}
            >
              {s.count > 1 ? `${s.count}× ` : ''}{s.label}
            </span>
          ))
        ) : (
          <span style={{ color: '#5b7089', fontSize: 13 }}>Nothing confidently identified.</span>
        )}
      </div>
    </div>
  );
}

function TableView({ columns = [], rows = [] }: any) {
  return (
    <table className="tv-table">
      <thead><tr>{columns.map((c: string, i: number) => <th key={i}>{c}</th>)}</tr></thead>
      <tbody>
        {rows.map((r: any[], i: number) => (
          <tr key={i}>{r.map((cell, j) => <td key={j}>{String(cell)}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

function Checklist({ title, items = [] }: any) {
  const [done, setDone] = useState<boolean[]>(items.map((it: any) => !!it.done));
  return (
    <div>
      {title && <h3 className="tv-title">{title}</h3>}
      {items.map((it: any, i: number) => (
        <label key={i} className="tv-check">
          <input type="checkbox" checked={done[i]} onChange={() => setDone((s) => s.map((v, j) => (j === i ? !v : v)))} />
          <span style={{ textDecoration: done[i] ? 'line-through' : 'none', opacity: done[i] ? 0.55 : 1 }}>{it.text}</span>
        </label>
      ))}
    </div>
  );
}

function Slideshow({ images = [], interval = 3500 }: any) {
  const [i, setI] = useState(0);
  const n = images.length;
  const go = (d: number) => setI((x) => (x + d + n) % n);
  useEffect(() => {
    if (n < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % n), interval);
    return () => clearInterval(t);
  }, [n, interval]);
  if (!n) return <div>No images.</div>;
  return (
    <div style={{ textAlign: 'center' }}>
      <img src={images[i]} alt={`slide ${i + 1}`} style={{ maxWidth: '100%', maxHeight: 460, borderRadius: 8 }} />
      <div style={{ marginTop: 10, display: 'flex', gap: 12, justifyContent: 'center', alignItems: 'center' }}>
        <button className="icon-btn" onClick={() => go(-1)}>‹</button>
        <span style={{ color: '#5b7089', fontSize: 13 }}>{i + 1} / {n}</span>
        <button className="icon-btn" onClick={() => go(1)}>›</button>
      </div>
    </div>
  );
}

// ── 3D model / scene (Three.js) — a glowing, rotating object. ────────────────
function Model3D({ action }: any) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.clientWidth || 480, h = 320;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100);
    camera.position.z = 3.4;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.appendChild(renderer.domElement);

    const shape = String(action.shape || 'torusknot');
    const geo: THREE.BufferGeometry =
      shape === 'cube' ? new THREE.BoxGeometry(1.4, 1.4, 1.4) :
      shape === 'sphere' ? new THREE.IcosahedronGeometry(1.3, 1) :
      shape === 'torus' ? new THREE.TorusGeometry(1, 0.4, 24, 90) :
      shape === 'octahedron' ? new THREE.OctahedronGeometry(1.5, 0) :
      new THREE.TorusKnotGeometry(0.9, 0.3, 160, 24);
    const color = new THREE.Color(action.color || '#2F6FFF');
    const mat = new THREE.MeshStandardMaterial({
      color, metalness: 0.6, roughness: 0.25,
      emissive: color.clone().multiplyScalar(0.18), wireframe: Boolean(action.wireframe),
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    scene.add(new THREE.AmbientLight(0x8899ff, 1.1));
    const d1 = new THREE.DirectionalLight(0xffffff, 2.2); d1.position.set(4, 5, 6); scene.add(d1);
    const d2 = new THREE.DirectionalLight(0x7c4dff, 1.4); d2.position.set(-5, -2, 3); scene.add(d2);

    let raf = 0;
    const tick = () => { mesh.rotation.x += 0.006; mesh.rotation.y += 0.012; renderer.render(scene, camera); raf = requestAnimationFrame(tick); };
    tick();
    return () => {
      cancelAnimationFrame(raf); renderer.dispose(); geo.dispose(); mat.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
  }, [action]);
  return (
    <div>
      {action.title && <h3 className="tv-title">{action.title}</h3>}
      <div ref={ref} style={{ width: '100%', height: 320 }} />
    </div>
  );
}

// ── Gauge / dial — animated speedometer-style metric. ────────────────────────
function Gauge({ action }: any) {
  const min = Number(action.min ?? 0), max = Number(action.max ?? 100), val = Number(action.value ?? 0);
  const pct = Math.min(1, Math.max(0, (val - min) / ((max - min) || 1)));
  const r = 90, cx = 110, cy = 110;
  const a = Math.PI * (1 - pct);
  const ex = cx + r * Math.cos(a), ey = cy - r * Math.sin(a);
  const large = pct > 0.5 ? 1 : 0;
  const track = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const fill = `M ${cx - r} ${cy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`;
  return (
    <div style={{ textAlign: 'center' }}>
      {action.title && <h3 className="tv-title">{action.title}</h3>}
      <svg viewBox="0 0 220 128" width="100%" style={{ maxWidth: 320 }}>
        <path d={track} fill="none" stroke="#16324a" strokeWidth="15" strokeLinecap="round" />
        <path d={fill} fill="none" stroke="#2F6FFF" strokeWidth="15" strokeLinecap="round" style={{ transition: 'all 700ms ease' }} />
      </svg>
      <div style={{ marginTop: -34 }}>
        <span style={{ fontSize: 34, fontWeight: 800 }}>{val}</span>
        <span style={{ color: '#5b7089', fontSize: 15 }}> {action.unit || ''}</span>
      </div>
      {action.label && <div style={{ color: '#8fb4ff', marginTop: 4 }}>{action.label}</div>}
    </div>
  );
}

// ── Gallery — grid of images. ────────────────────────────────────────────────
function Gallery({ action }: any) {
  const imgs: string[] = action.images || [];
  return (
    <div>
      {action.title && <h3 className="tv-title">{action.title}</h3>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
        {imgs.map((s, i) => (
          <img key={i} src={s} alt={`img ${i + 1}`} style={{ width: '100%', height: 112, objectFit: 'cover', borderRadius: 8, border: '1px solid #16324a' }} />
        ))}
      </div>
    </div>
  );
}

// ── Countdown / live timer. ──────────────────────────────────────────────────
function Countdown({ action }: any) {
  const targetMs = action.target ? Date.parse(action.target) : Date.now() + (Number(action.seconds) || 60) * 1000;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  let rem = Math.max(0, Math.floor((targetMs - now) / 1000));
  const d = Math.floor(rem / 86400); rem %= 86400;
  const h = Math.floor(rem / 3600); rem %= 3600;
  const m = Math.floor(rem / 60); const s = rem % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const done = targetMs - now <= 0;
  return (
    <div style={{ textAlign: 'center' }}>
      {action.title && <h3 className="tv-title">{action.title}</h3>}
      <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: 2, color: done ? '#29E0A8' : '#2F6FFF', fontFamily: 'ui-monospace, monospace' }}>
        {done ? "TIME'S UP" : `${d > 0 ? d + 'd ' : ''}${pad(h)}:${pad(m)}:${pad(s)}`}
      </div>
      {action.label && <div style={{ color: '#8fb4ff', marginTop: 6 }}>{action.label}</div>}
    </div>
  );
}

// ── QR code — for a link or text. ────────────────────────────────────────────
function QRView({ action }: any) {
  const value = String(action.data || action.text || action.url || '');
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(value, { width: 320, margin: 1, color: { dark: '#e6f1ff', light: '#00000000' } }).then(setSrc).catch(() => {});
  }, [value]);
  return (
    <div style={{ textAlign: 'center' }}>
      {action.title && <h3 className="tv-title">{action.title}</h3>}
      {src && <img src={src} alt="QR code" style={{ width: 260, height: 260 }} />}
      <div style={{ color: '#8fb4ff', fontSize: 12, wordBreak: 'break-all', marginTop: 4 }}>{value}</div>
    </div>
  );
}

// ── Embed — a live web page / doc / video inside the popup (iframe). ──────────
function Embed({ action }: any) {
  return (
    <div>
      {action.title && <h3 className="tv-title">{action.title}</h3>}
      <iframe
        src={action.url}
        title={action.title || 'embed'}
        style={{ width: '100%', height: action.height || 440, border: '1px solid #16324a', borderRadius: 8, background: '#fff' }}
        allow="autoplay; fullscreen; clipboard-write"
      />
    </div>
  );
}

export function ToolView({ action }: { action: any }) {
  if (!action) return null;
  switch (action.type) {
    case 'video':
      return <video src={action.url || action.data} controls autoPlay loop style={{ maxWidth: '100%', maxHeight: 480, borderRadius: 8 }} />;
    case 'slideshow':
      return <Slideshow images={action.images || []} interval={action.interval || 3500} />;
    case 'chart':
      return <ChartView chartType={action.chartType} title={action.title} data={action.data} />;
    case 'stock':
      return <StockView action={action} />;
    case 'news':
      return <NewsView action={action} />;
    case 'article':
      return <ArticleView action={action} />;
    case 'vision':
      return <VisionView action={action} />;
    case 'model3d':
    case '3d':
      return <Model3D action={action} />;
    case 'gauge':
      return <Gauge action={action} />;
    case 'gallery':
      return <Gallery action={action} />;
    case 'countdown':
    case 'timer':
      return <Countdown action={action} />;
    case 'qr':
      return <QRView action={action} />;
    case 'embed':
    case 'webframe':
      return <Embed action={action} />;
    case 'code':
      return (
        <SyntaxHighlighter language={action.language || 'text'} style={oneDark} wrapLongLines showLineNumbers customStyle={{ margin: 0, borderRadius: 8, fontSize: 13 }}>
          {String(action.code ?? '')}
        </SyntaxHighlighter>
      );
    case 'document':
    case 'markdown':
      return (
        <div className="tv-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{String(action.markdown ?? action.data ?? '')}</ReactMarkdown>
        </div>
      );
    case 'table':
      return <TableView columns={action.columns} rows={action.rows} />;
    case 'checklist':
      return <Checklist title={action.title} items={action.items} />;
    case 'image':
    case 'screenshot':
    case 'map':
      return <img src={action.data} alt={action.type} style={{ maxWidth: '100%', borderRadius: 8 }} />;
    default:
      return <pre>{typeof action.data === 'string' ? action.data : JSON.stringify(action, null, 2)}</pre>;
  }
}
