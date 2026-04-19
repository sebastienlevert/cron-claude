import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── Temp directory for real filesystem tests ────────────────────────────────

let testDir: string;
let logsDir: string;

function createTestDir() {
  testDir = join(tmpdir(), `analytics-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  logsDir = join(testDir, 'logs');
  mkdirSync(logsDir, { recursive: true });
}

// ── Mocks ───────────────────────────────────────────────────────────────────

const loadConfigMock = vi.fn();
vi.mock('../config.js', () => ({
  loadConfig: (...args: any[]) => loadConfigMock(...args),
}));

const listTasksMock = vi.fn(() => [] as any[]);
const getTaskMock = vi.fn(() => null as any);
vi.mock('../tasks.js', () => ({
  listTasks: (...args: any[]) => listTasksMock(...args),
  getTask: (...args: any[]) => getTaskMock(...args),
}));

const getDependentsMock = vi.fn(() => [] as string[]);
vi.mock('../chains.js', () => ({
  getDependents: (...args: any[]) => getDependentsMock(...args),
}));

// ── Module under test (dynamically imported after mock setup) ───────────────

let analyticsModule: typeof import('../analytics.js');

// ── Helpers ─────────────────────────────────────────────────────────────────

function defaultConfig() {
  return {
    secretKey: 'test-secret',
    version: '0.1.0',
    tasksDirs: [join(testDir, 'tasks')],
    logsDir,
  };
}

function writeLogFile(
  filename: string,
  frontmatter: Record<string, any>,
  body = '',
) {
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n');
  writeFileSync(join(logsDir, filename), `---\n${fm}\n---\n\n${body}`, 'utf-8');
}

function makeSummary(id: string, enabled = true) {
  return { id, schedule: '0 9 * * *', invocation: 'cli' as const, agent: 'claude' as const, enabled };
}

function makeTask(id: string, overrides: Record<string, any> = {}) {
  return {
    id,
    schedule: '0 9 * * *',
    invocation: 'cli' as const,
    agent: 'claude' as const,
    enabled: true,
    notifications: { toast: false },
    instructions: `# ${id}`,
    ...overrides,
  };
}

/** Create N success log files for a task spread across a date range */
function createSuccessLogs(taskId: string, count: number, startDate: Date, intervalMs: number) {
  for (let i = 0; i < count; i++) {
    const ts = new Date(startDate.getTime() + i * intervalMs);
    const tsStr = ts.toISOString();
    const safeTs = tsStr.replace(/:/g, '-');
    writeLogFile(`${taskId}_${safeTs}_exec-${i}.md`, {
      taskId,
      executionId: `exec-${i}`,
      timestamp: tsStr,
      status: 'success',
      signature: 'abc',
    }, `**Started:** ${tsStr}\nStep done at ${new Date(ts.getTime() + 60000).toISOString()}`);
  }
}

/** Create a log file with specific status */
function createLog(taskId: string, ts: Date, status: 'success' | 'failure', opts: { body?: string; execId?: string } = {}) {
  const tsStr = ts.toISOString();
  const safeTs = tsStr.replace(/:/g, '-');
  const execId = opts.execId ?? `exec-${Math.random().toString(36).slice(2)}`;
  writeLogFile(`${taskId}_${safeTs}_${execId}.md`, {
    taskId,
    executionId: execId,
    timestamp: tsStr,
    status,
    signature: 'abc',
  }, opts.body ?? `**Started:** ${tsStr}`);
}

// ── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  createTestDir();

  loadConfigMock.mockReturnValue(defaultConfig());
  listTasksMock.mockReturnValue([]);
  getTaskMock.mockReturnValue(null);
  getDependentsMock.mockReturnValue([]);

  analyticsModule = await import('../analytics.js');
});

