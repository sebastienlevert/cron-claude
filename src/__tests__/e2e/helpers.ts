/**
 * Shared test infrastructure for E2E / boundary integration tests.
 *
 * Strategy:
 *   - Real file-based modules: tasks, runs, logger, config, concurrency
 *   - Mocked OS boundaries: child_process (scheduler/agent), fetch (API), node-notifier (toast)
 *   - Temp directories for all file I/O so tests are isolated
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { vi } from 'vitest';
import type { Config } from '../../types.js';

// ─── Temp directory management ──────────────────────────────────────────────

export interface TestDirs {
  root: string;
  configDir: string;
  tasksDir: string;
  logsDir: string;
  runsDir: string;
  configFile: string;
}

/**
 * Create a fresh, isolated temp directory tree for one test run.
 */
export function createTestDirs(): TestDirs {
  const root = mkdtempSync(join(tmpdir(), 'cron-agents-e2e-'));
  const configDir = join(root, '.cron-agents');
  const tasksDir = join(configDir, 'tasks');
  const logsDir = join(configDir, 'logs');
  const runsDir = join(configDir, 'runs');
  const configFile = join(configDir, 'config.json');

  mkdirSync(configDir, { recursive: true });
  mkdirSync(tasksDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });

  return { root, configDir, tasksDir, logsDir, runsDir, configFile };
}

/**
 * Remove the temp directory tree.
 */
