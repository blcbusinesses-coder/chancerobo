/**
 * PROJECTOR CHANNEL — a shared slot for whatever's on the projected screen.
 * When `active`, EVERY visual Chance makes (stock, 3D, chart, gauge, news…) is
 * mirrored here, and the projector view (?projector=1) polls and shows it.
 * Also carries the wake-word flag so "turn on wake word" works in projector mode.
 */
export interface ProjectorState {
  items: any[];
  active: boolean;
  wakeWord: boolean;
  updatedAt: number;
}

let items: any[] = [];
let active = false;
let wakeWord = false;

export const projector = {
  get: (): ProjectorState => ({ items, active, wakeWord, updatedAt: Date.now() }),
  set: (list: any[]) => { items = (list || []).filter(Boolean); },
  add: (item: any) => { if (item) items = [...items, item]; },
  clear: () => { items = []; },
  active: () => active,
  setActive: (v: boolean) => { active = v; if (!v) items = []; },
  wakeWordOn: () => wakeWord,
  setWakeWord: (v: boolean) => { wakeWord = v; },
};
