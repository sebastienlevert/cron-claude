import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Capture console output
// ---------------------------------------------------------------------------
let consoleLogs: string[] = [];
let consoleErrors: string[] = [];
let originalArgv: string[];

// ---------------------------------------------------------------------------
// Controllable fs mock — delegates to real fs by default
// ---------------------------------------------------------------------------
let realReaddirSync: any;
let realReadFileSync: any;
const mockReaddirSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  realReaddirSync = actual.readdirSync;
  realReadFileSync = actual.readFileSync;
  // Set initial implementations to delegate to real fs
  mockReaddirSync.mockImplementation((...args: any[]) => actual.readdirSync(...args));
  mockReadFileSync.mockImplementation((...args: any[]) => actual.readFileSync(...args));
  return {
    ...actual,
    readdirSync: (...args: any[]) => mockReaddirSync(...args),
    readFileSync: (...args: any[]) => mockReadFileSync(...args),
  };
});

// ---------------------------------------------------------------------------
// Mocks — hoisted before any imports
// ---------------------------------------------------------------------------
const mockRegisterTask = vi.fn(async () => 'Task registered');
const mockUnregisterTask = vi.fn(async () => {});
const mockEnableTask = vi.fn(async () => {});
const mockDisableTask = vi.fn(async () => {});
const mockGetTaskStatus = vi.fn(async () => ({
  exists: true,
  enabled: true,
  lastRunTime: null,
  nextRunTime: '2025-01-01 09:00:00',
}));

const mockExecuteTask = vi.fn(async () => ({
  success: true,
  logPath: '/test/logs/test.md',
}));

const mockVerifyLogFile = vi.fn(() => ({
  valid: true,
  log: { taskId: 'test', executionId: 'exec-1', status: 'success' },
}));

const mockLoadConfig = vi.fn(() => ({
  secretKey: 'test-secret',
  version: '0.1.0',
  tasksDirs: ['/test/tasks'],
  logsDir: '/test/logs',
  maxConcurrency: 2,
}));
const mockGetConfigDir = vi.fn(() => '/test/.cron-agents');

const mockCreateTask = vi.fn();
const mockGetTask = vi.fn<() => any>(() => null);
const mockListTasks = vi.fn<() => any[]>(() => []);
const mockTaskExists = vi.fn(() => false);
const mockGetTaskFilePath = vi.fn((id: string) => `/test/tasks/${id}.md`);

const mockGetSupportedAgents = vi.fn(() => ['claude', 'copilot']);
const mockGetAgentConfig = vi.fn((a: string) => ({
  name: a,
  displayName: a === 'claude' ? 'Claude Code' : 'GitHub Copilot CLI',
  executables: [a],
}));
const mockDetectAgentPath = vi.fn(() => '/usr/local/bin/claude');
const mockGetDefaultAgent = vi.fn(() => 'claude');
const mockIsValidAgent = vi.fn((a: string) => ['claude', 'copilot'].includes(a));

const mockCreateRun = vi.fn(() => ({
  runId: 'run-abc123',
  taskId: 'test',
  status: 'running',
  startedAt: '2025-01-01T09:00:00Z',
}));
const mockUpdateRun = vi.fn();
const mockGetRun = vi.fn<() => any>(() => null);
const mockGetLatestRunForTask = vi.fn<() => any>(() => null);
const mockCleanupOldRuns = vi.fn(() => 0);

const mockTryAcquireSlot = vi.fn(async () => ({
  acquired: true,
  runningCount: 0,
  maxConcurrency: 2,
}));
const mockWaitForSlot = vi.fn(async () => {});
const mockGetConcurrencyStatus = vi.fn(async () => ({
  running: 0,
  queued: 0,
  maxConcurrency: 2,
}));

vi.mock('../scheduler.js', () => ({
  registerTask: mockRegisterTask,
  unregisterTask: mockUnregisterTask,
  enableTask: mockEnableTask,
  disableTask: mockDisableTask,
  getTaskStatus: mockGetTaskStatus,
}));

vi.mock('../executor.js', () => ({
  executeTask: mockExecuteTask,
}));

vi.mock('../logger.js', () => ({
  verifyLogFile: mockVerifyLogFile,
}));

