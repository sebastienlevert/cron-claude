/**
 * Core types for cron-agents system
 */

export type AgentType = 'claude' | 'copilot';

export interface AgentConfig {
  name: string;
  displayName: string;
  /** Executable names to search for (in priority order) */
  executables: string[];
  /** CLI arguments for non-interactive print mode */
  printArgs: string[];
  /** How the agent receives task input: 'file' passes a temp file path, 'inline' passes instructions text directly, 'file-reference' writes a temp file but passes a short prompt referencing it */
  inputMode: 'file' | 'inline' | 'file-reference';
  /** Environment variable to override the agent path */
  pathEnvVar: string;
  /** Description shown in help text */
  description: string;
}

// ── Retry Policy ────────────────────────────────────────────────────────────

export type BackoffStrategy = 'fixed' | 'exponential' | 'linear';

export interface RetryPolicy {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Backoff strategy (default: 'fixed') */
  backoff: BackoffStrategy;
  /** Initial delay in seconds (default: 15) */
  initialDelay: number;
  /** Maximum delay in seconds (default: 300) */
  maxDelay: number;
}

/** Default retry policy matching legacy behavior */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  backoff: 'fixed',
  initialDelay: 15,
  maxDelay: 300,
};

// ── Task Definition ─────────────────────────────────────────────────────────

export interface TaskDefinition {
  id: string;
  schedule: string; // Cron expression
  invocation: 'cli' | 'api';
  agent: AgentType; // Which coding agent CLI to use
  notifications: {
    toast: boolean;
  };
  enabled: boolean;
  instructions: string; // Markdown content
  /** Task IDs this task depends on (DAG chaining) */
  dependsOn?: string[];
  /** Per-task retry policy (overrides defaults) */
  retry?: Partial<RetryPolicy>;
  /** Custom variables for template resolution */
  variables?: Record<string, string>;
  /** Execution timeout in minutes (default: 60) */
  timeout?: number;
}

// ── Logging ─────────────────────────────────────────────────────────────────

export interface TaskLog {
  taskId: string;
  executionId: string;
  timestamp: string;
  status: 'success' | 'failure' | 'running';
  steps: LogStep[];
  signature?: string;
}

export interface LogStep {
  timestamp: string;
  action: string;
  output?: string;
  error?: string;
}

export interface LoggerConfig {
  secretKey: string;
}

// ── Execution ───────────────────────────────────────────────────────────────

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  steps: LogStep[];
}

export interface ExecuteTaskResult {
  success: boolean;
  logPath?: string;
  error?: string;
}

/** Options for executeTask() */
export interface ExecuteTaskOptions {
  agentPath?: string;
  runId?: string;
  /** If true, validate everything but don't actually execute */
  dryRun?: boolean;
  /** Override attempt number (for template variables) */
  attempt?: number;
  /** Chain ID if triggered by a dependency */
  chainId?: string;
  /** Task ID that triggered this execution */
  triggeredBy?: string;
}

// ── Dry-Run ─────────────────────────────────────────────────────────────────

export interface DryRunResult {
  taskId: string;
  valid: boolean;
  checks: DryRunCheck[];
  resolvedInstructions?: string;
}

export interface DryRunCheck {
  name: string;
  passed: boolean;
  detail: string;
}

// ── Configuration ───────────────────────────────────────────────────────────

export interface Config {
  secretKey: string;
  version: string;
  tasksDirs: string[];
  logsDir: string;
  /** Maximum number of concurrent task executions (default: 2) */
  maxConcurrency: number;
  /** Global custom variables for template resolution */
  variables?: Record<string, string>;
}

// ── Run Records ─────────────────────────────────────────────────────────────

export interface RunRecord {
  runId: string;
  taskId: string;
  startedAt: string;
  finishedAt?: string;
  status: 'queued' | 'running' | 'success' | 'failure';
  /** PID of the executor process (for liveness checks) */
  pid?: number;
  error?: string;
  logPath?: string;
  /** How this run was triggered */
  triggerType?: 'schedule' | 'manual' | 'dependency' | 'retry';
  /** Task ID that triggered this run (for dependency chains) */
  triggeredBy?: string;
  /** Chain execution ID (groups related dependency runs) */
  chainId?: string;
  /** Retry attempt number (1-based) */
  attempt?: number;
}

// ── Monitoring ──────────────────────────────────────────────────────────────

export interface SystemSnapshot {
  timestamp: string;
  version: string;
  config: {
    tasksDirs: string[];
    logsDir: string;
    maxConcurrency: number;
  };
  tasks: TaskSnapshot[];
  concurrency: {
    running: number;
    queued: number;
    maxConcurrency: number;
  };
  recentLogs: LogSummary[];
}

export interface TaskSnapshot {
  id: string;
  schedule: string;
  invocation: string;
  agent: string;
  enabled: boolean;
  dependsOn?: string[];
  latestRun?: {
    runId: string;
    status: string;
    startedAt: string;
    finishedAt?: string;
    elapsed: number;
  };
  schedulerStatus?: {
    registered: boolean;
    enabled: boolean;
    nextRunTime?: string;
    lastRunTime?: string;
  };
}

export interface LogSummary {
  fileName: string;
  taskId: string;
  status: string;
  timestamp: string;
}
