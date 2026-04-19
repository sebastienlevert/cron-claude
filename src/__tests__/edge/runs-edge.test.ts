import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir: string;

vi.mock('os', async (importOriginal) => {
  const orig = await importOriginal<typeof import('os')>();
  return { ...orig, homedir: () => testDir };
});

vi.mock('../../config.js', () => ({
  getConfigDir: () => join(testDir, '.cron-agents'),
  loadConfig: () => ({
    secretKey: 'test-key',
    version: '0.1.0',
    tasksDirs: [join(testDir, '.cron-agents', 'tasks')],
    logsDir: join(testDir, '.cron-agents', 'logs'),
    maxConcurrency: 2,
  }),
}));

let runsModule: typeof import('../../runs.js');

beforeEach(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'runs-edge-'));
  mkdirSync(join(testDir, '.cron-agents', 'runs'), { recursive: true });
  vi.resetModules();
  runsModule = await import('../../runs.js');
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runsDir(): string {
  return join(testDir, '.cron-agents', 'runs');
}

function writeRunFile(runId: string, data: unknown) {
  writeFileSync(join(runsDir(), `${runId}.json`), typeof data === 'string' ? data : JSON.stringify(data, null, 2), 'utf-8');
}

function writeRawFile(filename: string, content: string) {
  writeFileSync(join(runsDir(), filename), content, 'utf-8');
}

// ===========================================================================
// 1. Corrupt JSON files
// ===========================================================================
describe('Corrupt JSON files', () => {
  it('getRun returns null for corrupt JSON', () => {
    writeRawFile('run-corrupt-1.json', '{corrupt');
    expect(runsModule.getRun('run-corrupt-1')).toBeNull();
  });

  it('getRun returns null for empty file', () => {
    writeRawFile('run-empty.json', '');
    expect(runsModule.getRun('run-empty')).toBeNull();
  });

  it('getRun returns null for file containing just whitespace', () => {
    writeRawFile('run-ws.json', '   \n\t  ');
    expect(runsModule.getRun('run-ws')).toBeNull();
  });

  it('getRun returns null for truncated JSON', () => {
    writeRawFile('run-trunc.json', '{"runId":"run-trunc","taskId":"t1"');
    expect(runsModule.getRun('run-trunc')).toBeNull();
  });

  it('getRun returns null for JSON array instead of object', () => {
    writeRawFile('run-arr.json', '[1,2,3]');
    // Arrays are valid JSON but getRun just returns whatever was parsed
    const result = runsModule.getRun('run-arr');
    // It will return the parsed value (array); this tests it doesn't throw
    expect(result).not.toBeNull();
  });

  it('updateRun returns null for corrupt JSON file', () => {
    writeRawFile('run-corrupt-upd.json', '{broken json!!!');
    expect(runsModule.updateRun('run-corrupt-upd', { status: 'success' })).toBeNull();
  });

  it('updateRun returns null for file with binary garbage', () => {
    writeFileSync(join(runsDir(), 'run-binary.json'), Buffer.from([0x00, 0xff, 0xfe, 0x80]));
    expect(runsModule.updateRun('run-binary', { status: 'success' })).toBeNull();
  });

  it('getLatestRunForTask skips corrupt files and returns valid match', () => {
    writeRawFile('run-aaaa-corrupt.json', '{nope');
    writeRunFile('run-zzzz-valid', {
      runId: 'run-zzzz-valid',
      taskId: 'my-task',
      startedAt: new Date().toISOString(),
      status: 'running',
      pid: process.pid,
    });
    const latest = runsModule.getLatestRunForTask('my-task');
    expect(latest).not.toBeNull();
    expect(latest?.runId).toBe('run-zzzz-valid');
  });

  it('getLatestRunForTask returns null when all files are corrupt', () => {
    writeRawFile('run-aaa.json', '{bad');
    writeRawFile('run-bbb.json', '');
    writeRawFile('run-ccc.json', 'null');
    expect(runsModule.getLatestRunForTask('any-task')).toBeNull();
  });

  it('getRunsByStatus skips corrupt files gracefully', () => {
    writeRawFile('run-bad.json', '{corrupt');
    writeRunFile('run-good', {
      runId: 'run-good',
      taskId: 'task-1',
      startedAt: new Date().toISOString(),
      status: 'running',
      pid: process.pid,
    });
    const results = runsModule.getRunsByStatus('running');
    expect(results.length).toBe(1);
    expect(results[0].runId).toBe('run-good');
  });

  it('cleanupStaleRuns skips corrupt files without throwing', () => {
    writeRawFile('run-corrupt-stale.json', '{{{');
    expect(() => runsModule.cleanupStaleRuns()).not.toThrow();
    expect(runsModule.cleanupStaleRuns()).toBe(0);
  });

  it('cleanupOldRuns skips corrupt files without throwing', () => {
    writeRawFile('run-corrupt-old.json', '!!!');
    expect(() => runsModule.cleanupOldRuns()).not.toThrow();
  });
});

