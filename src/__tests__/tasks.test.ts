import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import type { TaskDefinition } from '../types.js';

// Temp dirs scoped per test
let tempDir: string;
let tasksDir: string;
let tasksDir2: string;

// Mock config.js to return our temp dirs
vi.mock('../config.js', () => ({
  loadConfig: () => ({
    secretKey: 'test-secret',
    version: '0.1.0',
    tasksDirs: [tasksDir, tasksDir2],
    logsDir: join(tempDir, 'logs'),
    maxConcurrency: 2,
  }),
  getConfigDir: () => tempDir,
  getSecretKey: () => 'test-secret',
}));

// Mock agents.js to avoid side effects
vi.mock('../agents.js', () => ({
  getDefaultAgent: () => 'claude',
}));

// Import AFTER mocking
const { createTask, getTask, listTasks, taskExists, getTaskFilePath, updateTask, deleteTask } =
  await import('../tasks.js');

/**
 * Helper to build a TaskDefinition with sensible defaults.
 */
function makeTask(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id: 'test-task',
    schedule: '0 9 * * *',
    invocation: 'cli',
    agent: 'claude',
    notifications: { toast: true },
    enabled: true,
    instructions: '# Test\nDo something.',
    ...overrides,
  };
}

/**
 * Write a raw markdown task file directly to a given directory (bypasses createTask).
 */
function writeRawTask(dir: string, id: string, content: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.md`), content, 'utf-8');
}

beforeEach(() => {
  const unique = randomBytes(8).toString('hex');
  tempDir = join(tmpdir(), `cron-agents-test-${unique}`);
  tasksDir = join(tempDir, 'tasks1');
  tasksDir2 = join(tempDir, 'tasks2');
  mkdirSync(tasksDir, { recursive: true });
  mkdirSync(tasksDir2, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------
describe('createTask', () => {
  it('creates a file in the primary tasks dir', () => {
    createTask(makeTask());
    expect(existsSync(join(tasksDir, 'test-task.md'))).toBe(true);
  });

  it('file exists after creation', () => {
    createTask(makeTask({ id: 'exists-check' }));
    expect(existsSync(join(tasksDir, 'exists-check.md'))).toBe(true);
  });

  it('file contains correct YAML frontmatter fields', () => {
    createTask(makeTask({ id: 'yaml-check', schedule: '*/5 * * * *' }));
    const raw = readFileSync(join(tasksDir, 'yaml-check.md'), 'utf-8');
    expect(raw).toContain('id: yaml-check');
    expect(raw).toContain('schedule: "*/5 * * * *"');
    expect(raw).toContain('invocation: cli');
    expect(raw).toContain('agent: claude');
    expect(raw).toContain('enabled: true');
    expect(raw).toContain('toast: true');
  });

  it('file contains instructions content', () => {
    createTask(makeTask({ id: 'instr', instructions: '# Hello\nWorld' }));
    const raw = readFileSync(join(tasksDir, 'instr.md'), 'utf-8');
    expect(raw).toContain('# Hello');
    expect(raw).toContain('World');
  });

  it('throws if task already exists', () => {
    createTask(makeTask({ id: 'dup' }));
    expect(() => createTask(makeTask({ id: 'dup' }))).toThrow(/already exists/);
  });

  it('works with a minimal task definition', () => {
    const task = makeTask({ id: 'minimal', instructions: 'Run it.' });
    createTask(task);
    const retrieved = getTask('minimal');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe('minimal');
  });

  it('handles special characters in instructions (markdown, code blocks)', () => {
    const instructions = '# Special\n```ts\nconst x = 1;\n```\n- item **bold** _italic_';
    createTask(makeTask({ id: 'special-chars', instructions }));
    const raw = readFileSync(join(tasksDir, 'special-chars.md'), 'utf-8');
    expect(raw).toContain('```ts');
    expect(raw).toContain('const x = 1;');
    expect(raw).toContain('**bold**');
  });

  it('creates with agent=copilot', () => {
    createTask(makeTask({ id: 'copilot-task', agent: 'copilot' }));
    const raw = readFileSync(join(tasksDir, 'copilot-task.md'), 'utf-8');
    expect(raw).toContain('agent: copilot');
  });

  it('creates with invocation=api', () => {
    createTask(makeTask({ id: 'api-task', invocation: 'api' }));
    const raw = readFileSync(join(tasksDir, 'api-task.md'), 'utf-8');
    expect(raw).toContain('invocation: api');
  });

  it('creates with enabled=false', () => {
    createTask(makeTask({ id: 'disabled', enabled: false }));
    const raw = readFileSync(join(tasksDir, 'disabled.md'), 'utf-8');
    expect(raw).toContain('enabled: false');
  });

  it('creates with toast=false', () => {
    createTask(makeTask({ id: 'no-toast', notifications: { toast: false } }));
    const raw = readFileSync(join(tasksDir, 'no-toast.md'), 'utf-8');
    expect(raw).toContain('toast: false');
  });

  it('file is valid parseable markdown with gray-matter', async () => {
    createTask(makeTask({ id: 'parseable' }));
    const matter = (await import('gray-matter')).default;
    const raw = readFileSync(join(tasksDir, 'parseable.md'), 'utf-8');
    const parsed = matter(raw);
    expect(parsed.data.id).toBe('parseable');
    expect(parsed.data.schedule).toBe('0 9 * * *');
    expect(parsed.content).toContain('# Test');
  });
});

