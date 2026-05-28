// index.mjs — Ground Control collector.
// Zero-dependency Node server: ingests Claude Code hook events, runs the
// session state machine, persists user todos/notes, and pushes live snapshots
// to the browser over SSE. Also serves the built UI (same-origin).

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize as normPath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalize, freshSession, applyEvent, sweepStale } from './state.mjs';
import { loadStore, getProject, addTodo, toggleTodo, removeTodo, setNotes, DATA_DIR } from './store.mjs';
import { notifyTransition, notifyStatus } from './notify.mjs';
import { startTail, stopTail, stopAllTails, applyTranscriptLine, tailingCount } from './transcript.mjs';
import { getFocusedTerminal, focusWindow } from './terminal.mjs';

const PORT = Number(process.env.GC_PORT || 4242);
const TOKEN = process.env.GC_INGEST_TOKEN || '';      // sink seam: empty = open (localhost)
const STALE_MS = Number(process.env.GC_STALE_MS || 6 * 60 * 1000);
const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'public');

const HOOK_KINDS = new Set([
  'session-start', 'prompt', 'pre-tool', 'post-tool', 'permission', 'notify', 'stop', 'beat',
]);

/** @type {Map<string, any>} */
const sessions = new Map();
/** @type {Set<import('node:http').ServerResponse>} */
const clients = new Set();

loadStore();

// ---------- snapshot + broadcast ----------

function snapshot() {
  const list = [...sessions.values()].map((s) => {
    const p = getProject(s.cwd);
    return { ...s, userTodos: p.todos, notes: p.notes };
  });
  // newest activity first; "needs you" naturally floats via UI grouping
  list.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  const tally = { working: 0, waiting: 0, blocked: 0, done: 0, idle: 0 };
  for (const s of list) tally[s.status] = (tally[s.status] || 0) + 1;
  // Rate limits are account-scoped — pick the most recently beat-reported.
  let rlSrc = null;
  for (const s of list) {
    if (!s.metrics.rl5hResetsAt && !s.metrics.rl7dResetsAt) continue;
    if (!rlSrc || s.lastSeenAt > rlSrc.lastSeenAt) rlSrc = s;
  }
  const rateLimits = rlSrc ? {
    rl5hPct: rlSrc.metrics.rl5hPct,
    rl5hResetsAt: rlSrc.metrics.rl5hResetsAt,
    rl7dPct: rlSrc.metrics.rl7dPct,
    rl7dResetsAt: rlSrc.metrics.rl7dResetsAt,
  } : null;
  return { sessions: list, tally, rateLimits, now: Date.now() };
}

function broadcast() {
  const payload = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { clients.delete(res); }
  }
}

// ---------- helpers ----------

function send(res, code, body, headers = {}) {
  res.writeHead(code, {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    ...headers,
  });
  res.end(body);
}

function json(res, code, obj) {
  send(res, code, JSON.stringify(obj), { 'content-type': 'application/json' });
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { _raw: raw }; }
}

function authed(req) {
  if (!TOKEN) return true;
  const h = req.headers.authorization || '';
  return h === `Bearer ${TOKEN}`;
}

// ---------- request handling ----------

