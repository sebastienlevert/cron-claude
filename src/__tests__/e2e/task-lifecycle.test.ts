/**
 * E2E tests for the full task lifecycle: create → get → list → update → delete
 * Uses real file I/O in temp directories with mocked config.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import type { TaskDefinition } from '../../types.js';
import {
  createTestDirs,
  cleanupTestDirs,
  writeTestConfig,
  writeTaskFile,
  type TestDirs,
} from './helpers.js';

// ─── Mock config.js so tasks.ts reads from our temp dirs ────────────────────

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

// Mock agents.js to avoid side effects
vi.mock('../../agents.js', () => ({
  getDefaultAgent: () => 'claude',
}));

// Import AFTER mocking
const { _setTestConfig } = await import('../../config.js') as any;
const { createTask, getTask, listTasks, taskExists, getTaskFilePath, updateTask, deleteTask } =
  await import('../../tasks.js');

// ─── Helpers ────────────────────────────────────────────────────────────────

let dirs: TestDirs;

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
 * Write a raw markdown task file directly into a directory (bypasses createTask).
 */
function writeRawTask(dir: string, id: string, content: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.md`), content, 'utf-8');
}

function rawTaskContent(overrides: Record<string, string> = {}): string {
  const defaults: Record<string, string> = {
    id: 'raw-task',
    schedule: '"0 0 * * *"',
    invocation: 'cli',
    agent: 'claude',
    enabled: 'true',
    toast: 'false',
    instructions: '# Raw\nInstructions here.\n',
  };
  const o = { ...defaults, ...overrides };
  return `---
id: ${o.id}
schedule: ${o.schedule}
invocation: ${o.invocation}
agent: ${o.agent}
notifications:
  toast: ${o.toast}
enabled: ${o.enabled}
---

${o.instructions}
`;
}

// ─── Setup / Teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  dirs = createTestDirs();
  const config = writeTestConfig(dirs);
  _setTestConfig(config, dirs.configDir);
});

afterEach(() => {
  cleanupTestDirs(dirs);
});

// ===========================================================================
// CREATE TASK
// ===========================================================================
describe('createTask', () => {
  it('creates a file in the primary tasks dir', () => {
    createTask(makeTask());
    expect(existsSync(join(dirs.tasksDir, 'test-task.md'))).toBe(true);
  });

  it('creates a file with correct YAML frontmatter', () => {
    createTask(makeTask({ id: 'yaml-check', schedule: '*/5 * * * *' }));
    const raw = readFileSync(join(dirs.tasksDir, 'yaml-check.md'), 'utf-8');
    expect(raw).toContain('id: yaml-check');
    expect(raw).toContain('schedule: "*/5 * * * *"');
    expect(raw).toContain('invocation: cli');
    expect(raw).toContain('agent: claude');
    expect(raw).toContain('enabled: true');
    expect(raw).toContain('toast: true');
  });

  it('creates with copilot agent and api invocation', () => {
    createTask(makeTask({ id: 'copilot-api', agent: 'copilot', invocation: 'api' }));
    const raw = readFileSync(join(dirs.tasksDir, 'copilot-api.md'), 'utf-8');
    expect(raw).toContain('agent: copilot');
    expect(raw).toContain('invocation: api');
  });

  it('creates with toast disabled', () => {
    createTask(makeTask({ id: 'no-toast', notifications: { toast: false } }));
    const raw = readFileSync(join(dirs.tasksDir, 'no-toast.md'), 'utf-8');
    expect(raw).toContain('toast: false');
  });

  it('creates with custom schedule', () => {
    createTask(makeTask({ id: 'custom-sched', schedule: '30 14 1 * 5' }));
    const raw = readFileSync(join(dirs.tasksDir, 'custom-sched.md'), 'utf-8');
    expect(raw).toContain('schedule: "30 14 1 * 5"');
  });

  it('round-trips: create then read back all fields match', () => {
    const task = makeTask({
      id: 'roundtrip',
      schedule: '15 3 * * 0',
      invocation: 'api',
      agent: 'copilot',
      notifications: { toast: false },
      enabled: false,
      instructions: '# Round Trip\nBody text here.',
    });
    createTask(task);
    const retrieved = getTask('roundtrip')!;
    expect(retrieved.id).toBe('roundtrip');
    expect(retrieved.schedule).toBe('15 3 * * 0');
    expect(retrieved.invocation).toBe('api');
    expect(retrieved.agent).toBe('copilot');
    expect(retrieved.notifications.toast).toBe(false);
    expect(retrieved.enabled).toBe(false);
    expect(retrieved.instructions).toContain('# Round Trip');
    expect(retrieved.instructions).toContain('Body text here.');
  });

  it('throws when creating a duplicate task', () => {
    createTask(makeTask({ id: 'dup' }));
    expect(() => createTask(makeTask({ id: 'dup' }))).toThrow(/already exists/);
  });

  it('handles special characters in instructions (code blocks, markdown)', () => {
    const instructions =
      '# Special\n```ts\nconst x: Record<string, number> = {};\n```\n- **bold** _italic_ ~~strike~~\n> blockquote';
    createTask(makeTask({ id: 'special-md', instructions }));
    const raw = readFileSync(join(dirs.tasksDir, 'special-md.md'), 'utf-8');
    expect(raw).toContain('```ts');
    expect(raw).toContain('Record<string, number>');
    expect(raw).toContain('**bold**');
    expect(raw).toContain('> blockquote');
  });

  it('handles empty instructions', () => {
    createTask(makeTask({ id: 'empty-instr', instructions: '' }));
    const retrieved = getTask('empty-instr')!;
    expect(retrieved).not.toBeNull();
    expect(retrieved.instructions.trim()).toBe('');
  });

  it('created file is valid gray-matter parseable markdown', () => {
    createTask(makeTask({ id: 'parseable' }));
    const raw = readFileSync(join(dirs.tasksDir, 'parseable.md'), 'utf-8');
    const parsed = matter(raw);
    expect(parsed.data.id).toBe('parseable');
    expect(parsed.data.schedule).toBe('0 9 * * *');
    expect(parsed.data.invocation).toBe('cli');
    expect(parsed.data.agent).toBe('claude');
    expect(parsed.data.enabled).toBe(true);
    expect(parsed.data.notifications).toEqual({ toast: true });
    expect(parsed.content).toContain('# Test');
  });

  it('creates with enabled=false', () => {
    createTask(makeTask({ id: 'disabled', enabled: false }));
    const raw = readFileSync(join(dirs.tasksDir, 'disabled.md'), 'utf-8');
    expect(raw).toContain('enabled: false');
  });
});

