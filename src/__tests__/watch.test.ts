import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────────

const getSystemSnapshotMock = vi.fn();
vi.mock('../monitoring.js', () => ({
  getSystemSnapshot: (...args: any[]) => getSystemSnapshotMock(...args),
}));

let watchModule: typeof import('../watch.js');

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeSnapshot(overrides: any = {}): any {
  return {
    timestamp: new Date().toISOString(),
    version: '0.1.5',
    config: { tasksDirs: ['/tasks'], logsDir: '/logs', maxConcurrency: 2 },
    tasks: [],
    concurrency: { running: 0, queued: 0, maxConcurrency: 2 },
    recentLogs: [],
    ...overrides,
  };
}

function makeTask(overrides: any = {}): any {
  return {
    id: 'test-task',
    schedule: '0 9 * * *',
    invocation: 'cli',
    agent: 'claude',
    enabled: true,
    dependsOn: undefined,
    latestRun: undefined,
    ...overrides,
  };
}

function collectOutput(writeSpy: ReturnType<typeof vi.spyOn>): string {
  return writeSpy.mock.calls.map((c) => String(c[0])).join('');
}

// ── Setup / Teardown ────────────────────────────────────────────────────────

let writeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.resetModules();
  getSystemSnapshotMock.mockReset();
  writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  watchModule = await import('../watch.js');
});

afterEach(() => {
  writeSpy.mockRestore();
  vi.restoreAllMocks();
});

// =============================================================================
// startWatch – basic lifecycle
// =============================================================================
describe('startWatch – lifecycle', () => {
  it('calls getSystemSnapshot immediately', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const cleanup = await watchModule.startWatch(60_000);
    expect(getSystemSnapshotMock).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('passes maxLogs and includeScheduler options', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const cleanup = await watchModule.startWatch(60_000);
    expect(getSystemSnapshotMock).toHaveBeenCalledWith({ maxLogs: 8, includeScheduler: false });
    cleanup();
  });

  it('writes to stdout', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const cleanup = await watchModule.startWatch(60_000);
    expect(writeSpy).toHaveBeenCalled();
    cleanup();
  });

  it('hides cursor on start', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const cleanup = await watchModule.startWatch(60_000);
    const firstCall = String(writeSpy.mock.calls[0][0]);
    expect(firstCall).toContain('\x1b[?25l');
    cleanup();
  });

  it('cleanup function shows cursor', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const cleanup = await watchModule.startWatch(60_000);
    writeSpy.mockClear();
    cleanup();
    const output = collectOutput(writeSpy);
    expect(output).toContain('\x1b[?25h');
  });

  it('returns a function', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const cleanup = await watchModule.startWatch(60_000);
    expect(typeof cleanup).toBe('function');
    cleanup();
  });

  it('cleanup stops the interval (no more refreshes)', async () => {
    vi.useFakeTimers();
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const cleanup = await watchModule.startWatch(1000);
    expect(getSystemSnapshotMock).toHaveBeenCalledTimes(1);
    cleanup();
    getSystemSnapshotMock.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(getSystemSnapshotMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

// =============================================================================
// startWatch – rendered output: header
// =============================================================================
describe('startWatch – header', () => {
  it('output includes "cron-agents watch"', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('cron-agents watch');
    cleanup();
  });

  it('output includes a time string', async () => {
    const ts = '2024-06-15T14:30:00Z';
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ timestamp: ts }));
    const cleanup = await watchModule.startWatch(60_000);
    // Should contain the locale-formatted time
    const expected = new Date(ts).toLocaleTimeString();
    expect(collectOutput(writeSpy)).toContain(expected);
    cleanup();
  });

  it('output includes box-drawing characters', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const cleanup = await watchModule.startWatch(60_000);
    const out = collectOutput(writeSpy);
    expect(out).toContain('╔');
    expect(out).toContain('╚');
    cleanup();
  });
});

