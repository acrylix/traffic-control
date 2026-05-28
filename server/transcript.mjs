// transcript.mjs — read everything we can from Claude's own JSONL.
//
// This module replaces "one-shot backfill" with "continuous tail": we poll
// the session's transcript file every couple of seconds, read any new bytes,
// and apply each JSONL line to the in-memory session. That gives us:
//
//   • exact cumulative tokens (sum of usage.input_tokens / output_tokens)
//   • exact context-% used (latest turn's input + cache_read + cache_creation)
//   • live first/last prompt, last assistant text, TodoWrite mirror
//   • real session start time (first user message timestamp)
//
// All without modifying the user's statusLine. The downside vs the relay is
// no rate-limit data and no Anthropic-computed cost figure (transcript only
// gives us tokens; cost would have to be estimated per-model and would drift).

import { createReadStream, existsSync, statSync } from 'node:fs';

const TICK_MS = Number(process.env.GC_TAIL_MS || 2000);

// sessionId → { path, offset, leftover, timer }
const tails = new Map();
// sessionId → message count observed by the tail (authoritative for this signal).
// We track it here, not on the session, because the hook stream also bumps
// session.messageCount on UserPromptSubmit — using a tail-side counter and
// only writing back via max() means hooks and tail can both run without
// double-counting.
const tailCounts = new Map();
function bumpCount(s) {
  const next = (tailCounts.get(s.id) || 0) + 1;
  tailCounts.set(s.id, next);
  if (s.messageCount < next) s.messageCount = next;
}

// sessionId → max single-turn ctx-used ever observed. Used to infer whether
// the session is running on the 1M context variant (Claude Code's "[1m]" flag
// for Opus isn't usually present in the model ID written to the transcript —
// it just says "claude-opus-4-7". The only way we know is by observing usage
// that physically couldn't fit in 200k.)
const tailCtxMax = new Map();
function recordCtxMax(s, ctxUsed) {
  const prev = tailCtxMax.get(s.id) || 0;
  if (ctxUsed > prev) tailCtxMax.set(s.id, ctxUsed);
  return tailCtxMax.get(s.id) || ctxUsed;
}

/**
 * Start watching a transcript for new lines. Calls onLines(parsedObjs) every
 * tick that yields new content. The initial tick reads everything from
 * offset 0 — that catches up the dashboard on resumed/long-running sessions.
 */
export function startTail(path, sessionId, onLines) {
  if (!path || tails.has(sessionId)) return;
  const entry = { path, offset: 0, leftover: '', timer: null };
  tails.set(sessionId, entry);

  const tick = async () => {
    let st;
    try { st = statSync(path); } catch { return; }    // file not written yet
    if (st.size <= entry.offset) return;

    const stream = createReadStream(path, {
      start: entry.offset,
      end: st.size - 1,
      encoding: 'utf8',
    });
    let buf = entry.leftover;
    for await (const piece of stream) buf += piece;
    entry.offset = st.size;

    const lines = buf.split('\n');
    entry.leftover = lines.pop() || '';              // last line may be partial

    const objs = [];
    for (const line of lines) {
      if (!line || line[0] !== '{') continue;
      try { objs.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
    if (objs.length) onLines(objs);
  };

  // Catch-up read happens immediately; from then on we poll for the delta.
  tick().catch((e) => console.warn('[tail]', sessionId, e.message));
  entry.timer = setInterval(() => {
    tick().catch((e) => console.warn('[tail]', sessionId, e.message));
  }, TICK_MS);
}

export function stopTail(sessionId) {
  const e = tails.get(sessionId);
  if (!e) return;
  if (e.timer) clearInterval(e.timer);
  tails.delete(sessionId);
  tailCounts.delete(sessionId);
  tailCtxMax.delete(sessionId);
}

export function stopAllTails() {
  for (const id of [...tails.keys()]) stopTail(id);
}

export function tailingCount() { return tails.size; }

// ───────────────────────────────────────────────────────────────────────────
// Line application — derives session state from a single transcript record.
// Mutates the session in place; returns true if anything changed.
// ───────────────────────────────────────────────────────────────────────────

export function applyTranscriptLine(s, obj) {
  if (!obj || !obj.type) return false;
  let changed = false;

  if (obj.type === 'user' && !obj.isMeta) {
    const text = extractUserText(obj.message);
    if (text) {
      if (!s.firstPrompt) {
        s.firstPrompt = text;
        const ts = parseTs(obj.timestamp);
        if (ts && ts < s.startedAt) s.startedAt = ts;
        changed = true;
      }
      bumpCount(s);
      changed = true;
    }
  } else if (obj.type === 'assistant') {
    const msg = obj.message || {};
    const blocks = Array.isArray(msg.content) ? msg.content : [];

    // text → last assistant text
    const text = blocks
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (text && text !== s.lastAssistantText) {
      s.lastAssistantText = text;
      changed = true;
    }

    // TodoWrite → claudeTodos mirror
    for (const b of blocks) {
      if (b?.type === 'tool_use' && b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) {
        s.claudeTodos = b.input.todos.map((t) => ({
          content: t.content || '',
          activeForm: t.activeForm || t.active_form || t.content || '',
          status: t.status || 'pending',
        }));
        changed = true;
      }
    }

    // usage → cumulative tokens + current ctx %
    const usage = msg.usage;
    if (usage) {
      s.metrics.tokensIn  = (s.metrics.tokensIn  || 0) + (usage.input_tokens  || 0);
      s.metrics.tokensOut = (s.metrics.tokensOut || 0) + (usage.output_tokens || 0);
      const ctxUsed =
        (usage.input_tokens || 0) +
        (usage.cache_creation_input_tokens || 0) +
        (usage.cache_read_input_tokens || 0);
      const observedMax = recordCtxMax(s, ctxUsed);
      const ctxSize = contextWindowFor(msg.model || s.model, observedMax);
      if (ctxSize > 0) {
        s.metrics.ctxPct = Math.min(100, Math.round((ctxUsed / ctxSize) * 100));
      }
      changed = true;
    }

    if (blocks.length) {
      bumpCount(s);
      changed = true;
    }
  }

  return changed;
}

function extractUserText(message) {
  if (!message) return '';
  const c = message.content;
  if (typeof c === 'string') return c.trim();
  if (Array.isArray(c)) {
    const t = c.find((b) => b && b.type === 'text' && typeof b.text === 'string');
    return t ? t.text.trim() : '';
  }
  return '';
}

function parseTs(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/**
 * Context-window size for a model. Tries three strategies:
 *  1. Explicit "[1m]" / "1m" hint in the model id  → 1M
 *  2. Sonnet (default 1M)                         → 1M
 *  3. Observed usage proves the floor             → 1M when any single turn
 *     exceeded 200k tokens (a 200k window can't physically fit that)
 *  4. Otherwise default to 200k.
 *
 * This self-calibrating step matters because Claude Code records the model id
 * as "claude-opus-4-7" *without* the [1m] suffix even when the 1M variant is
 * in use — so the only way to detect it from transcript data alone is to
 * notice usage that wouldn't otherwise fit.
 */
function contextWindowFor(model, observedMax = 0) {
  const m = String(model || '').toLowerCase();
  if (m.includes('[1m]') || /\b1m\b/.test(m)) return 1_000_000;
  if (m.includes('sonnet')) return 1_000_000;
  if (observedMax > 200_000) return 1_000_000;         // physical proof
  if (m.includes('haiku')) return 200_000;
  if (m.includes('opus')) return 200_000;
  return 200_000;
}
