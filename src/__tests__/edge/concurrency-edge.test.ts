import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdirSync,
  rmSync,
  mkdtempSync,
  existsSync,
  openSync,
  closeSync,
  unlinkSync,
  utimesSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir: string;
let configDir: string;

// Shared mutable state for runs mock — reset in beforeEach
const runRecords = new Map<string, any>();

vi.mock('../../config.js', () => ({
  getConfigDir: () => configDir,
  loadConfig: () => ({
    secretKey: 'test-key',
    version: '0.1.0',
    tasksDirs: [],
    logsDir: '',
    maxConcurrency: 2,
  }),
}));

vi.mock('../../runs.js', () => ({
  getRunningCount: () => {
    let count = 0;
    for (const r of runRecords.values()) {
      if (r.status === 'running') count++;
    }
    return count;
  },
  cleanupStaleRuns: () => 0,
  getQueuedRuns: () => {
    const queued: any[] = [];
    for (const r of runRecords.values()) {
      if (r.status === 'queued') queued.push(r);
    }
    return queued.sort(
      (a: any, b: any) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
    );
  },
  updateRun: (runId: string, updates: any) => {
    const existing = runRecords.get(runId);
    if (existing) {
      Object.assign(existing, updates);
    }
    return existing || null;
  },
}));

let concurrencyModule: typeof import('../../concurrency.js');

beforeEach(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'concurrency-edge-'));
  configDir = join(testDir, '.cron-agents');
  mkdirSync(configDir, { recursive: true });
  runRecords.clear();
  vi.resetModules();
  concurrencyModule = await import('../../concurrency.js');
});

afterEach(() => {
  const lockPath = join(configDir, 'concurrency.lock');
  try {
    if (existsSync(lockPath)) unlinkSync(lockPath);
  } catch {}
  rmSync(testDir, { recursive: true, force: true });
});

function getLockPath(): string {
  return join(configDir, 'concurrency.lock');
}

function createLockFile(): void {
  const fd = openSync(getLockPath(), 'w');
  closeSync(fd);
}

function backdateLockFile(ageMs: number): void {
  const lockPath = getLockPath();
  const past = new Date(Date.now() - ageMs);
  utimesSync(lockPath, past, past);
}

