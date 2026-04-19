import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock tasks.js ───────────────────────────────────────────────────────────

const listTasksMock = vi.fn();
const getTaskMock = vi.fn();
const getTaskFilePathMock = vi.fn();
vi.mock('../tasks.js', () => ({
  listTasks: (...args: any[]) => listTasksMock(...args),
  getTask: (...args: any[]) => getTaskMock(...args),
  getTaskFilePath: (...args: any[]) => getTaskFilePathMock(...args),
}));

// ── Mock runs.js ────────────────────────────────────────────────────────────

const getLatestRunForTaskMock = vi.fn();
const createRunMock = vi.fn();
const updateRunMock = vi.fn();
vi.mock('../runs.js', () => ({
  getLatestRunForTask: (...args: any[]) => getLatestRunForTaskMock(...args),
  createRun: (...args: any[]) => createRunMock(...args),
  updateRun: (...args: any[]) => updateRunMock(...args),
}));

// ── Import module under test ────────────────────────────────────────────────

import {
  validateDAG,
  getDependents,
  areDependenciesMet,
  triggerDependents,
  getTopologicalOrder,
  getDAGDisplay,
} from '../chains.js';
import type { TaskDefinition, RunRecord } from '../types.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal TaskDefinition */
function makeTask(id: string, overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id,
    schedule: '0 9 * * *',
    invocation: 'cli',
    agent: 'claude',
    notifications: { toast: false },
    enabled: true,
    instructions: `Instructions for ${id}`,
    ...overrides,
  };
}

/** Build a minimal task summary as returned by listTasks() */
function makeSummary(id: string, enabled = true) {
  return { id, schedule: '0 9 * * *', invocation: 'cli' as const, agent: 'claude' as const, enabled };
}

/** Build a minimal RunRecord */
function makeRun(taskId: string, status: RunRecord['status'], overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: `run-${taskId}-1`,
    taskId,
    startedAt: '2024-01-01T00:00:00Z',
    status,
    ...overrides,
  };
}

// ── Reset mocks ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  listTasksMock.mockReturnValue([]);
  getTaskMock.mockReturnValue(null);
  getLatestRunForTaskMock.mockReturnValue(null);
});

// ═════════════════════════════════════════════════════════════════════════════
// validateDAG
// ═════════════════════════════════════════════════════════════════════════════