const server = createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS') return send(res, 204, '');

  // hook ingest: POST /e/<kind>
  if (pathname.startsWith('/e/') && req.method === 'POST') {
    if (!authed(req)) return json(res, 401, { error: 'unauthorized' });
    const kind = pathname.slice(3);
    if (!HOOK_KINDS.has(kind)) return json(res, 404, { error: 'unknown event', kind });

    const body = await readBody(req);
    const n = normalize(body);
    const id = n.sessionId || `anon:${n.cwd || 'unknown'}`;
    let s = sessions.get(id);
    const isNew = !s;
    if (isNew) { s = freshSession(id); sessions.set(id, s); }
    const prev = isNew ? null : s.status;
    const cli = searchParams.get('cli') || 'claude';
    applyEvent(s, kind, n, cli);
    if (prev !== null && prev !== s.status) notifyTransition(prev, s.status, s);
    // Bind to the focused OS window on session-start and on every user
    // prompt — the only moments focus is reliably in the terminal where Claude
    // is running. Tool/notify events can fire while the user is in another
    // app (or even another terminal tab), so binding on those would risk
    // pointing the focus button at the wrong window. After a collector restart,
    // existing sessions remain unbound until their next user prompt.
    if (kind === 'session-start' || kind === 'prompt') {
      getFocusedTerminal()
        .then((term) => {
          if (!term) return;
          const cur = sessions.get(id);
          if (!cur) return;
          cur.terminal = term;
          broadcast();
        })
        .catch(() => {});
    }
    // Start tailing the transcript on first sighting. The initial tick reads
    // everything up to current EOF (catches up history); subsequent ticks
    // poll for new bytes. Hooks → live state changes; transcript tail → live
    // tokens, ctx%, todos, last-said. Two independent feeds for the same
    // session, both broadcasting on change.
    if (!s.backfilled && n.transcriptPath) {
      s.backfilled = true;
      startTail(n.transcriptPath, id, (objs) => {
        const cur = sessions.get(id);
        if (!cur) return;
        let changed = false;
        for (const obj of objs) if (applyTranscriptLine(cur, obj)) changed = true;
        if (changed) broadcast();
      });
    }
    broadcast();
    return json(res, 200, { ok: true });   // fast ack; hook never blocks Claude
  }

  // live stream: GET /stream  (SSE)
  if (pathname === '/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    const ka = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch {} }, 25000);
    req.on('close', () => { clearInterval(ka); clients.delete(res); });
    return;
  }

  // one-shot snapshot
  if (pathname === '/api/state' && req.method === 'GET') {
    return json(res, 200, snapshot());
  }

  // user todos / notes
  if (pathname === '/api/todo' && req.method === 'POST') {
    const b = await readBody(req);
    addTodo(b.cwd, b.text); broadcast();
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/todo/toggle' && req.method === 'POST') {
    const b = await readBody(req);
    toggleTodo(b.cwd, b.id); broadcast();
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/todo/remove' && req.method === 'POST') {
    const b = await readBody(req);
    removeTodo(b.cwd, b.id); broadcast();
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/note' && req.method === 'POST') {
    const b = await readBody(req);
    setNotes(b.cwd, b.text); broadcast();
    return json(res, 200, { ok: true });
  }

  // jump to the terminal window the session is running in (requires yabai)
  if (pathname === '/api/session/focus' && req.method === 'POST') {
    const b = await readBody(req);
    const s = sessions.get(b.id);
    if (!s || !s.terminal) return json(res, 404, { error: 'no terminal binding' });
    const ok = await focusWindow(s.terminal.windowId);
    return json(res, ok ? 200 : 500, { ok });
  }

  // remove a session from the board (will reappear if it fires a new hook event)
  if (pathname === '/api/session/remove' && req.method === 'POST') {
    const b = await readBody(req);
    if (b.id) { sessions.delete(b.id); stopTail(b.id); }
    broadcast();
    return json(res, 200, { ok: true });
  }

  // health
  if (pathname === '/api/health') return json(res, 200, { ok: true, sessions: sessions.size });

  // static UI (built bundle)
  if (req.method === 'GET') return serveStatic(pathname, res);

  return json(res, 404, { error: 'not found' });
});

async function serveStatic(pathname, res) {
  if (!existsSync(PUBLIC_DIR)) {
    return send(res, 200,
      `<!doctype html><meta charset=utf8><title>Ground Control</title>
       <body style="font:14px ui-monospace,monospace;background:#08090b;color:#c9d1d9;padding:40px">
       <h1 style="color:#34e29a">▲ Ground Control collector is running</h1>
       <p>Port ${PORT}. The UI isn't built yet — run <code>npm run build</code>, or use <code>npm run dev</code> for the Vite dev server.</p>
       <p>Stream: <code>GET /stream</code> · Ingest: <code>POST /e/&lt;kind&gt;</code></p>
       </body>`, { 'content-type': 'text/html' });
  }
  let rel = pathname === '/' ? '/index.html' : pathname;
  let file = normPath(join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'forbidden' });
  if (!existsSync(file)) file = join(PUBLIC_DIR, 'index.html'); // SPA fallback
  try {
    const buf = await readFile(file);
    send(res, 200, buf, { 'content-type': mime(extname(file)) });
  } catch {
    json(res, 404, { error: 'not found' });
  }
}

function mime(ext) {
  return {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  }[ext] || 'application/octet-stream';
}

// stale sweep
setInterval(() => {
  let changed = false;
  for (const s of sessions.values()) if (sweepStale(s, STALE_MS)) changed = true;
  if (changed) broadcast();
}, 15000);

server.listen(PORT, () => {
  const n = notifyStatus();
  console.log(`▲ Ground Control collector  →  http://localhost:${PORT}`);
  console.log(`  data dir : ${DATA_DIR}`);
  console.log(`  auth     : ${TOKEN ? 'token required' : 'open (localhost)'}`);
  console.log(`  stale    : ${Math.round(STALE_MS / 1000)}s`);
  console.log(`  notify   : ${n.enabled ? `${n.backend} · ${n.events.join(',')} · sound=${n.sound} · sticky=${n.sticky ? 'on' : 'off'}` : 'disabled'}`);
  console.log(`  tailing  : ${tailingCount()} session(s) · poll=${process.env.GC_TAIL_MS || 2000}ms`);
});

// Clean up file watchers on shutdown.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { stopAllTails(); process.exit(0); });
}
