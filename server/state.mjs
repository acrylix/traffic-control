// state.mjs — payload normalization + the session state machine.
// No dependencies. Pure functions operating on a session object.

import { basename } from 'node:path';

const TASK_MAX = 96;

// ATC-style callsign derived from session_id. Stable, memorable, on-theme.
// 26 phonetic words × 99 numbers = 2574 distinct callsigns — plenty for any
// realistic fleet. Collisions are possible but rare for one user's machine.
const NATO = [
  'ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL',
  'INDIA', 'JULIET', 'KILO', 'LIMA', 'MIKE', 'NOVEMBER', 'OSCAR', 'PAPA',
  'QUEBEC', 'ROMEO', 'SIERRA', 'TANGO', 'UNIFORM', 'VICTOR', 'WHISKEY', 'XRAY',
  'YANKEE', 'ZULU',
];

export function callsign(id) {
  if (!id) return 'UNKNOWN';
  let h = 2166136261; // FNV-1a-ish
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const word = NATO[h % NATO.length];
  const num = (Math.floor(h / NATO.length) % 99) + 1;
  return `${word}-${num}`;
}

/** Short stable suffix of a session id for traceability when callsigns collide. */
export function shortId(id) {
  if (!id) return '——————';
  return id.replace(/-/g, '').slice(-6).toLowerCase();
}

/**
 * Hook payloads vary in casing (snake_case from hooks, camelCase from
 * transcripts/statusline) and shape across Claude Code versions. Normalize
 * to one internal vocabulary, accepting either form defensively.
 */
export function normalize(raw = {}) {
  const p = raw || {};
  const ctx = p.context_window || p.contextWindow || {};
  const cost = p.cost || {};
  const model = p.model || {};
  const ws = p.workspace || {};
  const rl = p.rate_limits || p.rateLimits || {};
  const rl5 = rl.five_hour || rl.fiveHour || {};
  const rl7 = rl.seven_day || rl.sevenDay || {};
  const eff = p.effort || {};
  const th = p.thinking || {};
  return {
    sessionId: p.session_id || p.sessionId || null,
    cwd: p.cwd || ws.current_dir || ws.project_dir || null,
    transcriptPath: p.transcript_path || p.transcriptPath || null,
    branch: p.gitBranch || p.git_branch || (ws.repo && ws.repo.name) || null,
    permissionMode: p.permission_mode || p.permissionMode || null,
    toolName: p.tool_name || p.toolName || null,
    toolInput: p.tool_input || p.toolInput || null,
    success: p.success ?? (p.tool_result ? p.tool_result.success : undefined),
    prompt: typeof p.prompt === 'string' ? p.prompt : extractPrompt(p),
    notifyType: p.type || p.notification_type || null,
    message: p.message && typeof p.message === 'string' ? p.message : null,
    // statusline / heartbeat metrics
    modelName: model.display_name || model.id || null,
    ctxPct: num(ctx.used_percentage),
    tokensIn: num(ctx.total_input_tokens),
    tokensOut: num(ctx.total_output_tokens),
    ctxSize: num(ctx.context_window_size),
    costUsd: num(cost.total_cost_usd),
    durationMs: num(cost.total_duration_ms),
    apiDurationMs: num(cost.total_api_duration_ms),
    linesAdded: num(cost.total_lines_added),
    linesRemoved: num(cost.total_lines_removed),
    rl5hPct: num(rl5.used_percentage),
    rl5hResetsAt: num(rl5.resets_at),
    rl7dPct: num(rl7.used_percentage),
    rl7dResetsAt: num(rl7.resets_at),
    effortLevel: eff.level || null,
    thinkingEnabled: typeof th.enabled === 'boolean' ? th.enabled : null,
  };
}

function num(v) { return typeof v === 'number' && !Number.isNaN(v) ? v : undefined; }

function extractPrompt(p) {
  // user message shape: { message: { content: "..." } }
  const m = p.message;
  if (m && typeof m.content === 'string') return m.content;
  return null;
}