// ===========================================================================
// GET TASK
// ===========================================================================
describe('getTask', () => {
  it('returns a full TaskDefinition for an existing task', () => {
    createTask(makeTask({ id: 'get-exists' }));
    const task = getTask('get-exists');
    expect(task).not.toBeNull();
    expect(task!.id).toBe('get-exists');
  });

  it('returns null for a nonexistent task', () => {
    expect(getTask('ghost')).toBeNull();
  });

  it('preserves instructions exactly', () => {
    const instructions = '# My Heading\n\nParagraph with **bold** and `code`.';
    createTask(makeTask({ id: 'instr-exact', instructions }));
    const task = getTask('instr-exact')!;
    expect(task.instructions).toContain('# My Heading');
    expect(task.instructions).toContain('**bold**');
    expect(task.instructions).toContain('`code`');
  });

  it('returns correct schedule, agent, invocation', () => {
    createTask(makeTask({
      id: 'fields',
      schedule: '30 14 * * 1',
      agent: 'copilot',
      invocation: 'api',
    }));
    const task = getTask('fields')!;
    expect(task.schedule).toBe('30 14 * * 1');
    expect(task.agent).toBe('copilot');
    expect(task.invocation).toBe('api');
  });

  it('returns notifications parsed correctly', () => {
    createTask(makeTask({ id: 'notif-check', notifications: { toast: true } }));
    const task = getTask('notif-check')!;
    expect(task.notifications).toEqual({ toast: true });
  });

  it('returns enabled=false when set', () => {
    createTask(makeTask({ id: 'disabled-get', enabled: false }));
    const task = getTask('disabled-get')!;
    expect(task.enabled).toBe(false);
  });

  it('returns enabled=true when set', () => {
    createTask(makeTask({ id: 'enabled-get', enabled: true }));
    const task = getTask('enabled-get')!;
    expect(task.enabled).toBe(true);
  });

  it('finds task from secondary directory', () => {
    // Create a second tasks dir and update config
    const secondDir = join(dirs.root, 'secondary-tasks');
    mkdirSync(secondDir, { recursive: true });
    const config = writeTestConfig(dirs, { tasksDirs: [dirs.tasksDir, secondDir] });
    _setTestConfig(config, dirs.configDir);

    writeRawTask(secondDir, 'sec-task', rawTaskContent({ id: 'sec-task' }));
    const task = getTask('sec-task');
    expect(task).not.toBeNull();
    expect(task!.id).toBe('sec-task');
  });

  it('prefers first directory when duplicate IDs exist', () => {
    const secondDir = join(dirs.root, 'secondary-tasks');
    mkdirSync(secondDir, { recursive: true });
    const config = writeTestConfig(dirs, { tasksDirs: [dirs.tasksDir, secondDir] });
    _setTestConfig(config, dirs.configDir);

    writeRawTask(dirs.tasksDir, 'dup-id', rawTaskContent({
      id: 'dup-id',
      schedule: '"0 1 * * *"',
      instructions: 'Primary version',
    }));
    writeRawTask(secondDir, 'dup-id', rawTaskContent({
      id: 'dup-id',
      schedule: '"0 2 * * *"',
      instructions: 'Secondary version',
    }));
    const task = getTask('dup-id')!;
    expect(task.schedule).toBe('0 1 * * *');
    expect(task.instructions).toContain('Primary version');
  });

  it('defaults missing fields to sensible values', () => {
    writeRawTask(
      dirs.tasksDir,
      'sparse',
      '---\nid: sparse\nschedule: "0 0 * * *"\n---\n\nJust instructions.\n',
    );
    const task = getTask('sparse')!;
    expect(task.agent).toBe('claude');
    expect(task.invocation).toBe('cli');
    expect(task.enabled).toBe(true);
  });
});

