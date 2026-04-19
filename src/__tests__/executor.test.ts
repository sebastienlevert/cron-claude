import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ---------------------------------------------------------------------------
// Test-scoped directories
// ---------------------------------------------------------------------------
let testDir: string;
let tasksDir: string;

// ---------------------------------------------------------------------------
// Mocks — must be declared at module scope (before imports of SUT)
// ---------------------------------------------------------------------------

// child_process
const spawnMock = vi.fn();
vi.mock('child_process', () => ({ spawn: spawnMock }));

// logger
const createLogMock = vi.fn(() => ({
  taskId: 'test',
  executionId: 'exec-1',
  timestamp: new Date().toISOString(),
  status: 'running' as const,
  steps: [],
}));
const addLogStepMock = vi.fn();
const finalizeLogMock = vi.fn(() => '/fake/log/path.md');
vi.mock('../logger.js', () => ({
  createLog: createLogMock,
  addLogStep: addLogStepMock,
  finalizeLog: finalizeLogMock,
}));

// notifier
const sendNotificationMock = vi.fn(async () => {});
vi.mock('../notifier.js', () => ({ sendNotification: sendNotificationMock }));

// agents
const getAgentConfigMock = vi.fn(() => ({
  name: 'claude',
  displayName: 'Claude Code',
  executables: ['claude'],
  printArgs: ['--print', '--dangerously-skip-permissions'],
  inputMode: 'file' as const,
  pathEnvVar: 'CLAUDE_CODE_PATH',
  description: 'Claude Code',
}));
const detectAgentPathMock = vi.fn(() => 'claude');
const getDefaultAgentMock = vi.fn(() => 'claude');
vi.mock('../agents.js', () => ({
  getAgentConfig: getAgentConfigMock,
  detectAgentPath: detectAgentPathMock,
  getDefaultAgent: getDefaultAgentMock,
}));

// concurrency
const tryAcquireSlotMock = vi.fn(async () => ({
  acquired: true,
  runningCount: 0,
  maxConcurrency: 2,
}));
const waitForSlotMock = vi.fn(async () => {});
vi.mock('../concurrency.js', () => ({
  tryAcquireSlot: tryAcquireSlotMock,
  waitForSlot: waitForSlotMock,
}));

// runs
const createRunMock = vi.fn(() => ({
  runId: 'run-1',
  taskId: 'test',
  status: 'running',
  startedAt: new Date().toISOString(),
}));
const updateRunMock = vi.fn();
vi.mock('../runs.js', () => ({
  createRun: createRunMock,
  updateRun: updateRunMock,
}));

// chains — stub out to avoid transitive imports of tasks/runs at module level
vi.mock('../chains.js', () => ({
  triggerDependents: vi.fn(async () => {}),
  areDependenciesMet: vi.fn(() => true),
  validateDAG: vi.fn(() => ({ valid: true, errors: [] })),
}));

// template — stub out to avoid git/config side effects
vi.mock('../template.js', () => ({
  resolveVariables: vi.fn((text: string) => ({ resolved: text, warnings: [] })),
  redactForDisplay: vi.fn((text: string) => text),
  listVariables: vi.fn(() => []),
}));

// config — avoid filesystem reads
vi.mock('../config.js', () => ({
  loadConfig: vi.fn(() => ({
    secretKey: 'test-key',
    version: '0.1.0',
    tasksDir: '/tmp/tasks',
    logsDir: '/tmp/logs',
    tasksDirs: [],
    variables: {},
  })),
}));