export function cleanupTestDirs(dirs: TestDirs): void {
  try {
    rmSync(dirs.root, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/**
 * Write a cron-agents config.json into the test config dir.
 */
export function writeTestConfig(dirs: TestDirs, overrides: Partial<Config> = {}): Config {
  const config: Config = {
    secretKey: 'e2e-test-secret-key-0123456789abcdef0123456789abcdef',
    version: '0.1.0',
    tasksDirs: [dirs.tasksDir],
    logsDir: dirs.logsDir,
    maxConcurrency: 2,
    ...overrides,
  };
  writeFileSync(dirs.configFile, JSON.stringify(config, null, 2), 'utf-8');
  return config;
}

/**
 * Read the current config from disk.
 */
export function readTestConfig(dirs: TestDirs): Config {
  return JSON.parse(readFileSync(dirs.configFile, 'utf-8'));
}

// ─── Task file helpers ──────────────────────────────────────────────────────

export interface TaskFileOptions {
  id: string;
  schedule?: string;
  invocation?: 'cli' | 'api';
  agent?: 'claude' | 'copilot';
  toast?: boolean;
  enabled?: boolean;
  instructions?: string;
}

/**
 * Write a task markdown file into a directory.
 */
export function writeTaskFile(dir: string, opts: TaskFileOptions): string {
  const {
    id,
    schedule = '0 9 * * *',
    invocation = 'cli',
    agent = 'claude',
    toast = true,
    enabled = true,
    instructions = '# Test Task\n\nDo something useful.\n',
  } = opts;

  const content = `---
id: ${id}
schedule: "${schedule}"
invocation: ${invocation}
agent: ${agent}
notifications:
  toast: ${toast}
enabled: ${enabled}
---

${instructions}
`;
  const filePath = join(dir, `${id}.md`);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ─── Run record helpers ─────────────────────────────────────────────────────

export interface RunFileOptions {
  runId: string;
  taskId: string;
  status?: 'queued' | 'running' | 'success' | 'failure';
  startedAt?: string;
  finishedAt?: string;
  pid?: number;
  error?: string;
  logPath?: string;
}

/**
 * Write a run record JSON file into the runs directory.
 */
export function writeRunFile(runsDir: string, opts: RunFileOptions): string {
  const record = {
    runId: opts.runId,
    taskId: opts.taskId,
    status: opts.status || 'running',
    startedAt: opts.startedAt || new Date().toISOString(),
    finishedAt: opts.finishedAt,
    pid: opts.pid || process.pid,
    error: opts.error,
    logPath: opts.logPath,
  };
  const filePath = join(runsDir, `${opts.runId}.json`);
  writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
  return filePath;
}

// ─── Fake PowerShell output builders ────────────────────────────────────────

/**
 * Build a fake JSON response matching getTaskStatus() parsing.
 */
export function fakePsTaskStatusJson(state: string, lastRun?: string, nextRun?: string): string {
  return JSON.stringify({
    State: state,
    LastRunTime: lastRun || '/Date(0)/',
    NextRunTime: nextRun || '/Date(1735689600000)/',
  });
}

/**
 * Build a fake "task registered" stdout message.
 */
export function fakePsRegisterOutput(taskName: string, triggerType: string, time: string): string {
  return `Task registered: ${taskName} (${triggerType} at ${time})`;
}

/**
 * Build a fake Get-ScheduledTask -TaskName lookup response (just the task name).
 */
export function fakePsTaskNameLookup(taskName: string): string {
  return taskName;
}

// ─── child_process mock utilities ───────────────────────────────────────────

export interface ExecCall {
  command: string;
  options?: any;
}

export interface SpawnCall {
  command: string;
  args: string[];
  options?: any;
}

/**
 * Create a mock for child_process.exec/execSync that records calls
 * and returns configurable responses.
 */
export function createExecMock() {
  const calls: ExecCall[] = [];
  const responses = new Map<string | RegExp, { stdout?: string; stderr?: string; error?: Error }>();

  function setResponse(pattern: string | RegExp, response: { stdout?: string; stderr?: string; error?: Error }) {
    responses.set(pattern, response);
  }

  function findResponse(command: string) {
    for (const [pattern, response] of responses) {
      if (typeof pattern === 'string') {
        if (command.includes(pattern)) return response;
      } else {
        if (pattern.test(command)) return response;
      }
    }
    return null;
  }

  // Mock for execAsync (promisified exec)
  const execFn = vi.fn((command: string, options?: any, callback?: Function) => {
    calls.push({ command, options });
    const response = findResponse(command);

    // Handle both callback and promisified styles
    if (callback) {
      if (response?.error) {
        callback(response.error, '', response.error.message);
      } else {
        callback(null, response?.stdout || '', response?.stderr || '');
      }
      return;
    }

    // Return promise-like for promisified usage
    if (response?.error) {
      return Promise.reject(response.error);
    }
    return Promise.resolve({ stdout: response?.stdout || '', stderr: response?.stderr || '' });
  });

  // Mock for execSync
  const execSyncFn = vi.fn((command: string, options?: any) => {
    calls.push({ command, options });
    const response = findResponse(command);
    if (response?.error) throw response.error;
    return response?.stdout || '';
  });

  return {
    calls,
    exec: execFn,
    execSync: execSyncFn,
    setResponse,
    reset() {
      calls.length = 0;
      responses.clear();
      execFn.mockClear();
      execSyncFn.mockClear();
    },
  };
}

/**
 * Create a mock for child_process.spawn that simulates process execution.
 */
export function createSpawnMock() {
  const calls: SpawnCall[] = [];
  let exitCode = 0;
  let stdoutData = '';
  let stderrData = '';
  let shouldError = false;
  let errorMessage = '';

  const spawnFn = vi.fn((command: string, args: string[], options?: any) => {
    calls.push({ command, args, options });

    const stdoutListeners: Function[] = [];
    const stderrListeners: Function[] = [];
    const closeListeners: Function[] = [];
    const errorListeners: Function[] = [];

    const process = {
      stdout: {
        on: vi.fn((event: string, listener: Function) => {
          if (event === 'data') stdoutListeners.push(listener);
        }),
      },
      stderr: {
        on: vi.fn((event: string, listener: Function) => {
          if (event === 'data') stderrListeners.push(listener);
        }),
      },
      on: vi.fn((event: string, listener: Function) => {
        if (event === 'close') closeListeners.push(listener);
        if (event === 'error') errorListeners.push(listener);
      }),
      kill: vi.fn(),
      pid: 12345,
    };

    // Simulate async process execution
    setTimeout(() => {
      if (shouldError) {
        errorListeners.forEach(l => l(new Error(errorMessage)));
      } else {
        if (stdoutData) stdoutListeners.forEach(l => l(Buffer.from(stdoutData)));
        if (stderrData) stderrListeners.forEach(l => l(Buffer.from(stderrData)));
        closeListeners.forEach(l => l(exitCode));
      }
    }, 10);

    return process;
  });

  return {
    calls,
    spawn: spawnFn,
    setResult(opts: { exitCode?: number; stdout?: string; stderr?: string; error?: string }) {
      exitCode = opts.exitCode ?? 0;
      stdoutData = opts.stdout || '';
      stderrData = opts.stderr || '';
      shouldError = !!opts.error;
      errorMessage = opts.error || '';
    },
    reset() {
      calls.length = 0;
      exitCode = 0;
      stdoutData = '';
      stderrData = '';
      shouldError = false;
      errorMessage = '';
      spawnFn.mockClear();
    },
  };
}

// ─── Fetch mock ─────────────────────────────────────────────────────────────

export interface FetchCall {
  url: string;
  options: any;
}

export function createFetchMock() {
  const calls: FetchCall[] = [];
  let responseBody: any = { content: [{ text: 'API response' }] };
  let responseStatus = 200;
  let shouldFail = false;

  const fetchFn = vi.fn(async (url: string, options: any) => {
    calls.push({ url, options });

    if (shouldFail) {
      return {
        ok: false,
        status: responseStatus,
        text: async () => 'API error',
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => responseBody,
    };
  });

  return {
    calls,
    fetch: fetchFn,
    setResponse(body: any, status = 200) {
      responseBody = body;
      responseStatus = status;
      shouldFail = status >= 400;
    },
    setError(status = 500) {
      shouldFail = true;
      responseStatus = status;
    },
    reset() {
      calls.length = 0;
      responseBody = { content: [{ text: 'API response' }] };
      responseStatus = 200;
      shouldFail = false;
      fetchFn.mockClear();
    },
  };
}

// ─── Notification mock ──────────────────────────────────────────────────────

export interface NotificationCall {
  title: string;
  message: string;
  openPath?: string;
}

export function createNotifierMock() {
  const calls: NotificationCall[] = [];

  return {
    calls,
    notify: vi.fn((opts: any, callback?: Function) => {
      calls.push({
        title: opts.title,
        message: opts.message,
        openPath: opts.open,
      });
      if (callback) callback(null, 'activated');
    }),
    reset() {
      calls.length = 0;
    },
  };
}

// ─── Log file helpers ───────────────────────────────────────────────────────

/**
 * Write a fake signed log file.
 */
export function writeFakeLogFile(
  logsDir: string,
  taskId: string,
  opts: { status?: string; executionId?: string; timestamp?: string } = {},
): string {
  const { createHmac } = require('crypto');
  const status = opts.status || 'success';
  const executionId = opts.executionId || `exec-${Date.now()}`;
  const timestamp = opts.timestamp || new Date().toISOString();

  const content = `# Task Execution Log: ${taskId}

**Execution ID:** ${executionId}
**Status:** ${status}
**Started:** ${timestamp}

## Execution Steps

### Step 1: Task execution started
**Time:** ${timestamp}

## Summary
Total steps: 1
Status: ${status}
`;

  const secretKey = 'e2e-test-secret-key-0123456789abcdef0123456789abcdef';
  const hmac = createHmac('sha256', secretKey);
  hmac.update(content);
  const signature = hmac.digest('hex');

  const fullContent = `---
category: cron-task
taskId: ${taskId}
executionId: ${executionId}
timestamp: '${timestamp}'
status: ${status}
signature: ${signature}
---
${content}`;

  const safeTimestamp = timestamp.replace(/[:.]/g, '-');
  const filename = `${taskId}_${safeTimestamp}_${executionId}.md`;
  const filePath = join(logsDir, filename);
  writeFileSync(filePath, fullContent, 'utf-8');
  return filePath;
}