vi.mock('../config.js', () => ({
  loadConfig: mockLoadConfig,
  getConfigDir: mockGetConfigDir,
}));

vi.mock('../tasks.js', () => ({
  createTask: mockCreateTask,
  getTask: mockGetTask,
  listTasks: mockListTasks,
  taskExists: mockTaskExists,
  getTaskFilePath: mockGetTaskFilePath,
}));

vi.mock('../agents.js', () => ({
  getSupportedAgents: mockGetSupportedAgents,
  getAgentConfig: mockGetAgentConfig,
  detectAgentPath: mockDetectAgentPath,
  getDefaultAgent: mockGetDefaultAgent,
  isValidAgent: mockIsValidAgent,
}));

vi.mock('../runs.js', () => ({
  createRun: mockCreateRun,
  updateRun: mockUpdateRun,
  getRun: mockGetRun,
  getLatestRunForTask: mockGetLatestRunForTask,
  cleanupOldRuns: mockCleanupOldRuns,
  getRunningCount: vi.fn(() => 0),
  cleanupStaleRuns: vi.fn(),
  getQueuedRuns: vi.fn(() => []),
}));

vi.mock('../concurrency.js', () => ({
  tryAcquireSlot: mockTryAcquireSlot,
  waitForSlot: mockWaitForSlot,
  getConcurrencyStatus: mockGetConcurrencyStatus,
}));

// ---------------------------------------------------------------------------
// Helper: run the CLI by setting process.argv and dynamically importing
// ---------------------------------------------------------------------------
async function runCLI(...args: string[]) {
  consoleLogs = [];
  consoleErrors = [];

  // Re-apply spies (they get restored in afterEach so need fresh ones)
  vi.spyOn(console, 'log').mockImplementation((...a) => consoleLogs.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a) => consoleErrors.push(a.join(' ')));
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as any);

  // Capture process.stdout.write for Commander's --help and --version output
  const stdoutWrites: string[] = [];
  const origWrite = process.stdout.write;
  process.stdout.write = ((chunk: any, ...rest: any[]) => {
    stdoutWrites.push(String(chunk));
    return true;
  }) as any;

  process.argv = ['node', 'cli.js', ...args];
  vi.resetModules();
  try {
    await import('../cli.js');
    // Give async actions a tick to settle
    await new Promise((r) => setTimeout(r, 50));
  } catch (e: any) {
    if (!e.message?.startsWith('process.exit')) throw e;
  } finally {
    process.stdout.write = origWrite;
  }

  // Merge stdout.write output with console.log output
  const allStdout = [...stdoutWrites, ...consoleLogs].join('\n');
  return {
    stdout: allStdout,
    stderr: consoleErrors.join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Suppress unhandled rejections from process.exit throws in async Commander
// ---------------------------------------------------------------------------
const unhandledRejectionHandler = (err: unknown) => {
  if (err instanceof Error && err.message?.startsWith('process.exit')) return;
  throw err;
};

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  originalArgv = [...process.argv];
  consoleLogs = [];
  consoleErrors = [];
  process.on('unhandledRejection', unhandledRejectionHandler);

  // Clear all mock call history and reset return values
  vi.clearAllMocks();

  vi.spyOn(console, 'log').mockImplementation((...a) => consoleLogs.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a) => consoleErrors.push(a.join(' ')));
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as any);

  // Reset all mock return values to defaults
  mockGetTask.mockReturnValue(null);
  mockListTasks.mockReturnValue([]);
  mockTaskExists.mockReturnValue(false);
  mockGetRun.mockReturnValue(null);
  mockGetLatestRunForTask.mockReturnValue(null);
  mockIsValidAgent.mockImplementation((a: string) => ['claude', 'copilot'].includes(a));
  mockExecuteTask.mockResolvedValue({ success: true, logPath: '/test/logs/test.md' });
  mockTryAcquireSlot.mockResolvedValue({ acquired: true, runningCount: 0, maxConcurrency: 2 });
  mockRegisterTask.mockResolvedValue('Task registered');
  mockUnregisterTask.mockResolvedValue(undefined);
  mockEnableTask.mockResolvedValue(undefined);
  mockDisableTask.mockResolvedValue(undefined);
  mockGetTaskStatus.mockResolvedValue({
    exists: true,
    enabled: true,
    lastRunTime: null,
    nextRunTime: '2025-01-01 09:00:00',
  });
  mockGetConcurrencyStatus.mockResolvedValue({ running: 0, queued: 0, maxConcurrency: 2 });
  mockDetectAgentPath.mockReturnValue('/usr/local/bin/claude');
  mockLoadConfig.mockReturnValue({
    secretKey: 'test-secret',
    version: '0.1.0',
    tasksDirs: ['/test/tasks'],
    logsDir: '/test/logs',
    maxConcurrency: 2,
  });
  // Reset fs mocks to delegate to real fs
  mockReaddirSync.mockImplementation((...args: any[]) => realReaddirSync(...args));
  mockReadFileSync.mockImplementation((...args: any[]) => realReadFileSync(...args));
});

