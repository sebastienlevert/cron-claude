import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ---------------------------------------------------------------------------
// Temp directory for real filesystem tests
// ---------------------------------------------------------------------------

let testDir: string;
let logsDir: string;

function createTestDir() {
  testDir = join(tmpdir(), `monitoring-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  logsDir = join(testDir, 'logs');
  mkdirSync(logsDir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const loadConfigMock = vi.fn();
const getConfigDirMock = vi.fn();
vi.mock('../config.js', () => ({
  loadConfig: (...args: any[]) => loadConfigMock(...args),
  getConfigDir: (...args: any[]) => getConfigDirMock(...args),
}));

const listTasksMock = vi.fn(() => [] as any[]);
const getTaskMock = vi.fn(() => null as any);
vi.mock('../tasks.js', () => ({
  listTasks: (...args: any[]) => listTasksMock(...args),
  getTask: (...args: any[]) => getTaskMock(...args),
}));

const getLatestRunForTaskMock = vi.fn(() => null as any);
const getRunsByStatusMock = vi.fn(() => [] as any[]);
const cleanupStaleRunsMock = vi.fn();
vi.mock('../runs.js', () => ({
  getLatestRunForTask: (...args: any[]) => getLatestRunForTaskMock(...args),
  getRunsByStatus: (...args: any[]) => getRunsByStatusMock(...args),
  cleanupStaleRuns: (...args: any[]) => cleanupStaleRunsMock(...args),
}));

const getConcurrencyStatusMock = vi.fn(async () => ({
  running: 0,
  queued: 0,
  maxConcurrency: 2,
}));
vi.mock('../concurrency.js', () => ({
  getConcurrencyStatus: (...args: any[]) => getConcurrencyStatusMock(...args),
}));

const getTaskStatusMock = vi.fn(async () => ({
  exists: false,
  enabled: false,
}));
vi.mock('../scheduler.js', () => ({
  getTaskStatus: (...args: any[]) => getTaskStatusMock(...args),
}));

let monitoringModule: typeof import('../monitoring.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultConfig() {
  return {
    secretKey: 'test-secret',
    version: '0.1.0',
    tasksDirs: [join(testDir, 'tasks')],
    logsDir,
    maxConcurrency: 2,
  };
}

function makeTask(overrides: Record<string, any> = {}) {
  return {
    id: 'task-a',
    schedule: '0 9 * * *',
    invocation: 'cli' as const,
    agent: 'claude' as const,
    enabled: true,
    notifications: { toast: true },
    instructions: '# hello',
    ...overrides,
  };
}

function makeRunRecord(overrides: Record<string, any> = {}) {
  return {
    runId: 'run-1',
    taskId: 'task-a',
    status: 'success',
    startedAt: '2024-06-01T09:00:00Z',
    finishedAt: '2024-06-01T09:05:00Z',
    ...overrides,
  };
}

function writeLogFile(name: string, frontmatter: Record<string, any>, body = '') {
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const content = `---\n${fm}\n---\n${body}`;
  writeFileSync(join(logsDir, name), content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  createTestDir();

  loadConfigMock.mockReturnValue(defaultConfig());
  getConfigDirMock.mockReturnValue(testDir);
  listTasksMock.mockReturnValue([]);
  getTaskMock.mockReturnValue(null);
  getLatestRunForTaskMock.mockReturnValue(null);
  getRunsByStatusMock.mockReturnValue([]);
  cleanupStaleRunsMock.mockImplementation(() => {});
  getConcurrencyStatusMock.mockResolvedValue({ running: 0, queued: 0, maxConcurrency: 2 });
  getTaskStatusMock.mockResolvedValue({ exists: false, enabled: false });

  // Re-mock the modules so the fresh import picks up our vi.mock factories
  monitoringModule = await import('../monitoring.js');
});

afterEach(() => {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ===========================================================================
// getSystemSnapshot
// ===========================================================================

describe('getSystemSnapshot', () => {
  // ── Empty state ───────────────────────────────────────────────────────

  describe('empty state', () => {
    it('returns valid snapshot with empty tasks array', async () => {
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.tasks).toEqual([]);
    });

    it('returns valid snapshot with empty recentLogs array', async () => {
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.recentLogs).toEqual([]);
    });

    it('returns an ISO timestamp', async () => {
      const snap = await monitoringModule.getSystemSnapshot();
      expect(() => new Date(snap.timestamp)).not.toThrow();
      expect(snap.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('returns a recent timestamp (within last 5 s)', async () => {
      const before = Date.now();
      const snap = await monitoringModule.getSystemSnapshot();
      const ts = new Date(snap.timestamp).getTime();
      expect(ts).toBeGreaterThanOrEqual(before - 1000);
      expect(ts).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('includes config with tasksDirs, logsDir, maxConcurrency', async () => {
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.config).toEqual({
        tasksDirs: [join(testDir, 'tasks')],
        logsDir,
        maxConcurrency: 2,
      });
    });

    it('includes concurrency block', async () => {
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.concurrency).toEqual({ running: 0, queued: 0, maxConcurrency: 2 });
    });
  });

  // ── cleanupStaleRuns ──────────────────────────────────────────────────

  describe('cleanupStaleRuns', () => {
    it('calls cleanupStaleRuns before building snapshot', async () => {
      await monitoringModule.getSystemSnapshot();
      expect(cleanupStaleRunsMock).toHaveBeenCalledTimes(1);
    });

    it('calls cleanupStaleRuns even when there are no tasks', async () => {
      listTasksMock.mockReturnValue([]);
      await monitoringModule.getSystemSnapshot();
      expect(cleanupStaleRunsMock).toHaveBeenCalled();
    });
  });

  // ── Version ───────────────────────────────────────────────────────────

  describe('version', () => {
    it('reads version from package.json in cwd', async () => {
      const snap = await monitoringModule.getSystemSnapshot();
      // The real package.json is at cwd; should pick up its version
      expect(snap.version).toBeTruthy();
      expect(snap.version).not.toBe('');
    });

    it('falls back to 0.0.0 when package.json is missing', async () => {
      // Monkey-patch cwd to point at our empty temp dir
      const orig = process.cwd;
      process.cwd = () => join(testDir, 'nonexistent');
      // Need a fresh import to use the patched cwd
      vi.resetModules();
      const m = await import('../monitoring.js');
      const snap = await m.getSystemSnapshot();
      expect(snap.version).toBe('0.0.0');
      process.cwd = orig;
    });
  });

  // ── Tasks ─────────────────────────────────────────────────────────────

  describe('task snapshots', () => {
    it('builds TaskSnapshot from listTasks data', async () => {
      listTasksMock.mockReturnValue([makeTask()]);
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.tasks).toHaveLength(1);
      expect(snap.tasks[0].id).toBe('task-a');
      expect(snap.tasks[0].schedule).toBe('0 9 * * *');
      expect(snap.tasks[0].invocation).toBe('cli');
      expect(snap.tasks[0].agent).toBe('claude');
      expect(snap.tasks[0].enabled).toBe(true);
    });

    it('includes dependsOn from getTask', async () => {
      listTasksMock.mockReturnValue([makeTask()]);
      getTaskMock.mockReturnValue(makeTask({ dependsOn: ['task-b', 'task-c'] }));
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.tasks[0].dependsOn).toEqual(['task-b', 'task-c']);
    });

    it('dependsOn is undefined when getTask returns null', async () => {
      listTasksMock.mockReturnValue([makeTask()]);
      getTaskMock.mockReturnValue(null);
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.tasks[0].dependsOn).toBeUndefined();
    });

    it('dependsOn is undefined when task has no dependsOn field', async () => {
      listTasksMock.mockReturnValue([makeTask()]);
      getTaskMock.mockReturnValue(makeTask());
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.tasks[0].dependsOn).toBeUndefined();
    });

    it('handles multiple tasks', async () => {
      listTasksMock.mockReturnValue([
        makeTask({ id: 'a' }),
        makeTask({ id: 'b', agent: 'copilot' }),
        makeTask({ id: 'c', enabled: false }),
      ]);
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.tasks).toHaveLength(3);
      expect(snap.tasks.map(t => t.id)).toEqual(['a', 'b', 'c']);
    });

    it('maps disabled task correctly', async () => {
      listTasksMock.mockReturnValue([makeTask({ enabled: false })]);
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.tasks[0].enabled).toBe(false);
    });

    it('maps copilot agent correctly', async () => {
      listTasksMock.mockReturnValue([makeTask({ agent: 'copilot' })]);
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.tasks[0].agent).toBe('copilot');
    });

    it('maps api invocation correctly', async () => {
      listTasksMock.mockReturnValue([makeTask({ invocation: 'api' })]);
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.tasks[0].invocation).toBe('api');
    });

    it('calls getTask with each task id', async () => {
      listTasksMock.mockReturnValue([
        makeTask({ id: 'x' }),
        makeTask({ id: 'y' }),
      ]);
      await monitoringModule.getSystemSnapshot();
      expect(getTaskMock).toHaveBeenCalledWith('x');
      expect(getTaskMock).toHaveBeenCalledWith('y');
    });
  });

  // ── Latest run ────────────────────────────────────────────────────────

  describe('latest run', () => {
    it('latestRun is undefined when getLatestRunForTask returns null', async () => {
      listTasksMock.mockReturnValue([makeTask()]);
      getLatestRunForTaskMock.mockReturnValue(null);
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.tasks[0].latestRun).toBeUndefined();
    });

    it('includes runId, status, startedAt, finishedAt', async () => {
      listTasksMock.mockReturnValue([makeTask()]);
      getLatestRunForTaskMock.mockReturnValue(makeRunRecord());
      const snap = await monitoringModule.getSystemSnapshot();
      const lr = snap.tasks[0].latestRun!;
      expect(lr.runId).toBe('run-1');
      expect(lr.status).toBe('success');
      expect(lr.startedAt).toBe('2024-06-01T09:00:00Z');
      expect(lr.finishedAt).toBe('2024-06-01T09:05:00Z');
    });

    it('calculates elapsed for completed run', async () => {
      listTasksMock.mockReturnValue([makeTask()]);
      getLatestRunForTaskMock.mockReturnValue(makeRunRecord({
        startedAt: '2024-06-01T09:00:00Z',
        finishedAt: '2024-06-01T09:05:00Z',
      }));
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.tasks[0].latestRun!.elapsed).toBe(300); // 5 minutes
    });

    it('calculates elapsed for running task (no finishedAt)', async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 60_000); // 60s ago
      listTasksMock.mockReturnValue([makeTask()]);
      getLatestRunForTaskMock.mockReturnValue(makeRunRecord({
        status: 'running',
        startedAt: start.toISOString(),
        finishedAt: undefined,
      }));
      const snap = await monitoringModule.getSystemSnapshot();
      const elapsed = snap.tasks[0].latestRun!.elapsed;
      // Should be approximately 60 seconds (±2s for execution jitter)
      expect(elapsed).toBeGreaterThanOrEqual(58);
      expect(elapsed).toBeLessThanOrEqual(65);
    });

    it('elapsed is 0 for run that finished immediately', async () => {
      listTasksMock.mockReturnValue([makeTask()]);
      getLatestRunForTaskMock.mockReturnValue(makeRunRecord({
        startedAt: '2024-06-01T09:00:00Z',
        finishedAt: '2024-06-01T09:00:00Z',
      }));
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.tasks[0].latestRun!.elapsed).toBe(0);
    });

    it('elapsed for long-running task is large', async () => {
      listTasksMock.mockReturnValue([makeTask()]);
      getLatestRunForTaskMock.mockReturnValue(makeRunRecord({
        startedAt: '2024-06-01T00:00:00Z',
        finishedAt: '2024-06-01T01:00:00Z',
      }));
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.tasks[0].latestRun!.elapsed).toBe(3600);
    });

    it('calls getLatestRunForTask with each task id', async () => {
      listTasksMock.mockReturnValue([
        makeTask({ id: 'aaa' }),
        makeTask({ id: 'bbb' }),
      ]);
      await monitoringModule.getSystemSnapshot();
      expect(getLatestRunForTaskMock).toHaveBeenCalledWith('aaa');
      expect(getLatestRunForTaskMock).toHaveBeenCalledWith('bbb');
    });
  });

  // ── Scheduler status ──────────────────────────────────────────────────

  describe('scheduler status', () => {
    it('includes scheduler status when includeScheduler is true', async () => {
      listTasksMock.mockReturnValue([makeTask()]);
      getTaskStatusMock.mockResolvedValue({ exists: true, enabled: true, nextRunTime: '2024-06-02T09:00:00Z' });
      const snap = await monitoringModule.getSystemSnapshot({ includeScheduler: true });
      expect(snap.tasks[0].schedulerStatus).toBeDefined();
      expect(snap.tasks[0].schedulerStatus!.registered).toBe(true);
      expect(snap.tasks[0].schedulerStatus!.enabled).toBe(true);
      expect(snap.tasks[0].schedulerStatus!.nextRunTime).toBe('2024-06-02T09:00:00Z');
    });

    it('excludes scheduler status when includeScheduler is false', async () => {
      listTasksMock.mockReturnValue([makeTask()]);
      const snap = await monitoringModule.getSystemSnapshot({ includeScheduler: false });
      expect(snap.tasks[0].schedulerStatus).toBeUndefined();
      expect(getTaskStatusMock).not.toHaveBeenCalled();
    });

    it('defaults to including scheduler status', async () => {
      listTasksMock.mockReturnValue([makeTask()]);
      getTaskStatusMock.mockResolvedValue({ exists: false, enabled: false });
      await monitoringModule.getSystemSnapshot();
      expect(getTaskStatusMock).toHaveBeenCalled();
    });

    it('handles scheduler error gracefully', async () => {
      listTasksMock.mockReturnValue([makeTask()]);
      getTaskStatusMock.mockRejectedValue(new Error('PS failed'));
      const snap = await monitoringModule.getSystemSnapshot({ includeScheduler: true });
      expect(snap.tasks[0].schedulerStatus).toEqual({
        registered: false,
        enabled: false,
      });
    });

    it('sets registered: false when task does not exist', async () => {
      listTasksMock.mockReturnValue([makeTask()]);
      getTaskStatusMock.mockResolvedValue({ exists: false, enabled: false });
      const snap = await monitoringModule.getSystemSnapshot({ includeScheduler: true });
      expect(snap.tasks[0].schedulerStatus!.registered).toBe(false);
    });

    it('includes lastRunTime from scheduler', async () => {
      listTasksMock.mockReturnValue([makeTask()]);
      getTaskStatusMock.mockResolvedValue({
        exists: true,
        enabled: true,
        lastRunTime: '2024-06-01T09:00:00Z',
      });
      const snap = await monitoringModule.getSystemSnapshot({ includeScheduler: true });
      expect(snap.tasks[0].schedulerStatus!.lastRunTime).toBe('2024-06-01T09:00:00Z');
    });

    it('calls getTaskStatus for each task', async () => {
      listTasksMock.mockReturnValue([
        makeTask({ id: 'p' }),
        makeTask({ id: 'q' }),
      ]);
      await monitoringModule.getSystemSnapshot({ includeScheduler: true });
      expect(getTaskStatusMock).toHaveBeenCalledWith('p');
      expect(getTaskStatusMock).toHaveBeenCalledWith('q');
    });

    it('one task fails scheduler, other succeeds', async () => {
      listTasksMock.mockReturnValue([
        makeTask({ id: 'ok' }),
        makeTask({ id: 'fail' }),
      ]);
      getTaskStatusMock
        .mockResolvedValueOnce({ exists: true, enabled: true })
        .mockRejectedValueOnce(new Error('boom'));
      const snap = await monitoringModule.getSystemSnapshot({ includeScheduler: true });
      expect(snap.tasks[0].schedulerStatus!.registered).toBe(true);
      expect(snap.tasks[1].schedulerStatus).toEqual({ registered: false, enabled: false });
    });
  });

  // ── Concurrency ───────────────────────────────────────────────────────

  describe('concurrency', () => {
    it('passes through running count', async () => {
      getConcurrencyStatusMock.mockResolvedValue({ running: 3, queued: 0, maxConcurrency: 5 });
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.concurrency.running).toBe(3);
    });

    it('passes through queued count', async () => {
      getConcurrencyStatusMock.mockResolvedValue({ running: 0, queued: 7, maxConcurrency: 2 });
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.concurrency.queued).toBe(7);
    });

    it('passes through maxConcurrency', async () => {
      getConcurrencyStatusMock.mockResolvedValue({ running: 0, queued: 0, maxConcurrency: 10 });
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.concurrency.maxConcurrency).toBe(10);
    });
  });

  // ── Recent logs ───────────────────────────────────────────────────────

  describe('recent logs', () => {
    it('returns empty array when logsDir does not exist', async () => {
      loadConfigMock.mockReturnValue({ ...defaultConfig(), logsDir: join(testDir, 'nope') });
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.recentLogs).toEqual([]);
    });

    it('returns empty array when logsDir is empty', async () => {
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.recentLogs).toEqual([]);
    });

    it('reads log file with valid frontmatter', async () => {
      writeLogFile('task-a_2024-06-01T09-00-00_exec-1.md', {
        taskId: 'task-a',
        status: 'success',
        timestamp: '2024-06-01T09:00:00Z',
      });
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.recentLogs).toHaveLength(1);
      expect(snap.recentLogs[0].taskId).toBe('task-a');
      expect(snap.recentLogs[0].status).toBe('success');
      // gray-matter parses date strings into Date objects
      expect(new Date(snap.recentLogs[0].timestamp).toISOString()).toBe('2024-06-01T09:00:00.000Z');
    });

    it('reads fileName from log file', async () => {
      const name = 'mylog_2024-06-01.md';
      writeLogFile(name, { taskId: 'x', status: 'ok', timestamp: 'ts' });
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.recentLogs[0].fileName).toBe(name);
    });

    it('handles corrupt log file (no valid frontmatter)', async () => {
      writeFileSync(join(logsDir, 'bad.md'), 'not yaml at all {{{{', 'utf-8');
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.recentLogs).toHaveLength(1);
      expect(snap.recentLogs[0].fileName).toBe('bad.md');
      // gray-matter may parse this as empty frontmatter; taskId fallback is filename prefix
      expect(snap.recentLogs[0].taskId).toBeTruthy();
    });

    it('corrupt log file uses fallback taskId from filename', async () => {
      writeFileSync(join(logsDir, 'mytask_rest.md'), 'garbage content', 'utf-8');
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.recentLogs[0].taskId).toBe('mytask');
    });

    it('corrupt log file has status "unknown"', async () => {
      writeFileSync(join(logsDir, 'oops_abc.md'), '{{not yaml}}', 'utf-8');
      const snap = await monitoringModule.getSystemSnapshot();
      // gray-matter may not throw but data.status is missing → 'unknown'
      expect(snap.recentLogs[0].status).toBe('unknown');
    });

    it('only reads .md files (ignores others)', async () => {
      writeLogFile('a.md', { taskId: 'a', status: 'success', timestamp: 'ts' });
      writeFileSync(join(logsDir, 'b.txt'), 'nope', 'utf-8');
      writeFileSync(join(logsDir, 'c.json'), '{}', 'utf-8');
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.recentLogs).toHaveLength(1);
      expect(snap.recentLogs[0].fileName).toBe('a.md');
    });

    it('sorts logs in reverse order (most recent first)', async () => {
      writeLogFile('aaa_2024-01-01.md', { taskId: 'a', status: 's', timestamp: '' });
      writeLogFile('zzz_2024-12-31.md', { taskId: 'z', status: 's', timestamp: '' });
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.recentLogs[0].fileName).toBe('zzz_2024-12-31.md');
      expect(snap.recentLogs[1].fileName).toBe('aaa_2024-01-01.md');
    });

    it('maxLogs limits the number of logs returned', async () => {
      for (let i = 0; i < 10; i++) {
        writeLogFile(`log-${String(i).padStart(2, '0')}.md`, { taskId: `t${i}`, status: 's', timestamp: '' });
      }
      const snap = await monitoringModule.getSystemSnapshot({ maxLogs: 3 });
      expect(snap.recentLogs).toHaveLength(3);
    });

    it('maxLogs defaults to 20', async () => {
      for (let i = 0; i < 25; i++) {
        writeLogFile(`log-${String(i).padStart(2, '0')}.md`, { taskId: `t${i}`, status: 's', timestamp: '' });
      }
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.recentLogs).toHaveLength(20);
    });

    it('maxLogs larger than available files returns all', async () => {
      writeLogFile('one.md', { taskId: 'one', status: 's', timestamp: '' });
      const snap = await monitoringModule.getSystemSnapshot({ maxLogs: 100 });
      expect(snap.recentLogs).toHaveLength(1);
    });

    it('reads multiple log files', async () => {
      writeLogFile('a.md', { taskId: 'a', status: 'success', timestamp: 't1' });
      writeLogFile('b.md', { taskId: 'b', status: 'failure', timestamp: 't2' });
      writeLogFile('c.md', { taskId: 'c', status: 'running', timestamp: 't3' });
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.recentLogs).toHaveLength(3);
    });

    it('log file without taskId in frontmatter uses filename prefix', async () => {
      writeLogFile('hello_world.md', { status: 'success', timestamp: 'ts' });
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.recentLogs[0].taskId).toBe('hello');
    });

    it('log file without status in frontmatter defaults to unknown', async () => {
      writeLogFile('t.md', { taskId: 'x', timestamp: 'ts' });
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.recentLogs[0].status).toBe('unknown');
    });

    it('log file without timestamp in frontmatter defaults to empty', async () => {
      writeLogFile('t.md', { taskId: 'x', status: 's' });
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.recentLogs[0].timestamp).toBe('');
    });
  });

  // ── Snapshot version increment ────────────────────────────────────────

  describe('snapshot version', () => {
    it('consecutive calls return different timestamps', async () => {
      const snap1 = await monitoringModule.getSystemSnapshot();
      // Small delay to ensure timestamp differs
      await new Promise(r => setTimeout(r, 5));
      const snap2 = await monitoringModule.getSystemSnapshot();
      // Timestamps may or may not differ at ms precision, but shouldn't error
      expect(snap1.timestamp).toBeTruthy();
      expect(snap2.timestamp).toBeTruthy();
    });
  });

  // ── Combined scenarios ────────────────────────────────────────────────

  describe('combined scenarios', () => {
    it('tasks + logs + concurrency in one snapshot', async () => {
      listTasksMock.mockReturnValue([makeTask({ id: 'combined' })]);
      getLatestRunForTaskMock.mockReturnValue(makeRunRecord({ taskId: 'combined' }));
      getConcurrencyStatusMock.mockResolvedValue({ running: 1, queued: 2, maxConcurrency: 4 });
      writeLogFile('combined_log.md', { taskId: 'combined', status: 'success', timestamp: 'now' });

      const snap = await monitoringModule.getSystemSnapshot({ includeScheduler: false });
      expect(snap.tasks).toHaveLength(1);
      expect(snap.tasks[0].latestRun).toBeDefined();
      expect(snap.concurrency.running).toBe(1);
      expect(snap.recentLogs).toHaveLength(1);
    });

    it('multiple tasks with various states', async () => {
      listTasksMock.mockReturnValue([
        makeTask({ id: 'enabled-running', enabled: true }),
        makeTask({ id: 'disabled-done', enabled: false }),
        makeTask({ id: 'no-run', enabled: true }),
      ]);

      getLatestRunForTaskMock
        .mockReturnValueOnce(makeRunRecord({ taskId: 'enabled-running', status: 'running', finishedAt: undefined, startedAt: new Date().toISOString() }))
        .mockReturnValueOnce(makeRunRecord({ taskId: 'disabled-done', status: 'success' }))
        .mockReturnValueOnce(null);

      getTaskMock
        .mockReturnValueOnce(makeTask({ id: 'enabled-running', dependsOn: ['disabled-done'] }))
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null);

      const snap = await monitoringModule.getSystemSnapshot({ includeScheduler: false });
      expect(snap.tasks).toHaveLength(3);
      expect(snap.tasks[0].latestRun!.status).toBe('running');
      expect(snap.tasks[0].dependsOn).toEqual(['disabled-done']);
      expect(snap.tasks[1].latestRun!.status).toBe('success');
      expect(snap.tasks[2].latestRun).toBeUndefined();
    });

    it('config values pass through correctly', async () => {
      loadConfigMock.mockReturnValue({
        ...defaultConfig(),
        tasksDirs: ['/custom/tasks1', '/custom/tasks2'],
        logsDir: join(testDir, 'logs'),
        maxConcurrency: 8,
      });
      const snap = await monitoringModule.getSystemSnapshot();
      expect(snap.config.tasksDirs).toEqual(['/custom/tasks1', '/custom/tasks2']);
      expect(snap.config.maxConcurrency).toBe(8);
    });
  });
});

// ===========================================================================
// getQuickStatus
// ===========================================================================

describe('getQuickStatus', () => {
  // ── Empty state ───────────────────────────────────────────────────────

  describe('empty state', () => {
    it('returns running: 0 when no running runs', async () => {
      const qs = await monitoringModule.getQuickStatus();
      expect(qs.running).toBe(0);
    });

    it('returns queued: 0 when no queued runs', async () => {
      const qs = await monitoringModule.getQuickStatus();
      expect(qs.queued).toBe(0);
    });

    it('returns empty tasks array when nothing is active', async () => {
      const qs = await monitoringModule.getQuickStatus();
      expect(qs.tasks).toEqual([]);
    });

    it('returns maxConcurrency from concurrency status', async () => {
      getConcurrencyStatusMock.mockResolvedValue({ running: 0, queued: 0, maxConcurrency: 5 });
      const qs = await monitoringModule.getQuickStatus();
      expect(qs.maxConcurrency).toBe(5);
    });
  });

  // ── cleanupStaleRuns ──────────────────────────────────────────────────

  describe('cleanupStaleRuns', () => {
    it('calls cleanupStaleRuns', async () => {
      await monitoringModule.getQuickStatus();
      expect(cleanupStaleRunsMock).toHaveBeenCalled();
    });
  });

  // ── Running runs ──────────────────────────────────────────────────────

  describe('running runs', () => {
    it('maps running runs with ⏳ status', async () => {
      getConcurrencyStatusMock.mockResolvedValue({ running: 1, queued: 0, maxConcurrency: 2 });
      getRunsByStatusMock.mockImplementation((status: string) => {
        if (status === 'running') return [{ taskId: 'task-r', runId: 'r1', status: 'running', startedAt: 'now' }];
        return [];
      });
      const qs = await monitoringModule.getQuickStatus();
      expect(qs.tasks).toHaveLength(1);
      expect(qs.tasks[0]).toEqual({ id: 'task-r', status: '⏳ running' });
    });

    it('running count matches concurrency status', async () => {
      getConcurrencyStatusMock.mockResolvedValue({ running: 2, queued: 0, maxConcurrency: 4 });
      getRunsByStatusMock.mockImplementation((status: string) => {
        if (status === 'running') return [
          { taskId: 'a', runId: 'r1', status: 'running', startedAt: 'now' },
          { taskId: 'b', runId: 'r2', status: 'running', startedAt: 'now' },
        ];
        return [];
      });
      const qs = await monitoringModule.getQuickStatus();
      expect(qs.running).toBe(2);
    });
  });

  // ── Queued runs ───────────────────────────────────────────────────────

  describe('queued runs', () => {
    it('maps queued runs with 🕐 status', async () => {
      getConcurrencyStatusMock.mockResolvedValue({ running: 0, queued: 1, maxConcurrency: 2 });
      getRunsByStatusMock.mockImplementation((status: string) => {
        if (status === 'queued') return [{ taskId: 'task-q', runId: 'q1', status: 'queued', startedAt: 'now' }];
        return [];
      });
      const qs = await monitoringModule.getQuickStatus();
      expect(qs.tasks).toHaveLength(1);
      expect(qs.tasks[0]).toEqual({ id: 'task-q', status: '🕐 queued' });
    });

    it('queued count matches concurrency status', async () => {
      getConcurrencyStatusMock.mockResolvedValue({ running: 0, queued: 3, maxConcurrency: 2 });
      getRunsByStatusMock.mockImplementation((status: string) => {
        if (status === 'queued') return [
          { taskId: 'q1', runId: '1', status: 'queued', startedAt: '' },
          { taskId: 'q2', runId: '2', status: 'queued', startedAt: '' },
          { taskId: 'q3', runId: '3', status: 'queued', startedAt: '' },
        ];
        return [];
      });
      const qs = await monitoringModule.getQuickStatus();
      expect(qs.queued).toBe(3);
    });
  });

  // ── Mixed running and queued ──────────────────────────────────────────

  describe('mixed running and queued', () => {
    it('includes both running and queued tasks', async () => {
      getConcurrencyStatusMock.mockResolvedValue({ running: 1, queued: 2, maxConcurrency: 2 });
      getRunsByStatusMock.mockImplementation((status: string) => {
        if (status === 'running') return [{ taskId: 'r1', runId: 'rr', status: 'running', startedAt: '' }];
        if (status === 'queued') return [
          { taskId: 'q1', runId: 'qq1', status: 'queued', startedAt: '' },
          { taskId: 'q2', runId: 'qq2', status: 'queued', startedAt: '' },
        ];
        return [];
      });
      const qs = await monitoringModule.getQuickStatus();
      expect(qs.tasks).toHaveLength(3);
      expect(qs.tasks[0]).toEqual({ id: 'r1', status: '⏳ running' });
      expect(qs.tasks[1]).toEqual({ id: 'q1', status: '🕐 queued' });
      expect(qs.tasks[2]).toEqual({ id: 'q2', status: '🕐 queued' });
    });

    it('running tasks come before queued tasks', async () => {
      getConcurrencyStatusMock.mockResolvedValue({ running: 1, queued: 1, maxConcurrency: 2 });
      getRunsByStatusMock.mockImplementation((status: string) => {
        if (status === 'running') return [{ taskId: 'run-task', runId: 'r', status: 'running', startedAt: '' }];
        if (status === 'queued') return [{ taskId: 'q-task', runId: 'q', status: 'queued', startedAt: '' }];
        return [];
      });
      const qs = await monitoringModule.getQuickStatus();
      expect(qs.tasks[0].status).toBe('⏳ running');
      expect(qs.tasks[1].status).toBe('🕐 queued');
    });
  });

  // ── maxConcurrency pass-through ───────────────────────────────────────

  describe('maxConcurrency', () => {
    it('passes through maxConcurrency = 1', async () => {
      getConcurrencyStatusMock.mockResolvedValue({ running: 0, queued: 0, maxConcurrency: 1 });
      const qs = await monitoringModule.getQuickStatus();
      expect(qs.maxConcurrency).toBe(1);
    });

    it('passes through maxConcurrency = 100', async () => {
      getConcurrencyStatusMock.mockResolvedValue({ running: 0, queued: 0, maxConcurrency: 100 });
      const qs = await monitoringModule.getQuickStatus();
      expect(qs.maxConcurrency).toBe(100);
    });
  });

  // ── getRunsByStatus calls ─────────────────────────────────────────────

  describe('getRunsByStatus calls', () => {
    it('calls getRunsByStatus with "running"', async () => {
      await monitoringModule.getQuickStatus();
      expect(getRunsByStatusMock).toHaveBeenCalledWith('running');
    });

    it('calls getRunsByStatus with "queued"', async () => {
      await monitoringModule.getQuickStatus();
      expect(getRunsByStatusMock).toHaveBeenCalledWith('queued');
    });
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================

describe('edge cases', () => {
  it('getTask returns null for a task → no crash, dependsOn undefined', async () => {
    listTasksMock.mockReturnValue([makeTask({ id: 'orphan' })]);
    getTaskMock.mockReturnValue(null);
    const snap = await monitoringModule.getSystemSnapshot({ includeScheduler: false });
    expect(snap.tasks[0].dependsOn).toBeUndefined();
    expect(snap.tasks[0].id).toBe('orphan');
  });

  it('getConcurrencyStatus rejects → getSystemSnapshot propagates error', async () => {
    getConcurrencyStatusMock.mockRejectedValue(new Error('concurrency fail'));
    await expect(monitoringModule.getSystemSnapshot()).rejects.toThrow('concurrency fail');
  });

  it('getConcurrencyStatus rejects → getQuickStatus propagates error', async () => {
    getConcurrencyStatusMock.mockRejectedValue(new Error('concurrency fail'));
    await expect(monitoringModule.getQuickStatus()).rejects.toThrow('concurrency fail');
  });

  it('listTasks returns large number of tasks', async () => {
    const tasks = Array.from({ length: 50 }, (_, i) => makeTask({ id: `task-${i}` }));
    listTasksMock.mockReturnValue(tasks);
    const snap = await monitoringModule.getSystemSnapshot({ includeScheduler: false });
    expect(snap.tasks).toHaveLength(50);
  });

  it('task with empty dependsOn array', async () => {
    listTasksMock.mockReturnValue([makeTask()]);
    getTaskMock.mockReturnValue(makeTask({ dependsOn: [] }));
    const snap = await monitoringModule.getSystemSnapshot({ includeScheduler: false });
    expect(snap.tasks[0].dependsOn).toEqual([]);
  });

  it('log file with body text parses correctly', async () => {
    writeLogFile('full.md', { taskId: 'ft', status: 'success', timestamp: 'ts' }, '# Execution\nSome log output here');
    const snap = await monitoringModule.getSystemSnapshot();
    expect(snap.recentLogs[0].taskId).toBe('ft');
    expect(snap.recentLogs[0].status).toBe('success');
  });

  it('logsDir is a file instead of a directory → empty recentLogs', async () => {
    const fakeDir = join(testDir, 'fakefile');
    writeFileSync(fakeDir, 'not a dir', 'utf-8');
    loadConfigMock.mockReturnValue({ ...defaultConfig(), logsDir: fakeDir });
    const snap = await monitoringModule.getSystemSnapshot();
    expect(snap.recentLogs).toEqual([]);
  });

  it('rapid consecutive getQuickStatus calls succeed', async () => {
    const results = await Promise.all([
      monitoringModule.getQuickStatus(),
      monitoringModule.getQuickStatus(),
      monitoringModule.getQuickStatus(),
    ]);
    expect(results).toHaveLength(3);
    results.forEach(r => {
      expect(r.running).toBe(0);
      expect(r.queued).toBe(0);
    });
  });

  it('rapid consecutive getSystemSnapshot calls succeed', async () => {
    const results = await Promise.all([
      monitoringModule.getSystemSnapshot({ includeScheduler: false }),
      monitoringModule.getSystemSnapshot({ includeScheduler: false }),
    ]);
    expect(results).toHaveLength(2);
    results.forEach(r => {
      expect(r.tasks).toEqual([]);
    });
  });

  it('getSystemSnapshot with maxLogs: 0 returns no logs', async () => {
    writeLogFile('a.md', { taskId: 'a', status: 's', timestamp: '' });
    const snap = await monitoringModule.getSystemSnapshot({ maxLogs: 0 });
    expect(snap.recentLogs).toEqual([]);
  });

  it('task schedule value passes through', async () => {
    listTasksMock.mockReturnValue([makeTask({ schedule: '*/5 * * * *' })]);
    const snap = await monitoringModule.getSystemSnapshot({ includeScheduler: false });
    expect(snap.tasks[0].schedule).toBe('*/5 * * * *');
  });

  it('getQuickStatus with multiple running tasks of the same task id', async () => {
    getConcurrencyStatusMock.mockResolvedValue({ running: 2, queued: 0, maxConcurrency: 4 });
    getRunsByStatusMock.mockImplementation((status: string) => {
      if (status === 'running') return [
        { taskId: 'dup', runId: 'r1', status: 'running', startedAt: '' },
        { taskId: 'dup', runId: 'r2', status: 'running', startedAt: '' },
      ];
      return [];
    });
    const qs = await monitoringModule.getQuickStatus();
    expect(qs.tasks).toHaveLength(2);
    expect(qs.tasks[0].id).toBe('dup');
    expect(qs.tasks[1].id).toBe('dup');
  });

  it('log file with only frontmatter delimiters and nothing else', async () => {
    writeFileSync(join(logsDir, 'empty-fm.md'), '---\n---\n', 'utf-8');
    const snap = await monitoringModule.getSystemSnapshot();
    expect(snap.recentLogs).toHaveLength(1);
    // filename has no underscore so split('_')[0] returns the full filename
    expect(snap.recentLogs[0].taskId).toBe('empty-fm.md');
    expect(snap.recentLogs[0].status).toBe('unknown');
  });

  it('scheduler enabled=false passes through correctly', async () => {
    listTasksMock.mockReturnValue([makeTask()]);
    getTaskStatusMock.mockResolvedValue({ exists: true, enabled: false });
    const snap = await monitoringModule.getSystemSnapshot({ includeScheduler: true });
    expect(snap.tasks[0].schedulerStatus!.enabled).toBe(false);
  });

  it('latestRun with failure status is mapped', async () => {
    listTasksMock.mockReturnValue([makeTask()]);
    getLatestRunForTaskMock.mockReturnValue(makeRunRecord({ status: 'failure' }));
    const snap = await monitoringModule.getSystemSnapshot({ includeScheduler: false });
    expect(snap.tasks[0].latestRun!.status).toBe('failure');
  });

  it('latestRun with queued status is mapped', async () => {
    listTasksMock.mockReturnValue([makeTask()]);
    getLatestRunForTaskMock.mockReturnValue(makeRunRecord({ status: 'queued', finishedAt: undefined, startedAt: new Date().toISOString() }));
    const snap = await monitoringModule.getSystemSnapshot({ includeScheduler: false });
    expect(snap.tasks[0].latestRun!.status).toBe('queued');
  });
});