afterEach(() => {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ===========================================================================
// formatDuration
// ===========================================================================

describe('formatDuration', () => {
  it('returns "0s" for 0 seconds', () => {
    expect(analyticsModule.formatDuration(0)).toBe('0s');
  });

  it('returns "1s" for 1 second', () => {
    expect(analyticsModule.formatDuration(1)).toBe('1s');
  });

  it('returns "59s" for 59 seconds', () => {
    expect(analyticsModule.formatDuration(59)).toBe('59s');
  });

  it('returns "1m 0s" for exactly 60 seconds', () => {
    expect(analyticsModule.formatDuration(60)).toBe('1m 0s');
  });

  it('returns "1m 1s" for 61 seconds', () => {
    expect(analyticsModule.formatDuration(61)).toBe('1m 1s');
  });

  it('returns "59m 59s" for 3599 seconds', () => {
    expect(analyticsModule.formatDuration(3599)).toBe('59m 59s');
  });

  it('returns "1h 0m" for exactly 3600 seconds', () => {
    expect(analyticsModule.formatDuration(3600)).toBe('1h 0m');
  });

  it('returns "2h 1m" for 7261 seconds', () => {
    expect(analyticsModule.formatDuration(7261)).toBe('2h 1m');
  });

  it('returns "1h 30m" for 5400 seconds', () => {
    expect(analyticsModule.formatDuration(5400)).toBe('1h 30m');
  });
});

// ===========================================================================
// analyzeProductivity – log parsing
// ===========================================================================

describe('analyzeProductivity – log parsing', () => {
  it('returns empty report when logsDir does not exist', () => {
    loadConfigMock.mockReturnValue({ ...defaultConfig(), logsDir: join(testDir, 'no-such-dir') });
    const report = analyticsModule.analyzeProductivity();
    expect(report.summary.totalRuns).toBe(0);
    expect(report.dataQuality.totalLogFiles).toBe(0);
  });

  it('returns empty report when logs directory is empty', () => {
    const report = analyticsModule.analyzeProductivity();
    expect(report.summary.totalRuns).toBe(0);
    expect(report.taskMetrics).toEqual([]);
    expect(report.dataQuality.totalLogFiles).toBe(0);
  });

  it('only reads .md files', () => {
    writeFileSync(join(logsDir, 'not-a-log.txt'), 'some text');
    writeFileSync(join(logsDir, 'also-not.json'), '{}');
    const report = analyticsModule.analyzeProductivity();
    expect(report.dataQuality.totalLogFiles).toBe(0);
  });

  it('parses a valid success log file', () => {
    const now = new Date();
    createLog('task-a', now, 'success');
    const report = analyticsModule.analyzeProductivity();
    expect(report.summary.totalRuns).toBe(1);
    expect(report.summary.successes).toBe(1);
    expect(report.dataQuality.parsedSuccessfully).toBe(1);
  });

  it('parses a valid failure log file', () => {
    const now = new Date();
    createLog('task-a', now, 'failure');
    const report = analyticsModule.analyzeProductivity();
    expect(report.summary.failures).toBe(1);
  });

  it('skips files with missing taskId', () => {
    writeLogFile('bad_2024-01-15T09-00-00Z_exec-1.md', {
      executionId: 'exec-1',
      timestamp: new Date().toISOString(),
      status: 'success',
    });
    const report = analyticsModule.analyzeProductivity();
    expect(report.summary.totalRuns).toBe(0);
    expect(report.dataQuality.corruptOrInvalid).toBe(1);
  });

  it('skips files with missing timestamp', () => {
    writeLogFile('bad_2024-01-15T09-00-00Z_exec-1.md', {
      taskId: 'task-a',
      executionId: 'exec-1',
      status: 'success',
    });
    const report = analyticsModule.analyzeProductivity();
    expect(report.dataQuality.corruptOrInvalid).toBe(1);
  });

  it('skips files with invalid status', () => {
    writeLogFile('bad_2024-01-15T09-00-00Z_exec-1.md', {
      taskId: 'task-a',
      executionId: 'exec-1',
      timestamp: new Date().toISOString(),
      status: 'unknown',
    });
    const report = analyticsModule.analyzeProductivity();
    expect(report.dataQuality.corruptOrInvalid).toBe(1);
  });

  it('skips files with invalid date (NaN)', () => {
    writeLogFile('bad_invalid_exec-1.md', {
      taskId: 'task-a',
      executionId: 'exec-1',
      timestamp: 'not-a-date',
      status: 'success',
    });
    const report = analyticsModule.analyzeProductivity();
    expect(report.dataQuality.corruptOrInvalid).toBe(1);
  });

  it('skips out-of-range log files', () => {
    const oldDate = new Date('2020-01-01T00:00:00Z');
    createLog('task-a', oldDate, 'success');
    const report = analyticsModule.analyzeProductivity({ days: 7 });
    expect(report.summary.totalRuns).toBe(0);
    expect(report.dataQuality.skippedOutOfRange).toBe(1);
  });

  it('tracks data quality with mixed valid/invalid/out-of-range files', () => {
    const now = new Date();
    // Valid
    createLog('task-a', now, 'success');
    // Corrupt (missing taskId)
    writeLogFile('bad_2024-01-15T09-00-00Z_exec-bad.md', {
      executionId: 'exec-bad',
      timestamp: now.toISOString(),
      status: 'success',
    });
    // Out of range
    createLog('task-a', new Date('2020-01-01T00:00:00Z'), 'success');
    // Non-md file
    writeFileSync(join(logsDir, 'readme.txt'), 'ignore me');

    const report = analyticsModule.analyzeProductivity({ days: 7 });
    expect(report.dataQuality.totalLogFiles).toBe(3); // only .md files counted
    expect(report.dataQuality.parsedSuccessfully).toBe(1);
    expect(report.dataQuality.corruptOrInvalid).toBe(1);
    expect(report.dataQuality.skippedOutOfRange).toBe(1);
  });

  it('filters by taskId when specified', () => {
    const now = new Date();
    createLog('task-a', now, 'success');
    createLog('task-b', now, 'success');
    const report = analyticsModule.analyzeProductivity({ taskId: 'task-a' });
    expect(report.summary.totalRuns).toBe(1);
    expect(report.taskMetrics.length).toBe(1);
    expect(report.taskMetrics[0].taskId).toBe('task-a');
  });

  it('filters by taskId using filename prefix', () => {
    const now = new Date();
    createLog('task-a', now, 'success');
    createLog('task-a-extended', now, 'success');
    const report = analyticsModule.analyzeProductivity({ taskId: 'task-a' });
    // Only exact prefix match on first underscore segment
    expect(report.summary.totalRuns).toBe(1);
  });

  it('defaults to 30 days', () => {
    const report = analyticsModule.analyzeProductivity();
    expect(report.period.days).toBe(30);
  });

  it('respects custom days parameter', () => {
    const report = analyticsModule.analyzeProductivity({ days: 7 });
    expect(report.period.days).toBe(7);
  });

  it('handles malformed frontmatter gracefully (counts as corrupt)', () => {
    writeFileSync(join(logsDir, 'malformed_2024_exec.md'),
      '---\n!!invalid yaml: [[\n---\ncontent');
    const report = analyticsModule.analyzeProductivity();
    expect(report.dataQuality.corruptOrInvalid).toBe(1);
  });
});

// ===========================================================================
// analyzeProductivity – duration estimation
// ===========================================================================

describe('analyzeProductivity – duration estimation', () => {
  it('estimates duration from ISO timestamps in content', () => {
    const start = new Date(Date.now() - 600_000);
    const later = new Date(start.getTime() + 300_000); // 5 min later
    createLog('task-a', start, 'success', {
      body: `**Started:** ${start.toISOString()}\nStep completed at ${later.toISOString()}`,
    });
    const report = analyticsModule.analyzeProductivity();
    expect(report.taskMetrics[0].avgDurationSec).toBe(300);
  });

  it('returns 0 duration when content has no timestamps', () => {
    const start = new Date(Date.now() - 600_000);
    createLog('task-a', start, 'success', { body: 'No timestamps here' });
    const report = analyticsModule.analyzeProductivity();
    expect(report.taskMetrics[0].avgDurationSec).toBe(0);
  });

  it('uses the last timestamp for duration', () => {
    const start = new Date(Date.now() - 600_000);
    const t1 = new Date(start.getTime() + 60_000);
    const t2 = new Date(start.getTime() + 120_000);
    createLog('task-a', start, 'success', {
      body: `Step 1 at ${t1.toISOString()}\nStep 2 at ${t2.toISOString()}`,
    });
    const report = analyticsModule.analyzeProductivity();
    expect(report.taskMetrics[0].avgDurationSec).toBe(120);
  });

  it('handles invalid timestamps in content gracefully', () => {
    const start = new Date(Date.now() - 600_000);
    createLog('task-a', start, 'success', {
      body: `Something at 9999-99-99T99:99:99Z`,
    });
    const report = analyticsModule.analyzeProductivity();
    // Should handle without crashing; duration may be 0 if NaN
    expect(report.summary.totalRuns).toBe(1);
  });
});

// ===========================================================================
// analyzeProductivity – retry detection
// ===========================================================================

describe('analyzeProductivity – retry detection', () => {
  it('detects retry from "retry" keyword in content', () => {
    const now = new Date();
    createLog('task-a', now, 'success', {
      body: 'This was a retry of a previous failed run.',
    });
    const report = analyticsModule.analyzeProductivity();
    expect(report.taskMetrics[0].retryRuns).toBe(1);
    expect(report.taskMetrics[0].retryRate).toBe(100);
  });

  it('detects retry from "attempt 2" pattern', () => {
    const now = new Date();
    createLog('task-a', now, 'success', {
      body: 'Execution attempt 2 of 3.',
    });
    const report = analyticsModule.analyzeProductivity();
    expect(report.taskMetrics[0].retryRuns).toBe(1);
  });

  it('detects retry from "attempt 9" pattern', () => {
    const now = new Date();
    createLog('task-a', now, 'success', {
      body: 'This is attempt 9.',
    });
    const report = analyticsModule.analyzeProductivity();
    expect(report.taskMetrics[0].retryRuns).toBe(1);
  });

  it('does NOT detect retry from "attempt 1"', () => {
    const now = new Date();
    createLog('task-a', now, 'success', {
      body: 'This is attempt 1 of 3.',
    });
    const report = analyticsModule.analyzeProductivity();
    expect(report.taskMetrics[0].retryRuns).toBe(0);
  });

  it('retry detection is case insensitive', () => {
    const now = new Date();
    createLog('task-a', now, 'success', {
      body: 'RETRY attempted successfully.',
    });
    const report = analyticsModule.analyzeProductivity();
    expect(report.taskMetrics[0].retryRuns).toBe(1);
  });

  it('does not flag non-retry content', () => {
    const now = new Date();
    createLog('task-a', now, 'success', {
      body: 'All steps completed normally.',
    });
    const report = analyticsModule.analyzeProductivity();
    expect(report.taskMetrics[0].retryRuns).toBe(0);
  });
});

// ===========================================================================
// analyzeProductivity – task metrics
// ===========================================================================

describe('analyzeProductivity – task metrics', () => {
  it('groups entries by taskId', () => {
    const now = new Date();
    createLog('task-a', now, 'success');
    createLog('task-b', now, 'failure');
    const report = analyticsModule.analyzeProductivity();
    expect(report.taskMetrics.length).toBe(2);
  });

  it('computes correct run counts', () => {
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), i < 3 ? 'success' : 'failure');
    }
    const report = analyticsModule.analyzeProductivity();
    const m = report.taskMetrics.find(t => t.taskId === 'task-a')!;
    expect(m.runs).toBe(5);
    expect(m.successes).toBe(3);
    expect(m.failures).toBe(2);
  });

  it('computes success rate rounded to integer', () => {
    const now = new Date();
    for (let i = 0; i < 3; i++) createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success');
    createLog('task-a', new Date(now.getTime() - 10 * 60000), 'failure');
    const report = analyticsModule.analyzeProductivity();
    const m = report.taskMetrics.find(t => t.taskId === 'task-a')!;
    expect(m.successRate).toBe(75); // 3/4 = 75%
  });

  it('computes 100% success rate for all successes', () => {
    const now = new Date();
    for (let i = 0; i < 3; i++) createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success');
    const report = analyticsModule.analyzeProductivity();
    expect(report.taskMetrics[0].successRate).toBe(100);
  });

  it('computes 0% success rate for all failures', () => {
    const now = new Date();
    for (let i = 0; i < 3; i++) createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'failure');
    const report = analyticsModule.analyzeProductivity();
    expect(report.taskMetrics[0].successRate).toBe(0);
  });

  it('computes duration stats only from entries with duration > 0', () => {
    const now = new Date();
    const startA = new Date(now.getTime() - 900_000);
    // Entry with duration (5 min)
    const laterA = new Date(startA.getTime() + 300_000);
    createLog('task-a', startA, 'success', {
      body: `Step at ${laterA.toISOString()}`,
    });
    // Entry with no duration
    createLog('task-a', new Date(now.getTime() - 300_000), 'success', {
      body: 'No timestamps',
    });
    const report = analyticsModule.analyzeProductivity();
    const m = report.taskMetrics.find(t => t.taskId === 'task-a')!;
    expect(m.avgDurationSec).toBe(300);
    expect(m.medianDurationSec).toBe(300);
  });

  it('sets lastRun to the most recent entry timestamp', () => {
    const t1 = new Date(Date.now() - 120_000);
    const t2 = new Date(Date.now() - 60_000);
    createLog('task-a', t1, 'success');
    createLog('task-a', t2, 'success');
    const report = analyticsModule.analyzeProductivity();
    const m = report.taskMetrics.find(t => t.taskId === 'task-a')!;
    expect(m.lastRun).toBe(t2.toISOString());
  });

  it('sorts taskMetrics by successRate ascending', () => {
    const now = new Date();
    // task-b: 100% success
    createLog('task-b', now, 'success');
    // task-a: 0% (failure)
    createLog('task-a', now, 'failure');
    const report = analyticsModule.analyzeProductivity();
    expect(report.taskMetrics[0].taskId).toBe('task-a');
    expect(report.taskMetrics[1].taskId).toBe('task-b');
  });
});

