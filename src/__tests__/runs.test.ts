import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tempDir: string;

vi.mock('../config.js', () => ({
  loadConfig: () => ({
    secretKey: 'test-secret',
    version: '0.1.0',
    tasksDirs: [join(tempDir, 'tasks')],
    logsDir: join(tempDir, 'logs'),
    maxConcurrency: 2,
  }),
  getConfigDir: () => tempDir,
  getSecretKey: () => 'test-secret',
}));

const {
  createRun,
  updateRun,
  getRun,
  getLatestRunForTask,
  getRunsByStatus,
  getRunningCount,
  getQueuedRuns,
  cleanupStaleRuns,
  cleanupOldRuns,
} = await import('../runs.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runsDir(): string {
  return join(tempDir, 'runs');
}

function readRunFile(runId: string) {
  return JSON.parse(readFileSync(join(runsDir(), `${runId}.json`), 'utf-8'));
}

function writeRunFile(runId: string, data: Record<string, unknown>) {
  mkdirSync(runsDir(), { recursive: true });
  writeFileSync(join(runsDir(), `${runId}.json`), JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  tempDir = join(tmpdir(), `cron-agents-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ===========================================================================
// createRun
// ===========================================================================
describe('createRun', () => {
  it('returns a RunRecord object', () => {
    const run = createRun('task-1');
    expect(run).toBeDefined();
    expect(typeof run).toBe('object');
  });

  it('runId starts with "run-"', () => {
    const run = createRun('task-1');
    expect(run.runId).toMatch(/^run-/);
  });

  it('runId is unique across calls', () => {
    const a = createRun('task-1');
    const b = createRun('task-1');
    expect(a.runId).not.toBe(b.runId);
  });

  it('taskId matches input', () => {
    const run = createRun('my-task');
    expect(run.taskId).toBe('my-task');
  });

  it('startedAt is a valid ISO date', () => {
    const run = createRun('task-1');
    expect(new Date(run.startedAt).toISOString()).toBe(run.startedAt);
  });

  it('default status is "running"', () => {
    const run = createRun('task-1');
    expect(run.status).toBe('running');
  });

  it('can create with status "queued"', () => {
    const run = createRun('task-1', 'queued');
    expect(run.status).toBe('queued');
  });

  it('can create with status "running" explicitly', () => {
    const run = createRun('task-1', 'running');
    expect(run.status).toBe('running');
  });

  it('pid is set to process.pid', () => {
    const run = createRun('task-1');
    expect(run.pid).toBe(process.pid);
  });

  it('JSON file is persisted to disk', () => {
    const run = createRun('task-1');
    const files = readdirSync(runsDir());
    expect(files).toContain(`${run.runId}.json`);
  });

  it('file content matches returned record', () => {
    const run = createRun('task-1');
    const onDisk = readRunFile(run.runId);
    expect(onDisk).toEqual(run);
  });

  it('multiple creates for different tasks work', () => {
    const a = createRun('task-a');
    const b = createRun('task-b');
    const c = createRun('task-c');
    expect(a.taskId).toBe('task-a');
    expect(b.taskId).toBe('task-b');
    expect(c.taskId).toBe('task-c');
    const files = readdirSync(runsDir());
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it('does not include finishedAt by default', () => {
    const run = createRun('task-1');
    expect(run.finishedAt).toBeUndefined();
  });

  it('does not include error by default', () => {
    const run = createRun('task-1');
    expect(run.error).toBeUndefined();
  });
});

// ===========================================================================
// updateRun
// ===========================================================================
describe('updateRun', () => {
  it('updates status field', () => {
    const run = createRun('task-1');
    const updated = updateRun(run.runId, { status: 'success' });
    expect(updated?.status).toBe('success');
  });

  it('updates finishedAt field', () => {
    const run = createRun('task-1');
    const ts = new Date().toISOString();
    const updated = updateRun(run.runId, { finishedAt: ts });
    expect(updated?.finishedAt).toBe(ts);
  });

  it('updates error field', () => {
    const run = createRun('task-1');
    const updated = updateRun(run.runId, { error: 'something went wrong' });
    expect(updated?.error).toBe('something went wrong');
  });

  it('updates logPath field', () => {
    const run = createRun('task-1');
    const updated = updateRun(run.runId, { logPath: '/some/path.md' });
    expect(updated?.logPath).toBe('/some/path.md');
  });

  it('returns updated record', () => {
    const run = createRun('task-1');
    const updated = updateRun(run.runId, { status: 'failure', error: 'oops' });
    expect(updated).not.toBeNull();
    expect(updated?.runId).toBe(run.runId);
  });

  it('returns null for non-existent runId', () => {
    const result = updateRun('run-does-not-exist', { status: 'success' });
    expect(result).toBeNull();
  });

  it('preserves fields not in updates', () => {
    const run = createRun('task-1');
    const updated = updateRun(run.runId, { status: 'success' });
    expect(updated?.taskId).toBe(run.taskId);
    expect(updated?.startedAt).toBe(run.startedAt);
    expect(updated?.pid).toBe(run.pid);
  });

  it('can update multiple fields at once', () => {
    const run = createRun('task-1');
    const ts = new Date().toISOString();
    const updated = updateRun(run.runId, {
      status: 'failure',
      finishedAt: ts,
      error: 'timeout',
      logPath: '/logs/out.md',
    });
    expect(updated?.status).toBe('failure');
    expect(updated?.finishedAt).toBe(ts);
    expect(updated?.error).toBe('timeout');
    expect(updated?.logPath).toBe('/logs/out.md');
  });

  it('original runId is preserved after update', () => {
    const run = createRun('task-1');
    const updated = updateRun(run.runId, { status: 'success' });
    expect(updated?.runId).toBe(run.runId);
  });

  it('file on disk reflects update', () => {
    const run = createRun('task-1');
    updateRun(run.runId, { status: 'success', error: 'none' });
    const onDisk = readRunFile(run.runId);
    expect(onDisk.status).toBe('success');
    expect(onDisk.error).toBe('none');
  });
});

// ===========================================================================
// getRun
// ===========================================================================
describe('getRun', () => {
  it('returns run record for existing run', () => {
    const run = createRun('task-1');
    const fetched = getRun(run.runId);
    expect(fetched).not.toBeNull();
  });

  it('returns null for non-existent runId', () => {
    expect(getRun('run-nonexistent-abc')).toBeNull();
  });

  it('returns correct runId', () => {
    const run = createRun('task-1');
    expect(getRun(run.runId)?.runId).toBe(run.runId);
  });

  it('returns correct taskId', () => {
    const run = createRun('task-1');
    expect(getRun(run.runId)?.taskId).toBe('task-1');
  });

  it('returns correct status', () => {
    const run = createRun('task-1', 'queued');
    expect(getRun(run.runId)?.status).toBe('queued');
  });

  it('returns correct pid', () => {
    const run = createRun('task-1');
    expect(getRun(run.runId)?.pid).toBe(process.pid);
  });

  it('works after update', () => {
    const run = createRun('task-1');
    updateRun(run.runId, { status: 'success' });
    const fetched = getRun(run.runId);
    expect(fetched).not.toBeNull();
  });

  it('returns the updated values after updateRun', () => {
    const run = createRun('task-1');
    const ts = new Date().toISOString();
    updateRun(run.runId, { status: 'failure', finishedAt: ts, error: 'bad' });
    const fetched = getRun(run.runId);
    expect(fetched?.status).toBe('failure');
    expect(fetched?.finishedAt).toBe(ts);
    expect(fetched?.error).toBe('bad');
  });
});

// ===========================================================================
// getLatestRunForTask
// ===========================================================================
describe('getLatestRunForTask', () => {
  it('returns null when no runs exist', () => {
    expect(getLatestRunForTask('task-1')).toBeNull();
  });

  it('returns null for unknown taskId', () => {
    createRun('task-a');
    expect(getLatestRunForTask('task-unknown')).toBeNull();
  });

  it('returns the only run for a task', () => {
    const run = createRun('task-1');
    const latest = getLatestRunForTask('task-1');
    expect(latest?.runId).toBe(run.runId);
  });

  it('returns latest run when multiple exist', () => {
    const run1 = createRun('task-1');
    // small delay so filenames sort differently
    const run2 = createRun('task-1');
    const latest = getLatestRunForTask('task-1');
    // run2 was created after run1, so it should be returned
    // Because filenames are sorted reverse, the later one comes first
    expect(latest?.runId).toBe(run2.runId);
  });

  it('different tasks do not interfere', () => {
    createRun('task-a');
    const runB = createRun('task-b');
    const latest = getLatestRunForTask('task-b');
    expect(latest?.runId).toBe(runB.runId);
  });

  it('returns correct run after one is updated', () => {
    const run1 = createRun('task-1');
    const run2 = createRun('task-1');
    updateRun(run1.runId, { status: 'success' });
    const latest = getLatestRunForTask('task-1');
    expect(latest?.runId).toBe(run2.runId);
  });

  it('returns run even if it has been updated to success', () => {
    const run = createRun('task-1');
    updateRun(run.runId, { status: 'success' });
    const latest = getLatestRunForTask('task-1');
    expect(latest).not.toBeNull();
    expect(latest?.status).toBe('success');
  });

  it('returns queued run as latest if created after running', () => {
    createRun('task-1', 'running');
    const run2 = createRun('task-1', 'queued');
    const latest = getLatestRunForTask('task-1');
    expect(latest?.runId).toBe(run2.runId);
  });
});

// ===========================================================================
// getRunsByStatus
// ===========================================================================
describe('getRunsByStatus', () => {
  it('returns empty array when no runs', () => {
    expect(getRunsByStatus('running')).toEqual([]);
  });

  it('returns only runs with matching status', () => {
    createRun('task-1', 'running');
    createRun('task-2', 'queued');
    const running = getRunsByStatus('running');
    expect(running.length).toBe(1);
    expect(running[0].taskId).toBe('task-1');
  });

  it('returns all running runs', () => {
    createRun('task-1', 'running');
    createRun('task-2', 'running');
    createRun('task-3', 'running');
    expect(getRunsByStatus('running').length).toBe(3);
  });

  it('returns all queued runs', () => {
    createRun('task-1', 'queued');
    createRun('task-2', 'queued');
    expect(getRunsByStatus('queued').length).toBe(2);
  });

  it('does not return completed runs when asking for running', () => {
    const run = createRun('task-1', 'running');
    updateRun(run.runId, { status: 'success' });
    expect(getRunsByStatus('running').length).toBe(0);
  });

  it('returns correct count with mixed statuses', () => {
    createRun('task-1', 'running');
    createRun('task-2', 'queued');
    createRun('task-3', 'running');
    const run4 = createRun('task-4', 'running');
    updateRun(run4.runId, { status: 'failure' });
    expect(getRunsByStatus('running').length).toBe(2);
    expect(getRunsByStatus('queued').length).toBe(1);
    expect(getRunsByStatus('failure').length).toBe(1);
  });

  it('returns success runs', () => {
    const run = createRun('task-1');
    updateRun(run.runId, { status: 'success', finishedAt: new Date().toISOString() });
    expect(getRunsByStatus('success').length).toBe(1);
  });

  it('returns failure runs', () => {
    const run = createRun('task-1');
    updateRun(run.runId, { status: 'failure', error: 'oops' });
    expect(getRunsByStatus('failure').length).toBe(1);
  });
});

// ===========================================================================
// getRunningCount
// ===========================================================================
describe('getRunningCount', () => {
  it('returns 0 when no runs', () => {
    expect(getRunningCount()).toBe(0);
  });

  it('returns count of running runs only', () => {
    createRun('task-1', 'running');
    createRun('task-2', 'running');
    expect(getRunningCount()).toBe(2);
  });

  it('does not count queued runs', () => {
    createRun('task-1', 'running');
    createRun('task-2', 'queued');
    expect(getRunningCount()).toBe(1);
  });

  it('does not count completed runs', () => {
    const run = createRun('task-1', 'running');
    updateRun(run.runId, { status: 'success' });
    createRun('task-2', 'running');
    expect(getRunningCount()).toBe(1);
  });
});

// ===========================================================================
// getQueuedRuns
// ===========================================================================
describe('getQueuedRuns', () => {
  it('returns empty array when no queued runs', () => {
    expect(getQueuedRuns()).toEqual([]);
  });

  it('returns queued runs in FIFO order', () => {
    // Write files manually with controlled timestamps to guarantee ordering
    writeRunFile('run-0001-aaa', {
      runId: 'run-0001-aaa',
      taskId: 'task-b',
      startedAt: '2024-01-01T00:00:02.000Z',
      status: 'queued',
      pid: process.pid,
    });
    writeRunFile('run-0002-bbb', {
      runId: 'run-0002-bbb',
      taskId: 'task-a',
      startedAt: '2024-01-01T00:00:01.000Z',
      status: 'queued',
      pid: process.pid,
    });
    const queued = getQueuedRuns();
    expect(queued.length).toBe(2);
    // FIFO: earlier startedAt first
    expect(queued[0].taskId).toBe('task-a');
    expect(queued[1].taskId).toBe('task-b');
  });

  it('does not include running runs', () => {
    createRun('task-1', 'running');
    createRun('task-2', 'queued');
    const queued = getQueuedRuns();
    expect(queued.length).toBe(1);
    expect(queued[0].taskId).toBe('task-2');
  });

  it('does not include completed runs', () => {
    const run = createRun('task-1', 'queued');
    updateRun(run.runId, { status: 'success' });
    expect(getQueuedRuns().length).toBe(0);
  });
});

// ===========================================================================
// cleanupStaleRuns
// ===========================================================================
describe('cleanupStaleRuns', () => {
  it('returns 0 when no stale runs', () => {
    createRun('task-1', 'running');
    expect(cleanupStaleRuns()).toBe(0);
  });

  it('marks old running run with dead PID as failure', () => {
    const oldDate = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(); // 5h ago
    writeRunFile('run-stale-001', {
      runId: 'run-stale-001',
      taskId: 'task-1',
      startedAt: oldDate,
      status: 'running',
      pid: 999999, // almost certainly dead
    });
    const cleaned = cleanupStaleRuns();
    expect(cleaned).toBe(1);
    const run = getRun('run-stale-001');
    expect(run?.status).toBe('failure');
    expect(run?.error).toContain('Stale run');
  });

  it('does not mark recent running runs as stale', () => {
    createRun('task-1', 'running');
    expect(cleanupStaleRuns()).toBe(0);
  });

  it('does not mark completed runs', () => {
    const oldDate = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    writeRunFile('run-done-001', {
      runId: 'run-done-001',
      taskId: 'task-1',
      startedAt: oldDate,
      status: 'success',
      finishedAt: oldDate,
      pid: 999999,
    });
    expect(cleanupStaleRuns()).toBe(0);
  });

  it('marks old queued run with dead PID as failure', () => {
    const oldDate = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    writeRunFile('run-queued-old', {
      runId: 'run-queued-old',
      taskId: 'task-1',
      startedAt: oldDate,
      status: 'queued',
      pid: 999999,
    });
    const cleaned = cleanupStaleRuns();
    expect(cleaned).toBe(1);
    expect(getRun('run-queued-old')?.status).toBe('failure');
  });
});

// ===========================================================================
// cleanupOldRuns
// ===========================================================================
describe('cleanupOldRuns', () => {
  it('returns 0 when no old runs', () => {
    createRun('task-1');
    expect(cleanupOldRuns()).toBe(0);
  });

  it('removes completed runs older than 24h', () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25h ago
    writeRunFile('run-old-done', {
      runId: 'run-old-done',
      taskId: 'task-1',
      startedAt: oldDate,
      status: 'success',
      finishedAt: oldDate,
      pid: process.pid,
    });
    const cleaned = cleanupOldRuns();
    expect(cleaned).toBeGreaterThanOrEqual(1);
    expect(getRun('run-old-done')).toBeNull();
  });

  it('does not remove recent completed runs', () => {
    const run = createRun('task-1');
    const ts = new Date().toISOString();
    updateRun(run.runId, { status: 'success', finishedAt: ts });
    cleanupOldRuns();
    expect(getRun(run.runId)).not.toBeNull();
  });

  it('does not remove running runs even if old', () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    // Use current process.pid so it's alive and won't be cleaned as stale either
    writeRunFile('run-old-running', {
      runId: 'run-old-running',
      taskId: 'task-1',
      startedAt: oldDate,
      status: 'running',
      pid: process.pid,
    });
    cleanupOldRuns();
    const run = getRun('run-old-running');
    // Still running (not deleted); PID is alive so not marked stale
    expect(run).not.toBeNull();
    expect(run?.status).toBe('running');
  });

  it('removes failure runs older than 24h', () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    writeRunFile('run-old-fail', {
      runId: 'run-old-fail',
      taskId: 'task-1',
      startedAt: oldDate,
      status: 'failure',
      finishedAt: oldDate,
      error: 'oops',
      pid: process.pid,
    });
    const cleaned = cleanupOldRuns();
    expect(cleaned).toBeGreaterThanOrEqual(1);
    expect(getRun('run-old-fail')).toBeNull();
  });

  it('also cleans up stale running runs', () => {
    const oldDate = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    writeRunFile('run-stale-x', {
      runId: 'run-stale-x',
      taskId: 'task-1',
      startedAt: oldDate,
      status: 'running',
      pid: 999999,
    });
    const cleaned = cleanupOldRuns();
    expect(cleaned).toBeGreaterThanOrEqual(1);
    // Should have been marked as failure by cleanupStaleRuns
    const run = getRun('run-stale-x');
    expect(run?.status).toBe('failure');
  });
});
