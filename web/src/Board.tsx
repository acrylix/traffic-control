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
    <main className="board wall">
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
            <div className="cards">
              {items.map((s) => <Card key={s.id} s={s} />)}
            </div>
          </div>
        );
      })}
    </main>
  );
}

function Card({ s }: { s: Session }) {
  const { now, selectedId, select } = useStore();
  const focusSession = useStore((st) => st.focusSession);
  const meta = STATUS_META[s.status];
  const done = s.claudeTodos.filter((t) => t.status === 'completed').length;
  const total = s.claudeTodos.length;
  const ctxHi = s.metrics.ctxPct >= 80;
  const timer =
    s.status === 'working' ? elapsed(s.startedAt, now)
    : (s.status === 'idle' || s.status === 'done') ? '—'
    : elapsed(s.startedAt, s.lastSeenAt);

  return (
    <div className={`card ${meta.cls} ${selectedId === s.id ? 'sel' : ''}`} onClick={() => select(s.id)}>
      <div className="c-edge" />

      <div className="c-top">
        <span className="led-lg" />
        <span className="c-st">{meta.label}</span>
        {s.branch && <span className="c-branch">⎇ {s.branch}</span>}
      </div>

      <div className="c-proj">
        <span className="callsign" title={`session id · ${s.id}`}>{s.callsign}</span>
        <h3>{s.project}</h3>
      </div>

      <div className="c-task">
        {s.status === 'working' ? <>⚙ {s.task}<span className="cursor" /></>
          : s.status === 'waiting' ? <><span className="tk-ico">⏸</span> {s.task}</>
          : s.status === 'done' ? <>✓ {s.task}</>
          : s.status === 'blocked' ? <>✕ {s.task}</>
          : <>{s.task}</>}
      </div>

      <div className="c-ctx">
        <div className="c-ctx-lbl"><span>CTX</span><b>{s.metrics.ctxPct}%</b></div>
        <div className={`bar ctx ${ctxHi ? 'hi' : ''}`}><i style={{ width: `${s.metrics.ctxPct}%` }} /></div>
        <div className="c-stats">
          <span>{ks(s.metrics.tokensIn + s.metrics.tokensOut)} tok</span>
          <span>◴ {done}/{total}</span>
          <span className="c-timer">{timer}</span>
        </div>
      </div>

      {/* Footer row — pinned to ~62px to give the gate its native (strip)
          proportions, regardless of how tall the card body grew. */}
      <div className="c-bot">
        <div className="c-meta">
          <span className="seen">{s.status === 'working' ? 'active now' : ago(s.lastSeenAt, now)}</span>
          {s.model && <span className="c-model">{s.model}</span>}
        </div>

        {s.terminal ? (
          <button
            type="button"
            className="gate gate-bound gate-sm"
            title={`Jump to ${s.terminal.app}${s.terminal.title ? ' · ' + s.terminal.title : ''}`}
            aria-label={`Jump to ${s.terminal.app}`}
            onClick={(e) => { e.stopPropagation(); focusSession(s.id); }}
          >
            <span className="gate-tag">GATE</span>
            <span className="gate-row">
              <span className="gate-chev" aria-hidden="true"><i>›</i><i>›</i><i>›</i></span>
              <span className="gate-dest">{shortAppName(s.terminal.app)}</span>
            </span>
            <span className="gate-runway" aria-hidden="true" />
          </button>
        ) : (
          <div
            className="gate gate-unbound gate-sm"
            title="No terminal bound — send a prompt in your terminal to bind this session"
            aria-label="Terminal not bound"
          >
            <span className="gate-tag">— — —</span>
            <span className="gate-row">
              <span className="gate-chev" aria-hidden="true"><i>·</i><i>·</i><i>·</i></span>
              <span className="gate-dest">NO LINK</span>
            </span>
            <span className="gate-runway gate-runway-off" aria-hidden="true" />
          </div>
        )}
      </div>
    </div>
  );
}

function shortAppName(app: string): string {
  const map: Record<string, string> = {
    WarpTerminal: 'WARP',
    Warp: 'WARP',
    iTerm2: 'ITERM',
    iTerm: 'ITERM',
    Terminal: 'TERM',
    WezTerm: 'WEZTERM',
    kitty: 'KITTY',
    Alacritty: 'ALCRT',
    Ghostty: 'GHOSTTY',
  };
  return map[app] || app.toUpperCase().slice(0, 7);
}