afterEach(() => {
  process.argv = originalArgv;
  process.removeListener('unhandledRejection', unhandledRejectionHandler);
  vi.restoreAllMocks();
});

// ===========================================================================
// CREATE command
// ===========================================================================
describe('create command', () => {
  it('creates a task with default options', async () => {
    const { stdout } = await runCLI('create', 'my-task');

    expect(mockCreateTask).toHaveBeenCalledOnce();
    const task = mockCreateTask.mock.calls[0][0];
    expect(task.id).toBe('my-task');
    expect(task.schedule).toBe('0 9 * * *');
    expect(task.agent).toBe('claude');
    expect(task.invocation).toBe('cli');
    expect(task.notifications.toast).toBe(true);
    expect(task.enabled).toBe(true);
    expect(stdout).toContain('my-task');
    expect(stdout).toContain('created');
  });

  it('creates a task with custom schedule', async () => {
    await runCLI('create', 'hourly-check', '--schedule', '0 * * * *');

    const task = mockCreateTask.mock.calls[0][0];
    expect(task.schedule).toBe('0 * * * *');
  });

  it('creates a task with copilot agent', async () => {
    await runCLI('create', 'copilot-task', '--agent', 'copilot');

    const task = mockCreateTask.mock.calls[0][0];
    expect(task.agent).toBe('copilot');
  });

  it('creates a task with api method', async () => {
    await runCLI('create', 'api-task', '--method', 'api');

    const task = mockCreateTask.mock.calls[0][0];
    expect(task.invocation).toBe('api');
  });

  it('creates a task with --no-toast', async () => {
    await runCLI('create', 'quiet-task', '--no-toast');

    const task = mockCreateTask.mock.calls[0][0];
    expect(task.notifications.toast).toBe(false);
  });

  it('creates a task with all options combined', async () => {
    await runCLI('create', 'full-task', '--schedule', '30 8 * * 1-5', '--agent', 'copilot', '--method', 'api', '--no-toast');

    const task = mockCreateTask.mock.calls[0][0];
    expect(task.id).toBe('full-task');
    expect(task.schedule).toBe('30 8 * * 1-5');
    expect(task.agent).toBe('copilot');
    expect(task.invocation).toBe('api');
    expect(task.notifications.toast).toBe(false);
  });

  it('prints file location and next steps', async () => {
    const { stdout } = await runCLI('create', 'new-task');

    expect(stdout).toContain('Location:');
    expect(stdout).toContain('Next steps:');
    expect(stdout).toContain('register');
  });

  it('exits with error for duplicate task', async () => {
    mockTaskExists.mockReturnValue(true);

    const { stderr } = await runCLI('create', 'existing-task');

    expect(stderr).toContain('already exists');
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('exits with error for invalid agent', async () => {
    mockIsValidAgent.mockReturnValue(false);

    const { stderr } = await runCLI('create', 'bad-agent', '--agent', 'gpt');

    expect(stderr).toContain('Unknown agent');
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('prints agent name in output', async () => {
    const { stdout } = await runCLI('create', 'agent-task', '--agent', 'copilot');

    expect(stdout).toContain('copilot');
  });

  it('prints schedule in output', async () => {
    const { stdout } = await runCLI('create', 'sched-task', '--schedule', '*/5 * * * *');

    expect(stdout).toContain('*/5 * * * *');
  });
});

// ===========================================================================
// LIST command
// ===========================================================================
describe('list command', () => {
  it('shows message when no tasks exist', async () => {
    mockListTasks.mockReturnValue([]);

    const { stdout } = await runCLI('list');

    expect(stdout).toContain('No tasks found');
  });

  it('lists single task with status', async () => {
    mockListTasks.mockReturnValue([
      { id: 'daily-report', schedule: '0 9 * * *', invocation: 'cli', agent: 'claude', enabled: true },
    ]);

    const { stdout } = await runCLI('list');

    expect(stdout).toContain('daily-report');
    expect(stdout).toContain('0 9 * * *');
    expect(stdout).toContain('claude');
  });

  it('lists multiple tasks', async () => {
    mockListTasks.mockReturnValue([
      { id: 'task-a', schedule: '0 8 * * *', invocation: 'cli', agent: 'claude', enabled: true },
      { id: 'task-b', schedule: '0 12 * * *', invocation: 'api', agent: 'copilot', enabled: false },
    ]);

    const { stdout } = await runCLI('list');

    expect(stdout).toContain('task-a');
    expect(stdout).toContain('task-b');
  });

  it('shows registration status from scheduler', async () => {
    mockListTasks.mockReturnValue([
      { id: 'reg-task', schedule: '0 9 * * *', invocation: 'cli', agent: 'claude', enabled: true },
    ]);
    mockGetTaskStatus.mockResolvedValue({
      exists: true,
      enabled: true,
      lastRunTime: null,
      nextRunTime: '2025-06-01 09:00:00',
    });

    const { stdout } = await runCLI('list');

    expect(stdout).toContain('Registered: ✓');
  });

  it('shows unregistered status', async () => {
    mockListTasks.mockReturnValue([
      { id: 'unreg-task', schedule: '0 9 * * *', invocation: 'cli', agent: 'claude', enabled: true },
    ]);
    mockGetTaskStatus.mockResolvedValue({
      exists: false,
      enabled: false,
      lastRunTime: null,
      nextRunTime: null,
    });

    const { stdout } = await runCLI('list');

    expect(stdout).toContain('Registered: ✗');
  });

  it('shows active running status', async () => {
    mockListTasks.mockReturnValue([
      { id: 'running-task', schedule: '0 9 * * *', invocation: 'cli', agent: 'claude', enabled: true },
    ]);
    mockGetLatestRunForTask.mockReturnValue({
      runId: 'run-1',
      taskId: 'running-task',
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    const { stdout } = await runCLI('list');

    expect(stdout).toContain('Running');
  });
});

// ===========================================================================
// GET command
// ===========================================================================
describe('get command', () => {
  it('displays task definition when found', async () => {
    mockGetTask.mockReturnValue({
      id: 'my-task',
      schedule: '0 9 * * *',
      invocation: 'cli',
      agent: 'claude',
      enabled: true,
      notifications: { toast: true },
      instructions: '# Do something\n\nRun the tests.',
    });

    const { stdout } = await runCLI('get', 'my-task');

    expect(stdout).toContain('my-task');
    expect(stdout).toContain('0 9 * * *');
    expect(stdout).toContain('claude');
    expect(stdout).toContain('Do something');
  });

  it('shows enabled status', async () => {
    mockGetTask.mockReturnValue({
      id: 'enabled-task',
      schedule: '0 9 * * *',
      invocation: 'cli',
      agent: 'claude',
      enabled: true,
      notifications: { toast: true },
      instructions: 'test',
    });

    const { stdout } = await runCLI('get', 'enabled-task');

    expect(stdout).toContain('✓');
  });

  it('shows notification info', async () => {
    mockGetTask.mockReturnValue({
      id: 'toast-task',
      schedule: '0 9 * * *',
      invocation: 'cli',
      agent: 'claude',
      enabled: true,
      notifications: { toast: true },
      instructions: 'test',
    });

    const { stdout } = await runCLI('get', 'toast-task');

    expect(stdout).toContain('Toast');
  });

  it('exits with error when task not found', async () => {
    mockGetTask.mockReturnValue(null);

    const { stderr } = await runCLI('get', 'nonexistent');

    expect(stderr).toContain('Task not found');
  });

  it('shows file path', async () => {
    mockGetTask.mockReturnValue({
      id: 'path-task',
      schedule: '0 9 * * *',
      invocation: 'cli',
      agent: 'claude',
      enabled: true,
      notifications: { toast: false },
      instructions: 'test',
    });

    const { stdout } = await runCLI('get', 'path-task');

    expect(stdout).toContain('/test/tasks/path-task.md');
  });
});

// ===========================================================================
// REGISTER command
// ===========================================================================
describe('register command', () => {
  it('registers a task successfully', async () => {
    mockGetTask.mockReturnValue({
      id: 'reg-task',
      schedule: '0 9 * * *',
      invocation: 'cli',
      agent: 'claude',
      enabled: true,
      instructions: 'test',
    });

    await runCLI('register', 'reg-task');

    expect(mockRegisterTask).toHaveBeenCalledOnce();
    expect(mockRegisterTask.mock.calls[0][0]).toBe('reg-task');
  });

  it('exits with error when task not found', async () => {
    mockGetTask.mockReturnValue(null);

    const { stderr } = await runCLI('register', 'missing');

    expect(stderr).toContain('Task not found');
    expect(mockRegisterTask).not.toHaveBeenCalled();
  });

  it('exits with error when registration fails', async () => {
    mockGetTask.mockReturnValue({
      id: 'fail-reg',
      schedule: '0 9 * * *',
      invocation: 'cli',
      agent: 'claude',
      enabled: true,
      instructions: 'test',
    });
    mockRegisterTask.mockRejectedValueOnce(new Error('Scheduler error'));

    const { stderr } = await runCLI('register', 'fail-reg');

    expect(stderr).toContain('Error registering task');
  });
});

// ===========================================================================
// UNREGISTER command
// ===========================================================================
describe('unregister command', () => {
  it('unregisters a task successfully', async () => {
    await runCLI('unregister', 'my-task');

    expect(mockUnregisterTask).toHaveBeenCalledWith('my-task');
  });

  it('exits with error when unregister fails', async () => {
    mockUnregisterTask.mockRejectedValueOnce(new Error('Not found'));

    const { stderr } = await runCLI('unregister', 'missing');

    expect(stderr).toContain('Error unregistering task');
  });
});

// ===========================================================================
// ENABLE command
// ===========================================================================
describe('enable command', () => {
  it('enables a task successfully', async () => {
    await runCLI('enable', 'my-task');

    expect(mockEnableTask).toHaveBeenCalledWith('my-task');
  });

  it('exits with error when enable fails', async () => {
    mockEnableTask.mockRejectedValueOnce(new Error('Not found'));

    const { stderr } = await runCLI('enable', 'missing');

    expect(stderr).toContain('Error enabling task');
  });
});

// ===========================================================================
// DISABLE command
// ===========================================================================
describe('disable command', () => {
  it('disables a task successfully', async () => {
    await runCLI('disable', 'my-task');

    expect(mockDisableTask).toHaveBeenCalledWith('my-task');
  });

  it('exits with error when disable fails', async () => {
    mockDisableTask.mockRejectedValueOnce(new Error('Not found'));

    const { stderr } = await runCLI('disable', 'missing');

    expect(stderr).toContain('Error disabling task');
  });
});

// ===========================================================================
// RUN command
// ===========================================================================
describe('run command', () => {
  const sampleTask = {
    id: 'run-task',
    schedule: '0 9 * * *',
    invocation: 'cli' as const,
    agent: 'claude' as const,
    enabled: true,
    notifications: { toast: true },
    instructions: 'Run tests',
  };

  it('executes a task in foreground (sync)', async () => {
    mockGetTask.mockReturnValue(sampleTask);

    const { stdout } = await runCLI('run', 'run-task');

    expect(mockExecuteTask).toHaveBeenCalled();
    expect(stdout).toContain('completed');
  });

  it('shows log path on success', async () => {
    mockGetTask.mockReturnValue(sampleTask);
    mockExecuteTask.mockResolvedValue({ success: true, logPath: '/logs/out.md' });

    const { stdout } = await runCLI('run', 'run-task');

    expect(stdout).toContain('/logs/out.md');
  });

  it('exits with error on execution failure', async () => {
    mockGetTask.mockReturnValue(sampleTask);
    mockExecuteTask.mockResolvedValue({ success: false, error: 'Tests failed' });

    const { stderr } = await runCLI('run', 'run-task');

    expect(stderr).toContain('failed');
  });

  it('runs in background with --background flag', async () => {
    mockGetTask.mockReturnValue(sampleTask);

    const { stdout } = await runCLI('run', 'run-task', '--background');

    expect(mockCreateRun).toHaveBeenCalled();
    expect(stdout).toContain('background');
    expect(stdout).toContain('run-abc123');
  });

  it('shows queued status when no slot available', async () => {
    mockGetTask.mockReturnValue(sampleTask);
    mockTryAcquireSlot.mockResolvedValue({ acquired: false, runningCount: 2, maxConcurrency: 2 });

    const { stdout } = await runCLI('run', 'run-task', '--background');

    expect(stdout).toContain('queued');
  });

  it('exits with error when task not found', async () => {
    mockGetTask.mockReturnValue(null);

    const { stderr } = await runCLI('run', 'run-task');

    expect(stderr).toContain('Task not found');
  });

  it('detects agent path for CLI tasks', async () => {
    mockGetTask.mockReturnValue(sampleTask);

    await runCLI('run', 'run-task');

    expect(mockDetectAgentPath).toHaveBeenCalledWith('claude');
  });

  it('shows run-status command hint for background runs', async () => {
    mockGetTask.mockReturnValue(sampleTask);

    const { stdout } = await runCLI('run', 'run-task', '--background');

    expect(stdout).toContain('run-status');
  });

  it('handles executor throwing error', async () => {
    mockGetTask.mockReturnValue(sampleTask);
    mockExecuteTask.mockRejectedValueOnce(new Error('Crash'));

    const { stderr } = await runCLI('run', 'run-task');

    expect(stderr).toContain('Error executing task');
  });

  it('cleans up old runs in background mode', async () => {
    mockGetTask.mockReturnValue(sampleTask);

    await runCLI('run', 'run-task', '--background');

    expect(mockCleanupOldRuns).toHaveBeenCalled();
  });
});

// ===========================================================================
// RUN-STATUS command
// ===========================================================================
describe('run-status command', () => {
  it('shows status for a specific run-id', async () => {
    mockGetRun.mockReturnValue({
      runId: 'run-xyz',
      taskId: 'my-task',
      status: 'success',
      startedAt: '2025-01-01T09:00:00Z',
      finishedAt: '2025-01-01T09:01:00Z',
      logPath: '/logs/my-task.md',
    });

    const { stdout } = await runCLI('run-status', '--run-id', 'run-xyz');

    expect(stdout).toContain('run-xyz');
    expect(stdout).toContain('my-task');
    expect(stdout).toContain('success');
  });

  it('shows status for latest run by task-id', async () => {
    mockGetLatestRunForTask.mockReturnValue({
      runId: 'run-latest',
      taskId: 'report-task',
      status: 'running',
      startedAt: '2025-01-01T09:00:00Z',
    });

    const { stdout } = await runCLI('run-status', '--task-id', 'report-task');

    expect(stdout).toContain('run-latest');
    expect(stdout).toContain('running');
  });

  it('exits with error when no run found by run-id', async () => {
    mockGetRun.mockReturnValue(null);

    const { stderr } = await runCLI('run-status', '--run-id', 'nonexistent');

    expect(stderr).toContain('No run found');
  });

  it('exits with error when no run found by task-id', async () => {
    mockGetLatestRunForTask.mockReturnValue(null);

    const { stderr } = await runCLI('run-status', '--task-id', 'no-runs');

    expect(stderr).toContain('No run found');
  });

  it('exits with error when neither option provided', async () => {
    const { stderr } = await runCLI('run-status');

    expect(stderr).toContain('Provide either');
  });

  it('exits with error when both options provided', async () => {
    const { stderr } = await runCLI('run-status', '--run-id', 'r1', '--task-id', 't1');

    expect(stderr).toContain('not both');
  });

  it('shows log path when available', async () => {
    mockGetRun.mockReturnValue({
      runId: 'run-log',
      taskId: 'task-log',
      status: 'success',
      startedAt: '2025-01-01T09:00:00Z',
      finishedAt: '2025-01-01T09:02:00Z',
      logPath: '/logs/task-log-run.md',
    });

    const { stdout } = await runCLI('run-status', '--run-id', 'run-log');

    expect(stdout).toContain('/logs/task-log-run.md');
  });

  it('shows error message for failed run', async () => {
    mockGetRun.mockReturnValue({
      runId: 'run-fail',
      taskId: 'fail-task',
      status: 'failure',
      startedAt: '2025-01-01T09:00:00Z',
      finishedAt: '2025-01-01T09:00:30Z',
      error: 'Out of memory',
    });

    const { stdout } = await runCLI('run-status', '--run-id', 'run-fail');

    expect(stdout).toContain('Out of memory');
    expect(stdout).toContain('failure');
  });

  it('shows elapsed time', async () => {
    mockGetRun.mockReturnValue({
      runId: 'run-time',
      taskId: 'time-task',
      status: 'success',
      startedAt: '2025-01-01T09:00:00Z',
      finishedAt: '2025-01-01T09:00:45Z',
    });

    const { stdout } = await runCLI('run-status', '--run-id', 'run-time');

    expect(stdout).toContain('Elapsed:');
    expect(stdout).toContain('45s');
  });
});

// ===========================================================================
// LOGS command
// ===========================================================================
describe('logs command', () => {
  it('shows message when no logs exist', async () => {
    mockReaddirSync.mockImplementation((dir: any, ...rest: any[]) => {
      if (String(dir).includes('/test/logs') || String(dir) === '/test/logs') return [];
      return (realReaddirSync as any)(dir, ...rest);
    });

    const { stdout } = await runCLI('logs', 'my-task');

    expect(stdout).toContain('No logs found');
  });

  it('displays log entries when found', async () => {
    const logContent = '---\nstatus: success\ntimestamp: 2025-01-01T09:00:00Z\n---\n# Log';
    mockReaddirSync.mockImplementation((dir: any, ...rest: any[]) => {
      if (String(dir).includes('/test/logs') || String(dir) === '/test/logs') {
        return ['my-task_2025-01-01T09-00-00_exec-1.md'];
      }
      return (realReaddirSync as any)(dir, ...rest);
    });
    mockReadFileSync.mockImplementation((p: any, ...rest: any[]) => {
      if (String(p).includes('exec-1.md')) return logContent;
      return (realReadFileSync as any)(p, ...rest);
    });

    const { stdout } = await runCLI('logs', 'my-task');

    expect(stdout).toContain('my-task');
    expect(stdout).toContain('success');
  });

  it('shows log directory path', async () => {
    const logContent = '---\nstatus: success\ntimestamp: 2025-01-01T09:00:00Z\n---\n# Log';
    mockReaddirSync.mockImplementation((dir: any, ...rest: any[]) => {
      if (String(dir).includes('/test/logs') || String(dir) === '/test/logs') {
        return ['task_2025-01-01T09-00-00_exec-1.md'];
      }
      return (realReaddirSync as any)(dir, ...rest);
    });
    mockReadFileSync.mockImplementation((p: any, ...rest: any[]) => {
      if (String(p).includes('exec-1.md')) return logContent;
      return (realReadFileSync as any)(p, ...rest);
    });

    const { stdout } = await runCLI('logs', 'task');

    expect(stdout).toContain('/test/logs');
  });

  it('shows total execution count', async () => {
    const logContent = '---\nstatus: success\ntimestamp: 2025-01-01T09:00:00Z\n---\n# Log';
    mockReaddirSync.mockImplementation((dir: any, ...rest: any[]) => {
      if (String(dir).includes('/test/logs') || String(dir) === '/test/logs') {
        return ['task_2025-01-01_exec-1.md', 'task_2025-01-02_exec-2.md', 'task_2025-01-03_exec-3.md'];
      }
      return (realReaddirSync as any)(dir, ...rest);
    });
    mockReadFileSync.mockImplementation((p: any, ...rest: any[]) => {
      if (String(p).includes('exec-')) return logContent;
      return (realReadFileSync as any)(p, ...rest);
    });

    const { stdout } = await runCLI('logs', 'task');

    expect(stdout).toContain('Total executions: 3');
  });
});

// ===========================================================================
// STATUS command
// ===========================================================================
describe('status command', () => {
  it('shows version', async () => {
    const { stdout } = await runCLI('status');

    expect(stdout).toContain('Version:');
  });

  it('shows config directory', async () => {
    const { stdout } = await runCLI('status');

    expect(stdout).toContain('/test/.cron-agents');
  });

  it('shows task directories', async () => {
    const { stdout } = await runCLI('status');

    expect(stdout).toContain('/test/tasks');
  });

  it('shows logs directory', async () => {
    const { stdout } = await runCLI('status');

    expect(stdout).toContain('/test/logs');
  });

  it('shows secret key status', async () => {
    const { stdout } = await runCLI('status');

    expect(stdout).toContain('Configured');
  });

  it('shows supported agents', async () => {
    const { stdout } = await runCLI('status');

    expect(stdout).toContain('Claude Code');
  });

  it('shows concurrency info', async () => {
    const { stdout } = await runCLI('status');

    expect(stdout).toContain('Max concurrent tasks');
    expect(stdout).toContain('2');
  });

  it('shows platform info', async () => {
    const { stdout } = await runCLI('status');

    expect(stdout).toContain('Platform:');
    expect(stdout).toContain('Node version:');
  });

  it('shows total task count', async () => {
    mockListTasks.mockReturnValue([
      { id: 't1' },
      { id: 't2' },
    ] as any);

    const { stdout } = await runCLI('status');

    expect(stdout).toContain('Total tasks: 2');
  });

  it('shows agent detection status', async () => {
    const { stdout } = await runCLI('status');

    expect(stdout).toContain('Found at');
  });
});

// ===========================================================================
// HELP and VERSION
// ===========================================================================
describe('help and version', () => {
  it('--help shows usage info', async () => {
    const { stdout } = await runCLI('--help');

    expect(stdout).toContain('cron-agents');
    expect(stdout).toContain('Manage scheduled coding agent tasks');
  });

  it('--help lists available commands', async () => {
    const { stdout } = await runCLI('--help');

    expect(stdout).toContain('create');
    expect(stdout).toContain('list');
    expect(stdout).toContain('run');
    expect(stdout).toContain('status');
  });

  it('--version shows version string', async () => {
    const { stdout } = await runCLI('--version');

    // Version output should be a semver-like string
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it('command-level --help shows command options', async () => {
    const { stdout } = await runCLI('create', '--help');

    expect(stdout).toContain('--schedule');
    expect(stdout).toContain('--agent');
    expect(stdout).toContain('--method');
  });

  it('run --help shows background option', async () => {
    const { stdout } = await runCLI('run', '--help');

    expect(stdout).toContain('--background');
  });
});

// ===========================================================================
// EDGE CASES
// ===========================================================================
describe('edge cases', () => {
  it('no arguments does not crash', async () => {
    // Commander with no args simply does nothing or shows help depending on config
    const { stdout, stderr } = await runCLI();

    // Should not have an error about unknown commands
    expect(stderr).not.toContain('Unknown command');
  });

  it('task ID with hyphens and numbers', async () => {
    await runCLI('create', 'my-task-123');

    expect(mockCreateTask).toHaveBeenCalledOnce();
    const task = mockCreateTask.mock.calls[0][0];
    expect(task.id).toBe('my-task-123');
  });

  it('long task ID is accepted', async () => {
    const longId = 'a'.repeat(100);
    await runCLI('create', longId);

    expect(mockCreateTask).toHaveBeenCalledOnce();
    const task = mockCreateTask.mock.calls[0][0];
    expect(task.id).toBe(longId);
  });

  it('get command with special characters in task-id', async () => {
    mockGetTask.mockReturnValue(null);

    const { stderr } = await runCLI('get', 'task.with.dots');

    expect(stderr).toContain('Task not found');
  });

  it('register passes correct arguments', async () => {
    mockGetTask.mockReturnValue({
      id: 'sched-task',
      schedule: '30 14 * * *',
      invocation: 'cli',
      agent: 'copilot',
      enabled: true,
      instructions: 'test',
    });

    await runCLI('register', 'sched-task');

    expect(mockRegisterTask).toHaveBeenCalledWith(
      'sched-task',
      '/test/tasks/sched-task.md',
      '30 14 * * *',
      expect.any(String),
      'copilot',
    );
  });
});
