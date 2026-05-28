import type { Status } from './types';

export const STATUS_META: Record<Status, { cls: string; label: string }> = {
  working: { cls: 'go', label: 'Go' },
  waiting: { cls: 'hold', label: 'Hold' },
  blocked: { cls: 'stop', label: 'Stop' },
  done: { cls: 'done', label: 'Done' },
  idle: { cls: 'idle', label: 'Idle' },
};

/** mm:ss (or h:mm:ss) elapsed since a timestamp. */
export function elapsed(fromTs: number, now: number): string {
  let s = Math.max(0, Math.floor((now - fromTs) / 1000));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "active now", "2m ago", "1h 04m" style relative label. */
export function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 8) return 'active now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

export function cost(usd: number): string {
  return `$${(usd || 0).toFixed(2)}`;
}

export function ks(n: number): string {
  if (!n) return '0';
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/** Severity bucket from a 0-100 percentage. */
export function sev(pct: number): '' | 'mid' | 'hi' | 'crit' {
  if (pct >= 90) return 'crit';
  if (pct >= 70) return 'hi';
  if (pct >= 40) return 'mid';
  return '';
}

/** "in 2h 14m" / "in 3d" / "now" — from a unix seconds reset timestamp. */
export function until(unixSeconds: number, now: number): string {
  if (!unixSeconds) return '';
  const s = unixSeconds * 1000 - now;
  if (s <= 0) return 'now';
  const m = Math.floor(s / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d`;
}

/** "+210 / -18" lines diff. */
export function lines(added: number, removed: number): string {
  return `+${added || 0} / −${removed || 0}`;
}