// tasks — stub getTask/getTaskFilePath to avoid filesystem reads
vi.mock('../tasks.js', () => ({
  getTask: vi.fn(() => null),
  getTaskFilePath: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// Dynamic import handle
// ---------------------------------------------------------------------------
let executorModule: typeof import('../executor.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a task markdown file and return its absolute path. */
function writeTask(id: string, overrides: Record<string, unknown> = {}): string {
  const defaults: Record<string, unknown> = {
    schedule: '0 9 * * *',
    invocation: 'cli',
    agent: 'claude',
    enabled: true,
    notifications: { toast: false },
  };
  const data: Record<string, unknown> = { id, ...defaults, ...overrides };
  const lines = Object.entries(data).map(([k, v]) => {
    if (typeof v === 'object') return `${k}: ${JSON.stringify(v)}`;
    if (typeof v === 'string' && /[:#{}[\],&*?|>!%@`]/.test(String(v))) return `${k}: "${v}"`;
    return `${k}: ${v}`;
  });
  const content = `---\n${lines.join('\n')}\n---\n\n# Test task\nDo something.\n`;
  const filePath = join(tasksDir, `${id}.md`);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/** Build a fake child-process that emits close / stdout / stderr events. */
function createFakeProcess(exitCode = 0, stdout = '', stderr = '') {
  const listeners: Record<string, Function[]> = {};
  const proc = {
    stdout: {
      on: vi.fn((e: string, fn: Function) => {
        (listeners[`stdout:${e}`] ||= []).push(fn);
      }),
    },
    stderr: {
      on: vi.fn((e: string, fn: Function) => {
        (listeners[`stderr:${e}`] ||= []).push(fn);
      }),
    },
    on: vi.fn((e: string, fn: Function) => {
      (listeners[e] ||= []).push(fn);
    }),
    kill: vi.fn(),
    pid: 12345,
    _listeners: listeners,
  };
  // Emit events after a short delay so callers can register listeners
  setTimeout(() => {
    if (stdout)
      (listeners['stdout:data'] || []).forEach(fn => fn(Buffer.from(stdout)));
    if (stderr)
      (listeners['stderr:data'] || []).forEach(fn => fn(Buffer.from(stderr)));
    (listeners['close'] || []).forEach(fn => fn(exitCode));
  }, 5);
  return proc;
}

/** Build a fake process that emits an error event. */
function createErrorProcess(errorMessage: string) {
  const listeners: Record<string, Function[]> = {};
  const proc = {
    stdout: {
      on: vi.fn((e: string, fn: Function) => {
        (listeners[`stdout:${e}`] ||= []).push(fn);
      }),
    },
    stderr: {
      on: vi.fn((e: string, fn: Function) => {
        (listeners[`stderr:${e}`] ||= []).push(fn);
      }),
    },
    on: vi.fn((e: string, fn: Function) => {
      (listeners[e] ||= []).push(fn);
    }),
    kill: vi.fn(),
    pid: 12345,
    _listeners: listeners,
  };
  setTimeout(() => {
    (listeners['error'] || []).forEach(fn => fn(new Error(errorMessage)));
  }, 5);
  return proc;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'executor-test-'));
  tasksDir = join(testDir, 'tasks');
  mkdirSync(tasksDir, { recursive: true });

  vi.resetModules();

  // Reset mocks
  spawnMock.mockReset();
  createLogMock
    .mockClear()
    .mockReturnValue({
      taskId: 'test',
      executionId: 'exec-1',
      timestamp: new Date().toISOString(),
      status: 'running' as const,
      steps: [],
    });
  addLogStepMock.mockClear();
  finalizeLogMock.mockClear().mockReturnValue('/fake/log/path.md');
  sendNotificationMock.mockClear().mockResolvedValue(undefined);
  tryAcquireSlotMock
    .mockClear()
    .mockResolvedValue({ acquired: true, runningCount: 0, maxConcurrency: 2 });
  waitForSlotMock.mockClear().mockResolvedValue(undefined);
  createRunMock
    .mockClear()
    .mockReturnValue({
      runId: 'run-1',
      taskId: 'test',
      status: 'running',
      startedAt: new Date().toISOString(),
    });
  updateRunMock.mockClear();
  getAgentConfigMock.mockClear().mockReturnValue({
    name: 'claude',
    displayName: 'Claude Code',
    executables: ['claude'],
    printArgs: ['--print', '--dangerously-skip-permissions'],
    inputMode: 'file' as const,
    pathEnvVar: 'CLAUDE_CODE_PATH',
    description: 'Claude Code',
  });
  detectAgentPathMock.mockClear().mockReturnValue('claude');
  getDefaultAgentMock.mockClear().mockReturnValue('claude');

  // Stabilize retry jitter: Math.random()=0.5 → jitter factor = (0.5*2-1)=0 → no jitter
  vi.spyOn(Math, 'random').mockReturnValue(0.5);

  executorModule = await import('../executor.js');
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(testDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ===========================================================================
// parseTaskDefinition
// ===========================================================================
describe('parseTaskDefinition', () => {
  it('parses a fully specified task file', () => {
    const fp = writeTask('full', {
      schedule: '30 8 * * 1-5',
      invocation: 'api',
      agent: 'copilot',
      enabled: false,
      notifications: { toast: true },
    });
    const task = executorModule.parseTaskDefinition(fp);
    expect(task.id).toBe('full');
    expect(task.schedule).toBe('30 8 * * 1-5');
    expect(task.invocation).toBe('api');
    expect(task.agent).toBe('copilot');
    expect(task.enabled).toBe(false);
    expect(task.notifications.toast).toBe(true);
  });

  it('sets default invocation to cli', () => {
    const content = `---\nid: def-inv\nschedule: "0 9 * * *"\n---\nBody\n`;
    const fp = join(tasksDir, 'def-inv.md');
    writeFileSync(fp, content, 'utf-8');
    const task = executorModule.parseTaskDefinition(fp);
    expect(task.invocation).toBe('cli');
  });

  it('sets default agent from getDefaultAgent()', () => {
    const content = `---\nid: def-agent\nschedule: "0 9 * * *"\n---\nBody\n`;
    const fp = join(tasksDir, 'def-agent.md');
    writeFileSync(fp, content, 'utf-8');
    const task = executorModule.parseTaskDefinition(fp);
    expect(task.agent).toBe('claude');
    expect(getDefaultAgentMock).toHaveBeenCalled();
  });

  it('defaults enabled to true when not specified', () => {
    const content = `---\nid: def-enabled\nschedule: "0 9 * * *"\n---\nBody\n`;
    const fp = join(tasksDir, 'def-enabled.md');
    writeFileSync(fp, content, 'utf-8');
    const task = executorModule.parseTaskDefinition(fp);
    expect(task.enabled).toBe(true);
  });

  it('defaults enabled to true when explicitly set to true', () => {
    const fp = writeTask('en-true', { enabled: true });
    const task = executorModule.parseTaskDefinition(fp);
    expect(task.enabled).toBe(true);
  });

  it('respects enabled: false', () => {
    const fp = writeTask('en-false', { enabled: false });
    const task = executorModule.parseTaskDefinition(fp);
    expect(task.enabled).toBe(false);
  });

  it('sets default schedule when missing', () => {
    const content = `---\nid: no-sched\n---\nBody\n`;
    const fp = join(tasksDir, 'no-sched.md');
    writeFileSync(fp, content, 'utf-8');
    const task = executorModule.parseTaskDefinition(fp);
    expect(task.schedule).toBe('0 0 * * *');
  });

  it('sets id to unknown when missing', () => {
    const content = `---\nschedule: "0 9 * * *"\n---\nBody\n`;
    const fp = join(tasksDir, 'no-id.md');
    writeFileSync(fp, content, 'utf-8');
    const task = executorModule.parseTaskDefinition(fp);
    expect(task.id).toBe('unknown');
  });

  it('captures markdown instructions as content', () => {
    const fp = writeTask('content-test');
    const task = executorModule.parseTaskDefinition(fp);
    expect(task.instructions).toContain('Do something.');
  });

  it('defaults notifications to toast:false', () => {
    const content = `---\nid: no-notif\nschedule: "0 0 * * *"\n---\nBody\n`;
    const fp = join(tasksDir, 'no-notif.md');
    writeFileSync(fp, content, 'utf-8');
    const task = executorModule.parseTaskDefinition(fp);
    expect(task.notifications.toast).toBe(false);
  });

  it('preserves unknown invocation value from frontmatter', () => {
    const fp = writeTask('bad-inv', { invocation: 'magic' });
    const task = executorModule.parseTaskDefinition(fp);
    expect(task.invocation).toBe('magic');
  });
});

// ===========================================================================
// executeTask — CLI execution flow
// ===========================================================================
describe('executeTask — CLI execution', () => {
  it('succeeds with exit code 0', async () => {
    const fp = writeTask('cli-ok');
    spawnMock.mockReturnValue(createFakeProcess(0, 'All done!'));
    const result = await executorModule.executeTask(fp, undefined, 'ext-run-1');
    expect(result.success).toBe(true);
    expect(result.logPath).toBe('/fake/log/path.md');
  });

  it('fails with non-zero exit code', async () => {
    const fp = writeTask('cli-fail');
    spawnMock.mockReturnValue(createFakeProcess(1, '', 'something broke'));
    const result = await executorModule.executeTask(fp, undefined, 'ext-run-2');
    expect(result.success).toBe(false);
    expect(result.error).toContain('something broke');
  });

  it('captures stdout in log step', async () => {
    const fp = writeTask('cli-stdout');
    spawnMock.mockReturnValue(createFakeProcess(0, 'stdout-output'));
    await executorModule.executeTask(fp, undefined, 'ext-run-3');
    expect(addLogStepMock).toHaveBeenCalledWith(
      expect.anything(),
      'Agent output',
      'stdout-output',
    );
  });

  it('captures stderr in log step', async () => {
    const fp = writeTask('cli-stderr');
    spawnMock.mockReturnValue(createFakeProcess(1, '', 'err-output'));
    await executorModule.executeTask(fp, undefined, 'ext-run-4');
    expect(addLogStepMock).toHaveBeenCalledWith(
      expect.anything(),
      'Agent stderr',
      'err-output',
    );
  });

  it('handles process error event', async () => {
    const fp = writeTask('cli-err-event');
    spawnMock.mockReturnValue(createErrorProcess('ENOENT'));
    const result = await executorModule.executeTask(fp, undefined, 'ext-run-5');
    expect(result.success).toBe(false);
    expect(result.error).toContain('ENOENT');
  });

  it('passes agent CLI path when provided', async () => {
    const fp = writeTask('cli-path');
    spawnMock.mockReturnValue(createFakeProcess(0));
    await executorModule.executeTask(fp, '/custom/claude', 'ext-run-6');
    const cmd = spawnMock.mock.calls[0][0] as string;
    expect(cmd).toContain('/custom/claude');
  });

  it('spawns with shell:true and windowsHide:true', async () => {
    const fp = writeTask('spawn-opts');
    spawnMock.mockReturnValue(createFakeProcess(0));
    await executorModule.executeTask(fp, undefined, 'ext-run-7');
    const opts = spawnMock.mock.calls[0][2];
    expect(opts.shell).toBe(true);
    expect(opts.windowsHide).toBe(true);
  });

  it('creates and cleans up temp file', async () => {
    const fp = writeTask('cli-tmp');
    spawnMock.mockReturnValue(createFakeProcess(0));
    await executorModule.executeTask(fp, undefined, 'ext-run-8');
    // Should have created temp file (logged), and cleaned up (logged)
    expect(addLogStepMock).toHaveBeenCalledWith(
      expect.anything(),
      'Created temporary task file',
      expect.stringContaining('cron-agents-task-cli-tmp'),
    );
    expect(addLogStepMock).toHaveBeenCalledWith(
      expect.anything(),
      'Cleaned up temporary file',
    );
  });

  it('falls back to detected agent path when no agentPath', async () => {
    detectAgentPathMock.mockReturnValue('detected-claude');
    const fp = writeTask('detect-agent');
    spawnMock.mockReturnValue(createFakeProcess(0));
    await executorModule.executeTask(fp, undefined, 'ext-run-9');
    const cmd = spawnMock.mock.calls[0][0] as string;
    expect(cmd).toContain('detected-claude');
  });

  it('uses env var agent path when set', async () => {
    const originalEnv = process.env.CLAUDE_CODE_PATH;
    process.env.CLAUDE_CODE_PATH = '/env/claude';
    detectAgentPathMock.mockReturnValue(null);
    const fp = writeTask('env-agent');
    spawnMock.mockReturnValue(createFakeProcess(0));
    await executorModule.executeTask(fp, undefined, 'ext-run-10');
    const cmd = spawnMock.mock.calls[0][0] as string;
    expect(cmd).toContain('/env/claude');
    process.env.CLAUDE_CODE_PATH = originalEnv;
  });

  it('falls back to executable name when nothing else resolves', async () => {
    detectAgentPathMock.mockReturnValue(null);
    const originalEnv = process.env.CLAUDE_CODE_PATH;
    delete process.env.CLAUDE_CODE_PATH;
    const fp = writeTask('fallback-agent');
    spawnMock.mockReturnValue(createFakeProcess(0));
    await executorModule.executeTask(fp, undefined, 'ext-run-11');
    const cmd = spawnMock.mock.calls[0][0] as string;
    expect(cmd).toContain('claude');
    process.env.CLAUDE_CODE_PATH = originalEnv;
  });
});

// ===========================================================================
// Timeout
// ===========================================================================
describe('executeTask — CLI timeout', () => {
  it('kills process and returns failure on timeout', async () => {
    vi.useFakeTimers();
    const fp = writeTask('cli-timeout');
    // Process that never closes
    const listeners: Record<string, Function[]> = {};
    const proc = {
      stdout: { on: vi.fn((e: string, fn: Function) => { (listeners[`stdout:${e}`] ||= []).push(fn); }) },
      stderr: { on: vi.fn((e: string, fn: Function) => { (listeners[`stderr:${e}`] ||= []).push(fn); }) },
      on: vi.fn((e: string, fn: Function) => { (listeners[e] ||= []).push(fn); }),
      kill: vi.fn(),
      pid: 99,
    };
    spawnMock.mockReturnValue(proc);

    const resultPromise = executorModule.executeTask(fp, undefined, 'ext-run-to');

    // Advance past 60-min timeout
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    vi.useRealTimers();
  });
});

// ===========================================================================
// executeTask — API execution flow
// ===========================================================================
describe('executeTask — API execution', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('succeeds with valid API response', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: 'API answer' }] }),
    }) as any;
    const fp = writeTask('api-ok', { invocation: 'api' });
    const result = await executorModule.executeTask(fp, undefined, 'ext-run-api1');
    expect(result.success).toBe(true);
  });

  it('fails on HTTP error', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    }) as any;
    const fp = writeTask('api-err', { invocation: 'api' });
    const result = await executorModule.executeTask(fp, undefined, 'ext-run-api2');
    expect(result.success).toBe(false);
    expect(result.error).toContain('500');
  });

  it('fails when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fp = writeTask('api-nokey', { invocation: 'api' });
    const result = await executorModule.executeTask(fp, undefined, 'ext-run-api3');
    expect(result.success).toBe(false);
    expect(result.error).toContain('ANTHROPIC_API_KEY');
  });

  it('handles malformed JSON response gracefully', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: 'format' }),
    }) as any;
    const fp = writeTask('api-malformed', { invocation: 'api' });
    const result = await executorModule.executeTask(fp, undefined, 'ext-run-api4');
    // Succeeds but output falls back to JSON.stringify
    expect(result.success).toBe(true);
  });

  it('handles network error', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
    const fp = writeTask('api-net', { invocation: 'api' });
    const result = await executorModule.executeTask(fp, undefined, 'ext-run-api5');
    expect(result.success).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('sends correct headers to Anthropic API', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-my-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: 'ok' }] }),
    });
    globalThis.fetch = fetchMock as any;
    const fp = writeTask('api-headers', { invocation: 'api' });
    await executorModule.executeTask(fp, undefined, 'ext-run-api6');
    const callArgs = fetchMock.mock.calls[0];
    expect(callArgs[0]).toBe('https://api.anthropic.com/v1/messages');
    expect(callArgs[1].headers['x-api-key']).toBe('sk-my-key');
    expect(callArgs[1].headers['anthropic-version']).toBe('2023-06-01');
  });
});

