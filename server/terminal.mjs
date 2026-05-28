// terminal.mjs — bind sessions to OS windows via yabai.
// Each Warp tab is a distinct yabai window, so capturing the focused window
// at session-start / prompt time gives us a stable handle we can re-focus later.

import { spawn } from 'node:child_process';

// Terminals whose windows we're willing to bind to. Anything else (Chrome,
// Slack, etc.) is ignored — protects against capturing the wrong window if a
// hook fires while focus has wandered.
const TERMINALS = new Set(['Warp', 'iTerm2', 'Terminal', 'WezTerm', 'kitty', 'Alacritty', 'Ghostty']);

/** Run `yabai` with args, resolve to stdout (trimmed) or null on any failure. */
function runYabai(args, timeoutMs = 800) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let p;
    try {
      p = spawn('yabai', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return finish(null);
    }
    const chunks = [];
    p.stdout.on('data', (c) => chunks.push(c));
    p.on('error', () => finish(null));
    p.on('close', (code) => {
      if (code !== 0) return finish(null);
      finish(Buffer.concat(chunks).toString('utf8').trim());
    });
    setTimeout(() => { try { p.kill(); } catch {} finish(null); }, timeoutMs);
  });
}

/**
 * Query the currently-focused window. Returns null if yabai is missing, the
 * focused app isn't a known terminal, or anything fails.
 */
export async function getFocusedTerminal() {
  const out = await runYabai(['-m', 'query', '--windows', '--window']);
  if (!out) return null;
  let w;
  try { w = JSON.parse(out); } catch { return null; }
  if (!w || !TERMINALS.has(w.app)) return null;
  return {
    app: w.app,
    windowId: w.id,
    title: w.title || '',
    space: w.space ?? null,
    stampedAt: Date.now(),
  };
}

/** Focus a yabai window by id. Resolves true on success. */
export async function focusWindow(windowId) {
  if (!windowId) return false;
  const out = await runYabai(['-m', 'window', '--focus', String(windowId)]);
  // yabai prints nothing on success; null only on hard failure. An empty
  // string is the success case.
  return out !== null;
}