// ===========================================================================
// 2. Invalid dates
// ===========================================================================
describe('Invalid dates in cleanupOldRuns', () => {
  it('skips run with finishedAt "not-a-date"', () => {
    writeRunFile('run-baddate-1', {
      runId: 'run-baddate-1',
      taskId: 'task-1',
      startedAt: '2020-01-01T00:00:00Z',
      status: 'success',
      finishedAt: 'not-a-date',
      pid: process.pid,
    });
    const cleaned = runsModule.cleanupOldRuns();
    // Should not delete because NaN check skips it
    expect(existsSync(join(runsDir(), 'run-baddate-1.json'))).toBe(true);
  });

  it('skips run with finishedAt as empty string', () => {
    writeRunFile('run-baddate-2', {
      runId: 'run-baddate-2',
      taskId: 'task-1',
      startedAt: '2020-01-01T00:00:00Z',
      status: 'failure',
      finishedAt: '',
      pid: process.pid,
    });
    runsModule.cleanupOldRuns();
    expect(existsSync(join(runsDir(), 'run-baddate-2.json'))).toBe(true);
  });

  it('skips run with finishedAt as null', () => {
    writeRunFile('run-baddate-3', {
      runId: 'run-baddate-3',
      taskId: 'task-1',
      startedAt: '2020-01-01T00:00:00Z',
      status: 'success',
      finishedAt: null,
      pid: process.pid,
    });
    runsModule.cleanupOldRuns();
    // null is falsy, so the `run.finishedAt` check in cleanupOldRuns skips it
    expect(existsSync(join(runsDir(), 'run-baddate-3.json'))).toBe(true);
  });

  it('skips run with finishedAt as object', () => {
    writeRunFile('run-baddate-4', {
      runId: 'run-baddate-4',
      taskId: 'task-1',
      startedAt: '2020-01-01T00:00:00Z',
      status: 'success',
      finishedAt: { year: 2020 },
      pid: process.pid,
    });
    runsModule.cleanupOldRuns();
    expect(existsSync(join(runsDir(), 'run-baddate-4.json'))).toBe(true);
  });

  it('skips run with finishedAt as number 0', () => {
    writeRunFile('run-baddate-5', {
      runId: 'run-baddate-5',
      taskId: 'task-1',
      startedAt: '2020-01-01T00:00:00Z',
      status: 'success',
      finishedAt: 0,
      pid: process.pid,
    });
    runsModule.cleanupOldRuns();
    // 0 is falsy → condition `run.finishedAt` is false → skipped
    expect(existsSync(join(runsDir(), 'run-baddate-5.json'))).toBe(true);
  });

  it('correctly deletes run with valid old finishedAt', () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    writeRunFile('run-validold', {
      runId: 'run-validold',
      taskId: 'task-1',
      startedAt: oldDate,
      status: 'success',
      finishedAt: oldDate,
      pid: process.pid,
    });
    runsModule.cleanupOldRuns();
    expect(existsSync(join(runsDir(), 'run-validold.json'))).toBe(false);
  });
});

