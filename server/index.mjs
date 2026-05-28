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

const PORT = Number(process.env.GC_PORT || 4317);
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
  return { sessions: list, tally, now: Date.now() };
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

  // remove a session from the board (will reappear if it fires a new hook event)
  if (pathname === '/api/session/remove' && req.method === 'POST') {
    const b = await readBody(req);
    if (b.id) sessions.delete(b.id);
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
});