describe('validateDAG', () => {
  it('returns no errors when there are no tasks', () => {
    expect(validateDAG()).toEqual([]);
  });

  it('returns no errors for a single task without dependencies', () => {
    listTasksMock.mockReturnValue([makeSummary('A')]);
    getTaskMock.mockImplementation((id: string) => makeTask(id));
    expect(validateDAG()).toEqual([]);
  });

  it('returns no errors for a simple valid chain A → B → C', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B'), makeSummary('C')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'B') return makeTask('B', { dependsOn: ['A'] });
      if (id === 'C') return makeTask('C', { dependsOn: ['B'] });
      return makeTask(id);
    });
    expect(validateDAG()).toEqual([]);
  });

  it('detects self-reference', () => {
    listTasksMock.mockReturnValue([makeSummary('A')]);
    getTaskMock.mockReturnValue(makeTask('A', { dependsOn: ['A'] }));
    const errors = validateDAG();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('depends on itself'))).toBe(true);
  });

  it('detects missing dependency', () => {
    listTasksMock.mockReturnValue([makeSummary('A')]);
    getTaskMock.mockReturnValue(makeTask('A', { dependsOn: ['nonexistent'] }));
    const errors = validateDAG();
    expect(errors.some(e => e.includes('non-existent task "nonexistent"'))).toBe(true);
  });

  it('detects simple cycle A→B→A', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeTask('A', { dependsOn: ['B'] });
      if (id === 'B') return makeTask('B', { dependsOn: ['A'] });
      return makeTask(id);
    });
    const errors = validateDAG();
    expect(errors.some(e => e.includes('Circular dependency'))).toBe(true);
  });

  it('detects complex cycle A→B→C→A', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B'), makeSummary('C')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeTask('A', { dependsOn: ['C'] });
      if (id === 'B') return makeTask('B', { dependsOn: ['A'] });
      if (id === 'C') return makeTask('C', { dependsOn: ['B'] });
      return makeTask(id);
    });
    const errors = validateDAG();
    expect(errors.some(e => e.includes('Circular dependency'))).toBe(true);
  });

  it('validates a diamond graph as valid (D ← B,C ← A)', () => {
    listTasksMock.mockReturnValue([
      makeSummary('A'), makeSummary('B'), makeSummary('C'), makeSummary('D'),
    ]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'B') return makeTask('B', { dependsOn: ['A'] });
      if (id === 'C') return makeTask('C', { dependsOn: ['A'] });
      if (id === 'D') return makeTask('D', { dependsOn: ['B', 'C'] });
      return makeTask(id);
    });
    expect(validateDAG()).toEqual([]);
  });

  it('validates multiple independent chains as valid', () => {
    listTasksMock.mockReturnValue([
      makeSummary('A'), makeSummary('B'),
      makeSummary('X'), makeSummary('Y'),
    ]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'B') return makeTask('B', { dependsOn: ['A'] });
      if (id === 'Y') return makeTask('Y', { dependsOn: ['X'] });
      return makeTask(id);
    });
    expect(validateDAG()).toEqual([]);
  });

  it('validates a specific task only (taskId param)', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeTask('A', { dependsOn: ['A'] }); // self-ref
      if (id === 'B') return makeTask('B', { dependsOn: ['missing'] }); // missing dep
      return makeTask(id);
    });
    // Only validate B → should find missing dep but NOT A's self-ref
    const errors = validateDAG('B');
    expect(errors.some(e => e.includes('"B"') && e.includes('non-existent'))).toBe(true);
    expect(errors.some(e => e.includes('"A"') && e.includes('depends on itself'))).toBe(false);
  });

  it('returns no errors for task with empty dependsOn array', () => {
    listTasksMock.mockReturnValue([makeSummary('A')]);
    getTaskMock.mockReturnValue(makeTask('A', { dependsOn: [] }));
    expect(validateDAG()).toEqual([]);
  });

  it('detects multiple errors in one DAG', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B'), makeSummary('C')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeTask('A', { dependsOn: ['A'] }); // self-ref
      if (id === 'B') return makeTask('B', { dependsOn: ['missing'] }); // missing dep
      if (id === 'C') return makeTask('C', { dependsOn: ['A'] });
      return makeTask(id);
    });
    const errors = validateDAG();
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors.some(e => e.includes('depends on itself'))).toBe(true);
    expect(errors.some(e => e.includes('non-existent'))).toBe(true);
  });

  it('handles task whose getTask returns null', () => {
    listTasksMock.mockReturnValue([makeSummary('A')]);
    getTaskMock.mockReturnValue(null);
    expect(validateDAG()).toEqual([]);
  });

  it('validates when taskId param is not in the taskMap (no deps)', () => {
    listTasksMock.mockReturnValue([makeSummary('A')]);
    getTaskMock.mockReturnValue(makeTask('A'));
    // taskId 'A' has no deps → no errors
    expect(validateDAG('A')).toEqual([]);
  });

  it('validates when taskId param has valid dependencies', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'B') return makeTask('B', { dependsOn: ['A'] });
      return makeTask(id);
    });
    expect(validateDAG('B')).toEqual([]);
  });

  it('detects self-reference for specific taskId', () => {
    listTasksMock.mockReturnValue([makeSummary('X')]);
    getTaskMock.mockReturnValue(makeTask('X', { dependsOn: ['X'] }));
    const errors = validateDAG('X');
    expect(errors.some(e => e.includes('"X"') && e.includes('depends on itself'))).toBe(true);
  });

  it('handles large fan-out: one task depended on by many', () => {
    const summaries = [makeSummary('root')];
    for (let i = 0; i < 10; i++) summaries.push(makeSummary(`child-${i}`));
    listTasksMock.mockReturnValue(summaries);
    getTaskMock.mockImplementation((id: string) => {
      if (id.startsWith('child-')) return makeTask(id, { dependsOn: ['root'] });
      return makeTask(id);
    });
    expect(validateDAG()).toEqual([]);
  });

  it('handles large fan-in: one task depends on many', () => {
    const summaries = [];
    for (let i = 0; i < 5; i++) summaries.push(makeSummary(`dep-${i}`));
    summaries.push(makeSummary('collector'));
    listTasksMock.mockReturnValue(summaries);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'collector') return makeTask(id, { dependsOn: summaries.filter(s => s.id !== 'collector').map(s => s.id) });
      return makeTask(id);
    });
    expect(validateDAG()).toEqual([]);
  });

  it('cycle detection includes the cycle path in the error', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeTask('A', { dependsOn: ['B'] });
      if (id === 'B') return makeTask('B', { dependsOn: ['A'] });
      return makeTask(id);
    });
    const errors = validateDAG();
    const cycleError = errors.find(e => e.includes('Circular dependency'));
    expect(cycleError).toBeDefined();
    expect(cycleError).toContain('→');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getDependents