// =============================================================================
// startWatch – concurrency bar
// =============================================================================
describe('startWatch – concurrency', () => {
  it('shows concurrency label', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('Concurrency:');
    cleanup();
  });

  it('shows running/total counts', async () => {
    getSystemSnapshotMock.mockResolvedValue(
      makeSnapshot({ concurrency: { running: 1, queued: 3, maxConcurrency: 4 } }),
    );
    const cleanup = await watchModule.startWatch(60_000);
    const out = collectOutput(writeSpy);
    expect(out).toContain('1/4 running');
    expect(out).toContain('3 queued');
    cleanup();
  });

  it('shows filled slots for running tasks', async () => {
    getSystemSnapshotMock.mockResolvedValue(
      makeSnapshot({ concurrency: { running: 2, queued: 0, maxConcurrency: 4 } }),
    );
    const cleanup = await watchModule.startWatch(60_000);
    const out = collectOutput(writeSpy);
    expect(out).toContain('██░░');
    cleanup();
  });

  it('all empty slots when nothing running', async () => {
    getSystemSnapshotMock.mockResolvedValue(
      makeSnapshot({ concurrency: { running: 0, queued: 0, maxConcurrency: 3 } }),
    );
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('░░░');
    cleanup();
  });
});

// =============================================================================
// startWatch – task statuses
// =============================================================================
describe('startWatch – task statuses', () => {
  it('running status → ⏳ shown', async () => {
    const task = makeTask({ latestRun: { runId: 'r1', status: 'running', startedAt: new Date().toISOString(), elapsed: 5 } });
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ tasks: [task] }));
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('⏳');
    cleanup();
  });

  it('running status shows elapsed seconds', async () => {
    const task = makeTask({ latestRun: { runId: 'r1', status: 'running', startedAt: new Date().toISOString(), elapsed: 42 } });
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ tasks: [task] }));
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('42s');
    cleanup();
  });

  it('queued status → 🕐 shown', async () => {
    const task = makeTask({ latestRun: { runId: 'r1', status: 'queued', startedAt: new Date().toISOString(), elapsed: 2 } });
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ tasks: [task] }));
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('🕐');
    cleanup();
  });

  it('success status → ✅ shown', async () => {
    const task = makeTask({ latestRun: { runId: 'r1', status: 'success', startedAt: new Date().toISOString(), elapsed: 10 } });
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ tasks: [task] }));
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('✅');
    cleanup();
  });

  it('failure status → ❌ shown', async () => {
    const task = makeTask({ latestRun: { runId: 'r1', status: 'failure', startedAt: new Date().toISOString(), elapsed: 10 } });
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ tasks: [task] }));
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('❌');
    cleanup();
  });

  it('no latestRun → "no runs" shown', async () => {
    const task = makeTask({ latestRun: undefined });
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ tasks: [task] }));
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('no runs');
    cleanup();
  });

  it('unknown status falls back to raw status text', async () => {
    const task = makeTask({ latestRun: { runId: 'r1', status: 'cancelled', startedAt: new Date().toISOString(), elapsed: 0 } });
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ tasks: [task] }));
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('cancelled');
    cleanup();
  });
});