// ===========================================================================
// LIST TASKS
// ===========================================================================
describe('listTasks', () => {
  it('returns empty array when no tasks exist', () => {
    expect(listTasks()).toEqual([]);
  });

  it('returns one TaskMetadata for a single task', () => {
    createTask(makeTask({ id: 'solo' }));
    const tasks = listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('solo');
  });

  it('returns all tasks when multiple exist', () => {
    createTask(makeTask({ id: 'a' }));
    createTask(makeTask({ id: 'b' }));
    createTask(makeTask({ id: 'c' }));
    const ids = listTasks().map((t) => t.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).toContain('c');
    expect(ids).toHaveLength(3);
  });

  it('includes correct metadata fields', () => {
    createTask(makeTask({
      id: 'meta-fields',
      schedule: '0 12 * * *',
      invocation: 'api',
      agent: 'copilot',
      enabled: false,
    }));
    const entry = listTasks().find((t) => t.id === 'meta-fields')!;
    expect(entry.id).toBe('meta-fields');
    expect(entry.schedule).toBe('0 12 * * *');
    expect(entry.invocation).toBe('api');
    expect(entry.agent).toBe('copilot');
    expect(entry.enabled).toBe(false);
  });

  it('finds tasks from multiple directories', () => {
    const secondDir = join(dirs.root, 'second-tasks');
    mkdirSync(secondDir, { recursive: true });
    const config = writeTestConfig(dirs, { tasksDirs: [dirs.tasksDir, secondDir] });
    _setTestConfig(config, dirs.configDir);

    createTask(makeTask({ id: 'primary-task' }));
    writeRawTask(secondDir, 'secondary-task', rawTaskContent({ id: 'secondary-task' }));

    const ids = listTasks().map((t) => t.id);
    expect(ids).toContain('primary-task');
    expect(ids).toContain('secondary-task');
  });

  it('deduplicates tasks with same ID across directories (first dir wins)', () => {
    const secondDir = join(dirs.root, 'dup-tasks');
    mkdirSync(secondDir, { recursive: true });
    const config = writeTestConfig(dirs, { tasksDirs: [dirs.tasksDir, secondDir] });
    _setTestConfig(config, dirs.configDir);

    writeRawTask(dirs.tasksDir, 'dup', rawTaskContent({
      id: 'dup',
      schedule: '"0 1 * * *"',
    }));
    writeRawTask(secondDir, 'dup', rawTaskContent({
      id: 'dup',
      schedule: '"0 2 * * *"',
    }));

    const matches = listTasks().filter((t) => t.id === 'dup');
    expect(matches).toHaveLength(1);
    expect(matches[0].schedule).toBe('0 1 * * *');
  });

  it('skips non-.md files', () => {
    createTask(makeTask({ id: 'real-task' }));
    writeFileSync(join(dirs.tasksDir, 'notes.txt'), 'not a task', 'utf-8');
    writeFileSync(join(dirs.tasksDir, 'data.json'), '{}', 'utf-8');

    const tasks = listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('real-task');
  });

  it('handles corrupt/invalid markdown gracefully (does not crash)', () => {
    createTask(makeTask({ id: 'valid-one' }));
    writeFileSync(join(dirs.tasksDir, 'corrupt.md'), 'NOT VALID YAML FRONT MATTER {{{{', 'utf-8');

    expect(() => listTasks()).not.toThrow();
    const tasks = listTasks();
    // Should still have the valid task at minimum
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks.some((t) => t.id === 'valid-one')).toBe(true);
  });

  it('handles 20+ tasks', () => {
    for (let i = 0; i < 25; i++) {
      createTask(makeTask({ id: `bulk-${String(i).padStart(2, '0')}` }));
    }
    const tasks = listTasks();
    expect(tasks).toHaveLength(25);
  });

  it('shows disabled tasks', () => {
    createTask(makeTask({ id: 'active', enabled: true }));
    createTask(makeTask({ id: 'inactive', enabled: false }));
    const tasks = listTasks();
    expect(tasks).toHaveLength(2);
    const inactive = tasks.find((t) => t.id === 'inactive')!;
    expect(inactive.enabled).toBe(false);
  });

  it('shows both cli and api tasks', () => {
    createTask(makeTask({ id: 'cli-task', invocation: 'cli' }));
    createTask(makeTask({ id: 'api-task', invocation: 'api' }));
    const tasks = listTasks();
    expect(tasks.find((t) => t.id === 'cli-task')!.invocation).toBe('cli');
    expect(tasks.find((t) => t.id === 'api-task')!.invocation).toBe('api');
  });

  it('shows both claude and copilot tasks', () => {
    createTask(makeTask({ id: 'claude-task', agent: 'claude' }));
    createTask(makeTask({ id: 'copilot-task', agent: 'copilot' }));
    const tasks = listTasks();
    expect(tasks.find((t) => t.id === 'claude-task')!.agent).toBe('claude');
    expect(tasks.find((t) => t.id === 'copilot-task')!.agent).toBe('copilot');
  });
});