// ═════════════════════════════════════════════════════════════════════════════

describe('getDependents', () => {
  it('returns empty array when task has no dependents', () => {
    listTasksMock.mockReturnValue([makeSummary('A')]);
    getTaskMock.mockReturnValue(makeTask('A'));
    expect(getDependents('A')).toEqual([]);
  });

  it('returns the single dependent of a task', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'B') return makeTask('B', { dependsOn: ['A'] });
      return makeTask(id);
    });
    const result = getDependents('A');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('B');
  });

  it('returns multiple dependents', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B'), makeSummary('C')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'B') return makeTask('B', { dependsOn: ['A'] });
      if (id === 'C') return makeTask('C', { dependsOn: ['A'] });
      return makeTask(id);
    });
    const result = getDependents('A');
    expect(result).toHaveLength(2);
    expect(result.map(t => t.id).sort()).toEqual(['B', 'C']);
  });

  it('returns empty for non-existent task', () => {
    listTasksMock.mockReturnValue([makeSummary('A')]);
    getTaskMock.mockReturnValue(makeTask('A'));
    expect(getDependents('nonexistent')).toEqual([]);
  });

  it('handles case where getTask returns null for some tasks', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B'), makeSummary('C')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'B') return null; // getTask returns null
      if (id === 'C') return makeTask('C', { dependsOn: ['A'] });
      return makeTask(id);
    });
    const result = getDependents('A');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('C');
  });

  it('returns empty array when no tasks exist', () => {
    listTasksMock.mockReturnValue([]);
    expect(getDependents('anything')).toEqual([]);
  });

  it('does not return the task itself', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'B') return makeTask('B', { dependsOn: ['A'] });
      return makeTask(id);
    });
    const result = getDependents('B');
    expect(result).toEqual([]);
  });

  it('only returns direct dependents, not transitive', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B'), makeSummary('C')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'B') return makeTask('B', { dependsOn: ['A'] });
      if (id === 'C') return makeTask('C', { dependsOn: ['B'] });
      return makeTask(id);
    });
    // C depends on B which depends on A; getDependents('A') should NOT include C
    const result = getDependents('A');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('B');
  });

  it('handles task with undefined dependsOn', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B')]);
    getTaskMock.mockImplementation((id: string) => {
      const t = makeTask(id);
      delete (t as any).dependsOn;
      return t;
    });
    expect(getDependents('A')).toEqual([]);
  });

  it('handles task with empty dependsOn', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B')]);
    getTaskMock.mockImplementation((id: string) => makeTask(id, { dependsOn: [] }));
    expect(getDependents('A')).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// areDependenciesMet
// ═════════════════════════════════════════════════════════════════════════════

describe('areDependenciesMet', () => {
  it('returns met:true with empty details when task has no dependencies', () => {
    getTaskMock.mockReturnValue(makeTask('A'));
    const result = areDependenciesMet('A');
    expect(result).toEqual({ met: true, details: [] });
  });

  it('returns met:true when dependsOn is empty array', () => {
    getTaskMock.mockReturnValue(makeTask('A', { dependsOn: [] }));
    const result = areDependenciesMet('A');
    expect(result).toEqual({ met: true, details: [] });
  });

  it('returns met:true when getTask returns null (no task found)', () => {
    getTaskMock.mockReturnValue(null);
    const result = areDependenciesMet('nonexistent');
    expect(result).toEqual({ met: true, details: [] });
  });

  it('returns met:false with status "missing" when dependency does not exist', () => {
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeTask('A', { dependsOn: ['missing-dep'] });
      return null; // missing-dep not found
    });
    const result = areDependenciesMet('A');
    expect(result.met).toBe(false);
    expect(result.details).toHaveLength(1);
    expect(result.details[0]).toMatchObject({ taskId: 'missing-dep', status: 'missing', met: false });
  });

  it('returns met:false with status "disabled" when dependency is disabled', () => {
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeTask('A', { dependsOn: ['B'] });
      if (id === 'B') return makeTask('B', { enabled: false });
      return null;
    });
    const result = areDependenciesMet('A');
    expect(result.met).toBe(false);
    expect(result.details[0]).toMatchObject({ taskId: 'B', status: 'disabled', met: false });
  });

  it('returns met:false with status "never_run" when dependency never ran', () => {
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeTask('A', { dependsOn: ['B'] });
      if (id === 'B') return makeTask('B');
      return null;
    });
    getLatestRunForTaskMock.mockReturnValue(null);
    const result = areDependenciesMet('A');
    expect(result.met).toBe(false);
    expect(result.details[0]).toMatchObject({ taskId: 'B', status: 'never_run', met: false });
  });

  it('returns met:true when dependency last ran successfully', () => {
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeTask('A', { dependsOn: ['B'] });
      if (id === 'B') return makeTask('B');
      return null;
    });
    getLatestRunForTaskMock.mockReturnValue(makeRun('B', 'success', { finishedAt: '2024-01-01T01:00:00Z' }));
    const result = areDependenciesMet('A');
    expect(result.met).toBe(true);
    expect(result.details[0]).toMatchObject({ taskId: 'B', status: 'success', met: true });
  });

  it('returns met:false when dependency last ran with failure', () => {
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeTask('A', { dependsOn: ['B'] });
      if (id === 'B') return makeTask('B');
      return null;
    });
    getLatestRunForTaskMock.mockReturnValue(makeRun('B', 'failure'));
    const result = areDependenciesMet('A');
    expect(result.met).toBe(false);
    expect(result.details[0]).toMatchObject({ taskId: 'B', status: 'failure', met: false });
  });

  it('returns met:false when dependency is currently running', () => {
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeTask('A', { dependsOn: ['B'] });
      if (id === 'B') return makeTask('B');
      return null;
    });
    getLatestRunForTaskMock.mockReturnValue(makeRun('B', 'running'));
    const result = areDependenciesMet('A');
    expect(result.met).toBe(false);
    expect(result.details[0]).toMatchObject({ taskId: 'B', status: 'running', met: false });
  });

  it('returns met:false when dependency is queued', () => {
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeTask('A', { dependsOn: ['B'] });
      if (id === 'B') return makeTask('B');
      return null;
    });
    getLatestRunForTaskMock.mockReturnValue(makeRun('B', 'queued'));
    const result = areDependenciesMet('A');
    expect(result.met).toBe(false);
    expect(result.details[0]).toMatchObject({ taskId: 'B', status: 'queued', met: false });
  });

  it('returns met:true when all multiple dependencies are met', () => {
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'D') return makeTask('D', { dependsOn: ['A', 'B', 'C'] });
      return makeTask(id);
    });
    getLatestRunForTaskMock.mockReturnValue(makeRun('any', 'success', { finishedAt: '2024-01-01T01:00:00Z' }));
    const result = areDependenciesMet('D');
    expect(result.met).toBe(true);
    expect(result.details).toHaveLength(3);
    expect(result.details.every(d => d.met)).toBe(true);
  });

  it('returns met:false when one of multiple dependencies is not met', () => {
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'D') return makeTask('D', { dependsOn: ['A', 'B'] });
      return makeTask(id);
    });
    getLatestRunForTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeRun('A', 'success', { finishedAt: '2024-01-01T01:00:00Z' });
      if (id === 'B') return makeRun('B', 'failure');
      return null;
    });
    const result = areDependenciesMet('D');
    expect(result.met).toBe(false);
    const detailA = result.details.find(d => d.taskId === 'A');
    const detailB = result.details.find(d => d.taskId === 'B');
    expect(detailA?.met).toBe(true);
    expect(detailB?.met).toBe(false);
  });

  it('includes runId in details when dependency has run', () => {
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeTask('A', { dependsOn: ['B'] });
      return makeTask(id);
    });
    getLatestRunForTaskMock.mockReturnValue(makeRun('B', 'success', { runId: 'run-123', finishedAt: '2024-01-01T01:00:00Z' }));
    const result = areDependenciesMet('A');
    expect(result.details[0].runId).toBe('run-123');
  });

  it('includes finishedAt in details when dependency has run', () => {
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeTask('A', { dependsOn: ['B'] });
      return makeTask(id);
    });
    getLatestRunForTaskMock.mockReturnValue(makeRun('B', 'success', { finishedAt: '2024-06-15T12:00:00Z' }));
    const result = areDependenciesMet('A');
    expect(result.details[0].finishedAt).toBe('2024-06-15T12:00:00Z');
  });

  it('handles mixed statuses across multiple dependencies', () => {
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'Z') return makeTask('Z', { dependsOn: ['A', 'B', 'C'] });
      if (id === 'A') return makeTask('A');
      if (id === 'B') return null; // missing
      if (id === 'C') return makeTask('C', { enabled: false }); // disabled
      return null;
    });
    getLatestRunForTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeRun('A', 'success');
      return null;
    });
    const result = areDependenciesMet('Z');
    expect(result.met).toBe(false);
    expect(result.details).toHaveLength(3);
    expect(result.details.find(d => d.taskId === 'A')?.met).toBe(true);
    expect(result.details.find(d => d.taskId === 'B')?.status).toBe('missing');
    expect(result.details.find(d => d.taskId === 'C')?.status).toBe('disabled');
  });

  it('checks dependencies in order', () => {
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeTask('A', { dependsOn: ['X', 'Y'] });
      return makeTask(id);
    });
    getLatestRunForTaskMock.mockReturnValue(makeRun('any', 'success'));
    const result = areDependenciesMet('A');
    expect(result.details[0].taskId).toBe('X');
    expect(result.details[1].taskId).toBe('Y');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// triggerDependents