export function freshSession(id) {
  const now = Date.now();
  return {
    id,
    callsign: callsign(id),
    shortId: shortId(id),
    cwd: null,
    project: id ? id.slice(0, 8) : 'unknown',
    branch: null,
    cli: 'claude',
    model: null,
    permissionMode: null,
    status: 'idle',
    reason: 'registered',
    task: 'waiting for session…',
    permission: null,
    claudeTodos: [],          // mirrored from TodoWrite (live + backfilled)
    firstPrompt: null,        // the "what was this session asked to do"
    lastAssistantText: null,  // most recent assistant text block (from transcript)
    messageCount: 0,          // total messages observed (backfill + live)
    backfilled: false,        // transcript scan attempted at least once
    metrics: {
      ctxPct: 0, costUsd: 0, tokensIn: 0, tokensOut: 0,
      durationMs: 0, apiDurationMs: 0,
      linesAdded: 0, linesRemoved: 0,
      rl5hPct: 0, rl5hResetsAt: 0,
      rl7dPct: 0, rl7dResetsAt: 0,
    },
    effortLevel: null,
    thinkingEnabled: null,
    terminal: null,           // { app, windowId, title, space, stampedAt } once bound via yabai
    startedAt: now,
    lastSeenAt: now,
    lastStopAt: null,
    events: [],
  };
}

const EVENT_CAP = 40;
function pushEvent(s, kind, label) {
  s.events.unshift({ t: Date.now(), kind, label });
  if (s.events.length > EVENT_CAP) s.events.length = EVENT_CAP;
}

/**
 * Apply a hook event to a session (mutates and returns it).
 * `kind` is the endpoint slug: session-start | prompt | pre-tool |
 * post-tool | permission | notify | stop | beat.
 */
export function applyEvent(s, kind, n, cli = 'claude') {
  s.lastSeenAt = Date.now();
  if (cli) s.cli = cli;

  // absorb identity/metrics whenever present
  if (n.cwd) { s.cwd = n.cwd; s.project = basename(n.cwd) || n.cwd; }
  if (n.branch) s.branch = n.branch;
  if (n.permissionMode) s.permissionMode = n.permissionMode;
  if (n.modelName) s.model = n.modelName;
  absorbMetrics(s, n);

  switch (kind) {
    case 'session-start':
      s.startedAt = Date.now();
      setStatus(s, 'idle', 'started');
      pushEvent(s, 'session-start', 'session started');
      break;

    case 'prompt':
      if (!s.firstPrompt && n.prompt) s.firstPrompt = n.prompt;
      s.messageCount += 1;
      setStatus(s, 'working', 'prompt');
      pushEvent(s, 'prompt', truncate(n.prompt || 'user prompt', 60));
      break;

    case 'pre-tool':
      captureTodos(s, n);
      setStatus(s, 'working', 'tool');
      pushEvent(s, 'pre-tool', n.toolName || 'tool');
      break;

    case 'post-tool':
      captureTodos(s, n);
      // a hard tool failure flips to blocked; otherwise stay in motion
      if (n.success === false) {
        setStatus(s, 'blocked', 'tool-error');
        pushEvent(s, 'post-tool', `${n.toolName || 'tool'} failed`);
      } else {
        setStatus(s, 'working', 'tool');
        pushEvent(s, 'post-tool', n.toolName || 'tool');
      }
      break;

    case 'permission':
      s.permission = describePermission(n);
      setStatus(s, 'waiting', 'permission');
      pushEvent(s, 'permission', s.permission.detail);
      break;

    case 'notify':
      // permission_prompt / idle_prompt mean "needs you"; errors → blocked
      if (/error|fail/i.test(n.notifyType || '')) {
        setStatus(s, 'blocked', n.notifyType);
      } else {
        setStatus(s, 'waiting', n.notifyType || 'notification');
      }
      pushEvent(s, 'notify', n.message || n.notifyType || 'notification');
      break;

    case 'stop':
      s.lastStopAt = Date.now();
      s.permission = null;
      // turn ended → waiting for you, unless every todo is done → done
      if (s.claudeTodos.length && s.claudeTodos.every((t) => t.status === 'completed')) {
        setStatus(s, 'done', 'all-todos-complete');
      } else {
        setStatus(s, 'waiting', 'turn-end');
      }
      pushEvent(s, 'stop', 'turn ended');
      break;

    case 'beat':
      // heartbeat: liveness + metrics only, no state change
      break;
  }

  s.task = computeTask(s, n);
  return s;
}

function setStatus(s, status, reason) {
  s.status = status;
  s.reason = reason;
}

