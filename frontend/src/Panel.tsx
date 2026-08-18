import { useRef, useState } from 'react';
import { X, Maximize2, Minimize2, GripHorizontal } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ToolView } from './ToolView';

/**
 * A single free-floating popup: draggable (grab the header), resizable (8 edge
 * handles), full-screenable, and independently z-ordered. Many can coexist and
 * persist until closed. (Drag/resize logic extends the original single-panel
 * implementation, generalized per-instance.)
 */
let zCounter = 40;
type Rect = { left: number; top: number; width: number; height: number };
const DIRS = ['n', 's', 'e', 'w', 'nw', 'ne', 'se', 'sw'];

export function Panel({ title, text, action, index, onClose }: {
  title: string; text?: string; action?: any; index: number; onClose: () => void;
}) {
  const [full, setFull] = useState(false);
  const [z, setZ] = useState(() => ++zCounter);
  const [rect, setRect] = useState<Rect>(() => {
    const width = 540, height = 460;
    const off = (index % 6) * 36;
    return { left: Math.max(20, window.innerWidth - width - 24 - off), top: 84 + off, width, height };
  });
  const dragRef = useRef<{ sx: number; sy: number; l: number; t: number } | null>(null);
  const resizeRef = useRef<(Rect & { sx: number; sy: number; dir: string }) | null>(null);
  const front = () => setZ(++zCounter);

  const onDragStart = (e: React.MouseEvent) => {
    if (full) return;
    e.preventDefault(); front();
    dragRef.current = { sx: e.clientX, sy: e.clientY, l: rect.left, t: rect.top };
    const mm = (me: MouseEvent) => {
      const d = dragRef.current; if (!d) return;
      setRect((r) => ({ ...r, left: d.l + (me.clientX - d.sx), top: d.t + (me.clientY - d.sy) }));
    };
    const mu = () => { dragRef.current = null; window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
  };

  const onResizeStart = (e: React.MouseEvent, dir: string) => {
    if (full) return;
    e.preventDefault(); e.stopPropagation(); front();
    resizeRef.current = { ...rect, sx: e.clientX, sy: e.clientY, dir };
    const MIN = 260;
    const mm = (me: MouseEvent) => {
      const s = resizeRef.current; if (!s) return;
      const dx = me.clientX - s.sx, dy = me.clientY - s.sy;
      let { left, top, width, height } = { left: s.left, top: s.top, width: s.width, height: s.height };
      if (s.dir.includes('e')) width = Math.max(MIN, s.width + dx);
      if (s.dir.includes('w')) { width = Math.max(MIN, s.width - dx); left = s.left + s.width - width; }
      if (s.dir.includes('s')) height = Math.max(MIN, s.height + dy);
      if (s.dir.includes('n')) { height = Math.max(MIN, s.height - dy); top = s.top + s.height - height; }
      setRect({ left, top, width, height });
    };
    const mu = () => { resizeRef.current = null; window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
  };

  const style: React.CSSProperties = full
    ? { position: 'fixed', left: 16, right: 16, top: 70, bottom: 16, width: 'auto', height: 'auto', zIndex: z }
    : { position: 'fixed', left: rect.left, top: rect.top, width: rect.width, height: rect.height, zIndex: z };

  return (
    <div className="tool-display panel floating fade-in" style={style} onMouseDown={front}>
      {!full && DIRS.map((dir) => <div key={dir} className={`resize-handle ${dir}`} onMouseDown={(e) => onResizeStart(e, dir)} />)}
      <div className="tool-header" onMouseDown={full ? undefined : onDragStart} style={{ cursor: full ? 'default' : 'grab' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {!full && <GripHorizontal size={14} color="#5b7089" style={{ flexShrink: 0 }} />}
          <h2 style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h2>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={() => setFull((f) => !f)} className="icon-btn" title={full ? 'Dock' : 'Full screen'}>
            {full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button onClick={onClose} className="icon-btn" title="Close"><X size={16} /></button>
        </div>
      </div>
      <div className="tool-content">
        {text && <div className="tv-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>}
        {action && <div style={{ marginTop: text ? 18 : 0 }}><ToolView action={action} /></div>}
      </div>
    </div>
  );
}
