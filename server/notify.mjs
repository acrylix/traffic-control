// notify.mjs — fire native macOS notifications on important state transitions.
// Zero-install via `osascript` (built into macOS); auto-upgrades to
// `terminal-notifier` if installed (click-to-open URL, subtitle).

import { execFile, execFileSync } from 'node:child_process';

const DARWIN = process.platform === 'darwin';
const ENABLED = process.env.GC_NOTIFY !== '0' && DARWIN;
const SOUND = process.env.GC_NOTIFY_SOUND || 'Glass'; // 'none' to silence
const EVENTS = new Set(
  (process.env.GC_NOTIFY_EVENTS || 'waiting,blocked').split(',').map((s) => s.trim()),
);
const PORT = Number(process.env.GC_PORT || 4242);
// Sticky default ON: "needs you" alerts should NOT auto-dismiss.
const STICKY = process.env.GC_NOTIFY_STICKY !== '0';
// Which next-states deserve a sticky alert (require terminal-notifier).
const STICKY_STATES = new Set(['waiting', 'blocked']);

// Detect terminal-notifier synchronously so the startup banner is truthful.
let useTerminalNotifier = false;
if (ENABLED) {
  try {
    execFileSync('which', ['terminal-notifier'], { stdio: ['ignore', 'pipe', 'ignore'] });
    useTerminalNotifier = true;
  } catch { /* not installed → osascript fallback */ }
}

const ICONS = { waiting: '🟡', blocked: '🔴', done: '✓', working: '🟢', idle: '⬤' };

function send({ title, subtitle, message, sound, url, group, sticky }) {
  if (!ENABLED) return;
  if (useTerminalNotifier) {
    const args = ['-title', title, '-message', message];
    if (subtitle) args.push('-subtitle', subtitle);
    if (sound && sound !== 'none') args.push('-sound', sound);
    if (group) args.push('-group', group);
    if (sticky) {
      // -actions promotes the notification to Alert style (sticky).
      // -execute fires when the user clicks "Open" (or the notification body).
      args.push('-actions', 'Open');
      args.push('-closeLabel', 'Dismiss');
      if (url) args.push('-execute', `open '${url}'`);
    } else if (url) {
      args.push('-open', url);
    }
    execFile('terminal-notifier', args, () => {});
    return;
  }
  // osascript fallback (cannot be sticky from payload; user can change
  // Script Editor's notification style to Alerts in System Settings to mimic it)
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const parts = [`display notification "${esc(message)}" with title "${esc(title)}"`];
  if (subtitle) parts.push(`subtitle "${esc(subtitle)}"`);
  if (sound && sound !== 'none') parts.push(`sound name "${esc(sound)}"`);
  execFile('osascript', ['-e', parts.join(' ')], () => {});
}

/** Dismiss a previously sent sticky notification for a session. */
function clearGroup(group) {
  if (!useTerminalNotifier) return;
  execFile('terminal-notifier', ['-remove', group], () => {});
}

/**
 * Called by the ingest handler when a session's status actually changes.
 * Stale silence (→ idle from staleness sweep) is intentionally ignored — that
 * isn't a "needs you" event, that's just the session going quiet.
 */
export function notifyTransition(prev, next, session) {
  if (!ENABLED) return;
  if (prev === next) return;
  const group = `gc:${session.id}`;

  // When a session leaves waiting/blocked, clear any prior sticky alert so
  // resolved situations don't sit in the notification center confusingly.
  if (STICKY_STATES.has(prev) && !STICKY_STATES.has(next)) clearGroup(group);

  if (!EVENTS.has(next)) return;
  const icon = ICONS[next] || '●';
  const tag = session.callsign ? `${session.callsign} · ${session.project}` : session.project;
  const title = `${icon} ${next.toUpperCase()} · ${tag}`;
  const subtitle = session.branch ? `${session.branch} · ${session.cli}` : session.cli;
  const message = session.task || session.reason || '—';
  const url = `http://localhost:${PORT}/?s=${encodeURIComponent(session.id)}`;
  const sticky = STICKY && STICKY_STATES.has(next) && useTerminalNotifier;
  send({ title, subtitle, message, sound: SOUND, url, group, sticky });
}

export function notifyStatus() {
  return {
    enabled: ENABLED,
    backend: useTerminalNotifier ? 'terminal-notifier' : DARWIN ? 'osascript' : 'none',
    events: [...EVENTS],
    sound: SOUND,
    sticky: STICKY && useTerminalNotifier,
  };
}