// ===========================================================================
// Retry logic
// ===========================================================================
describe('executeTask — retry logic', () => {
  const retryableMessages = [
    'CAPIError: 429 Too Many Requests',
    "unexpected `tool_use_id` in response",
    'rate limit exceeded',
    'read ECONNRESET',
    'connect ETIMEDOUT 1.2.3.4:443',
    'socket hang up',
    '502 Bad Gateway',
    '503 Service Unavailable',
    '504 Gateway Timeout',
  ];

  retryableMessages.forEach((msg, index) => {
    it(`retries on "${msg}"`, async () => {
      vi.useFakeTimers();
      const fp = writeTask(`retry-pattern-${index}`, { invocation: 'api' });
      process.env.ANTHROPIC_API_KEY = 'sk-test';

      let callCount = 0;
      globalThis.fetch = vi.fn(async () => {
        callCount++;
        if (callCount < 3) {
          return { ok: false, status: 500, text: async () => msg } as any;
        }
        return { ok: true, json: async () => ({ content: [{ text: 'done' }] }) } as any;
      }) as any;

      const resultPromise = executorModule.executeTask(fp, undefined, `ext-retry-${callCount}`);

      // Advance through retry delays
      await vi.advanceTimersByTimeAsync(15_000);
      await vi.advanceTimersByTimeAsync(15_000);

      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(callCount).toBe(3);

      vi.useRealTimers();
      delete process.env.ANTHROPIC_API_KEY;
    });
  });

  it('does not retry non-retryable errors', async () => {
    const fp = writeTask('no-retry', { invocation: 'api' });
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Invalid request body',
    }) as any;

    const result = await executorModule.executeTask(fp, undefined, 'ext-nr-1');
    expect(result.success).toBe(false);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('gives up after MAX_RETRIES (3) attempts', async () => {
    vi.useFakeTimers();
    const fp = writeTask('max-retry', { invocation: 'api' });
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => '503 Service Unavailable',
    }) as any;

    const resultPromise = executorModule.executeTask(fp, undefined, 'ext-max-r');

    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(15_000);

    const result = await resultPromise;
    expect(result.success).toBe(false);
    // 3 attempts maximum
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('succeeds on retry attempt 2', async () => {
    vi.useFakeTimers();
    const fp = writeTask('retry2-ok', { invocation: 'api' });
    process.env.ANTHROPIC_API_KEY = 'sk-test';

    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 503, text: async () => '503 Service Unavailable' } as any;
      }
      return { ok: true, json: async () => ({ content: [{ text: 'ok' }] }) } as any;
    }) as any;

    const resultPromise = executorModule.executeTask(fp, undefined, 'ext-r2');
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(callCount).toBe(2);

    vi.useRealTimers();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('retries CLI failures with retryable stderr', async () => {
    vi.useFakeTimers();
    const fp = writeTask('cli-retry');

    let callCount = 0;
    spawnMock.mockImplementation(() => {
      callCount++;
      if (callCount < 3) {
        return createFakeProcess(1, '', 'CAPIError: 429');
      }
      return createFakeProcess(0, 'Success');
    });

    const resultPromise = executorModule.executeTask(fp, undefined, 'ext-clir');

    // Advance past createFakeProcess setTimeout(5), then retry delay, repeat
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(callCount).toBe(3);

    vi.useRealTimers();
  });
});

