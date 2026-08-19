/**
 * PROJECTOR CHANNEL — a shared slot for whatever's on the projected screen.
 * When `active`, EVERY visual Chance makes (stock, 3D, chart, gauge, news…) is
 * mirrored here, and the projector view (?projector=1) polls and shows it.
 * Also carries the wake-word flag so "turn on wake word" works in projector mode.
 */
export interface Gesture { x: number; y: number; pinch: boolean; active: boolean; ts: number }
export interface ProjectorState {
  items: any[];
  active: boolean;
  wakeWord: boolean;
  gesture: Gesture;
  updatedAt: number;
}

let items: any[] = [];
let active = false;
let wakeWord = false;
let gesture: Gesture = { x: 0.5, y: 0.5, pinch: false, active: false, ts: 0 };

export const projector = {
  get: (): ProjectorState => ({ items, active, wakeWord, gesture, updatedAt: Date.now() }),
  set: (list: any[]) => { items = (list || []).filter(Boolean); },
  add: (item: any) => { if (item) items = [...items, item]; },
  clear: () => { items = []; },
  active: () => active,
  setActive: (v: boolean) => { active = v; if (!v) items = []; },
  wakeWordOn: () => wakeWord,
  setWakeWord: (v: boolean) => { wakeWord = v; },
  // Hand-gesture cursor, fed by the vision service.
  setGesture: (g: Partial<Gesture>) => { gesture = { ...gesture, ...g, ts: Date.now() }; },
  setGestureActive: (v: boolean) => { gesture = { ...gesture, active: v }; },
};
