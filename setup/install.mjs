#!/usr/bin/env node
// install.mjs — idempotently merge Ground Control's hooks into Claude Code's
// settings.json. Shows the exact diff and asks before writing. This is the
// *only* thing `npx` automates; you can do the identical edit by hand.

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';

const PORT = Number(process.env.GC_PORT || 4317);
const YES = process.argv.includes('--yes') || process.argv.includes('-y');
const TIER2 = !process.argv.includes('--tier1'); // default = full (tool stream)
const STATUSLINE = process.argv.includes('--statusline');

const SETTINGS = process.env.CLAUDE_SETTINGS ||
  join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json');

const BASE = `http://localhost:${PORT}`;
const cmd = (slug) => `curl -sm2 -X POST ${BASE}/e/${slug} --data-binary @- || true`;
const hook = (slug) => ({ matcher: '*', hooks: [{ type: 'command', command: cmd(slug) }] });

const EVENTS = {
  SessionStart: 'session-start',
  UserPromptSubmit: 'prompt',
  PermissionRequest: 'permission',
  Notification: 'notify',
  Stop: 'stop',
  ...(TIER2 ? { PreToolUse: 'pre-tool', PostToolUse: 'post-tool' } : {}),
};

function load() {
  if (!existsSync(SETTINGS)) return {};
  try { return JSON.parse(readFileSync(SETTINGS, 'utf8')); }
  catch (e) { console.error(`✕ ${SETTINGS} is not valid JSON — fix it first.\n  ${e.message}`); process.exit(1); }
}

// strip any prior Ground Control entries (idempotent) then add fresh ones
function isOurs(entry) {
  return entry?.hooks?.some((h) => typeof h.command === 'string' && h.command.includes('/e/'));
}

function merge(settings) {
  const out = structuredClone(settings);
  out.hooks ||= {};
  for (const [event, slug] of Object.entries(EVENTS)) {
    const list = (out.hooks[event] || []).filter((e) => !isOurs(e));
    list.push(hook(slug));
    out.hooks[event] = list;
  }
  if (STATUSLINE) {
    out.statusLine = { type: 'command', command: `curl -sm2 -X POST ${BASE}/e/beat --data-binary @-; cat`, refreshInterval: 5 };
  }
  return out;
}

async function main() {
  const before = load();
  const after = merge(before);

  console.log(`\n▲ Ground Control hook installer`);
  console.log(`  target : ${SETTINGS}`);
  console.log(`  tier   : ${TIER2 ? '2 (lifecycle + tool stream + todos)' : '1 (lifecycle only — no tool contents)'}`);
  console.log(`  events : ${Object.keys(EVENTS).join(', ')}${STATUSLINE ? ' + statusLine beat' : ''}`);
  console.log(`\n  The following will be written into "hooks":\n`);
  for (const [event, slug] of Object.entries(EVENTS)) {
    console.log(`  ${event.padEnd(18)} → ${cmd(slug)}`);
  }
  console.log('');

  if (!YES) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ans = (await rl.question('  Write these changes? [y/N] ')).trim().toLowerCase();
    rl.close();
    if (ans !== 'y' && ans !== 'yes') { console.log('  Aborted. No changes made.'); return; }
  }

  mkdirSync(dirname(SETTINGS), { recursive: true });
  if (existsSync(SETTINGS)) copyFileSync(SETTINGS, `${SETTINGS}.gc-backup`);
  writeFileSync(SETTINGS, JSON.stringify(after, null, 2));
  console.log(`\n  ✓ Wrote ${SETTINGS}`);
  if (existsSync(`${SETTINGS}.gc-backup`)) console.log(`  ✓ Backup at ${SETTINGS}.gc-backup`);
  console.log(`\n  Next: start a session with \`claude\` — Claude will ask you to approve the new hooks once.\n`);
}

main();
