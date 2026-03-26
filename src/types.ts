export type ChangeState = "ready" | "not-ready";

export interface ChangeItem {
  id: string;
  name: string;
  path: string;
  tasksPath: string;
  state: ChangeState;
  reason?: string;
}

export type RunStatus = "pending" | "success" | "failed" | "skipped";

export type FailureKind = "spawn_error" | "timeout" | "agent_error" | "invalid_output";

export interface RunChangeRecord {
  changeId: string;
  changePath: string;
  status: RunStatus;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  failureKind?: FailureKind;
  exitCode?: number | null;
  logPath?: string;
  message?: string;
}

export interface RunSummary {
  runId: string;
  projectRoot: string;
  changesDir: string;
  agentCommand: string;
  createdAt: string;
  updatedAt: string;
  totals: {
    total: number;
    ready: number;
    skipped: number;
    success: number;
    failed: number;
  };
  records: RunChangeRecord[];
}

export interface ExecuteOptions {
  projectRoot: string;
  changesDir: string;
  agentCommand: string;
  retry: number;
  timeoutMs: number;
  concurrency: number;
  dryRun: boolean;
  runId?: string;
  stateDir: string;
  logsDir: string;
}

export interface AgentRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  timedOut: boolean;
  failureKind?: FailureKind;
}
