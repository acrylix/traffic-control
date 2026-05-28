import { useEffect, useState } from 'react';
import { useStore } from './store';
import { Board } from './Board';
import { Detail } from './Detail';
import { ago } from './util';
import type { Status } from './types';

export function App() {
  const connect = useStore((s) => s.connect);
  useEffect(() => { connect(); }, [connect]);

  return (
    <div className="tower">
      <Header />
      <Rail />
      <Board />
      <Detail />
    </div>
  );
}

function Header() {
  const tally = useStore((s) => s.tally);
  const sessions = useStore((s) => s.sessions);
  const connected = useStore((s) => s.connected);
  const [clock, setClock] = useState('');

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('en-GB'));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header>
      <div className="brand">
        <div className={`radar ${connected ? '' : 'off'}`} />
        <div>
          <h1>Ground Control</h1>
          <div className="sub">
            session orchestrator · {sessions.length} tracked
          </div>
        </div>
      </div>

      <div className="clock">
        <b>{clock}</b>
        <span>{connected ? 'LIVE' : 'RECONNECTING…'}</span>
      </div>

      <div className="tally">
        <div className="t go"><span className="dot" /><span className="num">{tally.working}</span><span className="lbl">working</span></div>
        <div className="t hold"><span className="dot" /><span className="num">{tally.waiting}</span><span className="lbl">waiting</span></div>
        <div className="t stop"><span className="dot" /><span className="num">{tally.blocked}</span><span className="lbl">blocked</span></div>
      </div>

      <div className="cmd">
        <span>⌕</span>
        <input placeholder="filter sessions / jump to project…" />
        <kbd>⌘K</kbd>
      </div>
    </header>
  );
}

function Rail() {
  const sessions = useStore((s) => s.sessions);
  const tally = useStore((s) => s.tally);
  const connected = useStore((s) => s.connected);
  const now = useStore((s) => s.now);

  const byCli = sessions.reduce<Record<string, number>>((m, s) => {
    m[s.cli] = (m[s.cli] || 0) + 1; return m;
  }, {});

  const feed = sessions
    .flatMap((s) => s.events.slice(0, 2).map((e) => ({ ...e, project: s.project })))
    .sort((a, b) => b.t - a.t)
    .slice(0, 6);

  const dot = (color: string, glow?: boolean) =>
    ({ background: `var(${color})`, boxShadow: glow ? `0 0 6px var(${color}-glow)` : 'none' });

  return (
    <aside className="rail">
      <div className="rail-sec">
        <h3>Status</h3>
        <Filt label="All sessions" count={sessions.length} style={{ background: '#fff' }} />
        <Filt label="Working" count={tally.working} style={dot('--go', true)} />
        <Filt label="Waiting on you" count={tally.waiting} style={dot('--hold', true)} />
        <Filt label="Done" count={tally.done} style={dot('--done')} />
        <Filt label="Blocked" count={tally.blocked} style={dot('--stop', true)} />
        <Filt label="Stale" count={tally.idle} style={dot('--idle')} />
      </div>

      <div className="rail-sec">
        <h3>Agents</h3>
        {Object.keys(byCli).length === 0 && <div className="filt"><span style={{ color: 'var(--ink-faint)' }}>none yet</span></div>}
        {Object.entries(byCli).map(([cli, n]) => (
          <div className="filt" key={cli}>
            <span className={`chip cli-${cli}`} style={{ border: 'none', padding: 0, background: 'none' }}>{cli}</span>
            <span className="cnt">{n}</span>
          </div>
        ))}
      </div>

      <div className="rail-sec">
        <h3>Feed</h3>
        <div className="feed">
          {feed.length === 0 && <div className="e">— no activity —</div>}
          {feed.map((e, i) => (
            <div className="e" key={i}>
              <span style={{ color: 'var(--ink-faint)' }}>{ago(e.t, now)}</span> · {e.project} · {e.label}
            </div>
          ))}
        </div>
      </div>

      <div className="rail-sec">
        <h3>Collector</h3>
        <div className={`conn ${connected ? 'on' : 'off'}`}>
          <span className="led" />{connected ? 'connected' : 'offline'}
        </div>
      </div>
    </aside>
  );
}

function Filt({ label, count, style }: { label: string; count: number; style: React.CSSProperties }) {
  return (
    <div className="filt">
      <span className="dot" style={style} /> {label} <span className="cnt">{count}</span>
    </div>
  );
}

export const GROUPS: { key: string; title: string; match: (s: Status) => boolean }[] = [
  { key: 'needs', title: 'Needs you', match: (s) => s === 'waiting' },
  { key: 'motion', title: 'In motion', match: (s) => s === 'working' },
  { key: 'rest', title: 'Resolved & stale', match: (s) => s === 'done' || s === 'blocked' || s === 'idle' },
];
