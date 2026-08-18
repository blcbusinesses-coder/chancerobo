/**
 * PROJECTOR CHANNEL — a shared slot for whatever should be on the projected
 * screen. Chance's tools write to it; the projector view (?projector=1) polls
 * it. Kept dead-simple (in-memory) so voice/gesture control just works.
 */
export interface ProjectorState {
  items: any[]; // uiAction-style visuals shown big on the wall
  updatedAt: number;
}

let state: ProjectorState = { items: [], updatedAt: 0 };

export const projector = {
  get: (): ProjectorState => state,
  /** Replace everything on the wall. */
  set: (items: any[]) => { state = { items: items.filter(Boolean), updatedAt: Date.now() }; },
  /** Add one visual alongside what's there. */
  add: (item: any) => { if (item) state = { items: [...state.items, item], updatedAt: Date.now() }; },
  clear: () => { state = { items: [], updatedAt: Date.now() }; },
};
