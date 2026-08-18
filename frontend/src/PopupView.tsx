import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ToolView } from './ToolView';

/**
 * A single visual reply rendered as a native desktop popup (its own transparent
 * Electron window). Same ToolView the dashboard uses, but floating over your
 * actual desktop instead of inside the site — this is where his output leaves
 * the webpage. The window is dragged by its header (-webkit-app-region: drag).
 */
export function PopupView() {
  const [data, setData] = useState<{ action: any; title: string; text?: string } | null>(null);

  useEffect(() => {
    const d = (window as any).chanceDesktop;
    d?.getPopupData?.().then((payload: any) => payload && setData(payload));
  }, []);

  const close = () => (window as any).chanceDesktop?.closePopup?.();

  const shell: React.CSSProperties = {
    position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
    background: 'rgba(6,12,24,0.88)', border: '1px solid rgba(47,111,255,0.5)',
    borderRadius: 14, overflow: 'hidden', color: '#e6f1ff',
    boxShadow: '0 0 40px rgba(47,111,255,0.25)', fontFamily: 'system-ui, sans-serif',
  };
  const header: any = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 12px', borderBottom: '1px solid rgba(47,111,255,0.25)',
    WebkitAppRegion: 'drag', cursor: 'grab', flexShrink: 0,
  };
  const closeBtn: any = {
    WebkitAppRegion: 'no-drag', background: 'transparent', border: 'none',
    color: '#8fb4ff', cursor: 'pointer', display: 'flex', padding: 4, borderRadius: 6,
  };

  return (
    <div style={shell}>
      <div style={header}>
        <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 1, color: '#5b9cff' }}>
          {data?.title || 'CHANCE'}
        </span>
        <button style={closeBtn} onClick={close} title="Close"><X size={16} /></button>
      </div>
      <div style={{ padding: 14, overflow: 'auto', flex: 1 }}>
        {data?.text && (
          <div className="tv-markdown" style={{ marginBottom: data?.action ? 14 : 0 }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.text}</ReactMarkdown>
          </div>
        )}
        {data?.action && <ToolView action={data.action} />}
      </div>
    </div>
  );
}