// =============================================================================
// startWatch – task table contents
// =============================================================================
describe('startWatch – task table', () => {
  it('empty tasks → "No tasks configured"', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ tasks: [] }));
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('No tasks configured');
    cleanup();
  });

  it('shows task count', async () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' })];
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ tasks }));
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('Tasks (2)');
    cleanup();
  });

  it('shows task id in output', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ tasks: [makeTask({ id: 'my-cron-task' })] }));
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('my-cron-task');
    cleanup();
  });

  it('shows task schedule', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ tasks: [makeTask({ schedule: '*/5 * * * *' })] }));
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('*/5 * * * *');
    cleanup();
  });

  it('shows task agent', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ tasks: [makeTask({ agent: 'copilot' })] }));
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('copilot');
    cleanup();
  });

  it('disabled task → [disabled] shown', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ tasks: [makeTask({ enabled: false })] }));
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('[disabled]');
    cleanup();
  });

  it('enabled task does not show [disabled]', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ tasks: [makeTask({ enabled: true })] }));
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).not.toContain('[disabled]');
    cleanup();
  });

  it('task with dependsOn shows deps', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ tasks: [makeTask({ dependsOn: ['dep-a', 'dep-b'] })] }));
    const cleanup = await watchModule.startWatch(60_000);
    const out = collectOutput(writeSpy);
    expect(out).toContain('dep-a');
    expect(out).toContain('dep-b');
    cleanup();
  });

  it('task without dependsOn does not show arrow', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ tasks: [makeTask({ dependsOn: undefined })] }));
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).not.toContain('←');
    cleanup();
  });

  it('multiple tasks all rendered', async () => {
    const tasks = [
      makeTask({ id: 'alpha' }),
      makeTask({ id: 'bravo' }),
      makeTask({ id: 'charlie' }),
    ];
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ tasks }));
    const cleanup = await watchModule.startWatch(60_000);
    const out = collectOutput(writeSpy);
    expect(out).toContain('alpha');
    expect(out).toContain('bravo');
    expect(out).toContain('charlie');
    cleanup();
  });

  it('shows table header row', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ tasks: [makeTask()] }));
    const cleanup = await watchModule.startWatch(60_000);
    const out = collectOutput(writeSpy);
    expect(out).toContain('ID');
    expect(out).toContain('Schedule');
    expect(out).toContain('Agent');
    expect(out).toContain('Status');
    cleanup();
  });
});

// =============================================================================
// startWatch – recent logs
// =============================================================================
describe('startWatch – recent logs', () => {
  it('shows "Recent Logs" section when logs present', async () => {
    const logs = [{ fileName: 'log1.md', taskId: 'task-a', status: 'success', timestamp: new Date().toISOString() }];
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ recentLogs: logs }));
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('Recent Logs');
    cleanup();
  });

  it('shows success icon ✓ for success log', async () => {
    const logs = [{ fileName: 'log1.md', taskId: 'task-a', status: 'success', timestamp: new Date().toISOString() }];
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ recentLogs: logs }));
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('✓');
    cleanup();
  });

  it('shows failure icon ✗ for failure log', async () => {
    const logs = [{ fileName: 'log1.md', taskId: 'task-a', status: 'failure', timestamp: new Date().toISOString() }];
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ recentLogs: logs }));
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('✗');
    cleanup();
  });

  it('shows task id in log line', async () => {
    const logs = [{ fileName: 'log1.md', taskId: 'unique-task-id', status: 'success', timestamp: new Date().toISOString() }];
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ recentLogs: logs }));
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('unique-task-id');
    cleanup();
  });

  it('shows file name in log line', async () => {
    const logs = [{ fileName: 'my-special-log.md', taskId: 'task-a', status: 'success', timestamp: new Date().toISOString() }];
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ recentLogs: logs }));
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('my-special-log.md');
    cleanup();
  });

  it('no recent logs hides the section', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ recentLogs: [] }));
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).not.toContain('Recent Logs');
    cleanup();
  });

  it('caps logs at 8 entries', async () => {
    const logs = Array.from({ length: 12 }, (_, i) => ({
      fileName: `log${i}.md`,
      taskId: `task-${i}`,
      status: 'success',
      timestamp: new Date().toISOString(),
    }));
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ recentLogs: logs }));
    const cleanup = await watchModule.startWatch(60_000);
    const out = collectOutput(writeSpy);
    expect(out).toContain('task-7');
    expect(out).not.toContain('task-8');
    cleanup();
  });

  it('handles log with missing timestamp gracefully', async () => {
    const logs = [{ fileName: 'log.md', taskId: 'task-a', status: 'success', timestamp: '' }];
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ recentLogs: logs }));
    const cleanup = await watchModule.startWatch(60_000);
    // Should not throw; renders ??? for bad timestamps
    expect(collectOutput(writeSpy)).toBeTruthy();
    cleanup();
  });
});