// ===========================================================================
// TASK EXISTS
// ===========================================================================
describe('taskExists', () => {
  it('returns true for an existing task', () => {
    createTask(makeTask({ id: 'exists-yes' }));
    expect(taskExists('exists-yes')).toBe(true);
  });

  it('returns false for a nonexistent task', () => {
    expect(taskExists('nope')).toBe(false);
  });

  it('checks all directories', () => {
    const secondDir = join(dirs.root, 'exists-secondary');
    mkdirSync(secondDir, { recursive: true });
    const config = writeTestConfig(dirs, { tasksDirs: [dirs.tasksDir, secondDir] });
    _setTestConfig(config, dirs.configDir);

    writeRawTask(secondDir, 'only-in-second', rawTaskContent({ id: 'only-in-second' }));
    expect(taskExists('only-in-second')).toBe(true);
  });

  it('returns true even for disabled tasks', () => {
    createTask(makeTask({ id: 'disabled-exists', enabled: false }));
    expect(taskExists('disabled-exists')).toBe(true);
  });

  it('returns false after task is deleted', () => {
    createTask(makeTask({ id: 'del-check' }));
    deleteTask('del-check');
    expect(taskExists('del-check')).toBe(false);
  });
});

// ===========================================================================
// GET TASK FILE PATH
// ===========================================================================
describe('getTaskFilePath', () => {
  it('returns actual path for an existing task', () => {
    createTask(makeTask({ id: 'path-existing' }));
    const p = getTaskFilePath('path-existing');
    expect(p).toBe(join(dirs.tasksDir, 'path-existing.md'));
    expect(existsSync(p)).toBe(true);
  });

  it('returns path in primary dir for a nonexistent task', () => {
    const p = getTaskFilePath('no-such-task');
    expect(p).toBe(join(dirs.tasksDir, 'no-such-task.md'));
  });

  it('finds task in secondary directory', () => {
    const secondDir = join(dirs.root, 'path-secondary');
    mkdirSync(secondDir, { recursive: true });
    const config = writeTestConfig(dirs, { tasksDirs: [dirs.tasksDir, secondDir] });
    _setTestConfig(config, dirs.configDir);

    writeRawTask(secondDir, 'sec-path', rawTaskContent({ id: 'sec-path' }));
    const p = getTaskFilePath('sec-path');
    expect(p).toBe(join(secondDir, 'sec-path.md'));
  });

  it('prefers first directory when duplicates exist', () => {
    const secondDir = join(dirs.root, 'path-dup');
    mkdirSync(secondDir, { recursive: true });
    const config = writeTestConfig(dirs, { tasksDirs: [dirs.tasksDir, secondDir] });
    _setTestConfig(config, dirs.configDir);

    writeRawTask(dirs.tasksDir, 'dup-path', rawTaskContent({ id: 'dup-path' }));
    writeRawTask(secondDir, 'dup-path', rawTaskContent({ id: 'dup-path' }));

    const p = getTaskFilePath('dup-path');
    expect(p).toBe(join(dirs.tasksDir, 'dup-path.md'));
  });

  it('path always ends with .md extension', () => {
    expect(getTaskFilePath('anything')).toMatch(/\.md$/);
  });
});