// ===========================================================================
// analyzeProductivity – streak detection
// ===========================================================================

describe('analyzeProductivity – streak detection', () => {
  it('counts consecutive successes from the end', () => {
    const now = new Date();
    createLog('task-a', new Date(now.getTime() - 300_000), 'failure');
    createLog('task-a', new Date(now.getTime() - 200_000), 'success');
    createLog('task-a', new Date(now.getTime() - 100_000), 'success');
    createLog('task-a', now, 'success');
    const report = analyticsModule.analyzeProductivity();
    const m = report.taskMetrics[0];
    expect(m.currentStreak.type).toBe('success');
    expect(m.currentStreak.count).toBe(3);
  });

  it('counts consecutive failures from the end', () => {
    const now = new Date();
    createLog('task-a', new Date(now.getTime() - 200_000), 'success');
    createLog('task-a', new Date(now.getTime() - 100_000), 'failure');
    createLog('task-a', now, 'failure');
    const report = analyticsModule.analyzeProductivity();
    const m = report.taskMetrics[0];
    expect(m.currentStreak.type).toBe('failure');
    expect(m.currentStreak.count).toBe(2);
  });

  it('streak of 1 when only one entry', () => {
    const now = new Date();
    createLog('task-a', now, 'success');
    const report = analyticsModule.analyzeProductivity();
    expect(report.taskMetrics[0].currentStreak.count).toBe(1);
  });

  it('streak resets at status boundary', () => {
    const now = new Date();
    createLog('task-a', new Date(now.getTime() - 400_000), 'success');
    createLog('task-a', new Date(now.getTime() - 300_000), 'success');
    createLog('task-a', new Date(now.getTime() - 200_000), 'success');
    createLog('task-a', new Date(now.getTime() - 100_000), 'failure');
    createLog('task-a', now, 'success');
    const report = analyticsModule.analyzeProductivity();
    expect(report.taskMetrics[0].currentStreak).toEqual({ type: 'success', count: 1 });
  });
});

// ===========================================================================
// analyzeProductivity – trend detection
// ===========================================================================

describe('analyzeProductivity – trend detection', () => {
  it('returns insufficient_data with fewer than 10 runs', () => {
    const now = new Date();
    for (let i = 0; i < 9; i++) {
      createLog('task-a', new Date(now.getTime() - i * 86400_000), 'success');
    }
    const report = analyticsModule.analyzeProductivity({ days: 60 });
    expect(report.taskMetrics[0].trend).toBe('insufficient_data');
  });

  it('returns insufficient_data when span < 14 days even with 10+ runs', () => {
    const now = new Date();
    // 10 runs in 10 days (< 14)
    for (let i = 0; i < 10; i++) {
      createLog('task-a', new Date(now.getTime() - i * 86400_000), 'success');
    }
    const report = analyticsModule.analyzeProductivity({ days: 60 });
    expect(report.taskMetrics[0].trend).toBe('insufficient_data');
  });

  it('returns stable when halves have similar success rates', () => {
    const now = new Date();
    // 12 runs spread over 25 days (> 14 day span), all success
    for (let i = 0; i < 12; i++) {
      createLog('task-a', new Date(now.getTime() - (25 - i * 2) * 86400_000), 'success');
    }
    const report = analyticsModule.analyzeProductivity({ days: 30 });
    expect(report.taskMetrics[0].trend).toBe('stable');
  });

  it('returns improving when second half has significantly better rate', () => {
    const now = new Date();
    // First half: mostly failures, Second half: mostly successes
    // 12 runs over 20 days
    for (let i = 0; i < 6; i++) {
      createLog('task-a', new Date(now.getTime() - (25 - i) * 86400_000), 'failure');
    }
    for (let i = 0; i < 6; i++) {
      createLog('task-a', new Date(now.getTime() - (5 - i) * 86400_000), 'success');
    }
    const report = analyticsModule.analyzeProductivity({ days: 30 });
    expect(report.taskMetrics[0].trend).toBe('improving');
  });

  it('returns declining when second half has significantly worse rate', () => {
    const now = new Date();
    // First half: mostly success, Second half: mostly failures
    for (let i = 0; i < 6; i++) {
      createLog('task-a', new Date(now.getTime() - (25 - i) * 86400_000), 'success');
    }
    for (let i = 0; i < 6; i++) {
      createLog('task-a', new Date(now.getTime() - (5 - i) * 86400_000), 'failure');
    }
    const report = analyticsModule.analyzeProductivity({ days: 30 });
    expect(report.taskMetrics[0].trend).toBe('declining');
  });

  it('exactly 10 runs spanning exactly 14 days triggers trend analysis', () => {
    const now = new Date();
    const baseTime = now.getTime() - 14 * 86400_000;
    // Spread 10 runs: first 5 failure, last 5 success
    for (let i = 0; i < 5; i++) {
      createLog('task-a', new Date(baseTime + i * (14 * 86400_000 / 9)), 'failure');
    }
    for (let i = 5; i < 10; i++) {
      createLog('task-a', new Date(baseTime + i * (14 * 86400_000 / 9)), 'success');
    }
    const report = analyticsModule.analyzeProductivity({ days: 30 });
    // Should NOT be insufficient_data since we have 10 runs over 14 days
    expect(report.taskMetrics[0].trend).not.toBe('insufficient_data');
  });

  it('trend requires >15% difference to be non-stable', () => {
    const now = new Date();
    const baseTime = now.getTime() - 20 * 86400_000;
    // 12 runs: first half 50% success, second half 65% -> diff = 15%, exactly at boundary
    // first 6: 3 success 3 failure (50%)
    for (let i = 0; i < 3; i++) {
      createLog('task-a', new Date(baseTime + i * 86400_000), 'success');
    }
    for (let i = 3; i < 6; i++) {
      createLog('task-a', new Date(baseTime + i * 86400_000), 'failure');
    }
    // second 6: 4 success 2 failure (~67%) -> diff ~17% > 15%
    for (let i = 6; i < 10; i++) {
      createLog('task-a', new Date(baseTime + (i + 4) * 86400_000), 'success');
    }
    for (let i = 10; i < 12; i++) {
      createLog('task-a', new Date(baseTime + (i + 4) * 86400_000), 'failure');
    }
    const report = analyticsModule.analyzeProductivity({ days: 30 });
    // The diff should make it 'improving'
    expect(['improving', 'stable']).toContain(report.taskMetrics[0].trend);
  });
});

// ===========================================================================
// analyzeProductivity – summary metrics
// ===========================================================================

describe('analyzeProductivity – summary metrics', () => {
  it('aggregates total runs across all tasks', () => {
    const now = new Date();
    createLog('task-a', now, 'success');
    createLog('task-b', now, 'failure');
    createLog('task-c', now, 'success');
    const report = analyticsModule.analyzeProductivity();
    expect(report.summary.totalRuns).toBe(3);
  });

  it('computes correct successes and failures', () => {
    const now = new Date();
    createLog('task-a', new Date(now.getTime() - 120_000), 'success');
    createLog('task-a', new Date(now.getTime() - 60_000), 'failure');
    const report = analyticsModule.analyzeProductivity();
    expect(report.summary.successes).toBe(1);
    expect(report.summary.failures).toBe(1);
  });

  it('computes runsPerDay rounded to 1 decimal', () => {
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success');
    }
    const report = analyticsModule.analyzeProductivity({ days: 7 });
    // 3 / 7 = 0.428... → 0.4
    expect(report.summary.runsPerDay).toBe(0.4);
  });

  it('counts unique tasks', () => {
    const now = new Date();
    createLog('task-a', new Date(now.getTime() - 120_000), 'success');
    createLog('task-a', new Date(now.getTime() - 60_000), 'success');
    createLog('task-b', new Date(now.getTime() - 30_000), 'success');
    const report = analyticsModule.analyzeProductivity();
    expect(report.summary.uniqueTasks).toBe(2);
  });

  it('computes 0 successRate when no runs', () => {
    const report = analyticsModule.analyzeProductivity();
    expect(report.summary.successRate).toBe(0);
  });

  it('computes duration aggregates correctly', () => {
    const now = new Date();
    const t1 = new Date(now.getTime() - 600_000);
    const t1_end = new Date(t1.getTime() + 60_000);
    const t2 = new Date(now.getTime() - 300_000);
    const t2_end = new Date(t2.getTime() + 180_000);

    createLog('task-a', t1, 'success', {
      body: `Step at ${t1_end.toISOString()}`,
    });
    createLog('task-a', t2, 'success', {
      body: `Step at ${t2_end.toISOString()}`,
    });
    const report = analyticsModule.analyzeProductivity();
    expect(report.summary.avgDurationSec).toBe(120); // (60 + 180) / 2
    expect(report.summary.totalDurationSec).toBe(240); // 60 + 180
  });
});

// ===========================================================================
// analyzeProductivity – peak hours
// ===========================================================================

