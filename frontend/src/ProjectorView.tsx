import { useState, useEffect } from 'react';
import { ToolView } from './ToolView';

/**
 * PROJECTOR MODE (?projector=1). A big, high-contrast, gesture-ready surface for
 * a wall projection. Polls the projector channel and shows whatever Chance puts
 * there — big. Content is set by voice today; hand-gesture interaction (the AI
 * vision layer) drives/moves these next.
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
    const t = setInterval(poll, 1200);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <div className="proj-root">
      {items.length === 0 ? (
        <div className="proj-idle">
          <img src="/chance-brain-hero.png" alt="Chance" className="proj-brain"
               onError={(e) => { (e.target as HTMLImageElement).src = '/chance_brain2.png'; }} />
          <div className="proj-hint">PROJECTOR MODE — ready. Tell Chance what to show.</div>
        </div>
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
