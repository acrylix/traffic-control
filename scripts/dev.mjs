#!/usr/bin/env node
// dev.mjs — run the collector and the Vite dev server together.
import { spawn } from 'node:child_process';

const procs = [
  { name: 'collector', cmd: 'node', args: ['server/index.mjs'], color: '\x1b[32m' },
  { name: 'web', cmd: 'npx', args: ['vite'], color: '\x1b[36m' },
];

const children = procs.map(({ name, cmd, args, color }) => {
  const child = spawn(cmd, args, { stdio: ['inherit', 'pipe', 'pipe'], env: process.env });
  const tag = `${color}[${name}]\x1b[0m`;
  const pipe = (stream) => stream.on('data', (d) =>
    d.toString().split('\n').filter(Boolean).forEach((l) => console.log(`${tag} ${l}`)));
  pipe(child.stdout);
  pipe(child.stderr);
  return child;
});

const die = () => { children.forEach((c) => c.kill()); process.exit(); };
process.on('SIGINT', die);
process.on('SIGTERM', die);
