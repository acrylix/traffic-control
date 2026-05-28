```
   ▲   ┌──────────────────────────────────────────────────────────────────┐
  ▲ ▲  │                                                                  │
 ▲▲▲▲▲ │   ██████╗ ██████╗  ██████╗ ██╗   ██╗███╗   ██╗██████╗            │
   │   │  ██╔════╝ ██╔══██╗██╔═══██╗██║   ██║████╗  ██║██╔══██╗           │
   │   │  ██║  ███╗██████╔╝██║   ██║██║   ██║██╔██╗ ██║██║  ██║           │
   │   │  ██║   ██║██╔══██╗██║   ██║██║   ██║██║╚██╗██║██║  ██║           │
   │   │  ╚██████╔╝██║  ██║╚██████╔╝╚██████╔╝██║ ╚████║██████╔╝           │
   │   │   ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝╚═════╝            │
   │   │   ██████╗ ██████╗ ███╗   ██╗████████╗██████╗  ██████╗ ██╗        │
   │   │  ██╔════╝██╔═══██╗████╗  ██║╚══██╔══╝██╔══██╗██╔═══██╗██║        │
   │   │  ██║     ██║   ██║██╔██╗ ██║   ██║   ██████╔╝██║   ██║██║        │
   │   │  ██║     ██║   ██║██║╚██╗██║   ██║   ██╔══██╗██║   ██║██║        │
   │   │  ╚██████╗╚██████╔╝██║ ╚████║   ██║   ██║  ██║╚██████╔╝███████╗   │
   │   │   ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚══════╝   │
   │   │                                                                  │
   ▼   │   « tower online · clear for taxi · winds calm · localhost »     │
       └──────────────────────────────────────────────────────────────────┘
```

# ▲ Ground Control

**Traffic control for your local coding-agent sessions.** A pragmatic, local-first
dashboard that maps every running Claude Code session to a **flight strip** with
a traffic-light state — so you always know which session is **working** (🟢),
**waiting on you** (🟡), **done** (🔵), **blocked** (🔴), or **stale** (⬤).

Every session gets a NATO **callsign** (`ALPHA-7`, `ROMEO-42`, …), a live
transcript tail (exact tokens, ctx%, todos, last-said), a one-click **jump to
its terminal window**, and native macOS alerts the moment it needs you.

```
┌ command bar ─ live clock · GO/HOLD/STOP tally · rate limits · search ────────┐
├ rail ──┬ board ─────────────────────────────────────┬ detail ────────────────┤
│ status │  NEEDS YOU                                 │  current task          │
│ agents │   🟡 ROMEO-42  api-gateway  ↗              │  claude todos          │
│ feed   │     wants to run `migrate --prod`          │  your checklist        │
│ conn   │  IN MOTION                                 │  notes                 │
│        │   🟢 ALPHA-7   traffic-control  ↗          │  transcript history    │
│        │     refactoring Board.tsx · 47% ctx        │  activity timeline     │
│        │  RESOLVED & STALE …                        │  × dismiss             │
└────────┴────────────────────────────────────────────┴────────────────────────┘
```

## Features

- **Flight strips** — one per session, color-coded by state, sorted by who needs
  you first. NATO callsigns disambiguate two sessions in the same repo.
- **Live transcript tail** — polls `~/.claude/projects/<cwd>/<id>.jsonl` every
  2s for exact cumulative tokens, current ctx%, TodoWrite mirror, first prompt,
  and most recent assistant response. Survives collector restarts.
- **Self-calibrating 1M context detection** — Claude Code doesn't tag the Opus
  1M variant in transcripts; we infer it by observing usage that physically
  couldn't fit in 200k. No more spurious `ctx=100%` clamps.
- **Terminal binding (yabai)** — captures the focused window on session-start /
  prompt, then a `↗` button on the strip or detail panel jumps you back to
  that exact Warp/iTerm/Ghostty tab.
- **Native macOS notifications** — alerts on `→ waiting` and `→ blocked` only
  (configurable). With `terminal-notifier` installed, alerts are **sticky** and
  click-through to the relevant session; auto-cleared when the session resolves.
  Falls back to `osascript` if `terminal-notifier` isn't present.
- **Deep-link from notifications** — `?s=<id>` URL param pins selection so
  clicking an alert lands you on the right strip.
- **Statusline relay (optional)** — opt-in wrapper around your existing
  statusline (e.g. `ccstatusline`) that forwards rate limits (5h / 7d),
  effort level, and thinking-mode chips. Doesn't hijack your display.
- **Per-project todos & notes** — Claude's `TodoWrite` mirrored live, plus
  your own checklist + scratchpad. Persisted under `~/.ground-control/`.

## How it works