// ═════════════════════════════════════════════════════════════════════════════

describe('triggerDependents', () => {
  // Helper to set up a world where getDependents finds tasks
  function setupWorld(tasks: { id: string; dependsOn?: string[]; enabled?: boolean }[]) {
    listTasksMock.mockReturnValue(tasks.map(t => makeSummary(t.id, t.enabled ?? true)));
    getTaskMock.mockImplementation((id: string) => {
      const def = tasks.find(t => t.id === id);
      if (!def) return null;
      return makeTask(id, { dependsOn: def.dependsOn, enabled: def.enabled ?? true });
    });
  }

  it('returns empty array when no dependents exist', () => {
    setupWorld([{ id: 'A' }]);
    expect(triggerDependents('A')).toEqual([]);
  });

  it('triggers one eligible dependent', () => {
    setupWorld([
      { id: 'A' },
      { id: 'B', dependsOn: ['A'] },
    ]);
    getLatestRunForTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeRun('A', 'success');
      return null; // B has no active run
    });
    const result = triggerDependents('A');
    expect(result).toHaveLength(1);
    expect(result[0].taskId).toBe('B');
    expect(result[0].triggeredBy).toBe('A');
  });

  it('skips disabled dependents', () => {
    setupWorld([
      { id: 'A' },
      { id: 'B', dependsOn: ['A'], enabled: false },
    ]);
    getLatestRunForTaskMock.mockReturnValue(makeRun('A', 'success'));
    expect(triggerDependents('A')).toEqual([]);
  });

  it('skips dependents whose dependencies are not all met', () => {
    setupWorld([
      { id: 'A' },
      { id: 'C' },
      { id: 'B', dependsOn: ['A', 'C'] },
    ]);
    getLatestRunForTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeRun('A', 'success');
      // C never ran → B's dep not met
      return null;
    });
    expect(triggerDependents('A')).toEqual([]);
  });

  it('skips dependents that already have a running run', () => {
    setupWorld([
      { id: 'A' },
      { id: 'B', dependsOn: ['A'] },
    ]);
    getLatestRunForTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeRun('A', 'success');
      if (id === 'B') return makeRun('B', 'running');
      return null;
    });
    expect(triggerDependents('A')).toEqual([]);
  });

  it('skips dependents that already have a queued run', () => {
    setupWorld([
      { id: 'A' },
      { id: 'B', dependsOn: ['A'] },
    ]);
    getLatestRunForTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeRun('A', 'success');
      if (id === 'B') return makeRun('B', 'queued');
      return null;
    });
    expect(triggerDependents('A')).toEqual([]);
  });

  it('uses provided chainId', () => {
    setupWorld([
      { id: 'A' },
      { id: 'B', dependsOn: ['A'] },
    ]);
    getLatestRunForTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeRun('A', 'success');
      return null;
    });
    const result = triggerDependents('A', 'my-chain-id');
    expect(result).toHaveLength(1);
    expect(result[0].chainId).toBe('my-chain-id');
  });

  it('auto-generates chainId when not provided', () => {
    setupWorld([
      { id: 'A' },
      { id: 'B', dependsOn: ['A'] },
    ]);
    getLatestRunForTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeRun('A', 'success');
      return null;
    });
    const result = triggerDependents('A');
    expect(result[0].chainId).toBeDefined();
    expect(result[0].chainId).toMatch(/^chain-/);
  });

  it('triggers multiple eligible dependents', () => {
    setupWorld([
      { id: 'A' },
      { id: 'B', dependsOn: ['A'] },
      { id: 'C', dependsOn: ['A'] },
    ]);
    getLatestRunForTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeRun('A', 'success');
      return null;
    });
    const result = triggerDependents('A');
    expect(result).toHaveLength(2);
    expect(result.map(t => t.taskId).sort()).toEqual(['B', 'C']);
  });

  it('triggers only eligible dependents from a mix', () => {
    setupWorld([
      { id: 'A' },
      { id: 'B', dependsOn: ['A'] },                // eligible
      { id: 'C', dependsOn: ['A'], enabled: false }, // disabled
      { id: 'D', dependsOn: ['A'] },                 // already running
    ]);
    getLatestRunForTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeRun('A', 'success');
      if (id === 'D') return makeRun('D', 'running');
      return null;
    });
    const result = triggerDependents('A');
    expect(result).toHaveLength(1);
    expect(result[0].taskId).toBe('B');
  });

  it('all triggered tasks share the same chainId', () => {
    setupWorld([
      { id: 'A' },
      { id: 'B', dependsOn: ['A'] },
      { id: 'C', dependsOn: ['A'] },
    ]);
    getLatestRunForTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeRun('A', 'success');
      return null;
    });
    const result = triggerDependents('A');
    expect(result).toHaveLength(2);
    expect(result[0].chainId).toBe(result[1].chainId);
  });

  it('triggeredBy references the completed task', () => {
    setupWorld([
      { id: 'root' },
      { id: 'child', dependsOn: ['root'] },
    ]);
    getLatestRunForTaskMock.mockImplementation((id: string) => {
      if (id === 'root') return makeRun('root', 'success');
      return null;
    });
    const result = triggerDependents('root');
    expect(result[0].triggeredBy).toBe('root');
  });

  it('returns empty when completedTaskId has no tasks at all', () => {
    listTasksMock.mockReturnValue([]);
    expect(triggerDependents('ghost')).toEqual([]);
  });

  it('skips dependent whose dep task returned failure for the completed task', () => {
    setupWorld([
      { id: 'A' },
      { id: 'B', dependsOn: ['A'] },
    ]);
    // areDependenciesMet for B: A has status 'failure' → met = false
    getLatestRunForTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeRun('A', 'failure');
      return null;
    });
    // triggerDependents calls getDependents → B, then areDependenciesMet('B') → not met
    expect(triggerDependents('A')).toEqual([]);
  });

  it('triggers dependent whose previous run was failure (not active)', () => {
    setupWorld([
      { id: 'A' },
      { id: 'B', dependsOn: ['A'] },
    ]);
    getLatestRunForTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeRun('A', 'success');
      if (id === 'B') return makeRun('B', 'failure'); // past failure, not active
      return null;
    });
    const result = triggerDependents('A');
    expect(result).toHaveLength(1);
    expect(result[0].taskId).toBe('B');
  });

  it('triggers dependent whose previous run was success (not active)', () => {
    setupWorld([
      { id: 'A' },
      { id: 'B', dependsOn: ['A'] },
    ]);
    getLatestRunForTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeRun('A', 'success');
      if (id === 'B') return makeRun('B', 'success'); // past success, not active
      return null;
    });
    const result = triggerDependents('A');
    expect(result).toHaveLength(1);
    expect(result[0].taskId).toBe('B');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getTopologicalOrder
