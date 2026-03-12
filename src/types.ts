/**
 * Core types for cron-claude system
 */

export type AgentType = 'claude' | 'copilot';

export interface AgentConfig {
  name: string;
  displayName: string;
  /** Executable names to search for (in priority order) */
  executables: string[];
  /** CLI arguments for non-interactive print mode */
  printArgs: string[];
  /** How the agent receives task input: 'file' passes a temp file path, 'inline' passes instructions text directly */
  inputMode: 'file' | 'inline';
  /** Environment variable to override the agent path */
  pathEnvVar: string;
  /** Description shown in help text */
  description: string;
}

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
}

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

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  steps: LogStep[];
}

export interface Config {
  secretKey: string;
  version: string;
  tasksDir: string;
  logsDir: string;
}
