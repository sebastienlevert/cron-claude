/**
 * E2E tests for the task execution flow (executeTask).
 *
 * Strategy:
 *   - Real file-based modules: tasks, runs, logger, concurrency
 *   - Mocked OS boundaries: child_process (spawn), global.fetch (API), node-notifier (toast)
 *   - Mocked config.ts to point at temp dirs
 *   - Each test creates fresh temp directories via helpers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';

import {
  createTestDirs,
  cleanupTestDirs,
  writeTestConfig,
  writeTaskFile,
  TestDirs,
  createSpawnMock,
  createFetchMock,
  createNotifierMock,
} from './helpers.js';

// ─── Module-level mocks (hoisted by vitest) ────────────────────────────────

let dirs: TestDirs;

// Mock config.ts — always returns temp-dir-based config
vi.mock('../../config.js', () => ({
  loadConfig: () => ({
    secretKey: 'e2e-test-secret-key-0123456789abcdef0123456789abcdef',
    version: '0.1.0',
    tasksDirs: [dirs.tasksDir],
    logsDir: dirs.logsDir,
    maxConcurrency: 2,
  }),
  getConfigDir: () => dirs.configDir,
  getSecretKey: () => 'e2e-test-secret-key-0123456789abcdef0123456789abcdef',
  updateConfig: vi.fn(),
}));

// Spawn / exec mock
const spawnMock = createSpawnMock();

vi.mock('child_process', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    spawn: (...args: any[]) => spawnMock.spawn(...args),
    execSync: vi.fn((cmd: string) => {
      // detectAgentPath — pretend agents are available
      if (typeof cmd === 'string' && (cmd.startsWith('where ') || cmd.startsWith('which '))) {
        const executable = cmd.split(' ').slice(1).join(' ');
        return executable + '\n';
      }
      return '';
    }),
    exec: vi.fn(),
  };
});

// Notifier mock
const notifierMock = createNotifierMock();

vi.mock('node-notifier', () => ({
  default: {
    notify: (...args: any[]) => notifierMock.notify(...args),
  },
}));

// Fetch mock
const fetchMock = createFetchMock();
vi.stubGlobal('fetch', fetchMock.fetch);

// Now import the module under test (after mocks are set up)
const { executeTask, parseTaskDefinition } = await import('../../executor.js');
const { verifyLogFile } = await import('../../logger.js');
const { getRun, getRunsByStatus } = await import('../../runs.js');

// Save the default spawn implementation so we can restore it after retry tests
// (vi.fn.mockClear does not reset mockImplementation overrides)
const defaultSpawnImpl = spawnMock.spawn.getMockImplementation()!;

// ─── Setup / Teardown ──────────────────────────────────────────────────────

beforeEach(() => {
  dirs = createTestDirs();
  writeTestConfig(dirs);
  spawnMock.reset();
  // Restore default spawn behavior (setupRetrySpawn overrides via mockImplementation)
  spawnMock.spawn.mockImplementation(defaultSpawnImpl);
  fetchMock.reset();
  notifierMock.calls.length = 0;
  vi.clearAllMocks();
  vi.useRealTimers();

  // Ensure ANTHROPIC_API_KEY is not set by default
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  cleanupTestDirs(dirs);
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function getLogFiles(): string[] {
  if (!existsSync(dirs.logsDir)) return [];
  return readdirSync(dirs.logsDir).filter(f => f.endsWith('.md'));
}

function readLogFile(filename: string): string {
  return readFileSync(join(dirs.logsDir, filename), 'utf-8');
}

function getRunFiles(): string[] {
  if (!existsSync(dirs.runsDir)) return [];
  return readdirSync(dirs.runsDir).filter(f => f.endsWith('.json'));
}

function readRunFile(filename: string): any {
  return JSON.parse(readFileSync(join(dirs.runsDir, filename), 'utf-8'));
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. CLI execution happy path
// ═══════════════════════════════════════════════════════════════════════════

describe('CLI execution happy path', () => {
  it('should call spawn when executing a CLI task', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'cli-spawn-test' });
    spawnMock.setResult({ exitCode: 0, stdout: 'Task done' });

    await executeTask(taskPath);

    expect(spawnMock.spawn).toHaveBeenCalled();
  });

  it('should include --print --dangerously-skip-permissions for claude agent', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'claude-args', agent: 'claude' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    await executeTask(taskPath);

    const call = spawnMock.spawn.mock.calls[0];
    const command = call[0] as string;
    expect(command).toContain('--print');
    expect(command).toContain('--dangerously-skip-permissions');
  });

  it('should include --yolo -p for copilot agent', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'copilot-args', agent: 'copilot' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    await executeTask(taskPath);

    const call = spawnMock.spawn.mock.calls[0];
    const command = call[0] as string;
    expect(command).toContain('--yolo');
    expect(command).toContain('-p');
  });

  it('should return success when spawn exits with code 0', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'success-exit' });
    spawnMock.setResult({ exitCode: 0, stdout: 'All good' });

    const result = await executeTask(taskPath);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should create a log file in logsDir', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'log-creation' });
    spawnMock.setResult({ exitCode: 0, stdout: 'done' });

    const result = await executeTask(taskPath);

    expect(result.logPath).toBeDefined();
    const logs = getLogFiles();
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('log-creation');
  });

  it('should create an HMAC-signed log file that passes verification', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'signed-log' });
    spawnMock.setResult({ exitCode: 0, stdout: 'done' });

    const result = await executeTask(taskPath);

    const logContent = readFileSync(result.logPath!, 'utf-8');
    const verification = verifyLogFile(logContent);
    expect(verification.valid).toBe(true);
  });

  it('should capture stdout in log steps', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'stdout-capture' });
    spawnMock.setResult({ exitCode: 0, stdout: 'Hello from agent' });

    const result = await executeTask(taskPath);

    const logContent = readFileSync(result.logPath!, 'utf-8');
    expect(logContent).toContain('Hello from agent');
  });

  it('should capture stderr in log steps', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'stderr-capture' });
    spawnMock.setResult({ exitCode: 0, stdout: '', stderr: 'Warning: something' });

    const result = await executeTask(taskPath);

    const logContent = readFileSync(result.logPath!, 'utf-8');
    expect(logContent).toContain('Warning: something');
  });

  it('should return logPath in result', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'logpath-result' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    const result = await executeTask(taskPath);

    expect(result.logPath).toBeDefined();
    expect(result.logPath!).toContain(dirs.logsDir);
    expect(result.logPath!).toContain('logpath-result');
  });

  it('should use shell:true in spawn options', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'shell-opt' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    await executeTask(taskPath);

    const call = spawnMock.spawn.mock.calls[0];
    const options = call[2];
    expect(options.shell).toBe(true);
  });

  it('should use provided agentPath in spawn command', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'agent-path' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    await executeTask(taskPath, '/custom/agent/path');

    const call = spawnMock.spawn.mock.calls[0];
    const command = call[0] as string;
    expect(command).toContain('/custom/agent/path');
  });

  it('should write success status in log frontmatter', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'success-frontmatter' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    const result = await executeTask(taskPath);

    const logContent = readFileSync(result.logPath!, 'utf-8');
    const parsed = matter(logContent);
    expect(parsed.data.status).toBe('success');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. CLI execution errors
// ═══════════════════════════════════════════════════════════════════════════

describe('CLI execution errors', () => {
  it('should return failure when spawn exits with code 1', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'exit-1' });
    spawnMock.setResult({ exitCode: 1, stderr: 'Agent crashed' });

    const result = await executeTask(taskPath);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should return failure when spawn emits error event', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'spawn-error' });
    spawnMock.setResult({ error: 'ENOENT: command not found' });

    const result = await executeTask(taskPath);

    expect(result.success).toBe(false);
    expect(result.error).toContain('ENOENT');
  });

  it('should include stderr in error result', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'stderr-error' });
    spawnMock.setResult({ exitCode: 1, stderr: 'fatal error in agent' });

    const result = await executeTask(taskPath);

    expect(result.success).toBe(false);
    expect(result.error).toContain('fatal error in agent');
  });

  it('should skip disabled task without spawning', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'disabled-task', enabled: false });
    spawnMock.setResult({ exitCode: 0 });

    const result = await executeTask(taskPath);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Task is disabled');
    expect(spawnMock.spawn).not.toHaveBeenCalled();
  });

  it('should throw when task file does not exist', async () => {
    const fakePath = join(dirs.tasksDir, 'nonexistent.md');

    await expect(executeTask(fakePath)).rejects.toThrow();
  });

  it('should return failure for unknown invocation method', async () => {
    // Write task with unknown invocation
    const taskPath = writeTaskFile(dirs.tasksDir, {
      id: 'unknown-method',
      invocation: 'cli', // will be overwritten below
    });
    // Rewrite with a bad invocation value
    const content = readFileSync(taskPath, 'utf-8').replace('invocation: cli', 'invocation: grpc');
    const { writeFileSync } = await import('fs');
    writeFileSync(taskPath, content, 'utf-8');

    const result = await executeTask(taskPath);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown method');
  });

  it('should still create a log file on failure', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'fail-log' });
    spawnMock.setResult({ exitCode: 1, stderr: 'error' });

    const result = await executeTask(taskPath);

    expect(result.logPath).toBeDefined();
    const logContent = readFileSync(result.logPath!, 'utf-8');
    const parsed = matter(logContent);
    expect(parsed.data.status).toBe('failure');
  });

  it('should write failure status in log frontmatter', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'fail-frontmatter' });
    spawnMock.setResult({ exitCode: 2, stderr: 'bad exit' });

    const result = await executeTask(taskPath);

    const logContent = readFileSync(result.logPath!, 'utf-8');
    const parsed = matter(logContent);
    expect(parsed.data.status).toBe('failure');
  });

  it('should create log file even for disabled task', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'disabled-log', enabled: false });

    const result = await executeTask(taskPath);

    expect(result.logPath).toBeDefined();
    expect(existsSync(result.logPath!)).toBe(true);
  });

  it('should not retry non-retryable CLI errors', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'no-retry-cli' });
    spawnMock.setResult({ exitCode: 1, stderr: 'Syntax error in code' });

    const result = await executeTask(taskPath);

    expect(result.success).toBe(false);
    // spawn should only be called once (no retries)
    expect(spawnMock.spawn).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. API execution
// ═══════════════════════════════════════════════════════════════════════════

describe('API execution', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-api-key-12345';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('should call fetch with correct URL for API task', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'api-url', invocation: 'api' });
    fetchMock.setResponse({ content: [{ text: 'API output' }] });

    await executeTask(taskPath);

    expect(fetchMock.fetch).toHaveBeenCalled();
    const call = fetchMock.fetch.mock.calls[0];
    expect(call[0]).toBe('https://api.anthropic.com/v1/messages');
  });

  it('should include x-api-key header from env', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'api-key', invocation: 'api' });
    fetchMock.setResponse({ content: [{ text: 'ok' }] });

    await executeTask(taskPath);

    const call = fetchMock.fetch.mock.calls[0];
    const options = call[1];
    const headers = options.headers;
    expect(headers['x-api-key']).toBe('test-api-key-12345');
  });

  it('should return success for a successful API call', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'api-success', invocation: 'api' });
    fetchMock.setResponse({ content: [{ text: 'API result text' }] });

    const result = await executeTask(taskPath);

    expect(result.success).toBe(true);
  });

  it('should return failure for HTTP 500 API response', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'api-500', invocation: 'api' });
    fetchMock.setError(500);

    const result = await executeTask(taskPath);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should return failure when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'api-no-key', invocation: 'api' });

    const result = await executeTask(taskPath);

    expect(result.success).toBe(false);
    expect(result.error).toContain('ANTHROPIC_API_KEY');
  });

  it('should parse content[0].text from API response', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'api-parse', invocation: 'api' });
    fetchMock.setResponse({ content: [{ text: 'Parsed text content' }] });

    const result = await executeTask(taskPath);

    expect(result.success).toBe(true);
    const logContent = readFileSync(result.logPath!, 'utf-8');
    expect(logContent).toContain('Parsed text content');
  });

  it('should create a log file for API execution', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'api-log', invocation: 'api' });
    fetchMock.setResponse({ content: [{ text: 'response' }] });

    const result = await executeTask(taskPath);

    expect(result.logPath).toBeDefined();
    expect(getLogFiles().length).toBe(1);
  });

  it('should use claude-sonnet-4-5-20250929 model', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'api-model', invocation: 'api' });
    fetchMock.setResponse({ content: [{ text: 'ok' }] });

    await executeTask(taskPath);

    const call = fetchMock.fetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.model).toBe('claude-sonnet-4-5-20250929');
  });

  it('should include task instructions in API request body', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, {
      id: 'api-instructions',
      invocation: 'api',
      instructions: '# My Special Instructions\n\nDo a thing.\n',
    });
    fetchMock.setResponse({ content: [{ text: 'ok' }] });

    await executeTask(taskPath);

    const call = fetchMock.fetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.messages[0].content).toContain('My Special Instructions');
  });

  it('should not call spawn for API invocation', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'api-no-spawn', invocation: 'api' });
    fetchMock.setResponse({ content: [{ text: 'ok' }] });

    await executeTask(taskPath);

    expect(spawnMock.spawn).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Retry logic
// ═══════════════════════════════════════════════════════════════════════════

describe('Retry logic', () => {
  // Use a shared helper for retry tests — inline spawn behavior per call
  function setupRetrySpawn(results: Array<{ exitCode: number; stdout?: string; stderr?: string; error?: string }>) {
    let callIndex = 0;

    spawnMock.spawn.mockImplementation((command: string, args: string[], options?: any) => {
      const currentResult = results[Math.min(callIndex, results.length - 1)];
      callIndex++;

      const listeners: Record<string, Function[]> = {};
      const proc = {
        stdout: {
          on: vi.fn((event: string, cb: Function) => {
            (listeners[`stdout:${event}`] ??= []).push(cb);
          }),
        },
        stderr: {
          on: vi.fn((event: string, cb: Function) => {
            (listeners[`stderr:${event}`] ??= []).push(cb);
          }),
        },
        on: vi.fn((event: string, cb: Function) => {
          (listeners[event] ??= []).push(cb);
        }),
        kill: vi.fn(),
        pid: 99999,
      };

      setTimeout(() => {
        if (currentResult.error) {
          listeners['error']?.forEach(cb => cb(new Error(currentResult.error!)));
        } else {
          if (currentResult.stdout) {
            listeners['stdout:data']?.forEach(cb => cb(Buffer.from(currentResult.stdout!)));
          }
          if (currentResult.stderr) {
            listeners['stderr:data']?.forEach(cb => cb(Buffer.from(currentResult.stderr!)));
          }
          listeners['close']?.forEach(cb => cb(currentResult.exitCode));
        }
      }, 5);

      return proc;
    });
  }

  // Helper: run executeTask with fake timers, advancing past retry delays
  async function executeWithFakeTimers(taskPath: string): Promise<Awaited<ReturnType<typeof executeTask>>> {
    vi.useFakeTimers();
    const promise = executeTask(taskPath);
    // Advance timers repeatedly to cover spawn timeouts (5ms) and retry delays (15000ms)
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(16_000);
    }
    const result = await promise;
    vi.useRealTimers();
    return result;
  }

  it('should retry on CAPIError in output', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'retry-capi' });
    setupRetrySpawn([
      { exitCode: 1, stderr: 'CAPIError: 429 rate limit exceeded' },
      { exitCode: 0, stdout: 'Success on retry' },
    ]);

    const result = await executeWithFakeTimers(taskPath);

    expect(result.success).toBe(true);
    expect(spawnMock.spawn).toHaveBeenCalledTimes(2);
  });

  it('should retry on rate limit error', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'retry-rate' });
    setupRetrySpawn([
      { exitCode: 1, stderr: 'rate limit reached' },
      { exitCode: 0, stdout: 'ok after rate limit' },
    ]);

    const result = await executeWithFakeTimers(taskPath);
    expect(result.success).toBe(true);
  });

  it('should retry on ECONNRESET', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'retry-connreset' });
    setupRetrySpawn([
      { exitCode: 1, stderr: 'ECONNRESET: connection reset' },
      { exitCode: 0, stdout: 'ok' },
    ]);

    const result = await executeWithFakeTimers(taskPath);
    expect(result.success).toBe(true);
  });

  it('should retry on ETIMEDOUT', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'retry-timedout' });
    setupRetrySpawn([
      { exitCode: 1, stderr: 'ETIMEDOUT: connection timed out' },
      { exitCode: 0, stdout: 'ok' },
    ]);

    const result = await executeWithFakeTimers(taskPath);
    expect(result.success).toBe(true);
  });

  it('should retry on 502 Bad Gateway', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'retry-502' });
    setupRetrySpawn([
      { exitCode: 1, stderr: '502 Bad Gateway' },
      { exitCode: 0, stdout: 'ok' },
    ]);

    const result = await executeWithFakeTimers(taskPath);
    expect(result.success).toBe(true);
  });

  it('should retry on 503 Service Unavailable', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'retry-503' });
    setupRetrySpawn([
      { exitCode: 1, stderr: '503 Service Unavailable' },
      { exitCode: 0, stdout: 'ok' },
    ]);

    const result = await executeWithFakeTimers(taskPath);
    expect(result.success).toBe(true);
  });

  it('should retry on 504 Gateway Timeout', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'retry-504' });
    setupRetrySpawn([
      { exitCode: 1, stderr: '504 Gateway Timeout' },
      { exitCode: 0, stdout: 'ok' },
    ]);

    const result = await executeWithFakeTimers(taskPath);
    expect(result.success).toBe(true);
  });

  it('should NOT retry non-retryable errors', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'no-retry' });
    setupRetrySpawn([
      { exitCode: 1, stderr: 'Permission denied: not authorized' },
    ]);

    const result = await executeTask(taskPath);

    expect(result.success).toBe(false);
    expect(spawnMock.spawn).toHaveBeenCalledTimes(1);
  });

  it('should succeed on second attempt after transient error', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'retry-success-2nd' });
    setupRetrySpawn([
      { exitCode: 1, stderr: 'CAPIError: 429 too many requests' },
      { exitCode: 0, stdout: 'Success on attempt 2' },
    ]);

    const result = await executeWithFakeTimers(taskPath);

    expect(result.success).toBe(true);
    expect(spawnMock.spawn).toHaveBeenCalledTimes(2);
  });

  it('should fail after all 3 attempts exhausted', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'retry-exhaust' });
    setupRetrySpawn([
      { exitCode: 1, stderr: 'CAPIError: 429 rate limit' },
      { exitCode: 1, stderr: 'CAPIError: 429 rate limit' },
      { exitCode: 1, stderr: 'CAPIError: 429 rate limit' },
    ]);

    const result = await executeWithFakeTimers(taskPath);

    expect(result.success).toBe(false);
    expect(spawnMock.spawn).toHaveBeenCalledTimes(3);

    // Log should mention all attempts failed
    const logContent = readFileSync(result.logPath!, 'utf-8');
    expect(logContent).toContain('All 3 attempts failed');
  });

  it('should retry on unexpected tool_use_id error', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'retry-tooluse' });
    setupRetrySpawn([
      { exitCode: 1, stderr: 'unexpected `tool_use_id` in response' },
      { exitCode: 0, stdout: 'ok' },
    ]);

    const result = await executeWithFakeTimers(taskPath);

    expect(result.success).toBe(true);
    expect(spawnMock.spawn).toHaveBeenCalledTimes(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Concurrency integration
// ═══════════════════════════════════════════════════════════════════════════

describe('Concurrency integration', () => {
  it('should create a run record when no runId is provided', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'conc-create-run' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    await executeTask(taskPath);

    const runFiles = getRunFiles();
    expect(runFiles.length).toBeGreaterThanOrEqual(1);
  });

  it('should acquire slot when executing without runId', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'conc-slot' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    // Should complete without errors (slot acquired)
    const result = await executeTask(taskPath);
    expect(result.success).toBe(true);
  });

  it('should skip concurrency gate when runId is provided', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'conc-skip' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    // Provide explicit runId — should not create additional run record
    const result = await executeTask(taskPath, undefined, 'run-external-123');

    expect(result.success).toBe(true);
    // No run files should be created since runId was provided
    const runFiles = getRunFiles();
    expect(runFiles.length).toBe(0);
  });

  it('should update run record to success on completion', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'conc-success-update' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    await executeTask(taskPath);

    const runFiles = getRunFiles();
    expect(runFiles.length).toBeGreaterThanOrEqual(1);

    const runData = readRunFile(runFiles[0]);
    expect(runData.status).toBe('success');
  });

  it('should update run record to failure on error', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'conc-failure-update' });
    spawnMock.setResult({ exitCode: 1, stderr: 'failed' });

    await executeTask(taskPath);

    const runFiles = getRunFiles();
    expect(runFiles.length).toBeGreaterThanOrEqual(1);

    const runData = readRunFile(runFiles[0]);
    expect(runData.status).toBe('failure');
  });

  it('should include logPath in run record', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'conc-logpath' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    const result = await executeTask(taskPath);

    const runFiles = getRunFiles();
    const runData = readRunFile(runFiles[0]);
    expect(runData.logPath).toBe(result.logPath);
  });

  it('should include error in run record on failure', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'conc-run-error' });
    spawnMock.setResult({ exitCode: 1, stderr: 'agent crashed badly' });

    await executeTask(taskPath);

    const runFiles = getRunFiles();
    const runData = readRunFile(runFiles[0]);
    expect(runData.error).toBeDefined();
    expect(runData.error).toContain('agent crashed badly');
  });

  it('should include finishedAt in run record', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'conc-finished' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    await executeTask(taskPath);

    const runFiles = getRunFiles();
    const runData = readRunFile(runFiles[0]);
    expect(runData.finishedAt).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Notifications
// ═══════════════════════════════════════════════════════════════════════════

describe('Notifications', () => {
  it('should send notification when toast is enabled', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'notif-enabled', toast: true });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    await executeTask(taskPath);

    expect(notifierMock.calls.length).toBe(1);
  });

  it('should NOT send notification when toast is disabled', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'notif-disabled', toast: false });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    await executeTask(taskPath);

    expect(notifierMock.calls.length).toBe(0);
  });

  it('should include task ID in success notification', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'notif-taskid', toast: true });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    await executeTask(taskPath);

    expect(notifierMock.calls.length).toBe(1);
    expect(notifierMock.calls[0].title).toContain('notif-taskid');
  });

  it('should include error message in failure notification', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'notif-failure', toast: true });
    spawnMock.setResult({ exitCode: 1, stderr: 'something went wrong' });

    await executeTask(taskPath);

    expect(notifierMock.calls.length).toBe(1);
    expect(notifierMock.calls[0].title).toContain('failed');
    expect(notifierMock.calls[0].message).toContain('something went wrong');
  });

  it('should include Obsidian deep-link in notification', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'notif-deeplink', toast: true });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    const result = await executeTask(taskPath);

    expect(notifierMock.calls.length).toBe(1);
    expect(notifierMock.calls[0].openPath).toBeDefined();
    expect(notifierMock.calls[0].openPath).toContain('obsidian://open');
  });

  it('should not crash if notification fails', async () => {
    // Make notifier throw
    notifierMock.notify.mockImplementationOnce((_opts: any, callback?: Function) => {
      if (callback) callback(new Error('Notification failed'), '');
    });

    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'notif-crash', toast: true });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    // Should not throw
    const result = await executeTask(taskPath);
    expect(result.success).toBe(true);
  });

  it('should mention retry count in success notification when attempt > 1', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'notif-retry', toast: true });

    // Set up retry scenario
    let callCount = 0;
    spawnMock.spawn.mockImplementation((command: string, args: string[], options?: any) => {
      callCount++;
      const exitCode = callCount === 1 ? 1 : 0;
      const stderr = callCount === 1 ? 'CAPIError: 429 rate limited' : '';
      const stdout = callCount > 1 ? 'Success after retry' : '';

      const listeners: Record<string, Function[]> = {};
      const proc = {
        stdout: { on: vi.fn((event: string, cb: Function) => { (listeners[`stdout:${event}`] ??= []).push(cb); }) },
        stderr: { on: vi.fn((event: string, cb: Function) => { (listeners[`stderr:${event}`] ??= []).push(cb); }) },
        on: vi.fn((event: string, cb: Function) => { (listeners[event] ??= []).push(cb); }),
        kill: vi.fn(),
        pid: 99999,
      };

      setTimeout(() => {
        if (stdout) listeners['stdout:data']?.forEach(cb => cb(Buffer.from(stdout)));
        if (stderr) listeners['stderr:data']?.forEach(cb => cb(Buffer.from(stderr)));
        listeners['close']?.forEach(cb => cb(exitCode));
      }, 5);

      return proc;
    });

    vi.useFakeTimers();
    const promise = executeTask(taskPath);
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(16_000);
    }
    const result = await promise;
    vi.useRealTimers();

    expect(result.success).toBe(true);
    expect(notifierMock.calls.length).toBe(1);
    expect(notifierMock.calls[0].message).toContain('attempt');
  });

  it('should send notification after log is finalized', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'notif-after-log', toast: true });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    const result = await executeTask(taskPath);

    // Notification should have been called, and logPath should exist
    expect(notifierMock.calls.length).toBe(1);
    expect(result.logPath).toBeDefined();
    expect(existsSync(result.logPath!)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Path and quoting
// ═══════════════════════════════════════════════════════════════════════════

describe('Path and quoting', () => {
  it('should handle task path with spaces', async () => {
    // Create a task in a path with spaces
    const { mkdirSync, writeFileSync: writeFS } = await import('fs');
    const spacedDir = join(dirs.tasksDir, 'path with spaces');
    mkdirSync(spacedDir, { recursive: true });
    const taskPath = writeTaskFile(spacedDir, { id: 'spaced-path' });

    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    const result = await executeTask(taskPath);
    expect(result.success).toBe(true);
  });

  it('should quote agent path with spaces in spawn command', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'spaced-agent' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    await executeTask(taskPath, 'C:\\Program Files\\Agent\\cli.exe');

    const call = spawnMock.spawn.mock.calls[0];
    const command = call[0] as string;
    expect(command).toContain('C:\\Program Files\\Agent\\cli.exe');
  });

  it('should preserve special characters in instructions', async () => {
    const specialInstructions = '# Task with $pecial Ch@racters\n\nHello "world" && `code` | pipe > redirect\n';
    const taskPath = writeTaskFile(dirs.tasksDir, {
      id: 'special-chars',
      instructions: specialInstructions,
    });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    const result = await executeTask(taskPath);

    expect(result.success).toBe(true);
    // The task definition should have parsed the instructions correctly
    const task = parseTaskDefinition(taskPath);
    expect(task.instructions).toContain('$pecial');
    expect(task.instructions).toContain('Ch@racters');
  });

  it('should construct temp file path from TEMP env var', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'temp-path' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    await executeTask(taskPath);

    // The spawn command should contain the temp file reference
    const call = spawnMock.spawn.mock.calls[0];
    const command = call[0] as string;
    // For claude agent (file input mode), the command includes the temp file path
    expect(command).toContain('cron-agents-task-temp-path');
  });

  it('should use empty args array with shell command in spawn', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'spawn-args' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    await executeTask(taskPath);

    const call = spawnMock.spawn.mock.calls[0];
    const args = call[1];
    expect(args).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Log file integrity
// ═══════════════════════════════════════════════════════════════════════════

describe('Log file integrity', () => {
  it('should include taskId in log frontmatter', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'log-taskid' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    const result = await executeTask(taskPath);

    const logContent = readFileSync(result.logPath!, 'utf-8');
    const parsed = matter(logContent);
    expect(parsed.data.taskId).toBe('log-taskid');
  });

  it('should include executionId in log frontmatter', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'log-execid' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    const result = await executeTask(taskPath);

    const logContent = readFileSync(result.logPath!, 'utf-8');
    const parsed = matter(logContent);
    expect(parsed.data.executionId).toBeDefined();
    expect(parsed.data.executionId).toMatch(/^exec-/);
  });

  it('should include timestamp in log frontmatter', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'log-timestamp' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    const result = await executeTask(taskPath);

    const logContent = readFileSync(result.logPath!, 'utf-8');
    const parsed = matter(logContent);
    expect(parsed.data.timestamp).toBeDefined();
  });

  it('should include category cron-task in log frontmatter', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'log-category' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    const result = await executeTask(taskPath);

    const logContent = readFileSync(result.logPath!, 'utf-8');
    const parsed = matter(logContent);
    expect(parsed.data.category).toBe('cron-task');
  });

  it('should include HMAC signature in log frontmatter', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'log-signature' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    const result = await executeTask(taskPath);

    const logContent = readFileSync(result.logPath!, 'utf-8');
    const parsed = matter(logContent);
    expect(parsed.data.signature).toBeDefined();
    expect(typeof parsed.data.signature).toBe('string');
    expect(parsed.data.signature.length).toBe(64); // hex-encoded SHA256
  });

  it('should log execution steps in markdown content', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'log-steps' });
    spawnMock.setResult({ exitCode: 0, stdout: 'step output' });

    const result = await executeTask(taskPath);

    const logContent = readFileSync(result.logPath!, 'utf-8');
    expect(logContent).toContain('Execution Steps');
    expect(logContent).toContain('Task execution started');
  });

  it('should include task invocation method in log', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'log-method' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    const result = await executeTask(taskPath);

    const logContent = readFileSync(result.logPath!, 'utf-8');
    expect(logContent).toContain('Method: cli');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. parseTaskDefinition
// ═══════════════════════════════════════════════════════════════════════════

describe('parseTaskDefinition', () => {
  it('should parse task ID from frontmatter', () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'parse-id' });
    const task = parseTaskDefinition(taskPath);
    expect(task.id).toBe('parse-id');
  });

  it('should default invocation to cli', () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'parse-default' });
    const task = parseTaskDefinition(taskPath);
    expect(task.invocation).toBe('cli');
  });

  it('should parse agent type', () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'parse-copilot', agent: 'copilot' });
    const task = parseTaskDefinition(taskPath);
    expect(task.agent).toBe('copilot');
  });

  it('should parse enabled flag correctly', () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'parse-disabled', enabled: false });
    const task = parseTaskDefinition(taskPath);
    expect(task.enabled).toBe(false);
  });

  it('should parse instructions from markdown content', () => {
    const taskPath = writeTaskFile(dirs.tasksDir, {
      id: 'parse-instructions',
      instructions: '# Custom Instructions\n\nDo something special.\n',
    });
    const task = parseTaskDefinition(taskPath);
    expect(task.instructions).toContain('Custom Instructions');
    expect(task.instructions).toContain('Do something special');
  });

  it('should parse notifications settings', () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'parse-notif', toast: true });
    const task = parseTaskDefinition(taskPath);
    expect(task.notifications.toast).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. Agent-specific behavior
// ═══════════════════════════════════════════════════════════════════════════

describe('Agent-specific behavior', () => {
  it('should use file input mode for claude (temp file path in command)', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'claude-file-mode', agent: 'claude' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    await executeTask(taskPath);

    const call = spawnMock.spawn.mock.calls[0];
    const command = call[0] as string;
    // Claude uses 'file' input mode — command should contain temp file path
    expect(command).toContain('cron-agents-task-claude-file-mode');
  });

  it('should use file-reference input mode for copilot', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'copilot-ref-mode', agent: 'copilot' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    await executeTask(taskPath);

    const call = spawnMock.spawn.mock.calls[0];
    const command = call[0] as string;
    // Copilot uses 'file-reference' mode — command references temp file
    expect(command).toContain('Read and execute the complete instructions from this file');
  });

  it('should use windowsHide:true in spawn options', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'windows-hide' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    await executeTask(taskPath);

    const call = spawnMock.spawn.mock.calls[0];
    const options = call[2];
    expect(options.windowsHide).toBe(true);
  });

  it('should use pipe stdio in spawn options', async () => {
    const taskPath = writeTaskFile(dirs.tasksDir, { id: 'pipe-stdio' });
    spawnMock.setResult({ exitCode: 0, stdout: 'ok' });

    await executeTask(taskPath);

    const call = spawnMock.spawn.mock.calls[0];
    const options = call[2];
    expect(options.stdio).toBe('pipe');
  });
});