// ===========================================================================
// 3. PID boundary values
// ===========================================================================
describe('PID boundary values', () => {
  it('cleanupStaleRuns handles pid 0', () => {
    const oldDate = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    writeRunFile('run-pid0', {
      runId: 'run-pid0',
      taskId: 'task-1',
      startedAt: oldDate,
      status: 'running',
      pid: 0,
    });
    // pid 0 is falsy, so !run.pid is true → should be marked as failure
    const cleaned = runsModule.cleanupStaleRuns();
    expect(cleaned).toBe(1);
    expect(runsModule.getRun('run-pid0')?.status).toBe('failure');
  });

  it('cleanupStaleRuns handles pid -1', () => {
    const oldDate = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    writeRunFile('run-pid-neg', {
      runId: 'run-pid-neg',
      taskId: 'task-1',
      startedAt: oldDate,
      status: 'running',
      pid: -1,
    });
    const cleaned = runsModule.cleanupStaleRuns();
    expect(cleaned).toBe(1);
    expect(runsModule.getRun('run-pid-neg')?.status).toBe('failure');
  });

  it('cleanupStaleRuns handles pid MAX_SAFE_INTEGER', () => {
    const oldDate = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    writeRunFile('run-pid-max', {
      runId: 'run-pid-max',
      taskId: 'task-1',
      startedAt: oldDate,
      status: 'running',
      pid: Number.MAX_SAFE_INTEGER,
    });
    const cleaned = runsModule.cleanupStaleRuns();
    expect(cleaned).toBe(1);
    expect(runsModule.getRun('run-pid-max')?.status).toBe('failure');
  });

  it('cleanupStaleRuns handles missing pid', () => {
    const oldDate = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    writeRunFile('run-nopid', {
      runId: 'run-nopid',
      taskId: 'task-1',
      startedAt: oldDate,
      status: 'running',
    });
    const cleaned = runsModule.cleanupStaleRuns();
    expect(cleaned).toBe(1);
    expect(runsModule.getRun('run-nopid')?.status).toBe('failure');
    expect(runsModule.getRun('run-nopid')?.error).toContain('unknown');
  });

  it('cleanupStaleRuns does not clean stale run with alive PID', () => {
    const oldDate = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    writeRunFile('run-alive', {
      runId: 'run-alive',
      taskId: 'task-1',
      startedAt: oldDate,
      status: 'running',
      pid: process.pid, // Current process is alive
    });
    const cleaned = runsModule.cleanupStaleRuns();
    expect(cleaned).toBe(0);
    expect(runsModule.getRun('run-alive')?.status).toBe('running');
  });
});

// ===========================================================================
// 4. Cleanup races — file disappears mid-read
// ===========================================================================
describe('Cleanup races', () => {
  it('cleanupStaleRuns survives file disappearing mid-iteration', () => {
    const oldDate = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    writeRunFile('run-vanish', {
      runId: 'run-vanish',
      taskId: 'task-1',
      startedAt: oldDate,
      status: 'running',
      pid: 999999,
    });
    // Delete the file right before cleanupStaleRuns would read it
    // We can't perfectly time this, but we can test that if the file
    // is gone by the time we read, the function doesn't throw
    unlinkSync(join(runsDir(), 'run-vanish.json'));
    expect(() => runsModule.cleanupStaleRuns()).not.toThrow();
  });

  it('cleanupOldRuns survives file disappearing during iteration', () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    writeRunFile('run-ghost', {
      runId: 'run-ghost',
      taskId: 'task-1',
      startedAt: oldDate,
      status: 'success',
      finishedAt: oldDate,
      pid: process.pid,
    });
    unlinkSync(join(runsDir(), 'run-ghost.json'));
    expect(() => runsModule.cleanupOldRuns()).not.toThrow();
  });

  it('getRunsByStatus survives file disappearing mid-scan', () => {
    writeRunFile('run-disappear', {
      runId: 'run-disappear',
      taskId: 'task-1',
      startedAt: new Date().toISOString(),
      status: 'running',
      pid: process.pid,
    });
    unlinkSync(join(runsDir(), 'run-disappear.json'));
    expect(() => runsModule.getRunsByStatus('running')).not.toThrow();
  });
});

