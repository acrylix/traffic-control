import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { STATUS_META, elapsed, cost } from './util';

export function Detail() {
  const { sessions, selectedId, now } = useStore();
  const addTodo = useStore((s) => s.addTodo);
  const toggleTodo = useStore((s) => s.toggleTodo);
  const setNotes = useStore((s) => s.setNotes);
  const dismissSession = useStore((s) => s.dismissSession);

  const s = sessions.find((x) => x.id === selectedId);
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

  if (!s) {
    return (
      <section className="detail">
        <div className="placeholder">Select a session to see its task, todos, and activity.</div>
      </section>
    );
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
    <section className="detail">
      <div className="d-head">
        <button
          className="dismiss"
          title="Dismiss from board (reappears if it fires another event)"
          onClick={() => { if (confirm(`Dismiss "${s.project}" from the board?`)) dismissSession(s.id); }}
        >×</button>
        <div className="badge">
          <span className={`led-lg ${meta.cls}`} />
          <span className="st" style={{ color: `var(--${meta.cls})` }}>{statusLabel}</span>
        </div>
        <h2>{s.project}</h2>
        <div className="path">
          {s.cwd}{s.branch ? ` · ${s.branch}` : ''} · {s.cli}
        </div>
      </div>

      <div className="d-stats">
        <div className="d-stat"><div className="k">Model</div><div className="v" style={{ fontSize: 13 }}>{s.model || '—'}</div></div>
        <div className="d-stat"><div className="k">Elapsed</div><div className="v">{elapsed(s.startedAt, s.status === 'working' ? now : s.lastSeenAt)}</div></div>
        <div className="d-stat"><div className="k">Spend</div><div className="v">{cost(s.metrics.costUsd)}</div></div>
      </div>

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
    </section>
  );
}