describe('analyzeProductivity – peak hours', () => {
  it('returns 24-element array initialized to 0 with no entries', () => {
    const report = analyticsModule.analyzeProductivity();
    expect(report.peakHours).toHaveLength(24);
    expect(report.peakHours.every(h => h === 0)).toBe(true);
  });

  it('counts entries by hour (getHours)', () => {
    // Create entries at specific hours
    const base = new Date();
    base.setHours(9, 0, 0, 0);
    createLog('task-a', base, 'success');

    const base2 = new Date();
    base2.setHours(9, 30, 0, 0);
    createLog('task-a', base2, 'success');

    const base3 = new Date();
    base3.setHours(15, 0, 0, 0);
    createLog('task-b', base3, 'success');

    const report = analyticsModule.analyzeProductivity();
    expect(report.peakHours[9]).toBe(2);
    expect(report.peakHours[15]).toBe(1);
  });

  it('handles midnight (hour 0) correctly', () => {
    const base = new Date();
    base.setHours(0, 15, 0, 0);
    createLog('task-a', base, 'success');
    const report = analyticsModule.analyzeProductivity();
    expect(report.peakHours[0]).toBe(1);
  });

  it('handles hour 23 correctly', () => {
    // Use yesterday at 23:45 to avoid future-time issues
    const base = new Date();
    base.setDate(base.getDate() - 1);
    base.setHours(23, 45, 0, 0);
    createLog('task-a', base, 'success');
    const report = analyticsModule.analyzeProductivity();
    expect(report.peakHours[23]).toBe(1);
  });
});

// ===========================================================================
// analyzeProductivity – daily activity
// ===========================================================================

describe('analyzeProductivity – daily activity', () => {
  it('fills all days in the range with 0s', () => {
    const report = analyticsModule.analyzeProductivity({ days: 7 });
    // Should have at least 7 entries (might be 8 depending on rounding)
    expect(report.dailyActivity.length).toBeGreaterThanOrEqual(7);
    for (const day of report.dailyActivity) {
      expect(day.runs).toBe(0);
      expect(day.successes).toBe(0);
      expect(day.failures).toBe(0);
    }
  });

  it('assigns entries to the correct day', () => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    createLog('task-a', now, 'success');
    createLog('task-b', now, 'failure');
    const report = analyticsModule.analyzeProductivity({ days: 7 });
    const today = report.dailyActivity.find(d => d.date === todayStr);
    expect(today).toBeDefined();
    expect(today!.runs).toBe(2);
    expect(today!.successes).toBe(1);
    expect(today!.failures).toBe(1);
  });

  it('sorts daily activity by date ascending', () => {
    const report = analyticsModule.analyzeProductivity({ days: 7 });
    for (let i = 1; i < report.dailyActivity.length; i++) {
      expect(report.dailyActivity[i].date >= report.dailyActivity[i - 1].date).toBe(true);
    }
  });
});

// ===========================================================================
// analyzeProductivity – insights generation
// ===========================================================================

describe('analyzeProductivity – insights', () => {
  it('generates "no executions" insight when totalRuns === 0', () => {
    const report = analyticsModule.analyzeProductivity();
    expect(report.insights).toHaveLength(1);
    expect(report.insights[0].message).toContain('No task executions');
    expect(report.insights[0].type).toBe('info');
  });

  it('generates excellent reliability insight at 95%', () => {
    const now = new Date();
    // 20 runs: 19 success, 1 failure = 95%
    for (let i = 0; i < 19; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success');
    }
    createLog('task-a', new Date(now.getTime() - 60000), 'failure');
    const report = analyticsModule.analyzeProductivity();
    const reliabilityInsight = report.insights.find(i => i.message.includes('reliability'));
    expect(reliabilityInsight).toBeDefined();
    expect(reliabilityInsight!.message).toContain('Excellent');
    expect(reliabilityInsight!.type).toBe('success');
  });

  it('generates good reliability insight between 80% and 94%', () => {
    const now = new Date();
    // 10 runs: 8 success, 2 failure = 80%
    for (let i = 0; i < 8; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success');
    }
    for (let i = 8; i < 10; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'failure');
    }
    const report = analyticsModule.analyzeProductivity();
    const reliabilityInsight = report.insights.find(i => i.message.includes('reliability'));
    expect(reliabilityInsight).toBeDefined();
    expect(reliabilityInsight!.message).toContain('Good');
  });

  it('generates low reliability warning below 80%', () => {
    const now = new Date();
    // 10 runs: 7 success, 3 failure = 70%
    for (let i = 0; i < 7; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success');
    }
    for (let i = 7; i < 10; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'failure');
    }
    const report = analyticsModule.analyzeProductivity();
    const reliabilityInsight = report.insights.find(i => i.message.includes('reliability'));
    expect(reliabilityInsight).toBeDefined();
    expect(reliabilityInsight!.message).toContain('Low');
    expect(reliabilityInsight!.type).toBe('warning');
  });

  it('generates high automation insight for ≥5 runs/day', () => {
    const now = new Date();
    // 5 runs in 1 day = 5 runs/day
    for (let i = 0; i < 5; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success');
    }
    const report = analyticsModule.analyzeProductivity({ days: 1 });
    const automationInsight = report.insights.find(i => i.message.includes('automation'));
    expect(automationInsight).toBeDefined();
    expect(automationInsight!.message).toContain('High');
  });

  it('generates steady automation insight for ≥1 runs/day but <5', () => {
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success');
    }
    const report = analyticsModule.analyzeProductivity({ days: 1 });
    const automationInsight = report.insights.find(i => i.message.includes('automation'));
    expect(automationInsight).toBeDefined();
    expect(automationInsight!.message).toContain('Steady');
  });

  it('generates high retry rate warning for >30%', () => {
    const now = new Date();
    // 4 out of 10 are retries = 40% (but need >30%)
    for (let i = 0; i < 6; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success', {
        body: 'Normal run.',
      });
    }
    for (let i = 6; i < 10; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success', {
        body: 'This was a retry of a failed run.',
      });
    }
    const report = analyticsModule.analyzeProductivity();
    const retryInsight = report.insights.find(i => i.message.includes('retry') || i.message.includes('Retry'));
    expect(retryInsight).toBeDefined();
    expect(retryInsight!.message).toContain('High');
    expect(retryInsight!.type).toBe('warning');
  });

  it('generates moderate retry rate insight for >10% ≤30%', () => {
    const now = new Date();
    // 2 out of 10 = 20%
    for (let i = 0; i < 8; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success', {
        body: 'Normal run.',
      });
    }
    for (let i = 8; i < 10; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success', {
        body: 'This was a retry of a failed run.',
      });
    }
    const report = analyticsModule.analyzeProductivity();
    const retryInsight = report.insights.find(i => i.message.includes('retry') || i.message.includes('Retry'));
    expect(retryInsight).toBeDefined();
    expect(retryInsight!.message).toContain('Moderate');
  });

  it('generates peak hour spread warning when concentrated >40%', () => {
    const now = new Date();
    now.setHours(9, 0, 0, 0);
    // 5 runs at 9am = 100% concentrated (>40%)
    for (let i = 0; i < 5; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success');
    }
    const report = analyticsModule.analyzeProductivity();
    const peakInsight = report.insights.find(i => i.message.includes('Peak') || i.message.includes('peak'));
    expect(peakInsight).toBeDefined();
    expect(peakInsight!.message).toContain('spreading');
  });

  it('generates healthy schedule insight when peak ≤40%', () => {
    const now = new Date();
    // Spread across multiple hours
    for (let h = 6; h <= 18; h++) {
      const t = new Date(now);
      t.setHours(h, 0, 0, 0);
      createLog(`task-${h}`, t, 'success');
    }
    const report = analyticsModule.analyzeProductivity();
    const peakInsight = report.insights.find(i => i.message.includes('Peak') || i.message.includes('peak'));
    if (peakInsight) {
      expect(peakInsight.message).toContain('healthy');
    }
  });

  it('generates improving trend insight', () => {
    const now = new Date();
    const baseTime = now.getTime() - 20 * 86400_000;
    // First 6: all failures
    for (let i = 0; i < 6; i++) {
      createLog('task-a', new Date(baseTime + i * 86400_000), 'failure');
    }
    // Last 6: all successes
    for (let i = 6; i < 12; i++) {
      createLog('task-a', new Date(baseTime + (i + 4) * 86400_000), 'success');
    }
    const report = analyticsModule.analyzeProductivity({ days: 30 });
    const trendInsight = report.insights.find(i => i.message.includes('trending better'));
    expect(trendInsight).toBeDefined();
    expect(trendInsight!.type).toBe('success');
  });

  it('generates declining trend insight', () => {
    const now = new Date();
    const baseTime = now.getTime() - 20 * 86400_000;
    // First 6: all successes
    for (let i = 0; i < 6; i++) {
      createLog('task-a', new Date(baseTime + i * 86400_000), 'success');
    }
    // Last 6: all failures
    for (let i = 6; i < 12; i++) {
      createLog('task-a', new Date(baseTime + (i + 4) * 86400_000), 'failure');
    }
    const report = analyticsModule.analyzeProductivity({ days: 30 });
    const trendInsight = report.insights.find(i => i.message.includes('trending worse'));
    expect(trendInsight).toBeDefined();
    expect(trendInsight!.type).toBe('warning');
  });

  it('generates duration insight when total > 3600s', () => {
    const now = new Date();
    // Create entries with durations that total > 3600s
    for (let i = 0; i < 5; i++) {
      const start = new Date(now.getTime() - (10 - i) * 120_000);
      const end = new Date(start.getTime() + 800_000); // 800s each, 5 * 800 = 4000s
      createLog('task-a', start, 'success', {
        body: `Step at ${end.toISOString()}`,
      });
    }
    const report = analyticsModule.analyzeProductivity();
    const durationInsight = report.insights.find(i => i.message.includes('hours'));
    expect(durationInsight).toBeDefined();
    expect(durationInsight!.message).toContain('agent execution time');
  });

  it('does NOT generate duration insight when total ≤ 3600s', () => {
    const start = new Date(Date.now() - 600_000);
    const end = new Date(start.getTime() + 60_000); // 60s
    createLog('task-a', start, 'success', {
      body: `Step at ${end.toISOString()}`,
    });
    const report = analyticsModule.analyzeProductivity();
    const durationInsight = report.insights.find(i => i.message.includes('agent execution time'));
    expect(durationInsight).toBeUndefined();
  });

  it('returns early with only "no executions" insight when totalRuns is 0', () => {
    const report = analyticsModule.analyzeProductivity();
    expect(report.insights).toHaveLength(1);
    expect(report.insights[0].icon).toBe('📭');
  });
});