// ---------------------------------------------------------------------------
// getTask
// ---------------------------------------------------------------------------
describe('getTask', () => {
  it('returns a task from the primary dir', () => {
    createTask(makeTask({ id: 'primary' }));
    const task = getTask('primary');
    expect(task).not.toBeNull();
    expect(task!.id).toBe('primary');
  });

  it('returns a task from the secondary dir', () => {
    writeRawTask(
      tasksDir2,
      'secondary',
      '---\nid: secondary\nschedule: "0 8 * * *"\ninvocation: cli\nagent: claude\nenabled: true\nnotifications:\n  toast: false\n---\n\n# Secondary task\n',
    );
    const task = getTask('secondary');
    expect(task).not.toBeNull();
    expect(task!.id).toBe('secondary');
  });

  it('returns null for a non-existent task', () => {
    expect(getTask('nope')).toBeNull();
  });

  it('returns correct id, schedule, invocation, agent, enabled', () => {
    createTask(
      makeTask({
        id: 'fields',
        schedule: '30 14 * * 1',
        invocation: 'api',
        agent: 'copilot',
        enabled: false,
      }),
    );
    const task = getTask('fields')!;
    expect(task.id).toBe('fields');
    expect(task.schedule).toBe('30 14 * * 1');
    expect(task.invocation).toBe('api');
    expect(task.agent).toBe('copilot');
    expect(task.enabled).toBe(false);
  });

  it('returns instructions content (trimmed markdown)', () => {
    createTask(makeTask({ id: 'instr-get', instructions: '# Heading\nBody text' }));
    const task = getTask('instr-get')!;
    expect(task.instructions).toContain('# Heading');
    expect(task.instructions).toContain('Body text');
  });

  it('defaults agent to claude if missing from file', () => {
    writeRawTask(
      tasksDir,
      'no-agent',
      '---\nid: no-agent\nschedule: "0 0 * * *"\n---\n\nInstructions\n',
    );
    const task = getTask('no-agent')!;
    expect(task.agent).toBe('claude');
  });

  it('defaults invocation to cli if missing', () => {
    writeRawTask(
      tasksDir,
      'no-invoc',
      '---\nid: no-invoc\nschedule: "0 0 * * *"\n---\n\nInstructions\n',
    );
    const task = getTask('no-invoc')!;
    expect(task.invocation).toBe('cli');
  });

  it('defaults enabled to true if missing', () => {
    writeRawTask(
      tasksDir,
      'no-enabled',
      '---\nid: no-enabled\nschedule: "0 0 * * *"\n---\n\nInstructions\n',
    );
    const task = getTask('no-enabled')!;
    expect(task.enabled).toBe(true);
  });

  it('prefers the first dir when task exists in both dirs', () => {
    writeRawTask(
      tasksDir,
      'both',
      '---\nid: both\nschedule: "1 1 * * *"\ninvocation: cli\nagent: claude\nenabled: true\nnotifications:\n  toast: true\n---\n\nPrimary instructions\n',
    );
    writeRawTask(
      tasksDir2,
      'both',
      '---\nid: both\nschedule: "2 2 * * *"\ninvocation: api\nagent: copilot\nenabled: false\nnotifications:\n  toast: false\n---\n\nSecondary instructions\n',
    );
    const task = getTask('both')!;
    // Should get the primary dir version
    expect(task.schedule).toBe('1 1 * * *');
    expect(task.instructions).toContain('Primary instructions');
  });

  it('returns notifications object', () => {
    createTask(makeTask({ id: 'notif', notifications: { toast: true } }));
    const task = getTask('notif')!;
    expect(task.notifications).toEqual({ toast: true });
  });
});

