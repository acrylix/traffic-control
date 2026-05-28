import { useStore } from './store';
import { GROUPS } from './App';
import { STATUS_META, elapsed, ago, ks } from './util';
import type { Session } from './types';

export function Board() {
  const sessions = useStore((s) => s.sessions);

  if (sessions.length === 0) {
    return (
      <main className="board">
        <div className="empty">
          <p>No sessions yet.</p>
          <p>Start one: open a terminal and run <code>claude</code>.</p>
          <p style={{ marginTop: 14, fontSize: 11 }}>
            Hooks not installed? Run <code>npm run init</code> (or paste the curl hooks into <code>~/.claude/settings.json</code>).
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="board">
      {GROUPS.map((g) => {
        const items = sessions.filter((s) => g.match(s.status));
        if (items.length === 0) return null;
        return (
          <div className="group" key={g.key}>
            <div className="board-head">
              <span className="g">{g.title}</span>
              <span className="ln" />
              <span className="c">{items.length}</span>
            </div>
            {items.map((s) => <Strip key={s.id} s={s} />)}
          </div>
        );
      })}
    </main>
  );
}

function Strip({ s }: { s: Session }) {
  const { now, selectedId, select } = useStore();
  const focusSession = useStore((st) => st.focusSession);
  const meta = STATUS_META[s.status];
  const done = s.claudeTodos.filter((t) => t.status === 'completed').length;
  const total = s.claudeTodos.length;
  const ctxHi = s.metrics.ctxPct >= 80;
  const timer = s.status === 'working' ? elapsed(s.startedAt, now) : (s.status === 'idle' || s.status === 'done' ? '—' : elapsed(s.startedAt, s.lastSeenAt));

  return (
    <div className={`strip ${meta.cls} ${selectedId === s.id ? 'sel' : ''}`} onClick={() => select(s.id)}>
      <div className="edge" />
      <div className="light"><span className="led-lg" /><span className="st">{meta.label}</span></div>

      <div className="body">
        <div className="row1">
          <span className="callsign" title={`session id · ${s.id}`}>{s.callsign}</span>
          <span className="call">{s.project}</span>
          {s.branch && <span className="branch">⎇ {s.branch}</span>}
          <span className={`chip cli-${s.cli}`}>{s.cli}</span>
          {s.model && <span className="chip">{s.model}</span>}
          {s.permissionMode && s.permissionMode !== 'default' &&
            <span className={`chip perm-${s.permissionMode}`}>{s.permissionMode}</span>}
          {s.effortLevel && s.effortLevel !== 'medium' &&
            <span className={`chip effort effort-${s.effortLevel}`} title={`effort: ${s.effortLevel}`}>{s.effortLevel}</span>}
          {s.thinkingEnabled && <span className="chip thinking" title="extended thinking enabled">💭</span>}
        </div>
        <div className="task">
          {s.status === 'working' ? <>⚙ {s.task}<span className="cursor" /></>
            : s.status === 'waiting' ? <><span className="tk-ico">⏸</span> {s.task}</>
            : s.status === 'done' ? <>✓ {s.task}</>
            : s.status === 'blocked' ? <>✕ {s.task}</>
            : <>{s.task}</>}
        </div>
      </div>

      <div className="gauge">
        <div className="g-lbl"><span>CTX</span><b>{s.metrics.ctxPct}%</b></div>
        <div className={`bar ctx ${ctxHi ? 'hi' : ''}`}><i style={{ width: `${s.metrics.ctxPct}%` }} /></div>
        <div className="toks">{ks(s.metrics.tokensIn + s.metrics.tokensOut)} tok</div>
      </div>

      <div className="meta">
        <div className="timer">{timer}</div>
        <div className="seen">{s.status === 'working' ? 'active now' : ago(s.lastSeenAt, now)}</div>
        <span className="todo-pill">◴ <b>{done}</b>/{total}</span>
      </div>

      {s.terminal && (
        <button
          className="focus-btn"
          title={`Jump to ${s.terminal.app} · ${s.terminal.title || 'window'}`}
          onClick={(e) => { e.stopPropagation(); focusSession(s.id); }}
        >↗</button>
      )}
    </div>
  );
}