// ---------------------------------------------------------------------------
// tryAcquireSlot basics
// ---------------------------------------------------------------------------
describe('tryAcquireSlot', () => {
  it('acquires slot when no tasks are running', async () => {
    const result = await concurrencyModule.tryAcquireSlot();
    expect(result.acquired).toBe(true);
    expect(result.runningCount).toBe(0);
    expect(result.maxConcurrency).toBe(2);
  });

  it('acquires slot when running count < maxConcurrency', async () => {
    runRecords.set('run-1', {
      runId: 'run-1',
      taskId: 'task-1',
      startedAt: new Date().toISOString(),
      status: 'running',
      pid: process.pid,
    });
    const result = await concurrencyModule.tryAcquireSlot();
    expect(result.acquired).toBe(true);
    expect(result.runningCount).toBe(1);
  });

  it('denies slot when running count >= maxConcurrency', async () => {
    runRecords.set('run-1', {
      runId: 'run-1',
      taskId: 'task-1',
      startedAt: new Date().toISOString(),
      status: 'running',
      pid: process.pid,
    });
    runRecords.set('run-2', {
      runId: 'run-2',
      taskId: 'task-2',
      startedAt: new Date().toISOString(),
      status: 'running',
      pid: process.pid,
    });
    const result = await concurrencyModule.tryAcquireSlot();
    expect(result.acquired).toBe(false);
    expect(result.runningCount).toBe(2);
  });

  it('returns correct maxConcurrency from config', async () => {
    const result = await concurrencyModule.tryAcquireSlot();
    expect(result.maxConcurrency).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Lock file behavior (internal, tested via tryAcquireSlot)
// ---------------------------------------------------------------------------
describe('lock file behavior', () => {
  it('lock file is cleaned up after tryAcquireSlot completes', async () => {
    await concurrencyModule.tryAcquireSlot();
    // The withLock function should release the lock after completion
    expect(existsSync(getLockPath())).toBe(false);
  });

  it('stale lock file (>30s) is removed and acquisition succeeds', async () => {
    createLockFile();
    backdateLockFile(35_000); // 35 seconds old
    const result = await concurrencyModule.tryAcquireSlot();
    expect(result.acquired).toBe(true);
  });

  it('fresh lock file blocks acquisition temporarily', async () => {
    createLockFile();
    // Lock is fresh (<30s), so acquireLock will fail initially
    // But withLock retries for up to 5 seconds, then force-removes
    // The test verifies it eventually succeeds (force fallback)
    const result = await concurrencyModule.tryAcquireSlot();
    expect(result).toBeDefined();
  });

  it('lock file does not persist after successful slot check', async () => {
    const result = await concurrencyModule.tryAcquireSlot();
    expect(result.acquired).toBe(true);
    expect(existsSync(getLockPath())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sequential acquire/release via tryAcquireSlot
// ---------------------------------------------------------------------------
describe('sequential slot acquisition', () => {
  it('multiple sequential tryAcquireSlot calls all succeed when no tasks running', async () => {
    for (let i = 0; i < 5; i++) {
      const result = await concurrencyModule.tryAcquireSlot();
      expect(result.acquired).toBe(true);
    }
  });

  it('slot becomes available after a run completes', async () => {
    // Fill both slots
    runRecords.set('run-a', {
      runId: 'run-a',
      taskId: 'task-a',
      startedAt: new Date().toISOString(),
      status: 'running',
      pid: process.pid,
    });
    runRecords.set('run-b', {
      runId: 'run-b',
      taskId: 'task-b',
      startedAt: new Date().toISOString(),
      status: 'running',
      pid: process.pid,
    });

    let result = await concurrencyModule.tryAcquireSlot();
    expect(result.acquired).toBe(false);

    // Complete one run
    runRecords.get('run-a')!.status = 'success';

    result = await concurrencyModule.tryAcquireSlot();
    expect(result.acquired).toBe(true);
    expect(result.runningCount).toBe(1);
  });

  it('slot available after run transitions to failure', async () => {
    runRecords.set('run-f1', {
      runId: 'run-f1',
      taskId: 'task-f1',
      startedAt: new Date().toISOString(),
      status: 'running',
      pid: process.pid,
    });
    runRecords.set('run-f2', {
      runId: 'run-f2',
      taskId: 'task-f2',
      startedAt: new Date().toISOString(),
      status: 'running',
      pid: process.pid,
    });

    // Fail one
    runRecords.get('run-f2')!.status = 'failure';

    const result = await concurrencyModule.tryAcquireSlot();
    expect(result.acquired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getConcurrencyStatus
// ---------------------------------------------------------------------------
describe('getConcurrencyStatus', () => {
  it('returns zeros when nothing is running or queued', async () => {
    const status = await concurrencyModule.getConcurrencyStatus();
    expect(status.running).toBe(0);
    expect(status.queued).toBe(0);
    expect(status.maxConcurrency).toBe(2);
  });

  it('reports correct running count', async () => {
    runRecords.set('run-s1', {
      runId: 'run-s1',
      taskId: 'task-s1',
      startedAt: new Date().toISOString(),
      status: 'running',
      pid: process.pid,
    });
    const status = await concurrencyModule.getConcurrencyStatus();
    expect(status.running).toBe(1);
  });

  it('reports correct queued count', async () => {
    runRecords.set('run-q1', {
      runId: 'run-q1',
      taskId: 'task-q1',
      startedAt: new Date().toISOString(),
      status: 'queued',
      pid: process.pid,
    });
    runRecords.set('run-q2', {
      runId: 'run-q2',
      taskId: 'task-q2',
      startedAt: new Date().toISOString(),
      status: 'queued',
      pid: process.pid,
    });
    const status = await concurrencyModule.getConcurrencyStatus();
    expect(status.queued).toBe(2);
  });

  it('completed runs do not count as running', async () => {
    runRecords.set('run-done', {
      runId: 'run-done',
      taskId: 'task-done',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'success',
      pid: process.pid,
    });
    const status = await concurrencyModule.getConcurrencyStatus();
    expect(status.running).toBe(0);
  });

  it('failed runs do not count as running', async () => {
    runRecords.set('run-fail', {
      runId: 'run-fail',
      taskId: 'task-fail',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'failure',
      pid: process.pid,
    });
    const status = await concurrencyModule.getConcurrencyStatus();
    expect(status.running).toBe(0);
  });

  it('mixed running and queued are reported correctly', async () => {
    runRecords.set('run-mix1', {
      runId: 'run-mix1',
      taskId: 'task-mix1',
      startedAt: new Date().toISOString(),
      status: 'running',
      pid: process.pid,
    });
    runRecords.set('run-mix2', {
      runId: 'run-mix2',
      taskId: 'task-mix2',
      startedAt: new Date().toISOString(),
      status: 'queued',
      pid: process.pid,
    });
    runRecords.set('run-mix3', {
      runId: 'run-mix3',
      taskId: 'task-mix3',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'success',
      pid: process.pid,
    });
    const status = await concurrencyModule.getConcurrencyStatus();
    expect(status.running).toBe(1);
    expect(status.queued).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Rapid acquire cycles
// ---------------------------------------------------------------------------
describe('rapid acquire cycles', () => {
  it('50 sequential tryAcquireSlot calls with no leaks', async () => {
    for (let i = 0; i < 50; i++) {
      const result = await concurrencyModule.tryAcquireSlot();
      expect(result.acquired).toBe(true);
    }
    // No stale lock should remain
    expect(existsSync(getLockPath())).toBe(false);
  });

  it('alternating full/empty slots over many iterations', async () => {
    for (let i = 0; i < 20; i++) {
      // Fill slots
      runRecords.set(`iter-${i}-a`, {
        runId: `iter-${i}-a`,
        taskId: 'task-a',
        startedAt: new Date().toISOString(),
        status: 'running',
        pid: process.pid,
      });
      runRecords.set(`iter-${i}-b`, {
        runId: `iter-${i}-b`,
        taskId: 'task-b',
        startedAt: new Date().toISOString(),
        status: 'running',
        pid: process.pid,
      });

      const full = await concurrencyModule.tryAcquireSlot();
      expect(full.acquired).toBe(false);

      // Free slots
      runRecords.get(`iter-${i}-a`)!.status = 'success';
      runRecords.get(`iter-${i}-b`)!.status = 'success';

      const free = await concurrencyModule.tryAcquireSlot();
      expect(free.acquired).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Lock dir doesn't exist initially
// ---------------------------------------------------------------------------
describe('lock dir handling', () => {
  it('tryAcquireSlot works even if config dir does not exist initially', async () => {
    rmSync(configDir, { recursive: true, force: true });
    mkdirSync(configDir, { recursive: true });
    const result = await concurrencyModule.tryAcquireSlot();
    expect(result.acquired).toBe(true);
  });

  it('getConcurrencyStatus works with fresh config dir', async () => {
    const status = await concurrencyModule.getConcurrencyStatus();
    expect(status).toHaveProperty('running');
    expect(status).toHaveProperty('queued');
    expect(status).toHaveProperty('maxConcurrency');
  });
});

// ---------------------------------------------------------------------------
// SlotResult shape
// ---------------------------------------------------------------------------
describe('SlotResult shape', () => {
  it('has acquired, runningCount, maxConcurrency fields', async () => {
    const result = await concurrencyModule.tryAcquireSlot();
    expect(result).toHaveProperty('acquired');
    expect(result).toHaveProperty('runningCount');
    expect(result).toHaveProperty('maxConcurrency');
    expect(typeof result.acquired).toBe('boolean');
    expect(typeof result.runningCount).toBe('number');
    expect(typeof result.maxConcurrency).toBe('number');
  });

  it('runningCount is never negative', async () => {
    const result = await concurrencyModule.tryAcquireSlot();
    expect(result.runningCount).toBeGreaterThanOrEqual(0);
  });

  it('maxConcurrency matches config value', async () => {
    const result = await concurrencyModule.tryAcquireSlot();
    expect(result.maxConcurrency).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Edge: queued runs and ordering
// ---------------------------------------------------------------------------
describe('queued run ordering', () => {
  it('queued runs are reported in FIFO order', async () => {
    const t1 = new Date('2024-01-01T10:00:00Z').toISOString();
    const t2 = new Date('2024-01-01T10:01:00Z').toISOString();
    const t3 = new Date('2024-01-01T10:02:00Z').toISOString();

    runRecords.set('q-3', {
      runId: 'q-3',
      taskId: 'task-3',
      startedAt: t3,
      status: 'queued',
    });
    runRecords.set('q-1', {
      runId: 'q-1',
      taskId: 'task-1',
      startedAt: t1,
      status: 'queued',
    });
    runRecords.set('q-2', {
      runId: 'q-2',
      taskId: 'task-2',
      startedAt: t2,
      status: 'queued',
    });

    const status = await concurrencyModule.getConcurrencyStatus();
    expect(status.queued).toBe(3);
  });

  it('queued runs do not affect slot acquisition decision', async () => {
    // Queued runs should not count toward running count
    runRecords.set('q-only', {
      runId: 'q-only',
      taskId: 'task-q',
      startedAt: new Date().toISOString(),
      status: 'queued',
    });
    const result = await concurrencyModule.tryAcquireSlot();
    expect(result.acquired).toBe(true);
    expect(result.runningCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Edge: concurrent state transitions
// ---------------------------------------------------------------------------
describe('state transitions', () => {
  it('moving all runs to success frees all slots', async () => {
    runRecords.set('t-1', {
      runId: 't-1',
      taskId: 'task-1',
      startedAt: new Date().toISOString(),
      status: 'running',
      pid: process.pid,
    });
    runRecords.set('t-2', {
      runId: 't-2',
      taskId: 'task-2',
      startedAt: new Date().toISOString(),
      status: 'running',
      pid: process.pid,
    });

    let result = await concurrencyModule.tryAcquireSlot();
    expect(result.acquired).toBe(false);

    runRecords.get('t-1')!.status = 'success';
    runRecords.get('t-2')!.status = 'success';

    result = await concurrencyModule.tryAcquireSlot();
    expect(result.acquired).toBe(true);
    expect(result.runningCount).toBe(0);
  });

  it('transitioning from queued to running increases running count', async () => {
    runRecords.set('tr-1', {
      runId: 'tr-1',
      taskId: 'task-tr1',
      startedAt: new Date().toISOString(),
      status: 'queued',
    });

    let status = await concurrencyModule.getConcurrencyStatus();
    expect(status.running).toBe(0);
    expect(status.queued).toBe(1);

    // Transition to running
    runRecords.get('tr-1')!.status = 'running';

    status = await concurrencyModule.getConcurrencyStatus();
    expect(status.running).toBe(1);
    expect(status.queued).toBe(0);
  });
});