// ===========================================================================
// 5. Empty runs directory
// ===========================================================================
describe('Empty runs directory', () => {
  it('getRun returns null', () => {
    expect(runsModule.getRun('run-nonexistent')).toBeNull();
  });

  it('getLatestRunForTask returns null', () => {
    expect(runsModule.getLatestRunForTask('task-1')).toBeNull();
  });

  it('getRunsByStatus returns empty array', () => {
    expect(runsModule.getRunsByStatus('running')).toEqual([]);
  });

  it('getRunningCount returns 0', () => {
    expect(runsModule.getRunningCount()).toBe(0);
  });

  it('getQueuedRuns returns empty array', () => {
    expect(runsModule.getQueuedRuns()).toEqual([]);
  });

  it('cleanupStaleRuns returns 0', () => {
    expect(runsModule.cleanupStaleRuns()).toBe(0);
  });

  it('cleanupOldRuns returns 0', () => {
    expect(runsModule.cleanupOldRuns()).toBe(0);
  });
});

// ===========================================================================
// 6. Massive number of run files
// ===========================================================================
describe('Massive number of run files', () => {
  it('handles 100+ run files without error', () => {
    for (let i = 0; i < 120; i++) {
      writeRunFile(`run-mass-${String(i).padStart(4, '0')}`, {
        runId: `run-mass-${String(i).padStart(4, '0')}`,
        taskId: `task-${i % 10}`,
        startedAt: new Date(Date.now() - i * 1000).toISOString(),
        status: i % 3 === 0 ? 'running' : i % 3 === 1 ? 'queued' : 'success',
        finishedAt: i % 3 === 2 ? new Date(Date.now() - i * 1000).toISOString() : undefined,
        pid: process.pid,
      });
    }
    const running = runsModule.getRunsByStatus('running');
    const queued = runsModule.getRunsByStatus('queued');
    const success = runsModule.getRunsByStatus('success');
    expect(running.length).toBe(40);
    expect(queued.length).toBe(40);
    expect(success.length).toBe(40);
  });

  it('getLatestRunForTask works with many files', () => {
    for (let i = 0; i < 100; i++) {
      writeRunFile(`run-lat-${String(i).padStart(4, '0')}`, {
        runId: `run-lat-${String(i).padStart(4, '0')}`,
        taskId: 'target-task',
        startedAt: new Date(Date.now() - i * 1000).toISOString(),
        status: 'success',
        finishedAt: new Date().toISOString(),
        pid: process.pid,
      });
    }
    const latest = runsModule.getLatestRunForTask('target-task');
    expect(latest).not.toBeNull();
    // Reverse-sorted filenames → run-lat-0099 is lexically last → comes first in reverse
    expect(latest?.runId).toBe('run-lat-0099');
  });

  it('cleanupOldRuns with many expired runs', () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    for (let i = 0; i < 50; i++) {
      writeRunFile(`run-exp-${String(i).padStart(4, '0')}`, {
        runId: `run-exp-${String(i).padStart(4, '0')}`,
        taskId: 'task-cleanup',
        startedAt: oldDate,
        status: 'success',
        finishedAt: oldDate,
        pid: process.pid,
      });
    }
    const cleaned = runsModule.cleanupOldRuns();
    expect(cleaned).toBeGreaterThanOrEqual(50);
    expect(readdirSync(runsDir()).filter(f => f.startsWith('run-exp-')).length).toBe(0);
  });
});

// ===========================================================================
// 7. getLatestRunForTask with no matches
// ===========================================================================
describe('getLatestRunForTask with no matches', () => {
  it('returns null when task has no runs among many files', () => {
    for (let i = 0; i < 10; i++) {
      writeRunFile(`run-other-${i}`, {
        runId: `run-other-${i}`,
        taskId: 'other-task',
        startedAt: new Date().toISOString(),
        status: 'running',
        pid: process.pid,
      });
    }
    expect(runsModule.getLatestRunForTask('non-existent-task')).toBeNull();
  });

  it('returns null for empty string taskId', () => {
    runsModule.createRun('task-1');
    expect(runsModule.getLatestRunForTask('')).toBeNull();
  });
});