// ===========================================================================
// UPDATE TASK
// ===========================================================================
describe('updateTask', () => {
  it('updates schedule and persists', () => {
    createTask(makeTask({ id: 'upd-sched' }));
    updateTask('upd-sched', makeTask({ id: 'upd-sched', schedule: '0 18 * * *' }));
    const task = getTask('upd-sched')!;
    expect(task.schedule).toBe('0 18 * * *');
  });

  it('updates agent and persists', () => {
    createTask(makeTask({ id: 'upd-agent' }));
    updateTask('upd-agent', makeTask({ id: 'upd-agent', agent: 'copilot' }));
    expect(getTask('upd-agent')!.agent).toBe('copilot');
  });

  it('updates enabled flag and persists', () => {
    createTask(makeTask({ id: 'upd-enabled', enabled: true }));
    updateTask('upd-enabled', makeTask({ id: 'upd-enabled', enabled: false }));
    expect(getTask('upd-enabled')!.enabled).toBe(false);
  });

  it('updates instructions and preserves them', () => {
    createTask(makeTask({ id: 'upd-instr' }));
    updateTask(
      'upd-instr',
      makeTask({ id: 'upd-instr', instructions: '# Updated\nNew instructions here.' }),
    );
    const task = getTask('upd-instr')!;
    expect(task.instructions).toContain('# Updated');
    expect(task.instructions).toContain('New instructions here.');
  });

  it('throws for a nonexistent task', () => {
    expect(() => updateTask('no-such', makeTask({ id: 'no-such' }))).toThrow(/not found/);
  });

  it('updates task in secondary directory in place (not primary)', () => {
    const secondDir = join(dirs.root, 'upd-secondary');
    mkdirSync(secondDir, { recursive: true });
    const config = writeTestConfig(dirs, { tasksDirs: [dirs.tasksDir, secondDir] });
    _setTestConfig(config, dirs.configDir);

    writeRawTask(secondDir, 'sec-upd', rawTaskContent({ id: 'sec-upd' }));
    updateTask('sec-upd', makeTask({ id: 'sec-upd', schedule: '30 6 * * *' }));

    // Should still live in secondDir, not primary
    expect(existsSync(join(secondDir, 'sec-upd.md'))).toBe(true);
    const task = getTask('sec-upd')!;
    expect(task.schedule).toBe('30 6 * * *');
  });
});

// ===========================================================================
// DELETE TASK
// ===========================================================================
describe('deleteTask', () => {
  it('removes the task file from disk', () => {
    createTask(makeTask({ id: 'del-file' }));
    const filePath = join(dirs.tasksDir, 'del-file.md');
    expect(existsSync(filePath)).toBe(true);
    deleteTask('del-file');
    expect(existsSync(filePath)).toBe(false);
  });

  it('causes taskExists to return false', () => {
    createTask(makeTask({ id: 'del-exists' }));
    deleteTask('del-exists');
    expect(taskExists('del-exists')).toBe(false);
  });

  it('throws for a nonexistent task', () => {
    expect(() => deleteTask('phantom')).toThrow(/not found/);
  });

  it('deletes from secondary directory', () => {
    const secondDir = join(dirs.root, 'del-secondary');
    mkdirSync(secondDir, { recursive: true });
    const config = writeTestConfig(dirs, { tasksDirs: [dirs.tasksDir, secondDir] });
    _setTestConfig(config, dirs.configDir);

    writeRawTask(secondDir, 'sec-del', rawTaskContent({ id: 'sec-del' }));
    expect(taskExists('sec-del')).toBe(true);
    deleteTask('sec-del');
    expect(existsSync(join(secondDir, 'sec-del.md'))).toBe(false);
    expect(taskExists('sec-del')).toBe(false);
  });

  it('does not affect other tasks', () => {
    createTask(makeTask({ id: 'keep-me' }));
    createTask(makeTask({ id: 'remove-me' }));
    deleteTask('remove-me');
    expect(taskExists('keep-me')).toBe(true);
    expect(getTask('keep-me')).not.toBeNull();
    expect(taskExists('remove-me')).toBe(false);
  });
});