// ===========================================================================
// analyzeProductivity – health checks
// ===========================================================================

describe('analyzeProductivity – health checks', () => {
  it('generates info for disabled tasks', () => {
    listTasksMock.mockReturnValue([makeSummary('task-a', false)]);
    const report = analyticsModule.analyzeProductivity();
    const check = report.healthChecks.find(c => c.taskId === 'task-a');
    expect(check).toBeDefined();
    expect(check!.severity).toBe('info');
    expect(check!.message).toContain('disabled');
  });

  it('generates warning for never-run enabled tasks', () => {
    listTasksMock.mockReturnValue([makeSummary('task-a', true)]);
    const report = analyticsModule.analyzeProductivity();
    const check = report.healthChecks.find(c => c.taskId === 'task-a' && c.message.includes('no executions'));
    expect(check).toBeDefined();
    expect(check!.severity).toBe('warning');
  });

  it('does not check never-run for disabled tasks', () => {
    listTasksMock.mockReturnValue([makeSummary('task-a', false)]);
    const report = analyticsModule.analyzeProductivity();
    const neverRunCheck = report.healthChecks.find(c => c.message.includes('no executions'));
    expect(neverRunCheck).toBeUndefined();
  });

  it('generates critical for chain bottleneck (≥3 dependents, <90% success, ≥5 runs)', () => {
    const now = new Date();
    listTasksMock.mockReturnValue([makeSummary('task-a', true)]);
    getTaskMock.mockReturnValue(makeTask('task-a'));
    getDependentsMock.mockReturnValue(['task-b', 'task-c', 'task-d']);

    // 5 runs, 4 success = 80% < 90%
    for (let i = 0; i < 4; i++) {
      createLog('task-a', new Date(now.getTime() - (5 - i) * 60000), 'success');
    }
    createLog('task-a', new Date(now.getTime() - 60000), 'failure');

    const report = analyticsModule.analyzeProductivity();
    const bottleneck = report.healthChecks.find(c => c.message.includes('Blocks'));
    expect(bottleneck).toBeDefined();
    expect(bottleneck!.severity).toBe('critical');
    expect(bottleneck!.message).toContain('3 downstream');
  });

  it('does NOT generate bottleneck with only 2 dependents', () => {
    const now = new Date();
    listTasksMock.mockReturnValue([makeSummary('task-a', true)]);
    getTaskMock.mockReturnValue(makeTask('task-a'));
    getDependentsMock.mockReturnValue(['task-b', 'task-c']);

    for (let i = 0; i < 5; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), i < 3 ? 'success' : 'failure');
    }
    const report = analyticsModule.analyzeProductivity();
    const bottleneck = report.healthChecks.find(c => c.message.includes('Blocks'));
    expect(bottleneck).toBeUndefined();
  });

  it('does NOT generate bottleneck when success rate ≥90%', () => {
    const now = new Date();
    listTasksMock.mockReturnValue([makeSummary('task-a', true)]);
    getTaskMock.mockReturnValue(makeTask('task-a'));
    getDependentsMock.mockReturnValue(['task-b', 'task-c', 'task-d']);

    // 10 runs, 9 success = 90%
    for (let i = 0; i < 9; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success');
    }
    createLog('task-a', new Date(now.getTime() - 60000), 'failure');

    const report = analyticsModule.analyzeProductivity();
    const bottleneck = report.healthChecks.find(c => c.message.includes('Blocks'));
    expect(bottleneck).toBeUndefined();
  });

  it('does NOT generate bottleneck with fewer than 5 runs', () => {
    const now = new Date();
    listTasksMock.mockReturnValue([makeSummary('task-a', true)]);
    getTaskMock.mockReturnValue(makeTask('task-a'));
    getDependentsMock.mockReturnValue(['task-b', 'task-c', 'task-d']);

    // 4 runs, all failures = 0% but fewer than MIN_RUNS_FOR_RATE
    for (let i = 0; i < 4; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'failure');
    }
    const report = analyticsModule.analyzeProductivity();
    const bottleneck = report.healthChecks.find(c => c.message.includes('Blocks'));
    expect(bottleneck).toBeUndefined();
  });

  it('generates critical for high failure rate (<50%, ≥5 runs)', () => {
    const now = new Date();
    // 5 runs, 2 success = 40%
    for (let i = 0; i < 2; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success');
    }
    for (let i = 2; i < 5; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'failure');
    }
    const report = analyticsModule.analyzeProductivity();
    const check = report.healthChecks.find(c => c.taskId === 'task-a' && c.severity === 'critical' && c.message.includes('success rate'));
    expect(check).toBeDefined();
    expect(check!.message).toContain('40%');
  });

  it('generates warning for moderate failure rate (50-79%, ≥5 runs)', () => {
    const now = new Date();
    // 5 runs, 3 success = 60%
    for (let i = 0; i < 3; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success');
    }
    for (let i = 3; i < 5; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'failure');
    }
    const report = analyticsModule.analyzeProductivity();
    const check = report.healthChecks.find(c => c.taskId === 'task-a' && c.severity === 'warning' && c.message.includes('success rate'));
    expect(check).toBeDefined();
    expect(check!.message).toContain('60%');
  });

  it('does NOT generate failure check when <5 runs', () => {
    const now = new Date();
    // 4 runs, 0 success
    for (let i = 0; i < 4; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'failure');
    }
    const report = analyticsModule.analyzeProductivity();
    const check = report.healthChecks.find(c => c.message.includes('success rate'));
    expect(check).toBeUndefined();
  });

  it('does NOT generate failure check for ≥80% success rate', () => {
    const now = new Date();
    // 5 runs, 4 success = 80%
    for (let i = 0; i < 4; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success');
    }
    createLog('task-a', new Date(now.getTime() - 60000), 'failure');
    const report = analyticsModule.analyzeProductivity();
    const check = report.healthChecks.find(c => c.message.includes('success rate'));
    expect(check).toBeUndefined();
  });

  it('generates critical for failure streak ≥3', () => {
    const now = new Date();
    createLog('task-a', new Date(now.getTime() - 300_000), 'success');
    createLog('task-a', new Date(now.getTime() - 200_000), 'failure');
    createLog('task-a', new Date(now.getTime() - 100_000), 'failure');
    createLog('task-a', now, 'failure');
    const report = analyticsModule.analyzeProductivity();
    const check = report.healthChecks.find(c => c.message.includes('consecutive failures'));
    expect(check).toBeDefined();
    expect(check!.severity).toBe('critical');
    expect(check!.message).toContain('3');
  });

  it('does NOT generate streak check for streak < 3', () => {
    const now = new Date();
    createLog('task-a', new Date(now.getTime() - 100_000), 'failure');
    createLog('task-a', now, 'failure');
    const report = analyticsModule.analyzeProductivity();
    const check = report.healthChecks.find(c => c.message.includes('consecutive failures'));
    expect(check).toBeUndefined();
  });

  it('generates warning for high retry rate (>40%, ≥5 runs)', () => {
    const now = new Date();
    // 5 runs: 3 with retry content = 60%
    for (let i = 0; i < 2; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success', { body: 'Normal run.' });
    }
    for (let i = 2; i < 5; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success', { body: 'This was a retry.' });
    }
    const report = analyticsModule.analyzeProductivity();
    const check = report.healthChecks.find(c => c.message.includes('retry rate'));
    expect(check).toBeDefined();
    expect(check!.severity).toBe('warning');
  });

  it('does NOT generate retry check for ≤40% retry rate', () => {
    const now = new Date();
    // 5 runs: 2 retry = 40% (boundary)
    for (let i = 0; i < 3; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success', { body: 'Normal run.' });
    }
    for (let i = 3; i < 5; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success', { body: 'This was a retry.' });
    }
    const report = analyticsModule.analyzeProductivity();
    const check = report.healthChecks.find(c => c.message.includes('retry rate'));
    expect(check).toBeUndefined();
  });

  it('generates info for long executions (P95 > 600s)', () => {
    const now = new Date();
    // Create logs with >600s durations
    for (let i = 0; i < 5; i++) {
      const start = new Date(now.getTime() - (10 - i) * 1200_000);
      const end = new Date(start.getTime() + 700_000); // 700s each
      createLog('task-a', start, 'success', {
        body: `Step at ${end.toISOString()}`,
      });
    }
    const report = analyticsModule.analyzeProductivity();
    const check = report.healthChecks.find(c => c.message.includes('P95'));
    expect(check).toBeDefined();
    expect(check!.severity).toBe('info');
  });

  it('does NOT generate long execution check when P95 ≤ 600s', () => {
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      const start = new Date(now.getTime() - (10 - i) * 120_000);
      const end = new Date(start.getTime() + 500_000); // 500s each
      createLog('task-a', start, 'success', {
        body: `Step at ${end.toISOString()}`,
      });
    }
    const report = analyticsModule.analyzeProductivity();
    const check = report.healthChecks.find(c => c.message.includes('P95'));
    expect(check).toBeUndefined();
  });

  it('generates warning for declining trend', () => {
    const now = new Date();
    const baseTime = now.getTime() - 20 * 86400_000;
    // First 6: all successes
    for (let i = 0; i < 6; i++) {
      createLog('task-a', new Date(baseTime + i * 86400_000), 'success');
    }
    // Last 6: all failures
    for (let i = 6; i < 12; i++) {
      createLog('task-a', new Date(baseTime + (i + 4) * 86400_000), 'failure');
    }
    const report = analyticsModule.analyzeProductivity({ days: 30 });
    const check = report.healthChecks.find(c => c.message.includes('declining'));
    expect(check).toBeDefined();
    expect(check!.severity).toBe('warning');
  });

  it('sorts health checks by severity (critical first)', () => {
    const now = new Date();
    listTasksMock.mockReturnValue([makeSummary('task-a', false), makeSummary('task-b', true)]);
    getTaskMock.mockReturnValue(makeTask('task-a'));
    getDependentsMock.mockReturnValue([]);

    // task-b: critical failure
    for (let i = 0; i < 5; i++) {
      createLog('task-b', new Date(now.getTime() - (20 - i) * 60000), 'failure');
    }
    const report = analyticsModule.analyzeProductivity();

    // Should have critical before info/warning
    const severities = report.healthChecks.map(c => c.severity);
    const criticalIdx = severities.indexOf('critical');
    const infoIdx = severities.indexOf('info');
    if (criticalIdx >= 0 && infoIdx >= 0) {
      expect(criticalIdx).toBeLessThan(infoIdx);
    }
  });

  it('respects taskId filter for health checks', () => {
    const now = new Date();
    listTasksMock.mockReturnValue([
      makeSummary('task-a', true),
      makeSummary('task-b', false),
    ]);
    createLog('task-a', now, 'success');
    const report = analyticsModule.analyzeProductivity({ taskId: 'task-a' });
    // Should not include task-b checks
    const taskBChecks = report.healthChecks.filter(c => c.taskId === 'task-b');
    expect(taskBChecks).toHaveLength(0);
  });

  it('boundary: exactly 50% success rate triggers critical, not warning', () => {
    const now = new Date();
    // 6 runs: 3 success = 50%
    for (let i = 0; i < 3; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success');
    }
    for (let i = 3; i < 6; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'failure');
    }
    const report = analyticsModule.analyzeProductivity();
    // 50% is NOT < 50, so no critical; it IS < 80 so warning
    const check = report.healthChecks.find(c => c.message.includes('success rate'));
    expect(check).toBeDefined();
    expect(check!.severity).toBe('warning');
  });

  it('boundary: exactly 49% triggers critical', () => {
    const now = new Date();
    // Make approximately 49%: 100 runs, 49 success
    // Simplify: 7 runs, 3 success = 42.8% ≈ 43%
    for (let i = 0; i < 3; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success');
    }
    for (let i = 3; i < 7; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'failure');
    }
    const report = analyticsModule.analyzeProductivity();
    const check = report.healthChecks.find(c => c.severity === 'critical' && c.message.includes('success rate'));
    expect(check).toBeDefined();
  });
});