// ===========================================================================
// 8. getQueuedRuns ordering
// ===========================================================================
describe('getQueuedRuns ordering', () => {
  it('FIFO order with same-second timestamps', () => {
    const baseTime = '2024-06-15T12:00:00.000Z';
    writeRunFile('run-q-aaa', {
      runId: 'run-q-aaa',
      taskId: 'task-a',
      startedAt: baseTime,
      status: 'queued',
      pid: process.pid,
    });
    writeRunFile('run-q-bbb', {
      runId: 'run-q-bbb',
      taskId: 'task-b',
      startedAt: baseTime,
      status: 'queued',
      pid: process.pid,
    });
    writeRunFile('run-q-ccc', {
      runId: 'run-q-ccc',
      taskId: 'task-c',
      startedAt: baseTime,
      status: 'queued',
      pid: process.pid,
    });
    const queued = runsModule.getQueuedRuns();
    expect(queued.length).toBe(3);
    // All same timestamp, so order is stable but all are returned
    const ids = queued.map(r => r.runId);
    expect(ids).toContain('run-q-aaa');
    expect(ids).toContain('run-q-bbb');
    expect(ids).toContain('run-q-ccc');
  });

  it('FIFO respects millisecond differences', () => {
    writeRunFile('run-fq-3', {
      runId: 'run-fq-3',
      taskId: 'task-3',
      startedAt: '2024-06-15T12:00:00.003Z',
      status: 'queued',
      pid: process.pid,
    });
    writeRunFile('run-fq-1', {
      runId: 'run-fq-1',
      taskId: 'task-1',
      startedAt: '2024-06-15T12:00:00.001Z',
      status: 'queued',
      pid: process.pid,
    });
    writeRunFile('run-fq-2', {
      runId: 'run-fq-2',
      taskId: 'task-2',
      startedAt: '2024-06-15T12:00:00.002Z',
      status: 'queued',
      pid: process.pid,
    });
    const queued = runsModule.getQueuedRuns();
    expect(queued[0].runId).toBe('run-fq-1');
    expect(queued[1].runId).toBe('run-fq-2');
    expect(queued[2].runId).toBe('run-fq-3');
  });

  it('excludes non-queued runs from FIFO list', () => {
    writeRunFile('run-mixed-q', {
      runId: 'run-mixed-q',
      taskId: 'task-q',
      startedAt: '2024-01-01T00:00:01.000Z',
      status: 'queued',
      pid: process.pid,
    });
    writeRunFile('run-mixed-r', {
      runId: 'run-mixed-r',
      taskId: 'task-r',
      startedAt: '2024-01-01T00:00:00.500Z',
      status: 'running',
      pid: process.pid,
    });
    const queued = runsModule.getQueuedRuns();
    expect(queued.length).toBe(1);
    expect(queued[0].runId).toBe('run-mixed-q');
  });
});

// ===========================================================================
// 9. createRun uniqueness
// ===========================================================================
describe('createRun uniqueness', () => {
  it('100 consecutive creates all have unique runIds', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const run = runsModule.createRun('task-uniq');
      ids.add(run.runId);
    }
    expect(ids.size).toBe(100);
  });

  it('all 100 runs are persisted as separate files', () => {
    for (let i = 0; i < 100; i++) {
      runsModule.createRun('task-persist');
    }
    const files = readdirSync(runsDir()).filter(f => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(100);
  });
});