// ===========================================================================
// MULTI-DIRECTORY
// ===========================================================================
describe('multi-directory support', () => {
  it('configures 3 directories and finds tasks in all', () => {
    const dir2 = join(dirs.root, 'multi-dir2');
    const dir3 = join(dirs.root, 'multi-dir3');
    mkdirSync(dir2, { recursive: true });
    mkdirSync(dir3, { recursive: true });
    const config = writeTestConfig(dirs, { tasksDirs: [dirs.tasksDir, dir2, dir3] });
    _setTestConfig(config, dirs.configDir);

    writeRawTask(dirs.tasksDir, 'task-in-1', rawTaskContent({ id: 'task-in-1' }));
    writeRawTask(dir2, 'task-in-2', rawTaskContent({ id: 'task-in-2' }));
    writeRawTask(dir3, 'task-in-3', rawTaskContent({ id: 'task-in-3' }));

    const ids = listTasks().map((t) => t.id);
    expect(ids).toContain('task-in-1');
    expect(ids).toContain('task-in-2');
    expect(ids).toContain('task-in-3');
    expect(ids).toHaveLength(3);
  });

  it('uses primary directory for new task creation', () => {
    const dir2 = join(dirs.root, 'multi-create-2');
    mkdirSync(dir2, { recursive: true });
    const config = writeTestConfig(dirs, { tasksDirs: [dirs.tasksDir, dir2] });
    _setTestConfig(config, dirs.configDir);

    createTask(makeTask({ id: 'new-in-primary' }));
    expect(existsSync(join(dirs.tasksDir, 'new-in-primary.md'))).toBe(true);
    expect(existsSync(join(dir2, 'new-in-primary.md'))).toBe(false);
  });

  it('tasks with same ID in multiple dirs → only first one counted in list', () => {
    const dir2 = join(dirs.root, 'multi-dup-2');
    mkdirSync(dir2, { recursive: true });
    const config = writeTestConfig(dirs, { tasksDirs: [dirs.tasksDir, dir2] });
    _setTestConfig(config, dirs.configDir);

    writeRawTask(dirs.tasksDir, 'shared-id', rawTaskContent({
      id: 'shared-id',
      agent: 'claude',
    }));
    writeRawTask(dir2, 'shared-id', rawTaskContent({
      id: 'shared-id',
      agent: 'copilot',
    }));

    const matches = listTasks().filter((t) => t.id === 'shared-id');
    expect(matches).toHaveLength(1);
    expect(matches[0].agent).toBe('claude');
  });

  it('non-existent directory is silently skipped', () => {
    const ghostDir = join(dirs.root, 'non-existent-dir');
    const config = writeTestConfig(dirs, { tasksDirs: [dirs.tasksDir, ghostDir] });
    _setTestConfig(config, dirs.configDir);

    createTask(makeTask({ id: 'still-works' }));
    expect(() => listTasks()).not.toThrow();
    const tasks = listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('still-works');
  });

  it('directory with no .md files causes no error', () => {
    const emptyDir = join(dirs.root, 'empty-dir');
    mkdirSync(emptyDir, { recursive: true });
    writeFileSync(join(emptyDir, 'readme.txt'), 'not a task', 'utf-8');
    const config = writeTestConfig(dirs, { tasksDirs: [dirs.tasksDir, emptyDir] });
    _setTestConfig(config, dirs.configDir);

    createTask(makeTask({ id: 'in-primary-only' }));
    expect(() => listTasks()).not.toThrow();
    const tasks = listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('in-primary-only');
  });
});