function absorbMetrics(s, n) {
  const m = s.metrics;
  if (n.ctxPct !== undefined) m.ctxPct = n.ctxPct;
  if (n.costUsd !== undefined) m.costUsd = n.costUsd;
  if (n.tokensIn !== undefined) m.tokensIn = n.tokensIn;
  if (n.tokensOut !== undefined) m.tokensOut = n.tokensOut;
  if (n.durationMs !== undefined) m.durationMs = n.durationMs;
  if (n.apiDurationMs !== undefined) m.apiDurationMs = n.apiDurationMs;
  if (n.linesAdded !== undefined) m.linesAdded = n.linesAdded;
  if (n.linesRemoved !== undefined) m.linesRemoved = n.linesRemoved;
  if (n.rl5hPct !== undefined) m.rl5hPct = n.rl5hPct;
  if (n.rl5hResetsAt !== undefined) m.rl5hResetsAt = n.rl5hResetsAt;
  if (n.rl7dPct !== undefined) m.rl7dPct = n.rl7dPct;
  if (n.rl7dResetsAt !== undefined) m.rl7dResetsAt = n.rl7dResetsAt;
  if (n.effortLevel) s.effortLevel = n.effortLevel;
  if (n.thinkingEnabled !== null && n.thinkingEnabled !== undefined) s.thinkingEnabled = n.thinkingEnabled;
}

function captureTodos(s, n) {
  if (n.toolName !== 'TodoWrite') return;
  const arr = n.toolInput && (n.toolInput.todos || n.toolInput.todoList);
  if (!Array.isArray(arr)) return;
  s.claudeTodos = arr.map((t) => ({
    content: t.content || t.task || '',
    activeForm: t.activeForm || t.active_form || t.content || '',
    status: t.status || 'pending',
  }));
}

function describePermission(n) {
  const tool = n.toolName || 'tool';
  const i = n.toolInput || {};
  let detail = i.command || i.file_path || i.path || i.url || i.pattern || '';
  if (!detail && typeof i === 'object') {
    const k = Object.keys(i)[0];
    if (k) detail = String(i[k]);
  }
  return { tool, detail: truncate(`${tool}: ${detail}`.trim(), 80) };
}

function computeTask(s, n) {
  if (s.status === 'waiting' && s.permission) {
    return `wants to run ${s.permission.detail}`;
  }
  const active = s.claudeTodos.find((t) => t.status === 'in_progress');
  if (active) return truncate(active.activeForm, TASK_MAX);
  if (s.status === 'blocked') return truncate(`error · ${s.reason}`, TASK_MAX);
  if (s.status === 'done') return 'completed — all todos done';
  if (n.prompt) return truncate(n.prompt, TASK_MAX);
  const lastPrompt = s.events.find((e) => e.kind === 'prompt');
  if (lastPrompt) return truncate(lastPrompt.label, TASK_MAX);
  // backfill fallback — gives idle/resumed sessions a real label
  if (s.firstPrompt) return truncate(s.firstPrompt, TASK_MAX);
  if (s.status === 'idle') return 'ready — awaiting input';
  return s.task;
}

/**
 * Merge transcript backfill into a session. Doesn't overwrite live data;
 * fills only what we don't already know.
 */
export function mergeBackfill(s, data) {
  if (!data) return false;
  let changed = false;
  if (!s.firstPrompt && data.firstPrompt) {
    s.firstPrompt = data.firstPrompt; changed = true;
  }
  if (data.lastAssistantText && data.lastAssistantText !== s.lastAssistantText) {
    s.lastAssistantText = data.lastAssistantText; changed = true;
  }
  if (data.firstPromptAt && data.firstPromptAt < s.startedAt) {
    s.startedAt = data.firstPromptAt; changed = true;
  }
  if (s.claudeTodos.length === 0 && Array.isArray(data.claudeTodos) && data.claudeTodos.length) {
    s.claudeTodos = data.claudeTodos; changed = true;
  }
  if (data.messageCount && s.messageCount < data.messageCount) {
    s.messageCount = data.messageCount; changed = true;
  }
  if (changed) s.task = computeTask(s, {});
  return changed;
}

function truncate(str, n) {
  const t = (str || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** Mark sessions stale if no signal for a while. Returns true if changed. */
export function sweepStale(s, staleMs) {
  const silent = Date.now() - s.lastSeenAt;
  if (silent > staleMs && s.status !== 'idle' && s.status !== 'done' && s.status !== 'blocked') {
    setStatus(s, 'idle', 'stale');
    s.task = 'stale — no signal';
    return true;
  }
  return false;
}
