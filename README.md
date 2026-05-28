# ▲ Ground Control

Traffic control for your local coding-agent sessions. A pragmatic, local-first
dashboard that maps every running Claude Code session to a **flight strip** with
a traffic-light state — so you always know which session is **working** (🟢),
**waiting on you** (🟡), **done** (🔵), **blocked** (🔴), or **stale** (⬤).

Plus per-session/project **todos** (mirrored live from Claude's own TodoWrite,
augmented with your own) and a **notes** scratchpad.

```
┌ command bar ─ live clock · GO/HOLD/STOP tally · search ──────────────────┐
├ rail ──┬ board ───────────────────────────────────┬ detail ─────────────┤
│ status │  NEEDS YOU                                │  current task       │
│ agents │   🟡 api-gateway  wants to run `migrate`  │  claude todos       │
│ feed   │  IN MOTION                                │  your checklist     │
│ conn   │   🟢 traffic-control  Building board UI    │  notes              │
│        │  RESOLVED & STALE …                        │  activity timeline  │
└────────┴───────────────────────────────────────────┴─────────────────────┘
```

## How it works

- **Collector** (`server/`) — a zero-dependency Node process. Claude Code's
  **hooks** POST lifecycle events (`SessionStart`, `PreToolUse`,
  `PermissionRequest`, `Stop`, …) to `localhost`; the collector runs a state
  machine and pushes live snapshots to the browser over **SSE**. It also serves
  the built UI same-origin (no CORS / mixed-content).
- **UI** (`web/`) — Vite + React + Zustand. The flight-strip board.
- Nothing leaves your machine. All traffic is `localhost`.

## Quickstart

```bash
npm install
npm run build      # builds the UI into server/public
npm run server     # collector + UI at http://localhost:4317
```

For development with hot reload:

```bash
npm run dev        # collector on :4317, Vite on :5173
```

## Connect Claude Code

### Option A — guided installer (shows a diff, asks first)

```bash
npm run init                 # Tier 2 (lifecycle + tool stream + todos)
npm run init -- --tier1      # Tier 1 (lifecycle only, no tool contents sent)
npm run init -- --statusline # also add the 5s heartbeat (ctx% / cost)
```

It backs up and idempotently merges hooks into `~/.claude/settings.json`.

### Option B — paste it yourself (fully auditable)

Add to `~/.claude/settings.json` — every hook is a plain `curl` to localhost:

```jsonc
{
  "hooks": {
    "SessionStart":      [{ "matcher": "*", "hooks": [{ "type": "command", "command": "curl -sm2 -X POST http://localhost:4317/e/session-start --data-binary @- || true" }]}],
    "UserPromptSubmit":  [{ "matcher": "*", "hooks": [{ "type": "command", "command": "curl -sm2 -X POST http://localhost:4317/e/prompt        --data-binary @- || true" }]}],
    "PreToolUse":        [{ "matcher": "*", "hooks": [{ "type": "command", "command": "curl -sm2 -X POST http://localhost:4317/e/pre-tool      --data-binary @- || true" }]}],
    "PostToolUse":       [{ "matcher": "*", "hooks": [{ "type": "command", "command": "curl -sm2 -X POST http://localhost:4317/e/post-tool     --data-binary @- || true" }]}],
    "PermissionRequest": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "curl -sm2 -X POST http://localhost:4317/e/permission     --data-binary @- || true" }]}],
    "Notification":      [{ "matcher": "*", "hooks": [{ "type": "command", "command": "curl -sm2 -X POST http://localhost:4317/e/notify         --data-binary @- || true" }]}],
    "Stop":              [{ "matcher": "*", "hooks": [{ "type": "command", "command": "curl -sm2 -X POST http://localhost:4317/e/stop           --data-binary @- || true" }]}]
  }
}
```

Drop `PreToolUse`/`PostToolUse` for Tier 1 (no command/code contents leave Claude).
Restart Claude; it will ask you to approve the new hooks once.

## Config (env vars)

| var | default | meaning |
|-----|---------|---------|
| `GC_PORT` | `4317` | collector port |
| `GC_DATA_DIR` | `~/.ground-control` | where todos/notes persist |
| `GC_STALE_MS` | `360000` | silence before a session goes stale |
| `GC_INGEST_TOKEN` | _(empty)_ | if set, hooks must send `Authorization: Bearer …` (the seam for hosting later) |

## Status

Local vertical slice working: real hook ingest → state machine → live board,
with Claude todo mirroring and per-project todos/notes. First-party Claude Code;
other CLIs (opencode, grok) plug into the same `/e/*` ingest later.