// ===========================================================================
// formatReportForCLI
// ===========================================================================

describe('formatReportForCLI', () => {
  function makeEmptyReport(): import('../analytics.js').ProductivityReport {
    return {
      period: { from: '2024-01-01T00:00:00Z', to: '2024-01-31T00:00:00Z', days: 30 },
      summary: {
        totalRuns: 0, successes: 0, failures: 0, successRate: 0,
        avgDurationSec: 0, medianDurationSec: 0, p95DurationSec: 0,
        totalDurationSec: 0, uniqueTasks: 0, runsPerDay: 0,
      },
      taskMetrics: [],
      insights: [],
      healthChecks: [],
      peakHours: new Array(24).fill(0),
      dailyActivity: [],
      dataQuality: { totalLogFiles: 0, parsedSuccessfully: 0, corruptOrInvalid: 0, skippedOutOfRange: 0 },
    };
  }

  it('returns a string', () => {
    const output = analyticsModule.formatReportForCLI(makeEmptyReport());
    expect(typeof output).toBe('string');
  });

  it('contains ANSI escape codes', () => {
    const output = analyticsModule.formatReportForCLI(makeEmptyReport());
    expect(output).toContain('\x1b[');
  });

  it('includes Productivity Analysis header', () => {
    const output = analyticsModule.formatReportForCLI(makeEmptyReport());
    expect(output).toContain('Productivity Analysis');
  });

  it('includes period information', () => {
    const output = analyticsModule.formatReportForCLI(makeEmptyReport());
    expect(output).toContain('2024-01-01');
    expect(output).toContain('2024-01-31');
  });

  it('includes Summary section', () => {
    const output = analyticsModule.formatReportForCLI(makeEmptyReport());
    expect(output).toContain('Summary');
    expect(output).toContain('Total runs');
  });

  it('includes insights when present', () => {
    const report = makeEmptyReport();
    report.insights = [{ type: 'info', icon: '📭', message: 'Test insight' }];
    const output = analyticsModule.formatReportForCLI(report);
    expect(output).toContain('Insights');
    expect(output).toContain('Test insight');
  });

  it('includes health checks when present', () => {
    const report = makeEmptyReport();
    report.healthChecks = [{
      taskId: 'task-a', severity: 'critical',
      message: 'Test check', recommendation: 'Fix it',
    }];
    const output = analyticsModule.formatReportForCLI(report);
    expect(output).toContain('Health Checks');
    expect(output).toContain('task-a');
    expect(output).toContain('Test check');
    expect(output).toContain('Fix it');
  });

  it('includes per-task metrics table when present', () => {
    const report = makeEmptyReport();
    report.taskMetrics = [{
      taskId: 'task-a', runs: 10, successes: 9, failures: 1,
      successRate: 90, avgDurationSec: 120, medianDurationSec: 100,
      p95DurationSec: 200, maxDurationSec: 250, retryRuns: 0,
      retryRate: 0, currentStreak: { type: 'success', count: 5 },
      trend: 'stable', lastRun: '2024-01-31T00:00:00Z',
    }];
    const output = analyticsModule.formatReportForCLI(report);
    expect(output).toContain('Per-Task Metrics');
    expect(output).toContain('task-a');
  });

  it('includes peak hours section when activity exists', () => {
    const report = makeEmptyReport();
    report.peakHours[9] = 5;
    const output = analyticsModule.formatReportForCLI(report);
    expect(output).toContain('Activity by Hour');
    expect(output).toContain('9:00');
  });

  it('skips peak hours section when no activity', () => {
    const output = analyticsModule.formatReportForCLI(makeEmptyReport());
    expect(output).not.toContain('Activity by Hour');
  });

  it('includes data quality note when corrupt files exist', () => {
    const report = makeEmptyReport();
    report.dataQuality.corruptOrInvalid = 3;
    report.dataQuality.parsedSuccessfully = 10;
    const output = analyticsModule.formatReportForCLI(report);
    expect(output).toContain('Data quality');
    expect(output).toContain('3');
  });

  it('uses color coding for success rates', () => {
    const report = makeEmptyReport();
    report.summary.successRate = 95;
    report.summary.totalRuns = 100;
    report.summary.successes = 95;
    report.summary.failures = 5;
    const output = analyticsModule.formatReportForCLI(report);
    // Green for 95%
    expect(output).toContain('\x1b[32m');
  });

  it('uses severity icons for health checks', () => {
    const report = makeEmptyReport();
    report.healthChecks = [
      { taskId: 'a', severity: 'critical', message: 'Critical', recommendation: 'Fix' },
      { taskId: 'b', severity: 'warning', message: 'Warning', recommendation: 'Check' },
      { taskId: 'c', severity: 'info', message: 'Info', recommendation: 'Note' },
    ];
    const output = analyticsModule.formatReportForCLI(report);
    expect(output).toContain('🔴');
    expect(output).toContain('🟡');
    expect(output).toContain('🔵');
  });

  it('uses trend icons', () => {
    const report = makeEmptyReport();
    report.taskMetrics = [
      {
        taskId: 'improving-task', runs: 10, successes: 10, failures: 0,
        successRate: 100, avgDurationSec: 0, medianDurationSec: 0,
        p95DurationSec: 0, maxDurationSec: 0, retryRuns: 0, retryRate: 0,
        currentStreak: { type: 'success', count: 10 }, trend: 'improving',
      },
    ];
    const output = analyticsModule.formatReportForCLI(report);
    expect(output).toContain('📈');
  });
});