// ===========================================================================
// Concurrency
// ===========================================================================
describe('executeTask — concurrency', () => {
  it('runs immediately when slot is available (no external runId)', async () => {
    const fp = writeTask('conc-ok');
    spawnMock.mockReturnValue(createFakeProcess(0, 'done'));
    const result = await executorModule.executeTask(fp);
    expect(result.success).toBe(true);
    expect(tryAcquireSlotMock).toHaveBeenCalled();
    expect(createRunMock).toHaveBeenCalled();
  });

  it('queues when slot is full and waits', async () => {
    tryAcquireSlotMock.mockResolvedValueOnce({
      acquired: false,
      runningCount: 2,
      maxConcurrency: 2,
    });
    const fp = writeTask('conc-wait');
    spawnMock.mockReturnValue(createFakeProcess(0, 'done'));
    const result = await executorModule.executeTask(fp);
    expect(result.success).toBe(true);
    expect(waitForSlotMock).toHaveBeenCalled();
    expect(createRunMock).toHaveBeenCalledWith('conc-wait', 'queued');
  });

  it('returns failure when queue wait times out', async () => {
    tryAcquireSlotMock.mockResolvedValueOnce({
      acquired: false,
      runningCount: 2,
      maxConcurrency: 2,
    });
    waitForSlotMock.mockRejectedValueOnce(new Error('Queue timeout for run run-1'));
    const fp = writeTask('conc-timeout');
    spawnMock.mockReturnValue(createFakeProcess(0));
    const result = await executorModule.executeTask(fp);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Queue timeout');
  });

  it('skips concurrency when external runId is provided', async () => {
    const fp = writeTask('conc-ext');
    spawnMock.mockReturnValue(createFakeProcess(0, 'done'));
    await executorModule.executeTask(fp, undefined, 'external-run-id');
    expect(tryAcquireSlotMock).not.toHaveBeenCalled();
    expect(createRunMock).not.toHaveBeenCalled();
  });

  it('updates owned run record on success', async () => {
    const fp = writeTask('conc-update');
    spawnMock.mockReturnValue(createFakeProcess(0, 'done'));
    await executorModule.executeTask(fp);
    expect(updateRunMock).toHaveBeenCalledWith('run-1', expect.objectContaining({
      status: 'success',
      logPath: '/fake/log/path.md',
    }));
  });

  it('updates owned run record on failure', async () => {
    const fp = writeTask('conc-update-fail');
    spawnMock.mockReturnValue(createFakeProcess(1, '', 'crashed'));
    await executorModule.executeTask(fp);
    expect(updateRunMock).toHaveBeenCalledWith('run-1', expect.objectContaining({
      status: 'failure',
    }));
  });

  it('does not update run when external runId is given', async () => {
    const fp = writeTask('conc-no-update');
    spawnMock.mockReturnValue(createFakeProcess(0));
    await executorModule.executeTask(fp, undefined, 'ext-id');
    expect(updateRunMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Notifications
// ===========================================================================
describe('executeTask — notifications', () => {
  it('sends toast notification when enabled', async () => {
    const fp = writeTask('notif-on', { notifications: { toast: true } });
    spawnMock.mockReturnValue(createFakeProcess(0, 'done'));
    await executorModule.executeTask(fp, undefined, 'ext-n1');
    expect(sendNotificationMock).toHaveBeenCalled();
  });

  it('does not send notification when toast is disabled', async () => {
    const fp = writeTask('notif-off', { notifications: { toast: false } });
    spawnMock.mockReturnValue(createFakeProcess(0));
    await executorModule.executeTask(fp, undefined, 'ext-n2');
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it('notification includes success message on success', async () => {
    const fp = writeTask('notif-succ', { notifications: { toast: true } });
    spawnMock.mockReturnValue(createFakeProcess(0, 'ok'));
    await executorModule.executeTask(fp, undefined, 'ext-n3');
    const callArgs = sendNotificationMock.mock.calls[0];
    expect(callArgs[0]).toContain('completed');
  });

  it('notification includes failure message on failure', async () => {
    const fp = writeTask('notif-fail', { notifications: { toast: true } });
    spawnMock.mockReturnValue(createFakeProcess(1, '', 'crash'));
    await executorModule.executeTask(fp, undefined, 'ext-n4');
    const callArgs = sendNotificationMock.mock.calls[0];
    expect(callArgs[0]).toContain('failed');
  });

  it('does not crash when notification throws', async () => {
    sendNotificationMock.mockRejectedValueOnce(new Error('Toast failed'));
    const fp = writeTask('notif-crash', { notifications: { toast: true } });
    spawnMock.mockReturnValue(createFakeProcess(0));
    const result = await executorModule.executeTask(fp, undefined, 'ext-n5');
    // Should still succeed despite notification error
    expect(result.success).toBe(true);
  });

  it('passes log path to notification', async () => {
    const fp = writeTask('notif-logpath', { notifications: { toast: true } });
    spawnMock.mockReturnValue(createFakeProcess(0));
    await executorModule.executeTask(fp, undefined, 'ext-n6');
    const callArgs = sendNotificationMock.mock.calls[0];
    expect(callArgs[2]).toBe('/fake/log/path.md');
  });
});

// ===========================================================================
// Output truncation
// ===========================================================================
describe('executeTask — output truncation', () => {
  it('truncates stdout longer than 10000 chars', async () => {
    const longOutput = 'x'.repeat(15000);
    const fp = writeTask('trunc-stdout');
    spawnMock.mockReturnValue(createFakeProcess(0, longOutput));
    await executorModule.executeTask(fp, undefined, 'ext-trunc1');
    const stdoutCalls = addLogStepMock.mock.calls.filter(
      (c: any[]) => c[1] === 'Agent output',
    );
    expect(stdoutCalls.length).toBeGreaterThan(0);
    expect(stdoutCalls[0][2].length).toBeLessThanOrEqual(10000);
  });

  it('truncates stderr longer than 5000 chars', async () => {
    const longError = 'e'.repeat(8000);
    const fp = writeTask('trunc-stderr');
    spawnMock.mockReturnValue(createFakeProcess(1, '', longError));
    await executorModule.executeTask(fp, undefined, 'ext-trunc2');
    const stderrCalls = addLogStepMock.mock.calls.filter(
      (c: any[]) => c[1] === 'Agent stderr',
    );
    expect(stderrCalls.length).toBeGreaterThan(0);
    expect(stderrCalls[0][2].length).toBeLessThanOrEqual(5000);
  });
});

// ===========================================================================
// Agent input modes
// ===========================================================================
describe('executeTask — agent input modes', () => {
  it('file mode: passes temp file path as arg', async () => {
    getAgentConfigMock.mockReturnValue({
      name: 'claude',
      displayName: 'Claude Code',
      executables: ['claude'],
      printArgs: ['--print'],
      inputMode: 'file' as const,
      pathEnvVar: 'CLAUDE_CODE_PATH',
      description: 'Claude Code',
    });
    const fp = writeTask('mode-file');
    spawnMock.mockReturnValue(createFakeProcess(0));
    await executorModule.executeTask(fp, undefined, 'ext-mf');
    const cmd = spawnMock.mock.calls[0][0] as string;
    expect(cmd).toContain('--print');
    expect(cmd).toContain('cron-agents-task-mode-file');
  });

  it('inline mode: passes instructions text directly', async () => {
    getAgentConfigMock.mockReturnValue({
      name: 'copilot',
      displayName: 'Copilot',
      executables: ['copilot'],
      printArgs: ['-p'],
      inputMode: 'inline' as const,
      pathEnvVar: 'COPILOT_CLI_PATH',
      description: 'Copilot',
    });
    const fp = writeTask('mode-inline');
    spawnMock.mockReturnValue(createFakeProcess(0));
    await executorModule.executeTask(fp, undefined, 'ext-mi');
    const cmd = spawnMock.mock.calls[0][0] as string;
    expect(cmd).toContain('-p');
    // Should contain parts of the instructions inline
    expect(cmd).toContain('Do something');
  });

  it('file-reference mode: passes prompt referencing temp file', async () => {
    getAgentConfigMock.mockReturnValue({
      name: 'copilot',
      displayName: 'Copilot',
      executables: ['copilot'],
      printArgs: ['--yolo', '-p'],
      inputMode: 'file-reference' as const,
      pathEnvVar: 'COPILOT_CLI_PATH',
      description: 'Copilot',
    });
    const fp = writeTask('mode-fileref');
    spawnMock.mockReturnValue(createFakeProcess(0));
    await executorModule.executeTask(fp, undefined, 'ext-mfr');
    const cmd = spawnMock.mock.calls[0][0] as string;
    expect(cmd).toContain('--yolo');
    expect(cmd).toContain('Read and execute');
    expect(cmd).toContain('cron-agents-task-mode-fileref');
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================
describe('executeTask — edge cases', () => {
  it('disabled task is skipped', async () => {
    const fp = writeTask('disabled', { enabled: false });
    spawnMock.mockReturnValue(createFakeProcess(0));
    const result = await executorModule.executeTask(fp, undefined, 'ext-dis');
    expect(result.success).toBe(false);
    expect(result.error).toContain('disabled');
    // spawn should NOT be called for a disabled task
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('unknown invocation method returns error', async () => {
    const fp = writeTask('bad-invoke', { invocation: 'smoke-signal' });
    const result = await executorModule.executeTask(fp, undefined, 'ext-bad');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown method');
    expect(result.error).toContain('smoke-signal');
  });

  it('empty instructions still runs', async () => {
    const content = `---\nid: empty-inst\nschedule: "0 9 * * *"\ninvocation: cli\nagent: claude\nenabled: true\nnotifications: {"toast":false}\n---\n`;
    const fp = join(tasksDir, 'empty-inst.md');
    writeFileSync(fp, content, 'utf-8');
    spawnMock.mockReturnValue(createFakeProcess(0, 'ran fine'));
    const result = await executorModule.executeTask(fp, undefined, 'ext-empty');
    expect(result.success).toBe(true);
  });

  it('finalizeLog is called with success=true on success', async () => {
    const fp = writeTask('fin-ok');
    spawnMock.mockReturnValue(createFakeProcess(0));
    await executorModule.executeTask(fp, undefined, 'ext-fin1');
    expect(finalizeLogMock).toHaveBeenCalledWith(expect.anything(), true);
  });

  it('finalizeLog is called with success=false on failure', async () => {
    const fp = writeTask('fin-fail');
    spawnMock.mockReturnValue(createFakeProcess(1, '', 'err'));
    await executorModule.executeTask(fp, undefined, 'ext-fin2');
    expect(finalizeLogMock).toHaveBeenCalledWith(expect.anything(), false);
  });

  it('finalizeLog is called with success=false for disabled task', async () => {
    const fp = writeTask('fin-dis', { enabled: false });
    await executorModule.executeTask(fp, undefined, 'ext-fin3');
    expect(finalizeLogMock).toHaveBeenCalledWith(expect.anything(), false);
  });

  it('createLog is called with task id', async () => {
    const fp = writeTask('log-id');
    spawnMock.mockReturnValue(createFakeProcess(0));
    await executorModule.executeTask(fp, undefined, 'ext-logid');
    expect(createLogMock).toHaveBeenCalledWith('log-id');
  });

  it('logs task execution started step', async () => {
    const fp = writeTask('start-step');
    spawnMock.mockReturnValue(createFakeProcess(0));
    await executorModule.executeTask(fp, undefined, 'ext-ss');
    expect(addLogStepMock).toHaveBeenCalledWith(
      expect.anything(),
      'Task execution started',
      expect.stringContaining('start-step'),
    );
  });

  it('handles concurrent success and failure paths', async () => {
    // Success then failure in separate calls
    const fp1 = writeTask('multi1');
    spawnMock.mockReturnValueOnce(createFakeProcess(0, 'ok'));
    const r1 = await executorModule.executeTask(fp1, undefined, 'ext-m1');
    expect(r1.success).toBe(true);

    const fp2 = writeTask('multi2');
    spawnMock.mockReturnValueOnce(createFakeProcess(1, '', 'fail'));
    const r2 = await executorModule.executeTask(fp2, undefined, 'ext-m2');
    expect(r2.success).toBe(false);
  });
});

// ===========================================================================
// CLI args quoting
// ===========================================================================
describe('executeTask — CLI args quoting', () => {
  it('quotes arguments containing spaces', async () => {
    getAgentConfigMock.mockReturnValue({
      name: 'test',
      displayName: 'Test Agent',
      executables: ['test-agent'],
      printArgs: ['--flag', 'value with spaces'],
      inputMode: 'file' as const,
      pathEnvVar: 'TEST_PATH',
      description: 'Test',
    });
    const fp = writeTask('quote-test');
    spawnMock.mockReturnValue(createFakeProcess(0));
    await executorModule.executeTask(fp, undefined, 'ext-qt');
    const cmd = spawnMock.mock.calls[0][0] as string;
    expect(cmd).toContain('"value with spaces"');
  });
});

// ===========================================================================
// isRetryableError (indirectly via executeTask retry behavior)
// ===========================================================================
describe('isRetryableError pattern matching (via CLI retry)', () => {
  it('matches CAPIError with various status codes', async () => {
    vi.useFakeTimers();
    const fp = writeTask('capi-err');
    let calls = 0;
    spawnMock.mockImplementation(() => {
      calls++;
      if (calls === 1) return createFakeProcess(1, '', 'CAPIError: 400 Bad Request');
      return createFakeProcess(0, 'ok');
    });
    const p = executorModule.executeTask(fp, undefined, 'ext-ce');
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(10);
    const result = await p;
    expect(result.success).toBe(true);
    expect(calls).toBe(2);
    vi.useRealTimers();
  });

  it('matches retryable error in stdout (not just stderr)', async () => {
    vi.useFakeTimers();
    const fp = writeTask('stdout-retry');
    let calls = 0;
    spawnMock.mockImplementation(() => {
      calls++;
      if (calls === 1) return createFakeProcess(1, 'ECONNRESET in response', '');
      return createFakeProcess(0, 'ok');
    });
    const p = executorModule.executeTask(fp, undefined, 'ext-sr');
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(10);
    const result = await p;
    expect(result.success).toBe(true);
    expect(calls).toBe(2);
    vi.useRealTimers();
  });

  it('case-insensitive pattern matching', async () => {
    vi.useFakeTimers();
    const fp = writeTask('case-ins');
    let calls = 0;
    spawnMock.mockImplementation(() => {
      calls++;
      if (calls === 1) return createFakeProcess(1, '', 'RATE LIMIT hit');
      return createFakeProcess(0, 'ok');
    });
    const p = executorModule.executeTask(fp, undefined, 'ext-ci');
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(10);
    const result = await p;
    expect(result.success).toBe(true);
    vi.useRealTimers();
  });
});

// ===========================================================================
// Additional edge: spawn args structure
// ===========================================================================
describe('executeTask — spawn args structure', () => {
  it('passes empty array as second argument to spawn', async () => {
    const fp = writeTask('spawn-args');
    spawnMock.mockReturnValue(createFakeProcess(0));
    await executorModule.executeTask(fp, undefined, 'ext-sa');
    expect(spawnMock.mock.calls[0][1]).toEqual([]);
  });

  it('uses pipe stdio', async () => {
    const fp = writeTask('spawn-stdio');
    spawnMock.mockReturnValue(createFakeProcess(0));
    await executorModule.executeTask(fp, undefined, 'ext-sio');
    const opts = spawnMock.mock.calls[0][2];
    expect(opts.stdio).toBe('pipe');
  });

  it('sets detached to false', async () => {
    const fp = writeTask('spawn-det');
    spawnMock.mockReturnValue(createFakeProcess(0));
    await executorModule.executeTask(fp, undefined, 'ext-det');
    const opts = spawnMock.mock.calls[0][2];
    expect(opts.detached).toBe(false);
  });
});
