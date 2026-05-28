// store.mjs — persistent user data (manual todos + notes), keyed by project
// cwd so it outlives ephemeral sessions. Plain JSON file, no dependencies.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const DATA_DIR = process.env.GC_DATA_DIR || join(homedir(), '.ground-control');
const FILE = join(DATA_DIR, 'store.json');

let data = { projects: {} };

export function loadStore() {
  try {
    if (existsSync(FILE)) data = JSON.parse(readFileSync(FILE, 'utf8'));
  } catch (e) {
    console.warn('[store] could not read store, starting fresh:', e.message);
    data = { projects: {} };
  }
  return data;
}

function persist() {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn('[store] write failed:', e.message);
  }
}

function proj(cwd) {
  const key = cwd || '__global__';
  if (!data.projects[key]) data.projects[key] = { notes: '', todos: [] };
  return data.projects[key];
}

/** Returns { notes, todos } for a project cwd (never null). */
export function getProject(cwd) {
  return proj(cwd);
}

export function addTodo(cwd, text) {
  const p = proj(cwd);
  const todo = { id: rid(), text: String(text || '').trim(), done: false, createdAt: Date.now() };
  if (!todo.text) return null;
  p.todos.push(todo);
  persist();
  return todo;
}

export function toggleTodo(cwd, id) {
  const p = proj(cwd);
  const t = p.todos.find((x) => x.id === id);
  if (t) { t.done = !t.done; persist(); }
  return t;
}

export function removeTodo(cwd, id) {
  const p = proj(cwd);
  p.todos = p.todos.filter((x) => x.id !== id);
  persist();
}

export function setNotes(cwd, text) {
  const p = proj(cwd);
  p.notes = String(text || '');
  persist();
  return p.notes;
}

function rid() {
  return Math.random().toString(36).slice(2, 9);
}

export { DATA_DIR, FILE };
