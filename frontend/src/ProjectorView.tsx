import { useState, useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';
import { ToolView } from './ToolView';

/**
 * PROJECTOR MODE (?projector=1). Idle = pure black with a subtle blue hue.
 * Otherwise shows EVERY visual Chance puts here (any popup type), spaced in a
 * grid. A Back button returns to the orb.
 */
const API = 'http://localhost:8787';

export function ProjectorView() {
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    let alive = true;
    const poll = () =>
      fetch(API + '/api/projector')
        .then((r) => r.json())
        .then((d) => { if (alive) setItems(d.items || []); })
        .catch(() => {});
    poll();
    const t = setInterval(poll, 1000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const back = () => {
    fetch(API + '/api/projector/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: false }) }).catch(() => {});
    window.location.href = '/?orb=1';
  };

  return (
    <div className="proj-root">
      <button className="proj-back" onClick={back} title="Back"><ChevronLeft size={22} /> Back</button>
      {items.length === 0 ? (
        <div className="proj-empty" />
      ) : (
        <div className={`proj-grid ${items.length === 1 ? 'one' : ''}`}>
          {items.map((a, i) => (
            <div key={i} className="proj-card"><ToolView action={a} /></div>
          ))}
        </div>
      )}
    </div>
  );
}