// ═════════════════════════════════════════════════════════════════════════════

describe('getTopologicalOrder', () => {
  it('returns empty array when no tasks exist', () => {
    expect(getTopologicalOrder()).toEqual([]);
  });

  it('returns single task', () => {
    listTasksMock.mockReturnValue([makeSummary('A')]);
    getTaskMock.mockReturnValue(makeTask('A'));
    expect(getTopologicalOrder()).toEqual(['A']);
  });

  it('returns valid topological order for linear chain A→B→C', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B'), makeSummary('C')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'B') return makeTask('B', { dependsOn: ['A'] });
      if (id === 'C') return makeTask('C', { dependsOn: ['B'] });
      return makeTask(id);
    });
    const order = getTopologicalOrder();
    expect(order).toHaveLength(3);
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('C'));
  });

  it('returns valid topological order for diamond graph', () => {
    listTasksMock.mockReturnValue([
      makeSummary('A'), makeSummary('B'), makeSummary('C'), makeSummary('D'),
    ]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'B') return makeTask('B', { dependsOn: ['A'] });
      if (id === 'C') return makeTask('C', { dependsOn: ['A'] });
      if (id === 'D') return makeTask('D', { dependsOn: ['B', 'C'] });
      return makeTask(id);
    });
    const order = getTopologicalOrder();
    expect(order).toHaveLength(4);
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('C'));
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('D'));
    expect(order.indexOf('C')).toBeLessThan(order.indexOf('D'));
  });

  it('includes all independent tasks', () => {
    listTasksMock.mockReturnValue([makeSummary('X'), makeSummary('Y'), makeSummary('Z')]);
    getTaskMock.mockImplementation((id: string) => makeTask(id));
    const order = getTopologicalOrder();
    expect(order).toHaveLength(3);
    expect(order.sort()).toEqual(['X', 'Y', 'Z']);
  });

  it('tasks with no deps come first', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B'), makeSummary('C')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'C') return makeTask('C', { dependsOn: ['A'] });
      return makeTask(id);
    });
    const order = getTopologicalOrder();
    // A and B have no deps; C depends on A
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('C'));
    // B has no deps so should appear before C
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('C'));
  });

  it('handles multiple independent chains', () => {
    listTasksMock.mockReturnValue([
      makeSummary('A'), makeSummary('B'),
      makeSummary('X'), makeSummary('Y'),
    ]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'B') return makeTask('B', { dependsOn: ['A'] });
      if (id === 'Y') return makeTask('Y', { dependsOn: ['X'] });
      return makeTask(id);
    });
    const order = getTopologicalOrder();
    expect(order).toHaveLength(4);
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
    expect(order.indexOf('X')).toBeLessThan(order.indexOf('Y'));
  });

  it('handles task with dependency on non-existent task gracefully', () => {
    listTasksMock.mockReturnValue([makeSummary('A')]);
    getTaskMock.mockReturnValue(makeTask('A', { dependsOn: ['ghost'] }));
    // ghost is not in the graph, so the dep edge is skipped
    const order = getTopologicalOrder();
    expect(order).toContain('A');
  });

  it('handles task with empty dependsOn', () => {
    listTasksMock.mockReturnValue([makeSummary('A')]);
    getTaskMock.mockReturnValue(makeTask('A', { dependsOn: [] }));
    expect(getTopologicalOrder()).toEqual(['A']);
  });

  it('handles getTask returning null', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return null;
      return makeTask('B');
    });
    const order = getTopologicalOrder();
    expect(order).toContain('A');
    expect(order).toContain('B');
  });

  it('handles long chain maintaining correct order', () => {
    const ids = ['A', 'B', 'C', 'D', 'E'];
    listTasksMock.mockReturnValue(ids.map(id => makeSummary(id)));
    getTaskMock.mockImplementation((id: string) => {
      const idx = ids.indexOf(id);
      if (idx > 0) return makeTask(id, { dependsOn: [ids[idx - 1]] });
      return makeTask(id);
    });
    const order = getTopologicalOrder();
    expect(order).toEqual(ids);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getDAGDisplay
// ═════════════════════════════════════════════════════════════════════════════

describe('getDAGDisplay', () => {
  it('returns "No task dependencies configured." when no deps exist', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B')]);
    getTaskMock.mockImplementation((id: string) => makeTask(id));
    expect(getDAGDisplay()).toBe('No task dependencies configured.');
  });

  it('returns "No task dependencies configured." when no tasks at all', () => {
    listTasksMock.mockReturnValue([]);
    expect(getDAGDisplay()).toBe('No task dependencies configured.');
  });

  it('shows graph for tasks with dependencies', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'B') return makeTask('B', { dependsOn: ['A'] });
      return makeTask(id);
    });
    getLatestRunForTaskMock.mockReturnValue(makeRun('A', 'success'));
    const display = getDAGDisplay();
    expect(display).toContain('Task Dependency Graph:');
    expect(display).toContain('B');
    expect(display).toContain('A');
  });

  it('shows independent tasks separately', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B'), makeSummary('C')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'B') return makeTask('B', { dependsOn: ['A'] });
      return makeTask(id);
    });
    getLatestRunForTaskMock.mockReturnValue(makeRun('A', 'success'));
    const display = getDAGDisplay();
    expect(display).toContain('Independent tasks:');
    expect(display).toContain('C');
  });

  it('shows ✓ ready status when deps are met', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'B') return makeTask('B', { dependsOn: ['A'] });
      return makeTask(id);
    });
    getLatestRunForTaskMock.mockReturnValue(makeRun('A', 'success'));
    const display = getDAGDisplay();
    expect(display).toContain('✓ ready');
  });

  it('shows ⏳ waiting status when deps are not met', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'B') return makeTask('B', { dependsOn: ['A'] });
      return makeTask(id);
    });
    getLatestRunForTaskMock.mockReturnValue(null); // A never ran
    const display = getDAGDisplay();
    expect(display).toContain('⏳ waiting');
  });

  it('shows dependency list for each task', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B'), makeSummary('C')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'C') return makeTask('C', { dependsOn: ['A', 'B'] });
      return makeTask(id);
    });
    getLatestRunForTaskMock.mockReturnValue(makeRun('any', 'success'));
    const display = getDAGDisplay();
    expect(display).toContain('[A, B]');
  });

  it('lists multiple independent tasks', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B'), makeSummary('C'), makeSummary('D')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'D') return makeTask('D', { dependsOn: ['A'] });
      return makeTask(id);
    });
    getLatestRunForTaskMock.mockReturnValue(makeRun('A', 'success'));
    const display = getDAGDisplay();
    expect(display).toContain('Independent tasks:');
    expect(display).toContain('B');
    expect(display).toContain('C');
  });

  it('does not show independent tasks section when all have deps', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'A') return makeTask('A', { dependsOn: ['B'] });
      if (id === 'B') return makeTask('B', { dependsOn: ['A'] });
      return makeTask(id);
    });
    getLatestRunForTaskMock.mockReturnValue(null);
    const display = getDAGDisplay();
    expect(display).not.toContain('Independent tasks:');
  });

  it('format includes arrow notation', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'B') return makeTask('B', { dependsOn: ['A'] });
      return makeTask(id);
    });
    getLatestRunForTaskMock.mockReturnValue(makeRun('A', 'success'));
    const display = getDAGDisplay();
    expect(display).toContain('←');
  });

  it('shows multiple dependency tasks in the graph', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B'), makeSummary('C')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'B') return makeTask('B', { dependsOn: ['A'] });
      if (id === 'C') return makeTask('C', { dependsOn: ['A'] });
      return makeTask(id);
    });
    getLatestRunForTaskMock.mockReturnValue(makeRun('A', 'success'));
    const display = getDAGDisplay();
    expect(display).toContain('B ← [A]');
    expect(display).toContain('C ← [A]');
  });

  it('handles all tasks being independent', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B')]);
    getTaskMock.mockImplementation((id: string) => makeTask(id));
    expect(getDAGDisplay()).toBe('No task dependencies configured.');
  });

  it('handles single task with dependency', () => {
    listTasksMock.mockReturnValue([makeSummary('A'), makeSummary('B')]);
    getTaskMock.mockImplementation((id: string) => {
      if (id === 'B') return makeTask('B', { dependsOn: ['A'] });
      return makeTask(id);
    });
    getLatestRunForTaskMock.mockReturnValue(makeRun('A', 'success'));
    const display = getDAGDisplay();
    expect(display).toContain('Task Dependency Graph:');
    expect(display).toContain('Independent tasks: A');
  });
});
