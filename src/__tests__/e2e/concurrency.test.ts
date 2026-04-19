/**
 * E2E tests for concurrency control.
 *
 * Uses REAL: runs.ts, concurrency.ts (file-based with temp dirs)
 * Mocks: config.ts (to point at temp dirs and control maxConcurrency)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import {
  createTestDirs,
  cleanupTestDirs,
  writeTestConfig,
  writeRunFile,
  TestDirs,
} from './helpers.js';

// ─── Config mock ────────────────────────────────────────────────────────────

vi.mock('../../config.js', () => {
  let _config: any = null;
  let _configDir: string = '';
  return {
    loadConfig: () => _config,
    getConfigDir: () => _configDir,
    getSecretKey: () => _config?.secretKey || 'test-key',
    updateConfig: () => {},
    _setTestConfig: (config: any, configDir: string) => {
      _config = config;
      _configDir = configDir;
    },
  };
});

// Import the setter so we can wire each test's temp dirs
const { _setTestConfig } = await import('../../config.js') as any;

// Import the real modules under test
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
} = await import('../../runs.js');

const {
  tryAcquireSlot,
  getConcurrencyStatus,
} = await import('../../concurrency.js');

// ─── Helpers ────────────────────────────────────────────────────────────────

let dirs: TestDirs;

function setupConfig(overrides: Record<string, unknown> = {}) {
  const config = writeTestConfig(dirs, overrides as any);
  _setTestConfig(config, dirs.configDir);
  return config;
}

/** Timestamp N hours in the past */
function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

/** Timestamp N minutes in the past */
function minutesAgo(m: number): string {
  return new Date(Date.now() - m * 60 * 1000).toISOString();
}

/** A PID that should never correspond to a real process */
const DEAD_PID = 99999999;

// ─── Setup / Teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  dirs = createTestDirs();
  setupConfig();
});

