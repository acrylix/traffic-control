export type Status = 'working' | 'waiting' | 'done' | 'blocked' | 'idle';

export interface ClaudeTodo {
  content: string;
  activeForm: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface UserTodo {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
}

export interface SessionEvent {
  t: number;
  kind: string;
  label: string;
}

export interface Metrics {
  ctxPct: number;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

export interface Session {
  id: string;
  cwd: string | null;
  project: string;
  branch: string | null;
  cli: string;
  model: string | null;
  permissionMode: string | null;
  status: Status;
  reason: string;
  task: string;
  permission: { tool: string; detail: string } | null;
  claudeTodos: ClaudeTodo[];
  userTodos: UserTodo[];
  notes: string;
  metrics: Metrics;
  startedAt: number;
  lastSeenAt: number;
  lastStopAt: number | null;
  events: SessionEvent[];
}

export interface Snapshot {
  sessions: Session[];
  tally: Record<Status, number>;
  now: number;
}