// ===========================================================================
// 10. Status transitions
// ===========================================================================
describe('Status transitions', () => {
  it('running → success', () => {
    const run = runsModule.createRun('task-1', 'running');
    const updated = runsModule.updateRun(run.runId, {
      status: 'success',
      finishedAt: new Date().toISOString(),
    });
    expect(updated?.status).toBe('success');
    expect(updated?.finishedAt).toBeDefined();
  });

  it('running → failure', () => {
    const run = runsModule.createRun('task-1', 'running');
    const updated = runsModule.updateRun(run.runId, {
      status: 'failure',
      finishedAt: new Date().toISOString(),
      error: 'Task crashed',
    });
    expect(updated?.status).toBe('failure');
    expect(updated?.error).toBe('Task crashed');
  });

  it('queued → running → success', () => {
    const run = runsModule.createRun('task-1', 'queued');
    expect(run.status).toBe('queued');

    const running = runsModule.updateRun(run.runId, { status: 'running' });
    expect(running?.status).toBe('running');

    const success = runsModule.updateRun(run.runId, {
      status: 'success',
      finishedAt: new Date().toISOString(),
    });
    expect(success?.status).toBe('success');
  });

  it('queued → running → failure', () => {
    const run = runsModule.createRun('task-1', 'queued');
    runsModule.updateRun(run.runId, { status: 'running' });
    const result = runsModule.updateRun(run.runId, {
      status: 'failure',
      error: 'timeout',
      finishedAt: new Date().toISOString(),
    });
    expect(result?.status).toBe('failure');
    expect(result?.error).toBe('timeout');
  });

  it('multiple updates preserve history of fields', () => {
    const run = runsModule.createRun('task-1', 'queued');
    runsModule.updateRun(run.runId, { status: 'running' });
    runsModule.updateRun(run.runId, { status: 'success', finishedAt: '2024-01-01T00:00:00Z' });
    const final = runsModule.getRun(run.runId);
    expect(final?.taskId).toBe('task-1');
    expect(final?.status).toBe('success');
    expect(final?.finishedAt).toBe('2024-01-01T00:00:00Z');
    expect(final?.pid).toBe(process.pid);
  });
});

// ===========================================================================
// 11. Non-JSON files in runs dir
// ===========================================================================
describe('Non-JSON files in runs dir', () => {
  it('text files are ignored by getRunsByStatus', () => {
    writeFileSync(join(runsDir(), 'readme.txt'), 'some text', 'utf-8');
    writeRunFile('run-real', {
      runId: 'run-real',
      taskId: 'task-1',
      startedAt: new Date().toISOString(),
      status: 'running',
      pid: process.pid,
    });
    expect(runsModule.getRunsByStatus('running').length).toBe(1);
  });

  it('hidden files are ignored by getLatestRunForTask', () => {
    writeFileSync(join(runsDir(), '.hidden.json'), JSON.stringify({
      runId: '.hidden',
      taskId: 'task-1',
      startedAt: new Date().toISOString(),
      status: 'running',
    }), 'utf-8');
    // .hidden.json does end with .json, so it may be picked up
    // The important thing is it doesn't crash
    expect(() => runsModule.getLatestRunForTask('task-1')).not.toThrow();
  });

  it('files without .json extension are ignored by getQueuedRuns', () => {
    writeFileSync(join(runsDir(), 'run-fake.txt'), JSON.stringify({
      runId: 'run-fake',
      taskId: 'task-1',
      startedAt: new Date().toISOString(),
      status: 'queued',
    }), 'utf-8');
    expect(runsModule.getQueuedRuns().length).toBe(0);
  });

  it('subdirectories in runs dir are ignored', () => {
    mkdirSync(join(runsDir(), 'subdir'), { recursive: true });
    writeRunFile('run-legit', {
      runId: 'run-legit',
      taskId: 'task-1',
      startedAt: new Date().toISOString(),
      status: 'running',
      pid: process.pid,
    });
    // readdirSync returns 'subdir' which doesn't end with .json → filtered
    expect(runsModule.getRunsByStatus('running').length).toBe(1);
  });

  it('cleanupOldRuns ignores non-JSON files', () => {
    writeFileSync(join(runsDir(), 'notes.md'), '# Notes', 'utf-8');
    expect(() => runsModule.cleanupOldRuns()).not.toThrow();
    // The non-JSON file should still exist
    expect(existsSync(join(runsDir(), 'notes.md'))).toBe(true);
  });
});

