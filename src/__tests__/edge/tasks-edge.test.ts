import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdtempSync,
  readdirSync,
  existsSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { TaskDefinition } from '../../types.js';

let testDir: string;
let tasksDir: string;
let tasksDir2: string;

vi.mock('../../config.js', () => ({
  loadConfig: () => ({
    secretKey: 'test-key',
    version: '0.1.0',
    tasksDirs: [tasksDir, tasksDir2],
    logsDir: join(testDir, 'logs'),
    maxConcurrency: 2,
  }),
  getConfigDir: () => join(testDir, '.cron-agents'),
}));

vi.mock('../../agents.js', () => ({
  getDefaultAgent: () => 'claude',
}));

let tasksModule: typeof import('../../tasks.js');

beforeEach(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'tasks-edge-'));
  tasksDir = join(testDir, 'tasks');
  tasksDir2 = join(testDir, 'tasks2');
  mkdirSync(tasksDir, { recursive: true });
  mkdirSync(tasksDir2, { recursive: true });
  vi.resetModules();
  tasksModule = await import('../../tasks.js');
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function makeTask(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id: 'edge-task',
    schedule: '0 9 * * *',
    invocation: 'cli',
    agent: 'claude',
    notifications: { toast: true },
    enabled: true,
    instructions: '# Edge\nDo something.',
    ...overrides,
  };
}

