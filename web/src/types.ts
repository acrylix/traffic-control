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
  apiDurationMs: number;
  linesAdded: number;
  linesRemoved: number;
  rl5hPct: number;
  rl5hResetsAt: number;
  rl7dPct: number;
  rl7dResetsAt: number;
}

export interface TerminalBinding {
  app: string;
  windowId: number;
  title: string;
  space: number | null;
  stampedAt: number;
}

export interface RateLimits {
  rl5hPct: number;
  rl5hResetsAt: number;
  rl7dPct: number;
  rl7dResetsAt: number;
}

export interface Session {
  id: string;
  callsign: string;
  shortId: string;
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
  firstPrompt: string | null;
  lastAssistantText: string | null;
  messageCount: number;
  backfilled: boolean;
  userTodos: UserTodo[];
  notes: string;
  metrics: Metrics;
  effortLevel: string | null;
  thinkingEnabled: boolean | null;
  terminal: TerminalBinding | null;
  startedAt: number;
  lastSeenAt: number;
  lastStopAt: number | null;
  events: SessionEvent[];
}

export interface Snapshot {
  sessions: Session[];
  tally: Record<Status, number>;
  rateLimits: RateLimits | null;
  now: number;
}