// ---------------------------------------------------------------------------
// listTasks
// ---------------------------------------------------------------------------
describe('listTasks', () => {
  it('returns empty array when no tasks exist', () => {
    expect(listTasks()).toEqual([]);
  });

  it('returns all tasks from the primary dir', () => {
    createTask(makeTask({ id: 'a' }));
    createTask(makeTask({ id: 'b' }));
    const tasks = listTasks();
    const ids = tasks.map((t) => t.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
  });

  it('returns tasks from the secondary dir too', () => {
    writeRawTask(
      tasksDir2,
      'sec-only',
      '---\nid: sec-only\nschedule: "0 0 * * *"\ninvocation: cli\nagent: claude\nenabled: true\nnotifications:\n  toast: false\n---\n\nHello\n',
    );
    const ids = listTasks().map((t) => t.id);
    expect(ids).toContain('sec-only');
  });

  it('deduplicates by id (same task in both dirs → only one entry)', () => {
    writeRawTask(
      tasksDir,
      'dup-list',
      '---\nid: dup-list\nschedule: "0 0 * * *"\ninvocation: cli\nagent: claude\nenabled: true\nnotifications:\n  toast: false\n---\n\nA\n',
    );
    writeRawTask(
      tasksDir2,
      'dup-list',
      '---\nid: dup-list\nschedule: "0 0 * * *"\ninvocation: cli\nagent: claude\nenabled: true\nnotifications:\n  toast: false\n---\n\nB\n',
    );
    const matches = listTasks().filter((t) => t.id === 'dup-list');
    expect(matches).toHaveLength(1);
  });

  it('each entry has id, schedule, invocation, agent, enabled', () => {
    createTask(makeTask({ id: 'meta-check' }));
    const entry = listTasks().find((t) => t.id === 'meta-check')!;
    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('schedule');
    expect(entry).toHaveProperty('invocation');
    expect(entry).toHaveProperty('agent');
    expect(entry).toHaveProperty('enabled');
  });

  it('handles empty directories gracefully', () => {
    // Both dirs exist but are empty
    expect(() => listTasks()).not.toThrow();
    expect(listTasks()).toEqual([]);
  });

  it('handles non-existent directories gracefully', () => {
    rmSync(tasksDir2, { recursive: true, force: true });
    createTask(makeTask({ id: 'only-primary' }));
    const tasks = listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('only-primary');
  });

  it('returns correct count after creating multiple tasks', () => {
    createTask(makeTask({ id: 'one' }));
    createTask(makeTask({ id: 'two' }));
    createTask(makeTask({ id: 'three' }));
    expect(listTasks()).toHaveLength(3);
  });

  it('returns correct data for each task', () => {
    createTask(makeTask({ id: 'data-a', schedule: '0 1 * * *', agent: 'copilot', enabled: false }));
    createTask(makeTask({ id: 'data-b', schedule: '0 2 * * *', invocation: 'api', enabled: true }));
    const tasks = listTasks();
    const a = tasks.find((t) => t.id === 'data-a')!;
    const b = tasks.find((t) => t.id === 'data-b')!;
    expect(a.schedule).toBe('0 1 * * *');
    expect(a.agent).toBe('copilot');
    expect(a.enabled).toBe(false);
    expect(b.schedule).toBe('0 2 * * *');
    expect(b.invocation).toBe('api');
    expect(b.enabled).toBe(true);
  });

  it('includes tasks from both dirs in total count', () => {
    createTask(makeTask({ id: 'p1' }));
    writeRawTask(
      tasksDir2,
      's1',
      '---\nid: s1\nschedule: "0 0 * * *"\ninvocation: cli\nagent: claude\nenabled: true\nnotifications:\n  toast: false\n---\n\nHi\n',
    );
    expect(listTasks()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// taskExists
// ---------------------------------------------------------------------------
describe('taskExists', () => {
  it('returns true for existing task in primary dir', () => {
    createTask(makeTask({ id: 'exist-primary' }));
    expect(taskExists('exist-primary')).toBe(true);
  });

  it('returns true for existing task in secondary dir', () => {
    writeRawTask(
      tasksDir2,
      'exist-sec',
      '---\nid: exist-sec\nschedule: "0 0 * * *"\n---\n\nHi\n',
    );
    expect(taskExists('exist-sec')).toBe(true);
  });

  it('returns false for non-existent task', () => {
    expect(taskExists('ghost')).toBe(false);
  });

  it('returns true immediately after createTask', () => {
    createTask(makeTask({ id: 'just-created' }));
    expect(taskExists('just-created')).toBe(true);
  });

  it('returns false after deleteTask', () => {
    createTask(makeTask({ id: 'will-delete' }));
    deleteTask('will-delete');
    expect(taskExists('will-delete')).toBe(false);
  });

  it('returns true when task exists in both dirs', () => {
    writeRawTask(tasksDir, 'both-exist', '---\nid: both-exist\nschedule: "0 0 * * *"\n---\n\nA\n');
    writeRawTask(tasksDir2, 'both-exist', '---\nid: both-exist\nschedule: "0 0 * * *"\n---\n\nB\n');
    expect(taskExists('both-exist')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getTaskFilePath
// ---------------------------------------------------------------------------
describe('getTaskFilePath', () => {
  it('returns path in primary dir when task exists there', () => {
    createTask(makeTask({ id: 'path-primary' }));
    const p = getTaskFilePath('path-primary');
    expect(p).toBe(join(tasksDir, 'path-primary.md'));
  });

  it('returns path in secondary dir when task exists only there', () => {
    writeRawTask(
      tasksDir2,
      'path-sec',
      '---\nid: path-sec\nschedule: "0 0 * * *"\n---\n\nHi\n',
    );
    const p = getTaskFilePath('path-sec');
    expect(p).toBe(join(tasksDir2, 'path-sec.md'));
  });

  it('returns primary dir path when task does not exist anywhere', () => {
    const p = getTaskFilePath('nonexistent');
    expect(p).toBe(join(tasksDir, 'nonexistent.md'));
  });

  it('path ends with .md', () => {
    const p = getTaskFilePath('anything');
    expect(p).toMatch(/\.md$/);
  });

  it('path contains task id', () => {
    const p = getTaskFilePath('my-unique-id');
    expect(p).toContain('my-unique-id');
  });

  it('prefers primary dir when task exists in both dirs', () => {
    writeRawTask(tasksDir, 'in-both', '---\nid: in-both\nschedule: "0 0 * * *"\n---\n\nA\n');
    writeRawTask(tasksDir2, 'in-both', '---\nid: in-both\nschedule: "0 0 * * *"\n---\n\nB\n');
    const p = getTaskFilePath('in-both');
    expect(p).toBe(join(tasksDir, 'in-both.md'));
  });
});

// ---------------------------------------------------------------------------
// updateTask
// ---------------------------------------------------------------------------
describe('updateTask', () => {
  it('updates a task in the primary dir', () => {
    createTask(makeTask({ id: 'update-me' }));
    updateTask('update-me', makeTask({ id: 'update-me', schedule: '0 18 * * *' }));
    const task = getTask('update-me')!;
    expect(task.schedule).toBe('0 18 * * *');
  });

  it('updated fields persist (re-read shows new values)', () => {
    createTask(makeTask({ id: 'persist' }));
    updateTask(
      'persist',
      makeTask({ id: 'persist', agent: 'copilot', invocation: 'api', enabled: false }),
    );
    const task = getTask('persist')!;
    expect(task.agent).toBe('copilot');
    expect(task.invocation).toBe('api');
    expect(task.enabled).toBe(false);
  });

  it('throws for a non-existent task', () => {
    expect(() => updateTask('no-such', makeTask({ id: 'no-such' }))).toThrow(/not found/);
  });

  it('can change schedule', () => {
    createTask(makeTask({ id: 'sched-change' }));
    updateTask('sched-change', makeTask({ id: 'sched-change', schedule: '*/10 * * * *' }));
    expect(getTask('sched-change')!.schedule).toBe('*/10 * * * *');
  });

  it('can change instructions', () => {
    createTask(makeTask({ id: 'instr-change' }));
    updateTask(
      'instr-change',
      makeTask({ id: 'instr-change', instructions: '# New\nUpdated body' }),
    );
    const task = getTask('instr-change')!;
    expect(task.instructions).toContain('# New');
    expect(task.instructions).toContain('Updated body');
  });

  it('can change enabled flag', () => {
    createTask(makeTask({ id: 'toggle' }));
    expect(getTask('toggle')!.enabled).toBe(true);
    updateTask('toggle', makeTask({ id: 'toggle', enabled: false }));
    expect(getTask('toggle')!.enabled).toBe(false);
  });

  it('updates task in secondary dir when it lives there', () => {
    writeRawTask(
      tasksDir2,
      'sec-update',
      '---\nid: sec-update\nschedule: "0 0 * * *"\ninvocation: cli\nagent: claude\nenabled: true\nnotifications:\n  toast: false\n---\n\nOld\n',
    );
    updateTask('sec-update', makeTask({ id: 'sec-update', schedule: '30 6 * * *' }));
    const task = getTask('sec-update')!;
    expect(task.schedule).toBe('30 6 * * *');
    // Verify it was written in secondary dir
    expect(existsSync(join(tasksDir2, 'sec-update.md'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deleteTask
// ---------------------------------------------------------------------------
describe('deleteTask', () => {
  it('deletes the task file', () => {
    createTask(makeTask({ id: 'del-file' }));
    deleteTask('del-file');
    expect(existsSync(join(tasksDir, 'del-file.md'))).toBe(false);
  });

  it('file no longer exists after delete', () => {
    createTask(makeTask({ id: 'gone' }));
    expect(existsSync(join(tasksDir, 'gone.md'))).toBe(true);
    deleteTask('gone');
    expect(existsSync(join(tasksDir, 'gone.md'))).toBe(false);
  });

  it('taskExists returns false after delete', () => {
    createTask(makeTask({ id: 'del-exists' }));
    deleteTask('del-exists');
    expect(taskExists('del-exists')).toBe(false);
  });

  it('throws for non-existent task', () => {
    expect(() => deleteTask('phantom')).toThrow(/not found/);
  });

  it('getTask returns null after delete', () => {
    createTask(makeTask({ id: 'del-get' }));
    deleteTask('del-get');
    expect(getTask('del-get')).toBeNull();
  });
});