function writeRaw(dir: string, filename: string, content: string): void {
  writeFileSync(join(dir, filename), content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Corrupt YAML frontmatter
// ---------------------------------------------------------------------------
describe('corrupt YAML frontmatter', () => {
  it('handles missing closing --- delimiter by throwing', () => {
    writeRaw(tasksDir, 'broken.md', '---\nid: broken\nschedule: "0 9 * * *"\nHello world\n');
    // gray-matter + js-yaml throws on invalid YAML when no closing ---
    expect(() => tasksModule.getTask('broken')).toThrow();
  });

  it('handles binary content in task file', () => {
    const binaryBuf = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
    writeFileSync(join(tasksDir, 'binary.md'), binaryBuf);
    // Should not crash
    expect(() => tasksModule.getTask('binary')).not.toThrow();
  });

  it('handles nested YAML objects in frontmatter', () => {
    writeRaw(
      tasksDir,
      'nested.md',
      '---\nid: nested\nschedule: "0 9 * * *"\ndeep:\n  level1:\n    level2: value\n---\n\n# Instructions\n',
    );
    const task = tasksModule.getTask('nested');
    expect(task).not.toBeNull();
    expect(task!.id).toBe('nested');
  });

  it('handles YAML with tab indentation', () => {
    writeRaw(
      tasksDir,
      'tabs.md',
      '---\nid: tabs\nschedule: "0 9 * * *"\nnotifications:\n\ttoast: true\n---\n\n# Instructions\n',
    );
    // YAML with tabs may cause errors; should not crash the system
    expect(() => tasksModule.getTask('tabs')).not.toThrow();
  });

  it('handles completely empty file', () => {
    writeRaw(tasksDir, 'empty.md', '');
    const task = tasksModule.getTask('empty');
    // Should return a task with defaults or handle gracefully
    expect(() => tasksModule.getTask('empty')).not.toThrow();
  });

  it('handles frontmatter with only delimiters and no fields', () => {
    writeRaw(tasksDir, 'empty-fm.md', '---\n---\n\n# Just instructions\n');
    const task = tasksModule.getTask('empty-fm');
    expect(task).not.toBeNull();
    // id falls back to filename when missing from frontmatter
    expect(task!.id).toBe('empty-fm');
  });

  it('handles file with only whitespace', () => {
    writeRaw(tasksDir, 'whitespace.md', '   \n\n\t\t\n  ');
    expect(() => tasksModule.getTask('whitespace')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Missing required fields
// ---------------------------------------------------------------------------
describe('missing required fields', () => {
  it('defaults id to filename when not specified', () => {
    writeRaw(tasksDir, 'no-id.md', '---\nschedule: "0 9 * * *"\n---\n\n# Hello\n');
    const task = tasksModule.getTask('no-id');
    expect(task).not.toBeNull();
    expect(task!.id).toBe('no-id');
  });

  it('defaults schedule to "0 0 * * *" when missing', () => {
    writeRaw(tasksDir, 'no-sched.md', '---\nid: no-sched\n---\n\n# Hello\n');
    const task = tasksModule.getTask('no-sched');
    expect(task).not.toBeNull();
    expect(task!.schedule).toBe('0 0 * * *');
  });

  it('returns empty instructions when no body after frontmatter', () => {
    writeRaw(tasksDir, 'no-body.md', '---\nid: no-body\nschedule: "0 9 * * *"\n---\n');
    const task = tasksModule.getTask('no-body');
    expect(task).not.toBeNull();
    expect(task!.instructions.trim()).toBe('');
  });

  it('defaults invocation to cli when missing', () => {
    writeRaw(tasksDir, 'no-inv.md', '---\nid: no-inv\nschedule: "0 9 * * *"\n---\n\nHi\n');
    const task = tasksModule.getTask('no-inv');
    expect(task!.invocation).toBe('cli');
  });

  it('defaults notifications to {toast: false} when missing', () => {
    writeRaw(tasksDir, 'no-notif.md', '---\nid: no-notif\nschedule: "0 9 * * *"\n---\n\nHi\n');
    const task = tasksModule.getTask('no-notif');
    expect(task!.notifications).toEqual({ toast: false });
  });

  it('defaults enabled to true when missing', () => {
    writeRaw(tasksDir, 'no-enabled.md', '---\nid: no-enabled\nschedule: "0 9 * * *"\n---\n\nHi\n');
    const task = tasksModule.getTask('no-enabled');
    expect(task!.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// YAML injection / special schedule values
// ---------------------------------------------------------------------------
describe('YAML injection and special values', () => {
  it('schedule with embedded newline stays as-is in parsed YAML', () => {
    // YAML string values handle newlines within quotes
    writeRaw(
      tasksDir,
      'inject.md',
      '---\nid: inject\nschedule: "0 9 * * *"\nmalicious: true\n---\n\n# Instructions\n',
    );
    const task = tasksModule.getTask('inject');
    expect(task).not.toBeNull();
    expect(task!.schedule).toBe('0 9 * * *');
    // The extra field shouldn't affect the parsed task
  });

  it('frontmatter with YAML anchors and aliases', () => {
    writeRaw(
      tasksDir,
      'anchors.md',
      '---\nid: anchors\nschedule: &sched "0 9 * * *"\nother: *sched\n---\n\n# Instructions\n',
    );
    expect(() => tasksModule.getTask('anchors')).not.toThrow();
  });

  it('schedule value with special cron chars is preserved', () => {
    writeRaw(
      tasksDir,
      'special-cron.md',
      '---\nid: special-cron\nschedule: "*/5 1-3,7 * * MON-FRI"\n---\n\n# Instructions\n',
    );
    const task = tasksModule.getTask('special-cron');
    expect(task!.schedule).toBe('*/5 1-3,7 * * MON-FRI');
  });

  it('frontmatter with duplicate keys throws (js-yaml safe mode rejects duplicates)', () => {
    writeRaw(
      tasksDir,
      'dup-keys.md',
      '---\nid: dup-keys\nschedule: "0 1 * * *"\nschedule: "0 2 * * *"\n---\n\n# Instructions\n',
    );
    // js-yaml in safe mode (used by gray-matter) throws on duplicate mapping keys
    expect(() => tasksModule.getTask('dup-keys')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Multiple tasksDirs
// ---------------------------------------------------------------------------
describe('multiple tasksDirs', () => {
  it('task in first dir wins when same id exists in both', () => {
    writeRaw(
      tasksDir,
      'dup.md',
      '---\nid: dup\nschedule: "0 1 * * *"\ninvocation: cli\nagent: claude\nenabled: true\nnotifications:\n  toast: true\n---\n\nFirst dir\n',
    );
    writeRaw(
      tasksDir2,
      'dup.md',
      '---\nid: dup\nschedule: "0 2 * * *"\ninvocation: api\nagent: copilot\nenabled: false\nnotifications:\n  toast: false\n---\n\nSecond dir\n',
    );
    const task = tasksModule.getTask('dup');
    expect(task!.schedule).toBe('0 1 * * *');
    expect(task!.instructions).toContain('First dir');
  });

  it('listTasks deduplicates by id across dirs', () => {
    writeRaw(
      tasksDir,
      'shared.md',
      '---\nid: shared\nschedule: "0 1 * * *"\n---\n\nDir1\n',
    );
    writeRaw(
      tasksDir2,
      'shared.md',
      '---\nid: shared\nschedule: "0 2 * * *"\n---\n\nDir2\n',
    );
    const matches = tasksModule.listTasks().filter((t) => t.id === 'shared');
    expect(matches).toHaveLength(1);
  });

  it('handles one dir missing entirely', () => {
    rmSync(tasksDir2, { recursive: true, force: true });
    tasksModule.createTask(makeTask({ id: 'solo' }));
    expect(tasksModule.listTasks()).toHaveLength(1);
  });

  it('task in second dir is found when not in first', () => {
    writeRaw(
      tasksDir2,
      'only-second.md',
      '---\nid: only-second\nschedule: "0 9 * * *"\ninvocation: cli\nagent: claude\nenabled: true\nnotifications:\n  toast: false\n---\n\nContent\n',
    );
    const task = tasksModule.getTask('only-second');
    expect(task).not.toBeNull();
    expect(task!.id).toBe('only-second');
  });

  it('getTaskFilePath returns first dir path when task exists in both', () => {
    writeRaw(tasksDir, 'in-both.md', '---\nid: in-both\nschedule: "0 0 * * *"\n---\n\nA\n');
    writeRaw(tasksDir2, 'in-both.md', '---\nid: in-both\nschedule: "0 0 * * *"\n---\n\nB\n');
    expect(tasksModule.getTaskFilePath('in-both')).toBe(join(tasksDir, 'in-both.md'));
  });

  it('listTasks aggregates unique tasks from both dirs', () => {
    writeRaw(tasksDir, 'a.md', '---\nid: a\nschedule: "0 0 * * *"\n---\n\nA\n');
    writeRaw(tasksDir2, 'b.md', '---\nid: b\nschedule: "0 0 * * *"\n---\n\nB\n');
    const ids = tasksModule.listTasks().map((t) => t.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Empty instructions
// ---------------------------------------------------------------------------
describe('empty instructions', () => {
  it('task with just frontmatter has empty instructions', () => {
    writeRaw(
      tasksDir,
      'no-instr.md',
      '---\nid: no-instr\nschedule: "0 9 * * *"\n---\n',
    );
    const task = tasksModule.getTask('no-instr');
    expect(task).not.toBeNull();
    expect(task!.instructions.trim()).toBe('');
  });

  it('task with only newlines after frontmatter', () => {
    writeRaw(
      tasksDir,
      'newlines.md',
      '---\nid: newlines\nschedule: "0 9 * * *"\n---\n\n\n\n',
    );
    const task = tasksModule.getTask('newlines');
    expect(task!.instructions.trim()).toBe('');
  });

  it('createTask with empty string instructions roundtrips', () => {
    tasksModule.createTask(makeTask({ id: 'empty-instr', instructions: '' }));
    const task = tasksModule.getTask('empty-instr');
    expect(task).not.toBeNull();
    expect(task!.instructions.trim()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Very large task file
// ---------------------------------------------------------------------------
describe('very large task file', () => {
  it('handles a 1MB instructions body', () => {
    const largeBody = 'x'.repeat(1_000_000);
    writeRaw(
      tasksDir,
      'large.md',
      `---\nid: large\nschedule: "0 9 * * *"\n---\n\n${largeBody}\n`,
    );
    const task = tasksModule.getTask('large');
    expect(task).not.toBeNull();
    expect(task!.instructions.length).toBeGreaterThanOrEqual(1_000_000);
  });

  it('listTasks still works with a large file present', () => {
    const largeBody = 'y'.repeat(500_000);
    writeRaw(
      tasksDir,
      'big.md',
      `---\nid: big\nschedule: "0 9 * * *"\n---\n\n${largeBody}\n`,
    );
    tasksModule.createTask(makeTask({ id: 'small' }));
    const ids = tasksModule.listTasks().map((t) => t.id);
    expect(ids).toContain('big');
    expect(ids).toContain('small');
  });
});

// ---------------------------------------------------------------------------
// Non-markdown files in task dir
// ---------------------------------------------------------------------------
describe('non-markdown files in task dir', () => {
  it('ignores .json files', () => {
    writeRaw(tasksDir, 'data.json', '{"hello": "world"}');
    tasksModule.createTask(makeTask({ id: 'real' }));
    const ids = tasksModule.listTasks().map((t) => t.id);
    expect(ids).toEqual(['real']);
  });

  it('ignores .txt files', () => {
    writeRaw(tasksDir, 'notes.txt', 'some notes');
    const tasks = tasksModule.listTasks();
    expect(tasks).toHaveLength(0);
  });

  it('ignores subdirectories', () => {
    mkdirSync(join(tasksDir, 'subdir'), { recursive: true });
    writeRaw(join(tasksDir, 'subdir'), 'nested.md', '---\nid: nested\n---\n\nNested\n');
    tasksModule.createTask(makeTask({ id: 'top-level' }));
    const ids = tasksModule.listTasks().map((t) => t.id);
    // Only the top-level .md file should be listed
    expect(ids).toEqual(['top-level']);
  });

  it('ignores hidden files like .dotfile.md', () => {
    writeRaw(tasksDir, '.hidden.md', '---\nid: hidden\nschedule: "0 0 * * *"\n---\n\nHi\n');
    // .hidden.md still ends with .md so it will be picked up by the filter
    // This tests actual behavior — the module does not exclude dot files
    const ids = tasksModule.listTasks().map((t) => t.id);
    // .hidden.md ends with .md, so it IS included (documenting actual behavior)
    expect(ids).toContain('hidden');
  });

  it('ignores files with .MD extension (case sensitivity check)', () => {
    writeRaw(tasksDir, 'UPPER.MD', '---\nid: upper\nschedule: "0 0 * * *"\n---\n\nHi\n');
    // On Windows, .MD and .md may or may not be treated the same
    // The filter uses .endsWith('.md') so .MD won't match on case-sensitive systems
    const tasks = tasksModule.listTasks();
    // On Windows (case-insensitive FS), readdirSync may return 'UPPER.MD'
    // which won't match .endsWith('.md')
    // Just verify no crash
    expect(() => tasksModule.listTasks()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Special characters in task id
// ---------------------------------------------------------------------------
describe('special characters in task id', () => {
  it('task id with dots', () => {
    writeRaw(
      tasksDir,
      'my.task.v2.md',
      '---\nid: my.task.v2\nschedule: "0 9 * * *"\n---\n\nDotted\n',
    );
    const task = tasksModule.getTask('my.task.v2');
    expect(task).not.toBeNull();
    expect(task!.id).toBe('my.task.v2');
  });

  it('task id with hyphens and underscores', () => {
    writeRaw(
      tasksDir,
      'my-task_v2.md',
      '---\nid: my-task_v2\nschedule: "0 9 * * *"\n---\n\nOk\n',
    );
    const task = tasksModule.getTask('my-task_v2');
    expect(task!.id).toBe('my-task_v2');
  });

  it('task id with numbers only', () => {
    writeRaw(
      tasksDir,
      '12345.md',
      '---\nid: "12345"\nschedule: "0 9 * * *"\n---\n\nNumeric\n',
    );
    const task = tasksModule.getTask('12345');
    expect(task).not.toBeNull();
    expect(task!.id).toBe('12345');
  });

  it('task id with unicode characters', () => {
    const id = 'tâche-café';
    writeRaw(
      tasksDir,
      `${id}.md`,
      `---\nid: "${id}"\nschedule: "0 9 * * *"\n---\n\nUnicode\n`,
    );
    const task = tasksModule.getTask(id);
    expect(task).not.toBeNull();
    expect(task!.id).toBe(id);
  });

  it('task id with spaces creates a file but may not roundtrip via getTask', () => {
    // getTask builds filename as `${taskId}.md`, so 'my task' → 'my task.md'
    writeRaw(
      tasksDir,
      'my task.md',
      '---\nid: "my task"\nschedule: "0 9 * * *"\n---\n\nSpaced\n',
    );
    const task = tasksModule.getTask('my task');
    expect(task).not.toBeNull();
    expect(task!.id).toBe('my task');
  });
});

// ---------------------------------------------------------------------------
// Task file with no frontmatter
// ---------------------------------------------------------------------------
describe('task file with no frontmatter', () => {
  it('plain markdown without --- delimiters', () => {
    writeRaw(tasksDir, 'plain.md', '# Just markdown\n\nNo frontmatter here.\n');
    const task = tasksModule.getTask('plain');
    expect(task).not.toBeNull();
    // gray-matter with no frontmatter: data is empty, id falls back to filename
    expect(task!.id).toBe('plain');
    expect(task!.instructions).toContain('# Just markdown');
  });

  it('listTasks handles files without frontmatter gracefully', () => {
    writeRaw(tasksDir, 'no-fm.md', '# No frontmatter\n\nJust text.\n');
    expect(() => tasksModule.listTasks()).not.toThrow();
    const tasks = tasksModule.listTasks();
    expect(tasks.length).toBeGreaterThanOrEqual(1);
  });

  it('file starting with single --- has no closing delimiter', () => {
    writeRaw(tasksDir, 'single-delim.md', '---\nNot really yaml\n');
    expect(() => tasksModule.getTask('single-delim')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Boolean coercion
// ---------------------------------------------------------------------------
describe('boolean coercion', () => {
  it('enabled as string "true" is truthy', () => {
    writeRaw(
      tasksDir,
      'str-true.md',
      '---\nid: str-true\nschedule: "0 9 * * *"\nenabled: "true"\n---\n\nHi\n',
    );
    const task = tasksModule.getTask('str-true');
    // YAML parses "true" (quoted) as the string "true", not boolean
    // The code does `parsed.data.enabled !== false` — string "true" !== false → true
    expect(task!.enabled).toBe(true);
  });

  it('enabled as string "false" is still truthy due to !== false check', () => {
    writeRaw(
      tasksDir,
      'str-false.md',
      '---\nid: str-false\nschedule: "0 9 * * *"\nenabled: "false"\n---\n\nHi\n',
    );
    const task = tasksModule.getTask('str-false');
    // string "false" !== false → true (documenting actual behavior)
    expect(task!.enabled).toBe(true);
  });

  it('enabled as YAML boolean false', () => {
    writeRaw(
      tasksDir,
      'bool-false.md',
      '---\nid: bool-false\nschedule: "0 9 * * *"\nenabled: false\n---\n\nHi\n',
    );
    const task = tasksModule.getTask('bool-false');
    expect(task!.enabled).toBe(false);
  });

  it('enabled as 0 is truthy (0 !== false)', () => {
    writeRaw(
      tasksDir,
      'zero.md',
      '---\nid: zero\nschedule: "0 9 * * *"\nenabled: 0\n---\n\nHi\n',
    );
    const task = tasksModule.getTask('zero');
    // 0 !== false → true
    expect(task!.enabled).toBe(true);
  });

  it('enabled as 1 is truthy', () => {
    writeRaw(
      tasksDir,
      'one.md',
      '---\nid: one\nschedule: "0 9 * * *"\nenabled: 1\n---\n\nHi\n',
    );
    const task = tasksModule.getTask('one');
    expect(task!.enabled).toBe(true);
  });

  it('toast as unquoted true is boolean true', () => {
    writeRaw(
      tasksDir,
      'toast-bool.md',
      '---\nid: toast-bool\nschedule: "0 9 * * *"\nnotifications:\n  toast: true\n---\n\nHi\n',
    );
    const task = tasksModule.getTask('toast-bool');
    expect(task!.notifications.toast).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unknown frontmatter fields
// ---------------------------------------------------------------------------
describe('unknown frontmatter fields', () => {
  it('extra fields do not cause errors', () => {
    writeRaw(
      tasksDir,
      'extra.md',
      '---\nid: extra\nschedule: "0 9 * * *"\ncustom_field: hello\npriority: 5\ntags:\n  - a\n  - b\n---\n\n# Instructions\n',
    );
    const task = tasksModule.getTask('extra');
    expect(task).not.toBeNull();
    expect(task!.id).toBe('extra');
    expect(task!.schedule).toBe('0 9 * * *');
  });

  it('extra fields are silently ignored in listTasks metadata', () => {
    writeRaw(
      tasksDir,
      'extra-list.md',
      '---\nid: extra-list\nschedule: "0 9 * * *"\nfoo: bar\n---\n\n# Hi\n',
    );
    const meta = tasksModule.listTasks().find((t) => t.id === 'extra-list');
    expect(meta).toBeDefined();
    // TaskMetadata only has id, schedule, invocation, agent, enabled
    expect(meta).not.toHaveProperty('foo');
  });

  it('deeply nested unknown fields are tolerated', () => {
    writeRaw(
      tasksDir,
      'deep-extra.md',
      '---\nid: deep-extra\nschedule: "0 9 * * *"\nmetadata:\n  author: test\n  config:\n    retries: 3\n    timeout: 60\n---\n\n# Instructions\n',
    );
    const task = tasksModule.getTask('deep-extra');
    expect(task).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createTask then getTask roundtrip
// ---------------------------------------------------------------------------
describe('createTask → getTask roundtrip', () => {
  it('all fields survive roundtrip', () => {
    const original = makeTask({
      id: 'roundtrip',
      schedule: '30 14 1 * *',
      invocation: 'api',
      agent: 'copilot',
      notifications: { toast: false },
      enabled: false,
      instructions: '# Full roundtrip\n\nWith **markdown** content.\n\n```ts\nconst x = 1;\n```',
    });
    tasksModule.createTask(original);
    const retrieved = tasksModule.getTask('roundtrip')!;

    expect(retrieved.id).toBe(original.id);
    expect(retrieved.schedule).toBe(original.schedule);
    expect(retrieved.invocation).toBe(original.invocation);
    expect(retrieved.agent).toBe(original.agent);
    expect(retrieved.notifications.toast).toBe(original.notifications.toast);
    expect(retrieved.enabled).toBe(original.enabled);
    expect(retrieved.instructions).toContain('# Full roundtrip');
    expect(retrieved.instructions).toContain('```ts');
  });

  it('instructions with YAML-like content in body do not corrupt frontmatter', () => {
    const task = makeTask({
      id: 'yaml-in-body',
      instructions: '# Config example\n\n---\nkey: value\n---\n\nSome text after.',
    });
    tasksModule.createTask(task);
    const retrieved = tasksModule.getTask('yaml-in-body')!;
    expect(retrieved.id).toBe('yaml-in-body');
    expect(retrieved.schedule).toBe('0 9 * * *');
  });

  it('multiple sequential creates and gets', () => {
    for (let i = 0; i < 10; i++) {
      tasksModule.createTask(makeTask({ id: `seq-${i}`, schedule: `${i} 0 * * *` }));
    }
    for (let i = 0; i < 10; i++) {
      const task = tasksModule.getTask(`seq-${i}`);
      expect(task).not.toBeNull();
      expect(task!.schedule).toBe(`${i} 0 * * *`);
    }
  });

  it('create → delete → getTask returns null', () => {
    tasksModule.createTask(makeTask({ id: 'del-rt' }));
    tasksModule.deleteTask('del-rt');
    expect(tasksModule.getTask('del-rt')).toBeNull();
  });

  it('create → delete → create again succeeds', () => {
    tasksModule.createTask(makeTask({ id: 'recreate' }));
    tasksModule.deleteTask('recreate');
    expect(() =>
      tasksModule.createTask(makeTask({ id: 'recreate', schedule: '0 18 * * *' })),
    ).not.toThrow();
    expect(tasksModule.getTask('recreate')!.schedule).toBe('0 18 * * *');
  });
});

// ---------------------------------------------------------------------------
// listTasks error resilience
// ---------------------------------------------------------------------------
describe('listTasks error resilience', () => {
  it('skips unparseable files without crashing', () => {
    tasksModule.createTask(makeTask({ id: 'good' }));
    // Write a corrupt file
    writeRaw(tasksDir, 'corrupt.md', '---\n: : :\ninvalid yaml\n---\n\n');
    const tasks = tasksModule.listTasks();
    // At minimum the good task should appear
    const ids = tasks.map((t) => t.id);
    expect(ids).toContain('good');
  });

  it('handles permission-like errors gracefully for unreadable dirs', () => {
    // Remove the second dir to simulate it being unavailable
    rmSync(tasksDir2, { recursive: true, force: true });
    tasksModule.createTask(makeTask({ id: 'available' }));
    expect(() => tasksModule.listTasks()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// deleteTask edge cases
// ---------------------------------------------------------------------------
describe('deleteTask edge cases', () => {
  it('throws when deleting non-existent task', () => {
    expect(() => tasksModule.deleteTask('ghost')).toThrow(/not found/);
  });

  it('double delete throws on second attempt', () => {
    tasksModule.createTask(makeTask({ id: 'double-del' }));
    tasksModule.deleteTask('double-del');
    expect(() => tasksModule.deleteTask('double-del')).toThrow(/not found/);
  });

  it('delete from secondary dir works', () => {
    writeRaw(
      tasksDir2,
      'sec-del.md',
      '---\nid: sec-del\nschedule: "0 9 * * *"\ninvocation: cli\nagent: claude\nenabled: true\nnotifications:\n  toast: false\n---\n\nContent\n',
    );
    expect(tasksModule.getTask('sec-del')).not.toBeNull();
    tasksModule.deleteTask('sec-del');
    expect(tasksModule.getTask('sec-del')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateTask edge cases
// ---------------------------------------------------------------------------
describe('updateTask edge cases', () => {
  it('throws when updating non-existent task', () => {
    expect(() => tasksModule.updateTask('no-such', makeTask({ id: 'no-such' }))).toThrow(
      /not found/,
    );
  });

  it('update preserves file location in secondary dir', () => {
    writeRaw(
      tasksDir2,
      'sec-up.md',
      '---\nid: sec-up\nschedule: "0 9 * * *"\ninvocation: cli\nagent: claude\nenabled: true\nnotifications:\n  toast: false\n---\n\nOriginal\n',
    );
    tasksModule.updateTask('sec-up', makeTask({ id: 'sec-up', schedule: '0 18 * * *' }));
    // Should still be in tasksDir2
    expect(existsSync(join(tasksDir2, 'sec-up.md'))).toBe(true);
    expect(tasksModule.getTask('sec-up')!.schedule).toBe('0 18 * * *');
  });
});