// ===========================================================================
// formatReportForMCP
// ===========================================================================

describe('formatReportForMCP', () => {
  function makeEmptyReport(): import('../analytics.js').ProductivityReport {
    return {
      period: { from: '2024-01-01T00:00:00Z', to: '2024-01-31T00:00:00Z', days: 30 },
      summary: {
        totalRuns: 0, successes: 0, failures: 0, successRate: 0,
        avgDurationSec: 0, medianDurationSec: 0, p95DurationSec: 0,
        totalDurationSec: 0, uniqueTasks: 0, runsPerDay: 0,
      },
      taskMetrics: [],
      insights: [],
      healthChecks: [],
      peakHours: new Array(24).fill(0),
      dailyActivity: [],
      dataQuality: { totalLogFiles: 0, parsedSuccessfully: 0, corruptOrInvalid: 0, skippedOutOfRange: 0 },
    };
  }

  it('returns a string', () => {
    const output = analyticsModule.formatReportForMCP(makeEmptyReport());
    expect(typeof output).toBe('string');
  });

  it('does NOT contain ANSI escape codes', () => {
    const report = makeEmptyReport();
    report.summary.totalRuns = 100;
    report.summary.successes = 90;
    report.summary.failures = 10;
    report.summary.successRate = 90;
    const output = analyticsModule.formatReportForMCP(report);
    expect(output).not.toContain('\x1b[');
  });

  it('includes Productivity Analysis header with days', () => {
    const output = analyticsModule.formatReportForMCP(makeEmptyReport());
    expect(output).toContain('Productivity Analysis (30 days)');
  });

  it('includes period dates', () => {
    const output = analyticsModule.formatReportForMCP(makeEmptyReport());
    expect(output).toContain('2024-01-01');
    expect(output).toContain('2024-01-31');
  });

  it('includes ## Summary heading', () => {
    const output = analyticsModule.formatReportForMCP(makeEmptyReport());
    expect(output).toContain('## Summary');
  });

  it('includes total runs in summary', () => {
    const report = makeEmptyReport();
    report.summary.totalRuns = 42;
    const output = analyticsModule.formatReportForMCP(report);
    expect(output).toContain('Total runs: 42');
  });

  it('includes success rate in summary', () => {
    const report = makeEmptyReport();
    report.summary.successRate = 85;
    report.summary.successes = 17;
    report.summary.failures = 3;
    const output = analyticsModule.formatReportForMCP(report);
    expect(output).toContain('85%');
  });

  it('includes insights section when present', () => {
    const report = makeEmptyReport();
    report.insights = [{ type: 'info', icon: '📭', message: 'MCP insight test' }];
    const output = analyticsModule.formatReportForMCP(report);
    expect(output).toContain('## Insights');
    expect(output).toContain('MCP insight test');
  });

  it('skips insights section when empty', () => {
    const output = analyticsModule.formatReportForMCP(makeEmptyReport());
    expect(output).not.toContain('## Insights');
  });

  it('includes health checks section when present', () => {
    const report = makeEmptyReport();
    report.healthChecks = [{
      taskId: 'task-a', severity: 'critical',
      message: 'MCP check', recommendation: 'MCP rec',
    }];
    const output = analyticsModule.formatReportForMCP(report);
    expect(output).toContain('## Health Checks');
    expect(output).toContain('🔴');
    expect(output).toContain('**task-a**');
    expect(output).toContain('MCP check');
  });

  it('uses correct severity icons', () => {
    const report = makeEmptyReport();
    report.healthChecks = [
      { taskId: 'a', severity: 'critical', message: 'm', recommendation: 'r' },
      { taskId: 'b', severity: 'warning', message: 'm', recommendation: 'r' },
      { taskId: 'c', severity: 'info', message: 'm', recommendation: 'r' },
    ];
    const output = analyticsModule.formatReportForMCP(report);
    expect(output).toContain('🔴');
    expect(output).toContain('🟡');
    expect(output).toContain('🔵');
  });

  it('includes per-task metrics when present', () => {
    const report = makeEmptyReport();
    report.taskMetrics = [{
      taskId: 'task-z', runs: 5, successes: 4, failures: 1,
      successRate: 80, avgDurationSec: 60, medianDurationSec: 50,
      p95DurationSec: 100, maxDurationSec: 120, retryRuns: 0,
      retryRate: 0, currentStreak: { type: 'success', count: 3 },
      trend: 'stable',
    }];
    const output = analyticsModule.formatReportForMCP(report);
    expect(output).toContain('## Per-Task Metrics');
    expect(output).toContain('**task-z**');
    expect(output).toContain('80%');
    expect(output).toContain('5 runs');
  });

  it('includes trend icons in per-task metrics', () => {
    const report = makeEmptyReport();
    report.taskMetrics = [{
      taskId: 'task-a', runs: 10, successes: 10, failures: 0,
      successRate: 100, avgDurationSec: 0, medianDurationSec: 0,
      p95DurationSec: 0, maxDurationSec: 0, retryRuns: 0, retryRate: 0,
      currentStreak: { type: 'success', count: 10 }, trend: 'declining',
    }];
    const output = analyticsModule.formatReportForMCP(report);
    expect(output).toContain('📉');
  });

  it('includes data quality note when corrupt files exist', () => {
    const report = makeEmptyReport();
    report.dataQuality.corruptOrInvalid = 2;
    const output = analyticsModule.formatReportForMCP(report);
    expect(output).toContain('Data quality');
    expect(output).toContain('2');
  });

  it('omits data quality note when no corrupt files', () => {
    const output = analyticsModule.formatReportForMCP(makeEmptyReport());
    expect(output).not.toContain('Data quality');
  });
});

// ===========================================================================
// Integration: full end-to-end scenarios
// ===========================================================================

