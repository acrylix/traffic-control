import { create } from 'zustand';
import type { RateLimits, Session, Snapshot, Status } from './types';

// In dev (Vite on :5173) talk to the collector on :4242; in production the
// collector serves this bundle same-origin, so relative URLs just work.
const API =
  import.meta.env.VITE_GC_URL ??
  (location.port === '5173' ? 'http://localhost:4242' : '');

interface GCState {
  sessions: Session[];
  tally: Record<Status, number>;
  rateLimits: RateLimits | null;
  connected: boolean;
  selectedId: string | null;
  now: number;
  select: (id: string | null) => void;
  connect: () => void;
  addTodo: (cwd: string | null, text: string) => void;
  toggleTodo: (cwd: string | null, id: string) => void;
  removeTodo: (cwd: string | null, id: string) => void;
  setNotes: (cwd: string | null, text: string) => void;
  dismissSession: (id: string) => void;
  focusSession: (id: string) => void;
}

const emptyTally: Record<Status, number> = {
  working: 0, waiting: 0, done: 0, blocked: 0, idle: 0,
};

function post(path: string, body: unknown) {
  fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

export const useStore = create<GCState>((set) => ({
  sessions: [],
  tally: emptyTally,
  rateLimits: null,
  connected: false,
  selectedId: null,
  now: Date.now(),

  select: (id) => set({ selectedId: id }),

  connect: () => {
    // deep-link from a notification: ?s=<sessionId> pins selection on first load
    const pin = new URLSearchParams(location.search).get('s');
    if (pin) set({ selectedId: pin });

    const open = () => {
      const es = new EventSource(`${API}/stream`);
      es.onopen = () => set({ connected: true });
      es.onmessage = (ev) => {
        try {
          const snap: Snapshot = JSON.parse(ev.data);
          set((s) => {
            // keep selection if it still exists, else auto-select first "needs you"
            let selectedId = s.selectedId;
            const ids = new Set(snap.sessions.map((x) => x.id));
            if (!selectedId || !ids.has(selectedId)) {
              const needy = snap.sessions.find((x) => x.status === 'waiting' || x.status === 'blocked');
              selectedId = (needy ?? snap.sessions[0])?.id ?? null;
            }
            return { sessions: snap.sessions, tally: snap.tally, rateLimits: snap.rateLimits, now: snap.now, selectedId };
          });
        } catch { /* ignore malformed frame */ }
      };
      es.onerror = () => {
        set({ connected: false });
        es.close();
        setTimeout(open, 1500); // reconnect
      };
    };
    open();
    // local clock so relative timers advance between snapshots
    setInterval(() => set({ now: Date.now() }), 1000);
  },

  addTodo: (cwd, text) => post('/api/todo', { cwd, text }),
  toggleTodo: (cwd, id) => post('/api/todo/toggle', { cwd, id }),
  removeTodo: (cwd, id) => post('/api/todo/remove', { cwd, id }),
  setNotes: (cwd, text) => post('/api/note', { cwd, text }),
  dismissSession: (id) => post('/api/session/remove', { id }),
  focusSession: (id) => post('/api/session/focus', { id }),
}));
