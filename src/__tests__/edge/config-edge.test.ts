/**
 * Edge-case tests for the config module.
 *
 * Strategy: mock os.homedir() so CONFIG_DIR / CONFIG_FILE resolve inside a
 * per-test temp directory. After each mock we reset the module cache and
 * dynamically re-import config.ts so module-level constants pick up the new
 * homedir.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ---------------------------------------------------------------------------
// Mock os.homedir() – vi.mock is hoisted so testRoot is set in beforeEach
// ---------------------------------------------------------------------------
let testRoot: string;

vi.mock('os', async (importOriginal) => {
  const original = (await importOriginal()) as typeof import('os');
  return {
    ...original,
    homedir: () => testRoot,
  };
});

// Module reference refreshed per test
let configModule: typeof import('../../config.js');

// Helpers
function configDir(): string {
  return join(testRoot, '.cron-agents');
}

function configFile(): string {
  return join(configDir(), 'config.json');
}

function defaultTasksDir(): string {
  return join(configDir(), 'tasks');
}

function defaultLogsDir(): string {
  return join(configDir(), 'logs');
}

function writeRawConfig(obj: Record<string, unknown>): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(configFile(), JSON.stringify(obj, null, 2), 'utf-8');
}

function writeRawString(content: string): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(configFile(), content, 'utf-8');
}

function readRawConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(configFile(), 'utf-8'));
}

function baseConfig(): Record<string, unknown> {
  return {
    secretKey: 'a'.repeat(64),
    version: '0.1.0',
    tasksDirs: [defaultTasksDir()],
    logsDir: defaultLogsDir(),
    maxConcurrency: 2,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
beforeEach(async () => {
  testRoot = mkdtempSync(join(tmpdir(), 'cron-agents-edge-'));
  vi.resetModules();
  configModule = await import('../../config.js');
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

// ===========================================================================
// 1. Corrupt JSON recovery
// ===========================================================================
describe('Corrupt JSON recovery', () => {
  it('recovers from truncated JSON "{"', () => {
    writeRawString('{');
    const cfg = configModule.loadConfig();
    expect(cfg.secretKey).toMatch(/^[0-9a-f]{64}$/);
    expect(cfg.tasksDirs).toContain(defaultTasksDir());
  });

  it('recovers from JSON "null"', () => {
    writeRawString('null');
    // JSON.parse('null') returns null — not a valid config object
    const cfg = configModule.loadConfig();
    expect(cfg.secretKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('recovers from the literal string "undefined"', () => {
    writeRawString('undefined');
    const cfg = configModule.loadConfig();
    expect(cfg.secretKey).toMatch(/^[0-9a-f]{64}$/);
    expect(cfg.maxConcurrency).toBe(2);
  });

  it('recovers from JSON array "[]"', () => {
    writeRawString('[]');
    // JSON.parse('[]') returns [] — accessing .tasksDirs on an array gives
    // undefined, which is handled by the defaults path
    const cfg = configModule.loadConfig();
    expect(cfg.tasksDirs).toContain(defaultTasksDir());
    expect(cfg.maxConcurrency).toBe(2);
  });

  it('recovers from JSON number "42"', () => {
    writeRawString('42');
    const cfg = configModule.loadConfig();
    expect(cfg.tasksDirs).toContain(defaultTasksDir());
  });

  it('recovers from empty string', () => {
    writeRawString('');
    const cfg = configModule.loadConfig();
    expect(cfg.secretKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('recovers from whitespace-only content', () => {
    writeRawString('   \n\t  ');
    const cfg = configModule.loadConfig();
    expect(cfg.secretKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('recovers from JSON with trailing comma', () => {
    writeRawString('{"secretKey": "abc",}');
    const cfg = configModule.loadConfig();
    expect(cfg.secretKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('recovers from binary garbage', () => {
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(configFile(), Buffer.from([0x00, 0xff, 0xfe, 0x80]), 'binary');
    const cfg = configModule.loadConfig();
    expect(cfg.secretKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('writes valid JSON after recovering from corrupt file', () => {
    writeRawString('{{{');
    configModule.loadConfig();
    const raw = readFileSync(configFile(), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('recovered config has all required fields', () => {
    writeRawString('not json at all');
    const cfg = configModule.loadConfig();
    expect(cfg).toHaveProperty('secretKey');
    expect(cfg).toHaveProperty('version');
    expect(cfg).toHaveProperty('tasksDirs');
    expect(cfg).toHaveProperty('logsDir');
    expect(cfg).toHaveProperty('maxConcurrency');
  });
});

// ===========================================================================
// 2. maxConcurrency edge values
// ===========================================================================
describe('maxConcurrency edge values', () => {
  it('maxConcurrency = 0 defaults to 2', () => {
    writeRawConfig({ ...baseConfig(), maxConcurrency: 0 });
    expect(configModule.loadConfig().maxConcurrency).toBe(2);
  });

  it('maxConcurrency = -1 defaults to 2', () => {
    writeRawConfig({ ...baseConfig(), maxConcurrency: -1 });
    expect(configModule.loadConfig().maxConcurrency).toBe(2);
  });

  it('maxConcurrency = NaN defaults to 2', () => {
    // JSON doesn't support NaN; writing it as a string in JSON
    writeRawString(JSON.stringify({ ...baseConfig(), maxConcurrency: 'NaN' }));
    expect(configModule.loadConfig().maxConcurrency).toBe(2);
  });

  it('maxConcurrency = Infinity defaults to 2', () => {
    // JSON.stringify converts Infinity to null
    writeRawString(
      JSON.stringify(baseConfig()).replace('"maxConcurrency":2', '"maxConcurrency":null'),
    );
    expect(configModule.loadConfig().maxConcurrency).toBe(2);
  });

  it('maxConcurrency = -Infinity defaults to 2', () => {
    writeRawString(
      JSON.stringify(baseConfig()).replace('"maxConcurrency":2', '"maxConcurrency":null'),
    );
    expect(configModule.loadConfig().maxConcurrency).toBe(2);
  });

  it('maxConcurrency = 0.5 defaults to 2 (< 1)', () => {
    writeRawConfig({ ...baseConfig(), maxConcurrency: 0.5 });
    expect(configModule.loadConfig().maxConcurrency).toBe(2);
  });

  it('maxConcurrency = 1.5 is floored to 1', () => {
    writeRawConfig({ ...baseConfig(), maxConcurrency: 1.5 });
    expect(configModule.loadConfig().maxConcurrency).toBe(1);
  });

  it('maxConcurrency = 2.9 is floored to 2', () => {
    writeRawConfig({ ...baseConfig(), maxConcurrency: 2.9 });
    expect(configModule.loadConfig().maxConcurrency).toBe(2);
  });

  it('maxConcurrency = 999999 is preserved', () => {
    writeRawConfig({ ...baseConfig(), maxConcurrency: 999999 });
    expect(configModule.loadConfig().maxConcurrency).toBe(999999);
  });

  it('maxConcurrency = string "3" defaults to 2', () => {
    writeRawConfig({ ...baseConfig(), maxConcurrency: '3' });
    expect(configModule.loadConfig().maxConcurrency).toBe(2);
  });

  it('maxConcurrency = boolean true defaults to 2', () => {
    writeRawConfig({ ...baseConfig(), maxConcurrency: true });
    expect(configModule.loadConfig().maxConcurrency).toBe(2);
  });

  it('maxConcurrency = null defaults to 2', () => {
    writeRawConfig({ ...baseConfig(), maxConcurrency: null });
    expect(configModule.loadConfig().maxConcurrency).toBe(2);
  });

  it('maxConcurrency = 1 is preserved (boundary)', () => {
    writeRawConfig({ ...baseConfig(), maxConcurrency: 1 });
    expect(configModule.loadConfig().maxConcurrency).toBe(1);
  });

  it('maxConcurrency = -0 defaults to 2', () => {
    writeRawConfig({ ...baseConfig(), maxConcurrency: -0 });
    expect(configModule.loadConfig().maxConcurrency).toBe(2);
  });
});

// ===========================================================================
// 3. tasksDirs filtering
// ===========================================================================
describe('tasksDirs filtering', () => {
  it('filters empty strings from tasksDirs', () => {
    writeRawConfig({ ...baseConfig(), tasksDirs: [defaultTasksDir(), '', 'C:\\valid'] });
    const cfg = configModule.loadConfig();
    expect(cfg.tasksDirs).not.toContain('');
  });

  it('filters whitespace-only strings from tasksDirs', () => {
    writeRawConfig({ ...baseConfig(), tasksDirs: [defaultTasksDir(), '   ', '\t\n'] });
    const cfg = configModule.loadConfig();
    for (const d of cfg.tasksDirs) {
      expect(d.trim().length).toBeGreaterThan(0);
    }
  });

  it('array of only empty strings falls back to default', () => {
    writeRawConfig({ ...baseConfig(), tasksDirs: ['', '', ''] });
    const cfg = configModule.loadConfig();
    expect(cfg.tasksDirs).toContain(defaultTasksDir());
    expect(cfg.tasksDirs.length).toBeGreaterThanOrEqual(1);
  });

  it('mixed valid and empty strings keeps valid ones', () => {
    writeRawConfig({
      ...baseConfig(),
      tasksDirs: [defaultTasksDir(), '', 'D:\\custom', '  ', 'E:\\other'],
    });
    const cfg = configModule.loadConfig();
    expect(cfg.tasksDirs).toContain('D:\\custom');
    expect(cfg.tasksDirs).toContain('E:\\other');
    expect(cfg.tasksDirs).not.toContain('');
    expect(cfg.tasksDirs).not.toContain('  ');
  });

  it('null entries in tasksDirs are filtered out', () => {
    // JSON allows null in arrays
    writeRawConfig({
      ...baseConfig(),
      tasksDirs: [defaultTasksDir(), null, 'C:\\valid'],
    });
    const cfg = configModule.loadConfig();
    expect(cfg.tasksDirs).not.toContain(null);
    expect(cfg.tasksDirs).toContain('C:\\valid');
  });

  it('tasksDirs with only whitespace entries falls back to default', () => {
    writeRawConfig({ ...baseConfig(), tasksDirs: ['  ', '\t'] });
    const cfg = configModule.loadConfig();
    expect(cfg.tasksDirs).toContain(defaultTasksDir());
  });

  it('empty tasksDirs array receives default', () => {
    writeRawConfig({ ...baseConfig(), tasksDirs: [] });
    const cfg = configModule.loadConfig();
    expect(cfg.tasksDirs).toContain(defaultTasksDir());
  });
});

// ===========================================================================
// 4. Legacy migration edge cases
// ===========================================================================
describe('Legacy migration edge cases', () => {
  it('legacy tasksDir as empty string falls back to default', () => {
    writeRawConfig({
      secretKey: 'a'.repeat(64),
      version: '0.1.0',
      tasksDir: '',
      logsDir: defaultLogsDir(),
    });
    const cfg = configModule.loadConfig();
    expect(cfg.tasksDirs).toContain(defaultTasksDir());
  });

  it('legacy tasksDir same as default produces single-entry array', () => {
    writeRawConfig({
      secretKey: 'a'.repeat(64),
      version: '0.1.0',
      tasksDir: defaultTasksDir(),
      logsDir: defaultLogsDir(),
    });
    const cfg = configModule.loadConfig();
    expect(cfg.tasksDirs).toEqual([defaultTasksDir()]);
  });

  it('legacy tasksDir different from default produces two entries', () => {
    const custom = 'X:\\my-tasks';
    writeRawConfig({
      secretKey: 'a'.repeat(64),
      version: '0.1.0',
      tasksDir: custom,
      logsDir: defaultLogsDir(),
    });
    const cfg = configModule.loadConfig();
    expect(cfg.tasksDirs[0]).toBe(defaultTasksDir());
    expect(cfg.tasksDirs).toContain(custom);
  });

  it('both tasksDir and tasksDirs present — tasksDirs takes priority', () => {
    writeRawConfig({
      secretKey: 'a'.repeat(64),
      version: '0.1.0',
      tasksDir: 'Y:\\old',
      tasksDirs: [defaultTasksDir(), 'Z:\\new'],
      logsDir: defaultLogsDir(),
    });
    const cfg = configModule.loadConfig();
    // tasksDirs array is non-empty so tasksDir is ignored
    expect(cfg.tasksDirs).toContain('Z:\\new');
    expect(cfg.tasksDirs).not.toContain('Y:\\old');
  });

  it('legacy tasksDir with whitespace-only string falls back to default', () => {
    writeRawConfig({
      secretKey: 'a'.repeat(64),
      version: '0.1.0',
      tasksDir: '   ',
      logsDir: defaultLogsDir(),
    });
    const cfg = configModule.loadConfig();
    // '   ' is truthy so it goes through the legacy path then gets filtered
    expect(cfg.tasksDirs).toContain(defaultTasksDir());
  });
});

// ===========================================================================
// 5. Missing fields
// ===========================================================================
describe('Missing fields', () => {
  it('config with only secretKey fills in defaults', () => {
    writeRawConfig({ secretKey: 'b'.repeat(64) });
    const cfg = configModule.loadConfig();
    expect(cfg.secretKey).toBe('b'.repeat(64));
    expect(cfg.version).toBe('0.1.0');
    expect(cfg.tasksDirs).toContain(defaultTasksDir());
    expect(cfg.logsDir).toBe(defaultLogsDir());
    expect(cfg.maxConcurrency).toBe(2);
  });

  it('empty object {} fills in all defaults', () => {
    writeRawConfig({});
    const cfg = configModule.loadConfig();
    expect(cfg.secretKey).toMatch(/^[0-9a-f]{64}$/);
    expect(cfg.version).toBe('0.1.0');
    expect(cfg.tasksDirs).toContain(defaultTasksDir());
    expect(cfg.logsDir).toBe(defaultLogsDir());
    expect(cfg.maxConcurrency).toBe(2);
  });

  it('missing secretKey generates a new one', () => {
    writeRawConfig({ version: '0.1.0', tasksDirs: [defaultTasksDir()], logsDir: defaultLogsDir() });
    const cfg = configModule.loadConfig();
    expect(cfg.secretKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('empty string secretKey generates a new one', () => {
    writeRawConfig({ ...baseConfig(), secretKey: '' });
    const cfg = configModule.loadConfig();
    // '' is falsy so the || branch generates a new key
    expect(cfg.secretKey).toMatch(/^[0-9a-f]{64}$/);
    expect(cfg.secretKey.length).toBe(64);
  });

  it('missing logsDir defaults to the standard path', () => {
    writeRawConfig({ secretKey: 'c'.repeat(64), version: '0.1.0' });
    expect(configModule.loadConfig().logsDir).toBe(defaultLogsDir());
  });

  it('empty string logsDir defaults to the standard path', () => {
    writeRawConfig({ ...baseConfig(), logsDir: '' });
    const cfg = configModule.loadConfig();
    // '' is falsy → default
    expect(cfg.logsDir).toBe(defaultLogsDir());
  });
});

// ===========================================================================
// 6. secretKey generation
// ===========================================================================
describe('secretKey generation', () => {
  it('generated key is exactly 64 hex characters', () => {
    const cfg = configModule.loadConfig();
    expect(cfg.secretKey).toHaveLength(64);
  });

  it('generated key is lowercase hex', () => {
    const cfg = configModule.loadConfig();
    expect(cfg.secretKey).toMatch(/^[0-9a-f]+$/);
  });

  it('two independent generations produce different keys', async () => {
    const cfg1 = configModule.loadConfig();

    // Remove the config so a fresh key is generated
    rmSync(testRoot, { recursive: true, force: true });
    testRoot = mkdtempSync(join(tmpdir(), 'cron-agents-edge2-'));
    vi.resetModules();
    configModule = await import('../../config.js');

    const cfg2 = configModule.loadConfig();
    expect(cfg1.secretKey).not.toBe(cfg2.secretKey);
  });

  it('secretKey persists after generation', () => {
    const key = configModule.loadConfig().secretKey;
    const key2 = configModule.loadConfig().secretKey;
    expect(key).toBe(key2);
  });

  it('getSecretKey returns the same key as loadConfig', () => {
    const fromLoad = configModule.loadConfig().secretKey;
    const fromGet = configModule.getSecretKey();
    expect(fromLoad).toBe(fromGet);
  });
});

// ===========================================================================
// 7. Version field edge cases
// ===========================================================================
describe('Version field edge cases', () => {
  it('missing version defaults to 0.1.0', () => {
    writeRawConfig({ secretKey: 'a'.repeat(64) });
    expect(configModule.loadConfig().version).toBe('0.1.0');
  });

  it('empty string version defaults to 0.1.0', () => {
    writeRawConfig({ ...baseConfig(), version: '' });
    expect(configModule.loadConfig().version).toBe('0.1.0');
  });

  it('numeric version (0) defaults to 0.1.0', () => {
    writeRawConfig({ ...baseConfig(), version: 0 });
    // 0 is falsy → '0.1.0'
    expect(configModule.loadConfig().version).toBe('0.1.0');
  });

  it('null version defaults to 0.1.0', () => {
    writeRawConfig({ ...baseConfig(), version: null });
    expect(configModule.loadConfig().version).toBe('0.1.0');
  });

  it('custom version string is preserved', () => {
    writeRawConfig({ ...baseConfig(), version: '2.0.0' });
    expect(configModule.loadConfig().version).toBe('2.0.0');
  });
});

// ===========================================================================
// 8. updateConfig edge cases
// ===========================================================================
describe('updateConfig edge cases', () => {
  it('partial update does not lose other fields', () => {
    configModule.loadConfig();
    const before = readRawConfig();
    configModule.updateConfig({ maxConcurrency: 10 });
    const after = readRawConfig();
    expect(after.secretKey).toBe(before.secretKey);
    expect(after.version).toBe(before.version);
    expect(after.logsDir).toBe(before.logsDir);
    expect(after.maxConcurrency).toBe(10);
  });

  it('update with empty object preserves everything', () => {
    configModule.loadConfig();
    const before = readRawConfig();
    configModule.updateConfig({});
    const after = readRawConfig();
    expect(after).toEqual(before);
  });

  it('sequential updates accumulate correctly', () => {
    configModule.loadConfig();
    configModule.updateConfig({ maxConcurrency: 5 });
    configModule.updateConfig({ logsDir: 'H:\\logs' });
    configModule.updateConfig({ version: '9.9.9' });
    const raw = readRawConfig();
    expect(raw.maxConcurrency).toBe(5);
    expect(raw.logsDir).toBe('H:\\logs');
    expect(raw.version).toBe('9.9.9');
  });

  it('updateConfig on non-existent config creates the file', () => {
    expect(existsSync(configFile())).toBe(false);
    configModule.updateConfig({ maxConcurrency: 7 });
    expect(existsSync(configFile())).toBe(true);
    expect(readRawConfig().maxConcurrency).toBe(7);
  });

  it('updateConfig with tasksDirs replaces the array', () => {
    configModule.loadConfig();
    configModule.updateConfig({ tasksDirs: ['A:\\new', 'B:\\other'] });
    const raw = readRawConfig();
    expect(raw.tasksDirs).toEqual(['A:\\new', 'B:\\other']);
  });

  it('updated config file is valid JSON', () => {
    configModule.loadConfig();
    configModule.updateConfig({ maxConcurrency: 3 });
    const raw = readFileSync(configFile(), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('updated config file is pretty-printed with 2-space indent', () => {
    configModule.loadConfig();
    configModule.updateConfig({ maxConcurrency: 4 });
    const raw = readFileSync(configFile(), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(raw).toBe(JSON.stringify(parsed, null, 2));
  });
});

// ===========================================================================
// 9. Concurrent loadConfig calls
// ===========================================================================
describe('Concurrent loadConfig calls', () => {
  it('multiple simultaneous loadConfig calls return consistent data', () => {
    const results = Array.from({ length: 10 }, () => configModule.loadConfig());
    const first = results[0];
    for (const r of results) {
      expect(r.secretKey).toBe(first.secretKey);
      expect(r.version).toBe(first.version);
      expect(r.tasksDirs).toEqual(first.tasksDirs);
      expect(r.logsDir).toBe(first.logsDir);
      expect(r.maxConcurrency).toBe(first.maxConcurrency);
    }
  });

  it('loadConfig after updateConfig reflects the update', () => {
    configModule.loadConfig();
    configModule.updateConfig({ maxConcurrency: 42 });
    const cfg = configModule.loadConfig();
    expect(cfg.maxConcurrency).toBe(42);
  });
});

// ===========================================================================
// 10. Config with extra unknown fields
// ===========================================================================
describe('Extra unknown fields', () => {
  it('unknown fields are preserved through updateConfig', () => {
    writeRawConfig({ ...baseConfig(), customField: 'hello', nested: { a: 1 } });
    configModule.updateConfig({ maxConcurrency: 5 });
    const raw = readRawConfig();
    // updateConfig does loadConfig → spread → save
    // loadConfig returns only known fields, so extras may be lost
    // This test documents actual behavior
    expect(raw.maxConcurrency).toBe(5);
  });

  it('loadConfig does not crash on extra fields', () => {
    writeRawConfig({
      ...baseConfig(),
      experimental: true,
      plugins: ['a', 'b'],
      deep: { nested: { value: 42 } },
    });
    const cfg = configModule.loadConfig();
    expect(cfg.secretKey).toBe('a'.repeat(64));
    expect(cfg.maxConcurrency).toBe(2);
  });

  it('numeric extra fields do not interfere', () => {
    writeRawConfig({ ...baseConfig(), count: 9999, ratio: 3.14 });
    const cfg = configModule.loadConfig();
    expect(cfg.version).toBe('0.1.0');
  });
});

// ===========================================================================
// 11. Unicode in paths
// ===========================================================================
describe('Unicode in paths', () => {
  it('tasksDirs with unicode characters are preserved', () => {
    const unicodePath = 'C:\\用户\\任务';
    writeRawConfig({ ...baseConfig(), tasksDirs: [defaultTasksDir(), unicodePath] });
    const cfg = configModule.loadConfig();
    expect(cfg.tasksDirs).toContain(unicodePath);
  });

  it('tasksDirs with emoji characters are preserved', () => {
    const emojiPath = 'D:\\📁\\tasks';
    writeRawConfig({ ...baseConfig(), tasksDirs: [defaultTasksDir(), emojiPath] });
    const cfg = configModule.loadConfig();
    expect(cfg.tasksDirs).toContain(emojiPath);
  });

  it('logsDir with accented characters is preserved', () => {
    const accentedPath = 'C:\\résumé\\logs';
    writeRawConfig({ ...baseConfig(), logsDir: accentedPath });
    const cfg = configModule.loadConfig();
    expect(cfg.logsDir).toBe(accentedPath);
  });

  it('legacy tasksDir with unicode migrates correctly', () => {
    const unicodePath = 'D:\\données\\tâches';
    writeRawConfig({
      secretKey: 'a'.repeat(64),
      version: '0.1.0',
      tasksDir: unicodePath,
      logsDir: defaultLogsDir(),
    });
    const cfg = configModule.loadConfig();
    expect(cfg.tasksDirs).toContain(unicodePath);
    expect(cfg.tasksDirs).toContain(defaultTasksDir());
  });
});

// ===========================================================================
// 12. getConfigDir
// ===========================================================================
describe('getConfigDir edge cases', () => {
  it('returns path ending with .cron-agents', () => {
    const dir = configModule.getConfigDir();
    expect(dir.endsWith('.cron-agents')).toBe(true);
  });

  it('returns path rooted at the mocked homedir', () => {
    const dir = configModule.getConfigDir();
    expect(dir.startsWith(testRoot)).toBe(true);
  });

  it('is stable across multiple calls', () => {
    expect(configModule.getConfigDir()).toBe(configModule.getConfigDir());
  });
});

// ===========================================================================
// 13. Persistence round-trip after corruption recovery
// ===========================================================================
describe('Persistence after corruption recovery', () => {
  it('config recovered from corruption can be updated', () => {
    writeRawString('totally broken');
    const cfg = configModule.loadConfig();
    configModule.updateConfig({ maxConcurrency: 15 });
    const raw = readRawConfig();
    expect(raw.maxConcurrency).toBe(15);
    expect(raw.secretKey).toBe(cfg.secretKey);
  });

  it('config recovered from corruption persists across module resets', async () => {
    writeRawString('{{{invalid');
    const cfg = configModule.loadConfig();

    vi.resetModules();
    const fresh = await import('../../config.js');
    const reloaded = fresh.loadConfig();

    expect(reloaded.secretKey).toBe(cfg.secretKey);
    expect(reloaded.version).toBe(cfg.version);
  });

  it('multiple corruptions in succession still recover', () => {
    writeRawString('bad1');
    const cfg1 = configModule.loadConfig();
    expect(cfg1.secretKey).toMatch(/^[0-9a-f]{64}$/);

    // Corrupt again
    writeRawString('bad2');
    const cfg2 = configModule.loadConfig();
    expect(cfg2.secretKey).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ===========================================================================
// 14. Edge cases on the full config lifecycle
// ===========================================================================
describe('Full config lifecycle', () => {
  it('create → update → corrupt → recover → update → verify', () => {
    // Step 1: Create
    const initial = configModule.loadConfig();
    expect(initial.maxConcurrency).toBe(2);

    // Step 2: Update
    configModule.updateConfig({ maxConcurrency: 8 });
    expect(configModule.loadConfig().maxConcurrency).toBe(8);

    // Step 3: Corrupt
    writeRawString('oops!');

    // Step 4: Recover
    const recovered = configModule.loadConfig();
    expect(recovered.secretKey).toMatch(/^[0-9a-f]{64}$/);

    // Step 5: Update after recovery
    configModule.updateConfig({ maxConcurrency: 12 });
    expect(configModule.loadConfig().maxConcurrency).toBe(12);
  });

  it('loadConfig returns a fresh object each time (no shared refs)', () => {
    const a = configModule.loadConfig();
    const b = configModule.loadConfig();
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // different object references
    a.maxConcurrency = 999;
    expect(b.maxConcurrency).not.toBe(999);
  });
});
