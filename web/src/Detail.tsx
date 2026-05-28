import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { STATUS_META, elapsed, ks, lines } from './util';

const WIDTH_KEY = 'gc.drawer.width';
const DEFAULT_W = 480;
const MIN_W = 360;
const maxW = () => Math.round(window.innerWidth * 0.85);

export function Detail() {
  const { sessions, selectedId, now } = useStore();
  const select = useStore((st) => st.select);
  const addTodo = useStore((s) => s.addTodo);
  const toggleTodo = useStore((s) => s.toggleTodo);
  const setNotes = useStore((s) => s.setNotes);
  const dismissSession = useStore((s) => s.dismissSession);
  const focusSession = useStore((s) => s.focusSession);

  const s = sessions.find((x) => x.id === selectedId);
  const open = !!s;

  const [draft, setDraft] = useState('');
  const [noteText, setNoteText] = useState('');
  const noteCwd = useRef<string | null>(null);

  // sync notes textarea when the selected project changes
  useEffect(() => {
    if (s && s.cwd !== noteCwd.current) {
      noteCwd.current = s.cwd;
      setNoteText(s.notes || '');
    }
  }, [s?.cwd, s?.notes, s]);

  // ---- resizable width ----
  const [width, setWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(stored) && stored >= MIN_W ? stored : DEFAULT_W;
  });
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    localStorage.setItem(WIDTH_KEY, String(width));
  }, [width]);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = d.startX - e.clientX;            // drag left → grow
      setWidth(Math.max(MIN_W, Math.min(maxW(), d.startW + dx)));
    };
    const onUp = () => setResizing(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [resizing]);

  // esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') select(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, select]);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: width };
    setResizing(true);
  };
  const resetWidth = () => setWidth(DEFAULT_W);

  if (!s) {
    // Render nothing visible when nothing is selected — the drawer fully
    // retracts off-screen via the CSS transform.
    return <aside className="drawer" aria-hidden="true" style={{ width }} />;
  }

  const meta = STATUS_META[s.status];
  const statusLabel =
    s.status === 'waiting' ? (s.permission ? 'Holding · needs approval' : 'Holding · needs you')
    : s.status === 'working' ? 'Working'
    : s.status === 'done' ? 'Done'
    : s.status === 'blocked' ? 'Blocked · error'
    : 'Idle';

  const saveNotes = (text: string) => {
    setNoteText(text);
    setNotes(s.cwd, text);
  };

  const submitTodo = () => {
    if (draft.trim()) { addTodo(s.cwd, draft.trim()); setDraft(''); }
  };

  return (
    <aside
      className={`drawer open ${resizing ? 'resizing' : ''}`}
      style={{ width }}
      role="dialog"
      aria-label={`Session detail · ${s.project}`}
    >
      <div
        className="resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize drawer"
        title="Drag to resize · double-click to reset"
        onPointerDown={startResize}
        onDoubleClick={resetWidth}
      />
      {resizing && <div className="resize-readout">{width} px</div>}

      <button
        className="dismiss"
        title="Close (esc)"
        onClick={() => select(null)}
      >×</button>

      <div className="d-head">
        <div className="badge">
          <span className={`led-lg ${meta.cls}`} />
          <span className="st" style={{ color: `var(--${meta.cls})` }}>{statusLabel}</span>
        </div>
        <h2>
          <span className="callsign callsign-lg" title={`session id · ${s.id}`}>{s.callsign}</span>
          {s.project}
        </h2>
        <div className="path">
          {s.cwd}{s.branch ? ` · ${s.branch}` : ''} · {s.cli} · <span style={{ color: 'var(--ink-dim)' }}>#{s.shortId}</span>
          {s.messageCount > 0 && <> · <span style={{ color: 'var(--ink-dim)' }}>{s.messageCount} msgs</span></>}
        </div>
        {s.terminal && (
          <button
            className="focus-pill"
            title={`Jump to this window in ${s.terminal.app}`}
            onClick={() => focusSession(s.id)}
          >
            ↗ jump to {s.terminal.app}{s.terminal.title ? ` · ${s.terminal.title}` : ''}
          </button>
        )}
        {(s.effortLevel || s.thinkingEnabled) && (
          <div className="d-badges">
            {s.effortLevel && <span className={`chip effort effort-${s.effortLevel}`}>effort: {s.effortLevel}</span>}
            {s.thinkingEnabled && <span className="chip thinking">💭 thinking</span>}
          </div>
        )}
        <button
          className="dismiss-soft"
          title="Dismiss from board (reappears if it fires another event)"
          onClick={() => { if (confirm(`Dismiss "${s.project}" from the board?`)) dismissSession(s.id); }}
        >dismiss from board</button>
      </div>

      <div className="d-stats two-by-two">
        <div className="d-stat"><div className="k">Model</div><div className="v" style={{ fontSize: 13 }}>{s.model || '—'}</div></div>
        <div className="d-stat"><div className="k">Elapsed</div><div className="v">{elapsed(s.startedAt, s.status === 'working' ? now : s.lastSeenAt)}</div></div>
        <div className="d-stat">
          <div className="k">Tokens</div>
          <div className="v">{ks(s.metrics.tokensIn)}<small> in</small></div>
          <div className="v" style={{ fontSize: 12, color: 'var(--ink-dim)' }}>{ks(s.metrics.tokensOut)}<small> out</small></div>
        </div>
        <div className="d-stat">
          <div className="k">Lines</div>
          <div className="v" style={{ fontSize: 14 }}>{lines(s.metrics.linesAdded, s.metrics.linesRemoved)}</div>
        </div>
      </div>

      {(s.firstPrompt || s.lastAssistantText) && (
        <div className="d-sec backfill">
          <h4>
            Transcript history
            <span className="src">
              {s.backfilled ? 'from JSONL' : 'live'}
              {s.messageCount > 0 ? ` · ${s.messageCount} msgs` : ''}
            </span>
          </h4>
          {s.firstPrompt && (
            <div className="b-entry">
              <div className="b-k">first asked</div>
              <pre className="b-v user-text">{s.firstPrompt}</pre>
            </div>
          )}
          {s.lastAssistantText && (
            <div className="b-entry">
              <div className="b-k">last said</div>
              <pre className="b-v assistant-text">{s.lastAssistantText}</pre>
            </div>
          )}
        </div>
      )}

      <div className="d-sec">
        <h4>Current task <span className="src">{s.claudeTodos.length ? 'claude · todo' : 'derived'}</span></h4>
        <div className="now-task">
          <div className="live">
            <span className="pulse" style={{ background: `var(--${meta.cls})`, boxShadow: `0 0 7px var(--${meta.cls}-glow)` }} />
            {s.reason}
          </div>
          <p>{s.task}</p>
          {s.permission && (
            <div className="tool">⏸ awaiting approval · <code style={{ color: 'var(--hold)', background: 'rgba(255,182,39,.08)' }}>{s.permission.detail}</code></div>
          )}
        </div>
      </div>

      <div className="d-sec">
        <h4>
          Claude todos
          <span className="src">{s.claudeTodos.filter((t) => t.status === 'completed').length}/{s.claudeTodos.length}</span>
        </h4>
        <div className="todos">
          {s.claudeTodos.length === 0 && <div style={{ color: 'var(--ink-faint)', fontSize: 11 }}>— none captured yet —</div>}
          {s.claudeTodos.map((t, i) => (
            <div className={`todo ${t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'active' : ''}`} key={i}>
              <span className="box" />
              <span>{t.status === 'in_progress' ? t.activeForm : t.content}</span>
              {t.status === 'in_progress' && <span className="tag">now</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="d-sec">
        <h4>Your checklist <span className="src">yours</span></h4>
        <div className="todos">
          {s.userTodos.map((t) => (
            <div className={`todo ${t.done ? 'done' : ''}`} key={t.id}>
              <span className="box" onClick={() => toggleTodo(s.cwd, t.id)} />
              <span>{t.text}</span>
              <span className="tag">mine</span>
            </div>
          ))}
        </div>
        <div className="add-todo">
          <span style={{ color: 'var(--ink-faint)' }}>+</span>
          <input
            value={draft}
            placeholder="add todo…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitTodo(); }}
          />
        </div>
      </div>

      <div className="d-sec notes">
        <h4>Notes <span className="src">saved per project</span></h4>
        <textarea
          value={noteText}
          placeholder="scratchpad — pins, reminders, guardrails for this project…"
          onChange={(e) => saveNotes(e.target.value)}
        />
      </div>

      <div className="d-sec" style={{ borderBottom: 'none' }}>
        <h4>Activity <span className="src">hook feed</span></h4>
        <div className="tl">
          {s.events.length === 0 && <div style={{ color: 'var(--ink-faint)', fontSize: 11 }}>— no events —</div>}
          {s.events.map((e, i) => (
            <div className={`tl-item ${e.kind}`} key={i}>
              <span className="t">{new Date(e.t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
              <b>{e.kind}</b> · {e.label}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