- **Collector** (`server/`) — a zero-dependency Node process. Claude Code's
  **hooks** POST lifecycle events (`SessionStart`, `PreToolUse`,
  `PermissionRequest`, `Stop`, …) to `localhost`; the collector runs a state
  machine, tails each session's JSONL transcript, and pushes live snapshots
  to the browser over **SSE**. It also serves the built UI same-origin
  (no CORS / mixed-content).
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
npm run init -- --statusline # also add the 5s heartbeat (rate limits / effort)
```

It backs up and idempotently merges hooks into `~/.claude/settings.json`.

### Option B — paste it yourself (fully auditable)

Add to `~/.claude/settings.json` — every hook is a plain `curl` to localhost:

```jsonc
{
  "hooks": {
    "SessionStart":      [{ "matcher": "*", "hooks": [{ "type": "command", "command": "curl -sm2 -o /dev/null -X POST http://localhost:4317/e/session-start --data-binary @- 2>/dev/null || true" }]}],
    "UserPromptSubmit":  [{ "matcher": "*", "hooks": [{ "type": "command", "command": "curl -sm2 -o /dev/null -X POST http://localhost:4317/e/prompt        --data-binary @- 2>/dev/null || true" }]}],
    "PreToolUse":        [{ "matcher": "*", "hooks": [{ "type": "command", "command": "curl -sm2 -o /dev/null -X POST http://localhost:4317/e/pre-tool      --data-binary @- 2>/dev/null || true" }]}],
    "PostToolUse":       [{ "matcher": "*", "hooks": [{ "type": "command", "command": "curl -sm2 -o /dev/null -X POST http://localhost:4317/e/post-tool     --data-binary @- 2>/dev/null || true" }]}],
    "PermissionRequest": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "curl -sm2 -o /dev/null -X POST http://localhost:4317/e/permission   --data-binary @- 2>/dev/null || true" }]}],
    "Notification":      [{ "matcher": "*", "hooks": [{ "type": "command", "command": "curl -sm2 -o /dev/null -X POST http://localhost:4317/e/notify       --data-binary @- 2>/dev/null || true" }]}],
    "Stop":              [{ "matcher": "*", "hooks": [{ "type": "command", "command": "curl -sm2 -o /dev/null -X POST http://localhost:4317/e/stop         --data-binary @- 2>/dev/null || true" }]}]
  }
}
```

Drop `PreToolUse`/`PostToolUse` for Tier 1 (no command/code contents leave Claude).
Restart Claude; it will ask you to approve the new hooks once.

The `curl` is hardened: `-m2` caps at 2s if the collector is down, `-o /dev/null`
and `2>/dev/null` keep any output from leaking into Claude's hook stream, and
`|| true` guarantees exit 0 — so a stopped collector can never break your session.

### Optional: terminal binding (jump-to-window)

If you have [yabai](https://github.com/koekeishiya/yabai) installed and scripting
addition loaded, Ground Control will capture the focused terminal window on
session-start / user-prompt and let you jump back to it with the `↗` button.
Known terminals: Warp, iTerm2, Terminal, WezTerm, kitty, Alacritty, Ghostty.
No yabai → the button just doesn't appear; everything else still works.

### Optional: statusline relay (rate limits + effort/thinking)

```bash
# In ~/.claude/settings.json, point statusLine.command at:
~/path/to/traffic-control/setup/statusline-relay.sh
```

The relay wraps your existing statusline (default `ccstatusline`, override with
`GC_STATUSLINE_CMD`), forwards the JSON payload to `/e/beat`, and prints the
original output unchanged. The header `RateLimitsWidget` lights up once data
starts flowing.

## Config (env vars)

| var | default | meaning |
|-----|---------|---------|
| `GC_PORT` | `4317` | collector port |
| `GC_DATA_DIR` | `~/.ground-control` | where todos/notes persist |
| `GC_STALE_MS` | `360000` | silence before a session goes stale |
| `GC_TAIL_MS` | `2000` | transcript-tail poll interval (ms) |
| `GC_INGEST_TOKEN` | _(empty)_ | if set, hooks must send `Authorization: Bearer …` (seam for hosting later) |
| `GC_NOTIFY` | `1` | `0` to disable native notifications |
| `GC_NOTIFY_EVENTS` | `waiting,blocked` | which next-states fire alerts |
| `GC_NOTIFY_STICKY` | `1` | sticky alerts on waiting/blocked (needs `terminal-notifier`) |
| `GC_NOTIFY_SOUND` | `Glass` | macOS sound name, or `none` |
| `GC_STATUSLINE_CMD` | `npx -y ccstatusline@latest` | wrapped statusline for the relay |

## Status

Local vertical slice working end-to-end: real hook ingest → state machine →
transcript tail → live board, with callsigns, Claude todo mirroring,
per-project todos/notes, terminal-binding jump, sticky macOS alerts, and an
optional statusline relay for rate-limits / effort / thinking. First-party
Claude Code; other CLIs (opencode, grok) plug into the same `/e/*` ingest later.
