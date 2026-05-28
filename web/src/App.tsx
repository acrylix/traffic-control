import { useEffect, useState } from 'react';
import { useStore } from './store';
import { Board } from './Board';
import { Detail } from './Detail';
import { sev, until } from './util';
import type { RateLimits, Status } from './types';

export function App() {
  const connect = useStore((s) => s.connect);
  useEffect(() => { connect(); }, [connect]);

  return (
    <div className="tower">
      <Header />
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

      <RateLimitsWidget />

      <div className="cmd">
        <span>⌕</span>
        <input placeholder="filter sessions / jump to project…" />
        <kbd>⌘K</kbd>
      </div>
    </header>
  );
}

function RateLimitsWidget() {
  const rl = useStore((s) => s.rateLimits);
  const now = useStore((s) => s.now);
  if (!rl) return null;
  return (
    <div className="rate-limits" title="Anthropic rate-limit usage — from statusline heartbeat">
      <div className="rl-label">RATE</div>
      <RLBar label="5H" pct={rl.rl5hPct} resetsAt={rl.rl5hResetsAt} now={now} />
      <RLBar label="7D" pct={rl.rl7dPct} resetsAt={rl.rl7dResetsAt} now={now} />
    </div>
  );
}

function RLBar({ label, pct, resetsAt, now }: { label: string; pct: number; resetsAt: number; now: number } & Partial<RateLimits>) {
  const s = sev(pct);
  const resetLabel = resetsAt ? `· resets in ${until(resetsAt, now)}` : '';
  return (
    <div className={`rl-bar ${s}`} title={`${label}: ${pct.toFixed(1)}% used ${resetLabel}`}>
      <span className="rl-lbl">{label}</span>
      <div className="rl-track"><i style={{ width: `${Math.min(100, pct)}%` }} /></div>
      <span className="rl-pct">{pct.toFixed(0)}%</span>
    </div>
  );
}

export const GROUPS: { key: string; title: string; match: (s: Status) => boolean }[] = [
  { key: 'needs', title: 'Needs you', match: (s) => s === 'waiting' },
  { key: 'motion', title: 'In motion', match: (s) => s === 'working' },
  { key: 'rest', title: 'Resolved & stale', match: (s) => s === 'done' || s === 'blocked' || s === 'idle' },
];