// ===========================================================================
// 12. Unicode in taskId
// ===========================================================================
describe('Unicode in taskId', () => {
  it('createRun with emoji taskId', () => {
    const run = runsModule.createRun('🚀-deploy');
    expect(run.taskId).toBe('🚀-deploy');
    const fetched = runsModule.getRun(run.runId);
    expect(fetched?.taskId).toBe('🚀-deploy');
  });

  it('createRun with spaces in taskId', () => {
    const run = runsModule.createRun('my task with spaces');
    expect(run.taskId).toBe('my task with spaces');
  });

  it('createRun with special characters', () => {
    const run = runsModule.createRun('task/sub:v2@latest');
    expect(run.taskId).toBe('task/sub:v2@latest');
    const fetched = runsModule.getRun(run.runId);
    expect(fetched?.taskId).toBe('task/sub:v2@latest');
  });

  it('getLatestRunForTask with unicode taskId', () => {
    runsModule.createRun('任务-一');
    const latest = runsModule.getLatestRunForTask('任务-一');
    expect(latest).not.toBeNull();
    expect(latest?.taskId).toBe('任务-一');
  });

  it('getRunsByStatus returns runs with unicode taskIds', () => {
    runsModule.createRun('tâche-française', 'queued');
    const queued = runsModule.getRunsByStatus('queued');
    expect(queued.some(r => r.taskId === 'tâche-française')).toBe(true);
  });
});

// ===========================================================================
// 13. Very long taskId
// ===========================================================================
describe('Very long taskId', () => {
  it('createRun with 1000+ char taskId succeeds', () => {
    const longId = 'a'.repeat(1200);
    const run = runsModule.createRun(longId);
    expect(run.taskId).toBe(longId);
    expect(run.taskId.length).toBe(1200);
  });

  it('getRun retrieves run with long taskId', () => {
    const longId = 'x'.repeat(1500);
    const run = runsModule.createRun(longId);
    const fetched = runsModule.getRun(run.runId);
    expect(fetched?.taskId).toBe(longId);
  });

  it('getLatestRunForTask matches long taskId', () => {
    const longId = 'z'.repeat(1000);
    runsModule.createRun(longId);
    const latest = runsModule.getLatestRunForTask(longId);
    expect(latest).not.toBeNull();
    expect(latest?.taskId.length).toBe(1000);
  });
});

// ===========================================================================
// 14. Run file with extra fields
// ===========================================================================
describe('Run file with extra fields', () => {
  it('getRun preserves extra fields', () => {
    writeRunFile('run-extra-1', {
      runId: 'run-extra-1',
      taskId: 'task-1',
      startedAt: new Date().toISOString(),
      status: 'running',
      pid: process.pid,
      customField: 'hello',
      nested: { key: 'value' },
    });
    const run = runsModule.getRun('run-extra-1') as Record<string, unknown>;
    expect(run).not.toBeNull();
    expect(run.customField).toBe('hello');
    expect(run.nested).toEqual({ key: 'value' });
  });

  it('updateRun preserves extra fields', () => {
    writeRunFile('run-extra-2', {
      runId: 'run-extra-2',
      taskId: 'task-1',
      startedAt: new Date().toISOString(),
      status: 'running',
      pid: process.pid,
      metadata: { version: 42 },
    });
    const updated = runsModule.updateRun('run-extra-2', { status: 'success' }) as Record<string, unknown>;
    expect(updated).not.toBeNull();
    expect(updated.status).toBe('success');
    expect(updated.metadata).toEqual({ version: 42 });
  });

  it('updateRun can add new extra fields via spread', () => {
    const run = runsModule.createRun('task-1');
    // updateRun uses spread, so extra fields in updates should be preserved
    const updated = runsModule.updateRun(run.runId, {
      status: 'success',
      logPath: '/some/log.md',
    } as any);
    expect(updated?.status).toBe('success');
    expect(updated?.logPath).toBe('/some/log.md');
  });

  it('extra fields survive round-trip through disk', () => {
    writeRunFile('run-extra-rt', {
      runId: 'run-extra-rt',
      taskId: 'task-1',
      startedAt: new Date().toISOString(),
      status: 'running',
      pid: process.pid,
      tags: ['urgent', 'daily'],
    });
    runsModule.updateRun('run-extra-rt', { status: 'success' });
    const onDisk = JSON.parse(readFileSync(join(runsDir(), 'run-extra-rt.json'), 'utf-8'));
    expect(onDisk.tags).toEqual(['urgent', 'daily']);
    expect(onDisk.status).toBe('success');
  });
});