afterEach(() => {
  cleanupTestDirs(dirs);
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. tryAcquireSlot
// ═══════════════════════════════════════════════════════════════════════════

describe('tryAcquireSlot', () => {
  it('returns acquired=true when no running tasks and maxConcurrency=2', async () => {
    const result = await tryAcquireSlot();
    expect(result).toEqual({ acquired: true, runningCount: 0, maxConcurrency: 2 });
  });

  it('returns acquired=true with 1 running task and maxConcurrency=2', async () => {
    writeRunFile(dirs.runsDir, { runId: 'r1', taskId: 't1', status: 'running', pid: process.pid });
    const result = await tryAcquireSlot();
    expect(result.acquired).toBe(true);
    expect(result.runningCount).toBe(1);
  });

  it('returns acquired=false with 2 running tasks and maxConcurrency=2', async () => {
    writeRunFile(dirs.runsDir, { runId: 'r1', taskId: 't1', status: 'running', pid: process.pid });
    writeRunFile(dirs.runsDir, { runId: 'r2', taskId: 't2', status: 'running', pid: process.pid });
    const result = await tryAcquireSlot();
    expect(result).toEqual({ acquired: false, runningCount: 2, maxConcurrency: 2 });
  });

  it('returns acquired=true when maxConcurrency=1 and 0 running', async () => {
    setupConfig({ maxConcurrency: 1 });
    const result = await tryAcquireSlot();
    expect(result.acquired).toBe(true);
    expect(result.maxConcurrency).toBe(1);
  });

  it('returns acquired=false when maxConcurrency=1 and 1 running', async () => {
    setupConfig({ maxConcurrency: 1 });
    writeRunFile(dirs.runsDir, { runId: 'r1', taskId: 't1', status: 'running', pid: process.pid });
    const result = await tryAcquireSlot();
    expect(result.acquired).toBe(false);
    expect(result.runningCount).toBe(1);
    expect(result.maxConcurrency).toBe(1);
  });

  it('returns acquired=true when maxConcurrency=5 and 4 running', async () => {
    setupConfig({ maxConcurrency: 5 });
    for (let i = 0; i < 4; i++) {
      writeRunFile(dirs.runsDir, { runId: `r${i}`, taskId: `t${i}`, status: 'running', pid: process.pid });
    }
    const result = await tryAcquireSlot();
    expect(result.acquired).toBe(true);
    expect(result.runningCount).toBe(4);
  });

  it('returns acquired=false when maxConcurrency=5 and 5 running', async () => {
    setupConfig({ maxConcurrency: 5 });
    for (let i = 0; i < 5; i++) {
      writeRunFile(dirs.runsDir, { runId: `r${i}`, taskId: `t${i}`, status: 'running', pid: process.pid });
    }
    const result = await tryAcquireSlot();
    expect(result.acquired).toBe(false);
    expect(result.runningCount).toBe(5);
  });

  it('does not count queued tasks toward running limit', async () => {
    writeRunFile(dirs.runsDir, { runId: 'r1', taskId: 't1', status: 'running', pid: process.pid });
    writeRunFile(dirs.runsDir, { runId: 'r2', taskId: 't2', status: 'queued', pid: process.pid });
    writeRunFile(dirs.runsDir, { runId: 'r3', taskId: 't3', status: 'queued', pid: process.pid });
    const result = await tryAcquireSlot();
    expect(result.acquired).toBe(true);
    expect(result.runningCount).toBe(1);
  });

  it('does not count completed tasks toward running limit', async () => {
    writeRunFile(dirs.runsDir, { runId: 'r1', taskId: 't1', status: 'running', pid: process.pid });
    writeRunFile(dirs.runsDir, {
      runId: 'r2', taskId: 't2', status: 'success',
      finishedAt: new Date().toISOString(), pid: process.pid,
    });
    const result = await tryAcquireSlot();
    expect(result.acquired).toBe(true);
    expect(result.runningCount).toBe(1);
  });

  it('does not count failed tasks toward running limit', async () => {
    writeRunFile(dirs.runsDir, { runId: 'r1', taskId: 't1', status: 'running', pid: process.pid });
    writeRunFile(dirs.runsDir, {
      runId: 'r2', taskId: 't2', status: 'failure',
      finishedAt: new Date().toISOString(), error: 'boom', pid: process.pid,
    });
    const result = await tryAcquireSlot();
    expect(result.acquired).toBe(true);
    expect(result.runningCount).toBe(1);
  });

  it('cleans up stale runs before counting', async () => {
    setupConfig({ maxConcurrency: 1 });
    // Stale: old timestamp + dead PID
    writeRunFile(dirs.runsDir, {
      runId: 'stale-1', taskId: 't1', status: 'running',
      startedAt: hoursAgo(5), pid: DEAD_PID,
    });
    const result = await tryAcquireSlot();
    // The stale run should have been cleaned up → slot available
    expect(result.acquired).toBe(true);
    expect(result.runningCount).toBe(0);
  });

  it('succeeds even when lock file already exists (stale lock)', async () => {
    // Create a stale lock file manually
    const lockPath = join(dirs.configDir, 'concurrency.lock');
    const { writeFileSync } = await import('fs');
    writeFileSync(lockPath, '', 'utf-8');
    // Backdate the file so it's considered stale (>30s)
    const { utimesSync } = await import('fs');
    const past = new Date(Date.now() - 60_000);
    utimesSync(lockPath, past, past);

    const result = await tryAcquireSlot();
    expect(result.acquired).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Run record lifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe('Run record lifecycle', () => {
  it('createRun creates a file on disk', () => {
    const run = createRun('task-1');
    const filePath = join(dirs.runsDir, `${run.runId}.json`);
    expect(existsSync(filePath)).toBe(true);
  });

  it('createRun default status is running', () => {
    const run = createRun('task-1');
    expect(run.status).toBe('running');
  });

  it('createRun with queued status', () => {
    const run = createRun('task-1', 'queued');
    expect(run.status).toBe('queued');
    const onDisk = JSON.parse(readFileSync(join(dirs.runsDir, `${run.runId}.json`), 'utf-8'));
    expect(onDisk.status).toBe('queued');
  });

  it('createRun sets PID to current process', () => {
    const run = createRun('task-1');
    expect(run.pid).toBe(process.pid);
  });

  it('createRun generates unique runIds', () => {
    const a = createRun('task-1');
    const b = createRun('task-1');
    expect(a.runId).not.toBe(b.runId);
  });

  it('updateRun changes status', () => {
    const run = createRun('task-1');
    const updated = updateRun(run.runId, { status: 'success' });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('success');
    // Verify on disk
    const onDisk = JSON.parse(readFileSync(join(dirs.runsDir, `${run.runId}.json`), 'utf-8'));
    expect(onDisk.status).toBe('success');
  });

  it('updateRun sets finishedAt', () => {
    const run = createRun('task-1');
    const ts = new Date().toISOString();
    const updated = updateRun(run.runId, { finishedAt: ts });
    expect(updated!.finishedAt).toBe(ts);
  });

  it('updateRun sets error', () => {
    const run = createRun('task-1');
    const updated = updateRun(run.runId, { error: 'something broke' });
    expect(updated!.error).toBe('something broke');
  });

  it('updateRun sets logPath', () => {
    const run = createRun('task-1');
    const updated = updateRun(run.runId, { logPath: '/some/path.md' });
    expect(updated!.logPath).toBe('/some/path.md');
  });

  it('updateRun on nonexistent returns null', () => {
    const result = updateRun('nonexistent-id', { status: 'success' });
    expect(result).toBeNull();
  });

  it('getRun returns correct record', () => {
    const run = createRun('task-1');
    const fetched = getRun(run.runId);
    expect(fetched).not.toBeNull();
    expect(fetched!.runId).toBe(run.runId);
    expect(fetched!.taskId).toBe('task-1');
    expect(fetched!.status).toBe('running');
  });

  it('getRun returns null for nonexistent', () => {
    expect(getRun('nonexistent')).toBeNull();
  });

  it('getLatestRunForTask returns the most recent', () => {
    writeRunFile(dirs.runsDir, { runId: 'aaa-old', taskId: 'task-x', status: 'success', startedAt: hoursAgo(2) });
    writeRunFile(dirs.runsDir, { runId: 'zzz-new', taskId: 'task-x', status: 'running', startedAt: minutesAgo(5) });
    const latest = getLatestRunForTask('task-x');
    expect(latest).not.toBeNull();
    // Files sorted reverse alphabetically → zzz-new comes first
    expect(latest!.runId).toBe('zzz-new');
  });

  it('getLatestRunForTask with multiple runs returns latest by file sort', () => {
    writeRunFile(dirs.runsDir, { runId: 'run-001', taskId: 'build', status: 'success' });
    writeRunFile(dirs.runsDir, { runId: 'run-002', taskId: 'build', status: 'failure' });
    writeRunFile(dirs.runsDir, { runId: 'run-003', taskId: 'build', status: 'running' });
    const latest = getLatestRunForTask('build');
    // Reverse-sorted: run-003 comes first
    expect(latest!.runId).toBe('run-003');
  });

  it('getLatestRunForTask returns null for nonexistent task', () => {
    writeRunFile(dirs.runsDir, { runId: 'r1', taskId: 'other', status: 'running' });
    expect(getLatestRunForTask('nonexistent')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. getRunsByStatus
// ═══════════════════════════════════════════════════════════════════════════

describe('getRunsByStatus', () => {
  it('returns empty array when no runs', () => {
    expect(getRunsByStatus('running')).toEqual([]);
  });

  it('returns only matching status', () => {
    writeRunFile(dirs.runsDir, { runId: 'r1', taskId: 't1', status: 'running', pid: process.pid });
    writeRunFile(dirs.runsDir, { runId: 'r2', taskId: 't2', status: 'queued', pid: process.pid });
    writeRunFile(dirs.runsDir, { runId: 'r3', taskId: 't3', status: 'success', pid: process.pid });
    writeRunFile(dirs.runsDir, { runId: 'r4', taskId: 't4', status: 'failure', pid: process.pid });

    const running = getRunsByStatus('running');
    expect(running).toHaveLength(1);
    expect(running[0].runId).toBe('r1');

    const queued = getRunsByStatus('queued');
    expect(queued).toHaveLength(1);
    expect(queued[0].runId).toBe('r2');
  });

  it('getRunningCount returns correct number', () => {
    writeRunFile(dirs.runsDir, { runId: 'r1', taskId: 't1', status: 'running', pid: process.pid });
    writeRunFile(dirs.runsDir, { runId: 'r2', taskId: 't2', status: 'running', pid: process.pid });
    writeRunFile(dirs.runsDir, { runId: 'r3', taskId: 't3', status: 'queued', pid: process.pid });
    expect(getRunningCount()).toBe(2);
  });

  it('getQueuedRuns returns sorted by startedAt (FIFO)', () => {
    writeRunFile(dirs.runsDir, {
      runId: 'q2', taskId: 't2', status: 'queued',
      startedAt: minutesAgo(5), pid: process.pid,
    });
    writeRunFile(dirs.runsDir, {
      runId: 'q1', taskId: 't1', status: 'queued',
      startedAt: minutesAgo(10), pid: process.pid,
    });
    writeRunFile(dirs.runsDir, {
      runId: 'q3', taskId: 't3', status: 'queued',
      startedAt: minutesAgo(1), pid: process.pid,
    });
    const queued = getQueuedRuns();
    expect(queued).toHaveLength(3);
    // Oldest first (FIFO)
    expect(queued[0].runId).toBe('q1');
    expect(queued[1].runId).toBe('q2');
    expect(queued[2].runId).toBe('q3');
  });

  it('getQueuedRuns excludes running and completed', () => {
    writeRunFile(dirs.runsDir, { runId: 'q1', taskId: 't1', status: 'queued', pid: process.pid });
    writeRunFile(dirs.runsDir, { runId: 'r1', taskId: 't2', status: 'running', pid: process.pid });
    writeRunFile(dirs.runsDir, { runId: 's1', taskId: 't3', status: 'success', pid: process.pid });
    writeRunFile(dirs.runsDir, { runId: 'f1', taskId: 't4', status: 'failure', pid: process.pid });
    const queued = getQueuedRuns();
    expect(queued).toHaveLength(1);
    expect(queued[0].runId).toBe('q1');
  });

  it('returns multiple running tasks', () => {
    for (let i = 0; i < 4; i++) {
      writeRunFile(dirs.runsDir, { runId: `run-${i}`, taskId: `t${i}`, status: 'running', pid: process.pid });
    }
    const running = getRunsByStatus('running');
    expect(running).toHaveLength(4);
  });

  it('getQueuedRuns preserves FIFO order across many items', () => {
    const timestamps = [10, 8, 6, 4, 2].map(m => minutesAgo(m));
    timestamps.forEach((ts, i) => {
      writeRunFile(dirs.runsDir, {
        runId: `fifo-${i}`, taskId: `t${i}`, status: 'queued',
        startedAt: ts, pid: process.pid,
      });
    });
    const queued = getQueuedRuns();
    // Oldest (10 min ago) should be first
    expect(queued[0].runId).toBe('fifo-0');
    // Newest (2 min ago) should be last
    expect(queued[queued.length - 1].runId).toBe('fifo-4');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. getConcurrencyStatus
// ═══════════════════════════════════════════════════════════════════════════

describe('getConcurrencyStatus', () => {
  it('returns zeros when empty', async () => {
    const status = await getConcurrencyStatus();
    expect(status).toEqual({ running: 0, queued: 0, maxConcurrency: 2 });
  });

  it('returns correct counts for mixed runs', async () => {
    writeRunFile(dirs.runsDir, { runId: 'r1', taskId: 't1', status: 'running', pid: process.pid });
    writeRunFile(dirs.runsDir, { runId: 'r2', taskId: 't2', status: 'running', pid: process.pid });
    writeRunFile(dirs.runsDir, { runId: 'q1', taskId: 't3', status: 'queued', pid: process.pid });
    writeRunFile(dirs.runsDir, { runId: 's1', taskId: 't4', status: 'success', pid: process.pid });

    const status = await getConcurrencyStatus();
    expect(status.running).toBe(2);
    expect(status.queued).toBe(1);
  });

  it('performs stale cleanup before counting', async () => {
    // Stale running run: old timestamp + dead PID
    writeRunFile(dirs.runsDir, {
      runId: 'stale', taskId: 't1', status: 'running',
      startedAt: hoursAgo(5), pid: DEAD_PID,
    });
    writeRunFile(dirs.runsDir, { runId: 'live', taskId: 't2', status: 'running', pid: process.pid });

    const status = await getConcurrencyStatus();
    expect(status.running).toBe(1);
  });

  it('reflects maxConcurrency from config', async () => {
    setupConfig({ maxConcurrency: 10 });
    const status = await getConcurrencyStatus();
    expect(status.maxConcurrency).toBe(10);
  });

  it('counts decrease after runs complete', async () => {
    const run = createRun('task-1');
    const before = await getConcurrencyStatus();
    expect(before.running).toBeGreaterThanOrEqual(1);

    updateRun(run.runId, { status: 'success', finishedAt: new Date().toISOString() });
    const after = await getConcurrencyStatus();
    expect(after.running).toBe(before.running - 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. cleanupStaleRuns
// ═══════════════════════════════════════════════════════════════════════════

describe('cleanupStaleRuns', () => {
  it('does not clean up running task with alive PID', () => {
    writeRunFile(dirs.runsDir, {
      runId: 'alive', taskId: 't1', status: 'running',
      startedAt: hoursAgo(5), pid: process.pid,
    });
    const cleaned = cleanupStaleRuns();
    expect(cleaned).toBe(0);
    const run = getRun('alive');
    expect(run!.status).toBe('running');
  });

  it('marks running task with dead PID (old timestamp) as failure', () => {
    writeRunFile(dirs.runsDir, {
      runId: 'dead-run', taskId: 't1', status: 'running',
      startedAt: hoursAgo(5), pid: DEAD_PID,
    });
    const cleaned = cleanupStaleRuns();
    expect(cleaned).toBe(1);
    const run = getRun('dead-run');
    expect(run!.status).toBe('failure');
  });

  it('does not clean up running task under 4h old regardless of PID', () => {
    writeRunFile(dirs.runsDir, {
      runId: 'young', taskId: 't1', status: 'running',
      startedAt: hoursAgo(2), pid: DEAD_PID,
    });
    const cleaned = cleanupStaleRuns();
    expect(cleaned).toBe(0);
    expect(getRun('young')!.status).toBe('running');
  });

  it('marks queued task with dead PID (old timestamp) as failure', () => {
    writeRunFile(dirs.runsDir, {
      runId: 'dead-queued', taskId: 't1', status: 'queued',
      startedAt: hoursAgo(5), pid: DEAD_PID,
    });
    const cleaned = cleanupStaleRuns();
    expect(cleaned).toBe(1);
    expect(getRun('dead-queued')!.status).toBe('failure');
  });

  it('does not touch completed tasks', () => {
    writeRunFile(dirs.runsDir, {
      runId: 'done-ok', taskId: 't1', status: 'success',
      startedAt: hoursAgo(10), finishedAt: hoursAgo(9), pid: DEAD_PID,
    });
    writeRunFile(dirs.runsDir, {
      runId: 'done-fail', taskId: 't2', status: 'failure',
      startedAt: hoursAgo(10), finishedAt: hoursAgo(9), pid: DEAD_PID,
    });
    const cleaned = cleanupStaleRuns();
    expect(cleaned).toBe(0);
    expect(getRun('done-ok')!.status).toBe('success');
    expect(getRun('done-fail')!.status).toBe('failure');
  });

  it('cleaned up run has error message mentioning stale', () => {
    writeRunFile(dirs.runsDir, {
      runId: 'stale-err', taskId: 't1', status: 'running',
      startedAt: hoursAgo(5), pid: DEAD_PID,
    });
    cleanupStaleRuns();
    const run = getRun('stale-err');
    expect(run!.error).toBeDefined();
    expect(run!.error!.toLowerCase()).toContain('stale');
  });

  it('returns count of cleaned runs', () => {
    writeRunFile(dirs.runsDir, {
      runId: 's1', taskId: 't1', status: 'running',
      startedAt: hoursAgo(5), pid: DEAD_PID,
    });
    writeRunFile(dirs.runsDir, {
      runId: 's2', taskId: 't2', status: 'running',
      startedAt: hoursAgo(6), pid: DEAD_PID,
    });
    writeRunFile(dirs.runsDir, {
      runId: 's3', taskId: 't3', status: 'running',
      startedAt: hoursAgo(1), pid: process.pid,
    });
    const cleaned = cleanupStaleRuns();
    expect(cleaned).toBe(2);
  });

  it('cleans up multiple stale runs', () => {
    for (let i = 0; i < 5; i++) {
      writeRunFile(dirs.runsDir, {
        runId: `stale-${i}`, taskId: `t${i}`, status: 'running',
        startedAt: hoursAgo(5 + i), pid: DEAD_PID,
      });
    }
    const cleaned = cleanupStaleRuns();
    expect(cleaned).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(getRun(`stale-${i}`)!.status).toBe('failure');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. cleanupOldRuns
// ═══════════════════════════════════════════════════════════════════════════

describe('cleanupOldRuns', () => {
  it('deletes completed run older than 24h', () => {
    writeRunFile(dirs.runsDir, {
      runId: 'old-success', taskId: 't1', status: 'success',
      startedAt: hoursAgo(48), finishedAt: hoursAgo(47), pid: process.pid,
    });
    const cleaned = cleanupOldRuns();
    expect(cleaned).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(dirs.runsDir, 'old-success.json'))).toBe(false);
  });

  it('does not delete completed run under 24h old', () => {
    writeRunFile(dirs.runsDir, {
      runId: 'recent-done', taskId: 't1', status: 'success',
      startedAt: hoursAgo(2), finishedAt: hoursAgo(1), pid: process.pid,
    });
    cleanupOldRuns();
    expect(existsSync(join(dirs.runsDir, 'recent-done.json'))).toBe(true);
  });

  it('does not delete running runs regardless of age', () => {
    writeRunFile(dirs.runsDir, {
      runId: 'old-running', taskId: 't1', status: 'running',
      startedAt: hoursAgo(2), pid: process.pid,
    });
    cleanupOldRuns();
    // Running runs won't have finishedAt, so they shouldn't be TTL-deleted
    expect(existsSync(join(dirs.runsDir, 'old-running.json'))).toBe(true);
  });

  it('does not delete queued runs regardless of age', () => {
    writeRunFile(dirs.runsDir, {
      runId: 'old-queued', taskId: 't1', status: 'queued',
      startedAt: hoursAgo(2), pid: process.pid,
    });
    cleanupOldRuns();
    expect(existsSync(join(dirs.runsDir, 'old-queued.json'))).toBe(true);
  });

  it('also calls cleanupStaleRuns', () => {
    // Stale running run
    writeRunFile(dirs.runsDir, {
      runId: 'stale-via-old', taskId: 't1', status: 'running',
      startedAt: hoursAgo(5), pid: DEAD_PID,
    });
    // Old completed run
    writeRunFile(dirs.runsDir, {
      runId: 'old-done', taskId: 't2', status: 'success',
      startedAt: hoursAgo(48), finishedAt: hoursAgo(47), pid: process.pid,
    });
    const cleaned = cleanupOldRuns();
    // Both should be cleaned: stale + old completed
    expect(cleaned).toBeGreaterThanOrEqual(2);
    // Stale run → marked failure (still on disk)
    expect(getRun('stale-via-old')!.status).toBe('failure');
    // Old completed → deleted
    expect(existsSync(join(dirs.runsDir, 'old-done.json'))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. FIFO queue semantics (component-level waitForSlot testing)
// ═══════════════════════════════════════════════════════════════════════════

describe('FIFO queue semantics', () => {
  it('getQueuedRuns returns runs in start-time order', () => {
    writeRunFile(dirs.runsDir, {
      runId: 'q-c', taskId: 'tc', status: 'queued',
      startedAt: minutesAgo(1), pid: process.pid,
    });
    writeRunFile(dirs.runsDir, {
      runId: 'q-a', taskId: 'ta', status: 'queued',
      startedAt: minutesAgo(10), pid: process.pid,
    });
    writeRunFile(dirs.runsDir, {
      runId: 'q-b', taskId: 'tb', status: 'queued',
      startedAt: minutesAgo(5), pid: process.pid,
    });

    const q = getQueuedRuns();
    expect(q.map(r => r.runId)).toEqual(['q-a', 'q-b', 'q-c']);
  });

  it('first queued run can acquire slot after running tasks finish', async () => {
    setupConfig({ maxConcurrency: 1 });
    // One running task blocks the queue
    const running = createRun('blocker');
    // Two queued
    writeRunFile(dirs.runsDir, {
      runId: 'q-first', taskId: 'tq1', status: 'queued',
      startedAt: minutesAgo(5), pid: process.pid,
    });
    writeRunFile(dirs.runsDir, {
      runId: 'q-second', taskId: 'tq2', status: 'queued',
      startedAt: minutesAgo(2), pid: process.pid,
    });

    // Slot full
    let slot = await tryAcquireSlot();
    expect(slot.acquired).toBe(false);

    // Finish the blocker
    updateRun(running.runId, { status: 'success', finishedAt: new Date().toISOString() });

    // Now slot opens
    slot = await tryAcquireSlot();
    expect(slot.acquired).toBe(true);

    // FIFO: first queued should be serviced first
    const q = getQueuedRuns();
    expect(q[0].runId).toBe('q-first');
  });

  it('manually transitioning queued → running adjusts counts', async () => {
    writeRunFile(dirs.runsDir, {
      runId: 'q-manual', taskId: 't1', status: 'queued',
      startedAt: minutesAgo(5), pid: process.pid,
    });

    let status = await getConcurrencyStatus();
    expect(status.queued).toBe(1);
    expect(status.running).toBe(0);

    // Simulate what waitForSlot does: transition queued → running
    updateRun('q-manual', { status: 'running' });

    status = await getConcurrencyStatus();
    expect(status.queued).toBe(0);
    expect(status.running).toBe(1);
  });

  it('slot acquisition is fair (no starvation of early queued runs)', async () => {
    setupConfig({ maxConcurrency: 2 });

    // Fill up slots
    writeRunFile(dirs.runsDir, { runId: 'r1', taskId: 't1', status: 'running', pid: process.pid });
    writeRunFile(dirs.runsDir, { runId: 'r2', taskId: 't2', status: 'running', pid: process.pid });

    // Queue 3 runs in order
    writeRunFile(dirs.runsDir, {
      runId: 'first', taskId: 'q1', status: 'queued',
      startedAt: minutesAgo(10), pid: process.pid,
    });
    writeRunFile(dirs.runsDir, {
      runId: 'second', taskId: 'q2', status: 'queued',
      startedAt: minutesAgo(5), pid: process.pid,
    });
    writeRunFile(dirs.runsDir, {
      runId: 'third', taskId: 'q3', status: 'queued',
      startedAt: minutesAgo(1), pid: process.pid,
    });

    // First in queue should always be oldest
    const queued = getQueuedRuns();
    expect(queued[0].runId).toBe('first');
    expect(queued[1].runId).toBe('second');
    expect(queued[2].runId).toBe('third');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Edge cases and integration
// ═══════════════════════════════════════════════════════════════════════════

describe('Edge cases', () => {
  it('createRun followed by getRun round-trips correctly', () => {
    const run = createRun('round-trip', 'queued');
    const fetched = getRun(run.runId);
    expect(fetched).toEqual(run);
  });

  it('multiple createRun calls produce distinct files on disk', () => {
    createRun('task-a');
    createRun('task-a');
    createRun('task-b');
    const files = readdirSync(dirs.runsDir).filter(f => f.endsWith('.json'));
    expect(files.length).toBe(3);
  });

  it('getRunsByStatus returns empty for status with no matches', () => {
    writeRunFile(dirs.runsDir, { runId: 'r1', taskId: 't1', status: 'running', pid: process.pid });
    expect(getRunsByStatus('queued')).toEqual([]);
    expect(getRunsByStatus('success')).toEqual([]);
    expect(getRunsByStatus('failure')).toEqual([]);
  });

  it('tryAcquireSlot with maxConcurrency=0 always returns false', async () => {
    // Edge: zero concurrency
    setupConfig({ maxConcurrency: 0 });
    const result = await tryAcquireSlot();
    expect(result.acquired).toBe(false);
    expect(result.maxConcurrency).toBe(0);
  });

  it('concurrent createRun calls produce separate records', () => {
    // Synchronous but rapid-fire
    const runs = Array.from({ length: 10 }, (_, i) => createRun(`task-${i}`));
    const ids = new Set(runs.map(r => r.runId));
    expect(ids.size).toBe(10);
  });

  it('updateRun preserves fields not in the update', () => {
    const run = createRun('preserve');
    updateRun(run.runId, { error: 'oops' });
    const fetched = getRun(run.runId);
    expect(fetched!.taskId).toBe('preserve');
    expect(fetched!.status).toBe('running');
    expect(fetched!.pid).toBe(process.pid);
    expect(fetched!.error).toBe('oops');
  });

  it('cleanupStaleRuns sets finishedAt on stale runs', () => {
    writeRunFile(dirs.runsDir, {
      runId: 'stale-ts', taskId: 't1', status: 'running',
      startedAt: hoursAgo(5), pid: DEAD_PID,
    });
    cleanupStaleRuns();
    const run = getRun('stale-ts');
    expect(run!.finishedAt).toBeDefined();
  });

  it('getConcurrencyStatus with only completed runs shows 0 running and 0 queued', async () => {
    writeRunFile(dirs.runsDir, {
      runId: 'done1', taskId: 't1', status: 'success',
      finishedAt: new Date().toISOString(), pid: process.pid,
    });
    writeRunFile(dirs.runsDir, {
      runId: 'done2', taskId: 't2', status: 'failure',
      finishedAt: new Date().toISOString(), pid: process.pid,
    });
    const status = await getConcurrencyStatus();
    expect(status.running).toBe(0);
    expect(status.queued).toBe(0);
  });

  it('large number of runs does not break slot acquisition', async () => {
    setupConfig({ maxConcurrency: 3 });
    // 3 running
    for (let i = 0; i < 3; i++) {
      writeRunFile(dirs.runsDir, { runId: `run-${i}`, taskId: `t${i}`, status: 'running', pid: process.pid });
    }
    // 10 queued
    for (let i = 0; i < 10; i++) {
      writeRunFile(dirs.runsDir, {
        runId: `queue-${i}`, taskId: `q${i}`, status: 'queued',
        startedAt: minutesAgo(10 - i), pid: process.pid,
      });
    }
    // 20 completed
    for (let i = 0; i < 20; i++) {
      writeRunFile(dirs.runsDir, {
        runId: `done-${i}`, taskId: `d${i}`, status: 'success',
        finishedAt: new Date().toISOString(), pid: process.pid,
      });
    }
    const result = await tryAcquireSlot();
    expect(result.acquired).toBe(false);
    expect(result.runningCount).toBe(3);
    expect(result.maxConcurrency).toBe(3);
  });
});