// =============================================================================
// startWatch – error handling
// =============================================================================
describe('startWatch – error handling', () => {
  it('error during refresh shows error message', async () => {
    getSystemSnapshotMock.mockRejectedValue(new Error('connection lost'));
    const cleanup = await watchModule.startWatch(60_000);
    const out = collectOutput(writeSpy);
    expect(out).toContain('Error refreshing');
    expect(out).toContain('connection lost');
    cleanup();
  });

  it('error during interval refresh shows error message', async () => {
    vi.useFakeTimers();
    getSystemSnapshotMock.mockResolvedValueOnce(makeSnapshot());
    getSystemSnapshotMock.mockRejectedValueOnce(new Error('oops'));
    const cleanup = await watchModule.startWatch(1000);
    writeSpy.mockClear();
    await vi.advanceTimersByTimeAsync(1000);
    const out = collectOutput(writeSpy);
    expect(out).toContain('Error refreshing');
    cleanup();
    vi.useRealTimers();
  });
});

// =============================================================================
// startWatch – interval / timer behavior
// =============================================================================
describe('startWatch – interval', () => {
  it('refreshes on each interval tick', async () => {
    vi.useFakeTimers();
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const cleanup = await watchModule.startWatch(500);
    expect(getSystemSnapshotMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(getSystemSnapshotMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(getSystemSnapshotMock).toHaveBeenCalledTimes(3);
    cleanup();
    vi.useRealTimers();
  });

  it('uses default interval of 2000ms', async () => {
    vi.useFakeTimers();
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const cleanup = await watchModule.startWatch();
    expect(getSystemSnapshotMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(getSystemSnapshotMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(getSystemSnapshotMock).toHaveBeenCalledTimes(2);
    cleanup();
    vi.useRealTimers();
  });

  it('no refresh after cleanup', async () => {
    vi.useFakeTimers();
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const cleanup = await watchModule.startWatch(500);
    cleanup();
    getSystemSnapshotMock.mockClear();
    await vi.advanceTimersByTimeAsync(2000);
    expect(getSystemSnapshotMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

// =============================================================================
// startWatch – footer
// =============================================================================
describe('startWatch – footer', () => {
  it('shows Ctrl+C hint', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('Ctrl+C');
    cleanup();
  });

  it('shows refresh interval hint', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('Refreshes every 2s');
    cleanup();
  });
});

// =============================================================================
// runWatch
// =============================================================================
describe('runWatch', () => {
  it('resolves when SIGINT is emitted', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const promise = watchModule.runWatch(60_000);
    // Delay signal to ensure handler is registered
    await new Promise((r) => setImmediate(r));
    process.emit('SIGINT' as any);
    await expect(promise).resolves.toBeUndefined();
  });

  it('resolves when SIGTERM is emitted', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const promise = watchModule.runWatch(60_000);
    await new Promise((r) => setImmediate(r));
    process.emit('SIGTERM' as any);
    await expect(promise).resolves.toBeUndefined();
  });

  it('shows cursor after signal', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const promise = watchModule.runWatch(60_000);
    await new Promise((r) => setImmediate(r));
    writeSpy.mockClear();
    process.emit('SIGINT' as any);
    await promise;
    expect(collectOutput(writeSpy)).toContain('\x1b[?25h');
  });

  it('passes custom interval', async () => {
    vi.useFakeTimers();
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const promise = watchModule.runWatch(750);
    expect(getSystemSnapshotMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(750);
    expect(getSystemSnapshotMock).toHaveBeenCalledTimes(2);
    process.emit('SIGINT' as any);
    await promise;
    vi.useRealTimers();
  });
});

// =============================================================================
// startWatch – ANSI escape codes
// =============================================================================
describe('startWatch – ANSI codes', () => {
  it('output contains CLEAR_SCREEN sequence', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('\x1b[2J\x1b[H');
    cleanup();
  });

  it('output contains BOLD sequence', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('\x1b[1m');
    cleanup();
  });

  it('output contains RESET sequence', async () => {
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const cleanup = await watchModule.startWatch(60_000);
    expect(collectOutput(writeSpy)).toContain('\x1b[0m');
    cleanup();
  });
});