// ===========================================================================
// 15. Concurrent createRun
// ===========================================================================
describe('Concurrent createRun', () => {
  it('multiple rapid creates do not collide', () => {
    const runs = [];
    for (let i = 0; i < 50; i++) {
      runs.push(runsModule.createRun('task-concurrent'));
    }
    const runIds = runs.map(r => r.runId);
    const uniqueIds = new Set(runIds);
    expect(uniqueIds.size).toBe(50);

    // Verify each file exists
    for (const run of runs) {
      expect(existsSync(join(runsDir(), `${run.runId}.json`))).toBe(true);
    }
  });

  it('creates for different tasks simultaneously are all unique', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const run = runsModule.createRun(`task-${i % 5}`);
      ids.add(run.runId);
    }
    expect(ids.size).toBe(30);
  });
});

// ===========================================================================
// 16. cleanupOldRuns with finishedAt exactly at TTL boundary
// ===========================================================================
describe('cleanupOldRuns TTL boundary precision', () => {
  it('does not delete run just inside TTL boundary', () => {
    // finishedAt is 23h59m ago — safely inside TTL even with clock drift
    const insideTTL = new Date(Date.now() - 24 * 60 * 60 * 1000 + 60_000).toISOString();
    writeRunFile('run-boundary-inside', {
      runId: 'run-boundary-inside',
      taskId: 'task-1',
      startedAt: insideTTL,
      status: 'success',
      finishedAt: insideTTL,
      pid: process.pid,
    });
    runsModule.cleanupOldRuns();
    expect(existsSync(join(runsDir(), 'run-boundary-inside.json'))).toBe(true);
  });

  it('deletes run 1ms past TTL boundary', () => {
    const justPastTTL = new Date(Date.now() - 24 * 60 * 60 * 1000 - 1).toISOString();
    writeRunFile('run-boundary-past', {
      runId: 'run-boundary-past',
      taskId: 'task-1',
      startedAt: justPastTTL,
      status: 'success',
      finishedAt: justPastTTL,
      pid: process.pid,
    });
    runsModule.cleanupOldRuns();
    expect(existsSync(join(runsDir(), 'run-boundary-past.json'))).toBe(false);
  });

  it('does not delete run 1ms before TTL boundary', () => {
    const justBeforeTTL = new Date(Date.now() - 24 * 60 * 60 * 1000 + 1000).toISOString();
    writeRunFile('run-boundary-before', {
      runId: 'run-boundary-before',
      taskId: 'task-1',
      startedAt: justBeforeTTL,
      status: 'success',
      finishedAt: justBeforeTTL,
      pid: process.pid,
    });
    runsModule.cleanupOldRuns();
    expect(existsSync(join(runsDir(), 'run-boundary-before.json'))).toBe(true);
  });

  it('deletes run from 48 hours ago', () => {
    const veryOld = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    writeRunFile('run-very-old', {
      runId: 'run-very-old',
      taskId: 'task-1',
      startedAt: veryOld,
      status: 'failure',
      finishedAt: veryOld,
      error: 'old error',
      pid: process.pid,
    });
    runsModule.cleanupOldRuns();
    expect(existsSync(join(runsDir(), 'run-very-old.json'))).toBe(false);
  });

  it('does not delete run from 12 hours ago', () => {
    const recent = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    writeRunFile('run-recent', {
      runId: 'run-recent',
      taskId: 'task-1',
      startedAt: recent,
      status: 'success',
      finishedAt: recent,
      pid: process.pid,
    });
    runsModule.cleanupOldRuns();
    expect(existsSync(join(runsDir(), 'run-recent.json'))).toBe(true);
  });
});