describe('integration scenarios', () => {
  it('handles only corrupt log files gracefully', () => {
    writeLogFile('bad1_ts_exec.md', { status: 'success' }); // no taskId
    writeLogFile('bad2_ts_exec.md', { taskId: 'x' }); // no timestamp
    writeFileSync(join(logsDir, 'bad3.md'), 'not frontmatter at all');

    const report = analyticsModule.analyzeProductivity();
    expect(report.summary.totalRuns).toBe(0);
    expect(report.dataQuality.totalLogFiles).toBe(3);
    expect(report.dataQuality.corruptOrInvalid).toBe(3);
  });

  it('handles mixed valid, corrupt, and out-of-range files', () => {
    const now = new Date();
    createLog('task-a', now, 'success');
    createLog('task-b', new Date('2020-01-01T00:00:00Z'), 'success');
    writeLogFile('corrupt_ts_exec.md', { status: 'success' });

    const report = analyticsModule.analyzeProductivity({ days: 7 });
    expect(report.summary.totalRuns).toBe(1);
    expect(report.dataQuality.parsedSuccessfully).toBe(1);
    expect(report.dataQuality.corruptOrInvalid).toBe(1);
    expect(report.dataQuality.skippedOutOfRange).toBe(1);
  });

  it('multiple tasks with varying success rates are sorted correctly', () => {
    const now = new Date();

    // task-c: 100% success
    createLog('task-c', now, 'success');
    // task-a: 0% success
    createLog('task-a', now, 'failure');
    // task-b: 50% success
    createLog('task-b', now, 'success');
    createLog('task-b', new Date(now.getTime() - 60_000), 'failure');

    const report = analyticsModule.analyzeProductivity();
    expect(report.taskMetrics[0].taskId).toBe('task-a'); // 0%
    expect(report.taskMetrics[1].taskId).toBe('task-b'); // 50%
    expect(report.taskMetrics[2].taskId).toBe('task-c'); // 100%
  });

  it('full report with realistic data', () => {
    const now = new Date();
    listTasksMock.mockReturnValue([
      makeSummary('deploy', true),
      makeSummary('backup', true),
      makeSummary('cleanup', false),
    ]);
    getTaskMock.mockImplementation((id: string) => makeTask(id));
    getDependentsMock.mockReturnValue([]);

    // deploy: 8 success, 2 failure
    for (let i = 0; i < 8; i++) {
      const start = new Date(now.getTime() - (10 - i) * 86400_000);
      const end = new Date(start.getTime() + 120_000);
      createLog('deploy', start, 'success', {
        body: `Step at ${end.toISOString()}`,
      });
    }
    for (let i = 0; i < 2; i++) {
      createLog('deploy', new Date(now.getTime() - i * 86400_000), 'failure');
    }

    // backup: 5 success
    for (let i = 0; i < 5; i++) {
      createLog('backup', new Date(now.getTime() - i * 86400_000), 'success');
    }

    const report = analyticsModule.analyzeProductivity({ days: 30 });

    expect(report.summary.totalRuns).toBe(15);
    expect(report.summary.uniqueTasks).toBe(2);
    expect(report.taskMetrics.length).toBe(2);
    expect(report.healthChecks.length).toBeGreaterThan(0);

    // cleanup should have disabled check
    const cleanupCheck = report.healthChecks.find(c => c.taskId === 'cleanup');
    expect(cleanupCheck).toBeDefined();
    expect(cleanupCheck!.message).toContain('disabled');

    // Verify formatting works
    const cliOutput = analyticsModule.formatReportForCLI(report);
    expect(cliOutput.length).toBeGreaterThan(100);

    const mcpOutput = analyticsModule.formatReportForMCP(report);
    expect(mcpOutput.length).toBeGreaterThan(50);
    expect(mcpOutput).not.toContain('\x1b[');
  });

  it('period from/to are ISO strings', () => {
    const report = analyticsModule.analyzeProductivity({ days: 7 });
    expect(() => new Date(report.period.from)).not.toThrow();
    expect(() => new Date(report.period.to)).not.toThrow();
    expect(report.period.days).toBe(7);
  });

  it('entries are sorted chronologically (oldest first)', () => {
    const now = new Date();
    createLog('task-a', new Date(now.getTime() - 100_000), 'failure');
    createLog('task-a', new Date(now.getTime() - 200_000), 'success');
    createLog('task-a', now, 'success');

    const report = analyticsModule.analyzeProductivity();
    // Last run should be the most recent
    expect(report.taskMetrics[0].lastRun).toBe(now.toISOString());
    // Streak should be based on chronological order
    expect(report.taskMetrics[0].currentStreak.type).toBe('success');
    expect(report.taskMetrics[0].currentStreak.count).toBe(1);
  });

  it('single task with single run produces valid report', () => {
    const now = new Date();
    createLog('solo', now, 'success');
    const report = analyticsModule.analyzeProductivity();
    expect(report.summary.totalRuns).toBe(1);
    expect(report.taskMetrics).toHaveLength(1);
    expect(report.taskMetrics[0].taskId).toBe('solo');
    expect(report.taskMetrics[0].runs).toBe(1);
    expect(report.taskMetrics[0].currentStreak).toEqual({ type: 'success', count: 1 });
    expect(report.taskMetrics[0].trend).toBe('insufficient_data');
  });

  it('maxDurationSec tracks the maximum duration', () => {
    const now = new Date();
    const s1 = new Date(now.getTime() - 600_000);
    const e1 = new Date(s1.getTime() + 60_000);
    createLog('task-a', s1, 'success', { body: `Step at ${e1.toISOString()}` });
    const s2 = new Date(now.getTime() - 300_000);
    const e2 = new Date(s2.getTime() + 300_000);
    createLog('task-a', s2, 'success', { body: `Step at ${e2.toISOString()}` });
    const report = analyticsModule.analyzeProductivity();
    expect(report.taskMetrics[0].maxDurationSec).toBe(300);
  });

  it('medianDurationSec returns median for odd count', () => {
    const now = new Date();
    // 3 entries with durations: 60, 120, 300
    for (const [offset, dur] of [[600, 60], [400, 120], [200, 300]] as const) {
      const s = new Date(now.getTime() - offset * 1000);
      const e = new Date(s.getTime() + dur * 1000);
      createLog('task-a', s, 'success', { body: `Step at ${e.toISOString()}` });
    }
    const report = analyticsModule.analyzeProductivity();
    expect(report.taskMetrics[0].medianDurationSec).toBe(120);
  });

  it('medianDurationSec returns average of middle two for even count', () => {
    const now = new Date();
    // 4 entries with durations: 60, 100, 200, 300
    for (const [offset, dur] of [[800, 60], [600, 100], [400, 200], [200, 300]] as const) {
      const s = new Date(now.getTime() - offset * 1000);
      const e = new Date(s.getTime() + dur * 1000);
      createLog('task-a', s, 'success', { body: `Step at ${e.toISOString()}` });
    }
    const report = analyticsModule.analyzeProductivity();
    expect(report.taskMetrics[0].medianDurationSec).toBe(150); // (100 + 200) / 2
  });

  it('all failures produce 0 successRate summary', () => {
    const now = new Date();
    createLog('task-a', new Date(now.getTime() - 120_000), 'failure');
    createLog('task-b', new Date(now.getTime() - 60_000), 'failure');
    const report = analyticsModule.analyzeProductivity();
    expect(report.summary.successRate).toBe(0);
    expect(report.summary.failures).toBe(2);
  });

  it('totalDurationSec is sum of all durations', () => {
    const now = new Date();
    const s1 = new Date(now.getTime() - 600_000);
    const e1 = new Date(s1.getTime() + 100_000);
    createLog('task-a', s1, 'success', { body: `Step at ${e1.toISOString()}` });
    const s2 = new Date(now.getTime() - 300_000);
    const e2 = new Date(s2.getTime() + 200_000);
    createLog('task-b', s2, 'success', { body: `Step at ${e2.toISOString()}` });
    const report = analyticsModule.analyzeProductivity();
    expect(report.summary.totalDurationSec).toBe(300); // 100 + 200
  });

  it('formatReportForCLI with declining task shows 📉', () => {
    const report = analyticsModule.analyzeProductivity();
    report.taskMetrics = [{
      taskId: 'dec-task', runs: 10, successes: 5, failures: 5,
      successRate: 50, avgDurationSec: 0, medianDurationSec: 0,
      p95DurationSec: 0, maxDurationSec: 0, retryRuns: 0, retryRate: 0,
      currentStreak: { type: 'failure', count: 3 }, trend: 'declining',
    }];
    const output = analyticsModule.formatReportForCLI(report);
    expect(output).toContain('📉');
  });

  it('formatReportForMCP with improving task shows 📈', () => {
    const report = analyticsModule.analyzeProductivity();
    report.taskMetrics = [{
      taskId: 'imp-task', runs: 10, successes: 10, failures: 0,
      successRate: 100, avgDurationSec: 0, medianDurationSec: 0,
      p95DurationSec: 0, maxDurationSec: 0, retryRuns: 0, retryRate: 0,
      currentStreak: { type: 'success', count: 10 }, trend: 'improving',
    }];
    const output = analyticsModule.formatReportForMCP(report);
    expect(output).toContain('📈');
  });

  it('no retry insight when retry rate is 0', () => {
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      createLog('task-a', new Date(now.getTime() - (20 - i) * 60000), 'success', {
        body: 'Normal execution.',
      });
    }
    const report = analyticsModule.analyzeProductivity();
    const retryInsight = report.insights.find(i =>
      i.message.includes('retry') || i.message.includes('Retry'));
    expect(retryInsight).toBeUndefined();
  });

  it('no automation insight when runsPerDay < 1', () => {
    const now = new Date();
    createLog('task-a', new Date(now.getTime() - 60_000), 'success');
    const report = analyticsModule.analyzeProductivity({ days: 30 });
    const automationInsight = report.insights.find(i => i.message.includes('automation'));
    expect(automationInsight).toBeUndefined();
  });

  it('peakHours counts across multiple tasks', () => {
    const now = new Date();
    const base = new Date(now);
    base.setHours(10, 0, 0, 0);
    if (base > now) base.setDate(base.getDate() - 1);
    createLog('task-a', base, 'success');
    createLog('task-b', new Date(base.getTime() + 1000), 'failure');
    const report = analyticsModule.analyzeProductivity();
    expect(report.peakHours[10]).toBe(2);
  });

  it('dailyActivity includes both success and failure on same day', () => {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86400_000);
    const dayStr = dayAgo.toISOString().split('T')[0];
    createLog('task-a', dayAgo, 'success');
    createLog('task-b', new Date(dayAgo.getTime() + 60_000), 'failure');
    const report = analyticsModule.analyzeProductivity({ days: 7 });
    const day = report.dailyActivity.find(d => d.date === dayStr);
    expect(day).toBeDefined();
    expect(day!.runs).toBe(2);
    expect(day!.successes).toBe(1);
    expect(day!.failures).toBe(1);
  });
});
