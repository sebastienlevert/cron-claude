/**
 * E2E tests for configuration management.
 *
 * Strategy: mock os.homedir() so that CONFIG_DIR / CONFIG_FILE resolve inside
 * a per-test temp directory. After each mock update we reset the module cache
 * and dynamically re-import config.ts so the module-level constants pick up
 * the new homedir.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ---------------------------------------------------------------------------
// Mock os.homedir() – vi.mock is hoisted so `testRoot` is set in beforeEach
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

function writeRawConfig(obj: Record<string, unknown>): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(configFile(), JSON.stringify(obj, null, 2), 'utf-8');
}

function readRawConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(configFile(), 'utf-8'));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
beforeEach(async () => {
  testRoot = mkdtempSync(join(tmpdir(), 'cron-agents-config-'));
  vi.resetModules();
  configModule = await import('../../config.js');
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

// ===========================================================================
// 1. First-time initialization
// ===========================================================================
describe('First-time initialization', () => {
  it('loadConfig creates config.json when none exists', () => {
    expect(existsSync(configFile())).toBe(false);
    configModule.loadConfig();
    expect(existsSync(configFile())).toBe(true);
  });

  it('created config has a 64-char hex secretKey', () => {
    const cfg = configModule.loadConfig();
    expect(cfg.secretKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('created config has version 0.1.0', () => {
    const cfg = configModule.loadConfig();
    expect(cfg.version).toBe('0.1.0');
  });

  it('created config has tasksDirs containing the default directory', () => {
    const cfg = configModule.loadConfig();
    const defaultDir = join(configDir(), 'tasks');
    expect(cfg.tasksDirs).toContain(defaultDir);
  });

  it('created config has logsDir pointing to the default directory', () => {
    const cfg = configModule.loadConfig();
    const defaultLogsDir = join(configDir(), 'logs');
    expect(cfg.logsDir).toBe(defaultLogsDir);
  });

  it('created config has maxConcurrency = 2', () => {
    const cfg = configModule.loadConfig();
    expect(cfg.maxConcurrency).toBe(2);
  });

  it('creates the .cron-agents directory if it does not exist', () => {
    expect(existsSync(configDir())).toBe(false);
    configModule.loadConfig();
    expect(existsSync(configDir())).toBe(true);
  });

  it('getConfigDir returns the expected path', () => {
    expect(configModule.getConfigDir()).toBe(configDir());
  });
});

// ===========================================================================
// 2. Loading existing config
// ===========================================================================
describe('Loading existing config', () => {
  const defaultTasksDir = () => join(configDir(), 'tasks');
  const defaultLogsDir = () => join(configDir(), 'logs');

  it('reads an existing config.json', () => {
    writeRawConfig({
      secretKey: 'a'.repeat(64),
      version: '1.2.3',
      tasksDirs: [defaultTasksDir()],
      logsDir: defaultLogsDir(),
      maxConcurrency: 5,
    });
    const cfg = configModule.loadConfig();
    expect(cfg.version).toBe('1.2.3');
  });

  it('preserves an existing secretKey', () => {
    const key = 'b'.repeat(64);
    writeRawConfig({
      secretKey: key,
      version: '0.1.0',
      tasksDirs: [defaultTasksDir()],
      logsDir: defaultLogsDir(),
      maxConcurrency: 2,
    });
    expect(configModule.loadConfig().secretKey).toBe(key);
  });

  it('preserves existing tasksDirs', () => {
    const dirs = [defaultTasksDir(), 'C:\\custom\\tasks'];
    writeRawConfig({
      secretKey: 'c'.repeat(64),
      version: '0.1.0',
      tasksDirs: dirs,
      logsDir: defaultLogsDir(),
      maxConcurrency: 2,
    });
    expect(configModule.loadConfig().tasksDirs).toEqual(dirs);
  });

  it('preserves existing logsDir', () => {
    const custom = 'D:\\custom\\logs';
    writeRawConfig({
      secretKey: 'd'.repeat(64),
      version: '0.1.0',
      tasksDirs: [defaultTasksDir()],
      logsDir: custom,
      maxConcurrency: 2,
    });
    expect(configModule.loadConfig().logsDir).toBe(custom);
  });

  it('preserves existing maxConcurrency', () => {
    writeRawConfig({
      secretKey: 'e'.repeat(64),
      version: '0.1.0',
      tasksDirs: [defaultTasksDir()],
      logsDir: defaultLogsDir(),
      maxConcurrency: 7,
    });
    expect(configModule.loadConfig().maxConcurrency).toBe(7);
  });

  it('generates secretKey when missing from file', () => {
    writeRawConfig({
      version: '0.1.0',
      tasksDirs: [defaultTasksDir()],
      logsDir: defaultLogsDir(),
      maxConcurrency: 2,
    });
    const cfg = configModule.loadConfig();
    expect(cfg.secretKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('defaults version to 0.1.0 when missing', () => {
    writeRawConfig({
      secretKey: 'f'.repeat(64),
      tasksDirs: [defaultTasksDir()],
      logsDir: defaultLogsDir(),
      maxConcurrency: 2,
    });
    expect(configModule.loadConfig().version).toBe('0.1.0');
  });

  it('defaults maxConcurrency to 2 when missing', () => {
    writeRawConfig({
      secretKey: 'a'.repeat(64),
      version: '0.1.0',
      tasksDirs: [defaultTasksDir()],
      logsDir: defaultLogsDir(),
    });
    expect(configModule.loadConfig().maxConcurrency).toBe(2);
  });
});

// ===========================================================================
// 3. Legacy migration
// ===========================================================================
describe('Legacy migration', () => {
  const defaultTasksDir = () => join(configDir(), 'tasks');
  const defaultLogsDir = () => join(configDir(), 'logs');

  it('migrates legacy tasksDir (string) to tasksDirs (array)', () => {
    writeRawConfig({
      secretKey: 'a'.repeat(64),
      version: '0.1.0',
      tasksDir: 'C:\\custom\\tasks',
      logsDir: defaultLogsDir(),
      maxConcurrency: 2,
    });
    const cfg = configModule.loadConfig();
    expect(Array.isArray(cfg.tasksDirs)).toBe(true);
    expect(cfg.tasksDirs).toContain('C:\\custom\\tasks');
  });

  it('legacy tasksDir equal to default results in single-entry array', () => {
    writeRawConfig({
      secretKey: 'a'.repeat(64),
      version: '0.1.0',
      tasksDir: defaultTasksDir(),
      logsDir: defaultLogsDir(),
      maxConcurrency: 2,
    });
    const cfg = configModule.loadConfig();
    expect(cfg.tasksDirs).toEqual([defaultTasksDir()]);
  });

  it('legacy custom tasksDir produces [default, custom]', () => {
    const custom = 'D:\\other\\tasks';
    writeRawConfig({
      secretKey: 'a'.repeat(64),
      version: '0.1.0',
      tasksDir: custom,
      logsDir: defaultLogsDir(),
      maxConcurrency: 2,
    });
    const cfg = configModule.loadConfig();
    expect(cfg.tasksDirs).toEqual([defaultTasksDir(), custom]);
  });

  it('does not migrate when tasksDirs already exists', () => {
    const dirs = [defaultTasksDir(), 'X:\\dirs'];
    writeRawConfig({
      secretKey: 'a'.repeat(64),
      version: '0.1.0',
      tasksDirs: dirs,
      logsDir: defaultLogsDir(),
      maxConcurrency: 2,
    });
    expect(configModule.loadConfig().tasksDirs).toEqual(dirs);
  });

  it('empty tasksDirs array receives the default', () => {
    writeRawConfig({
      secretKey: 'a'.repeat(64),
      version: '0.1.0',
      tasksDirs: [],
      logsDir: defaultLogsDir(),
      maxConcurrency: 2,
    });
    const cfg = configModule.loadConfig();
    expect(cfg.tasksDirs).toContain(defaultTasksDir());
  });

  it('default tasks dir is always included even if not stored', () => {
    writeRawConfig({
      secretKey: 'a'.repeat(64),
      version: '0.1.0',
      tasksDirs: ['Z:\\other'],
      logsDir: defaultLogsDir(),
      maxConcurrency: 2,
    });
    const cfg = configModule.loadConfig();
    expect(cfg.tasksDirs).toContain(defaultTasksDir());
  });

  it('legacy config without maxConcurrency defaults to 2', () => {
    writeRawConfig({
      secretKey: 'a'.repeat(64),
      version: '0.1.0',
      tasksDir: defaultTasksDir(),
      logsDir: defaultLogsDir(),
    });
    expect(configModule.loadConfig().maxConcurrency).toBe(2);
  });

  it('legacy config without logsDir gets the default', () => {
    writeRawConfig({
      secretKey: 'a'.repeat(64),
      version: '0.1.0',
      tasksDir: defaultTasksDir(),
    });
    expect(configModule.loadConfig().logsDir).toBe(defaultLogsDir());
  });
});

// ===========================================================================
// 4. maxConcurrency validation
// ===========================================================================
describe('maxConcurrency validation', () => {
  const base = () => ({
    secretKey: 'a'.repeat(64),
    version: '0.1.0',
    tasksDirs: [join(configDir(), 'tasks')],
    logsDir: join(configDir(), 'logs'),
  });

  it('preserves maxConcurrency = 1', () => {
    writeRawConfig({ ...base(), maxConcurrency: 1 });
    expect(configModule.loadConfig().maxConcurrency).toBe(1);
  });

  it('preserves maxConcurrency = 10', () => {
    writeRawConfig({ ...base(), maxConcurrency: 10 });
    expect(configModule.loadConfig().maxConcurrency).toBe(10);
  });

  it('defaults maxConcurrency 0 to 2', () => {
    writeRawConfig({ ...base(), maxConcurrency: 0 });
    expect(configModule.loadConfig().maxConcurrency).toBe(2);
  });

  it('defaults maxConcurrency -1 to 2', () => {
    writeRawConfig({ ...base(), maxConcurrency: -1 });
    expect(configModule.loadConfig().maxConcurrency).toBe(2);
  });

  it('defaults non-numeric maxConcurrency to 2', () => {
    writeRawConfig({ ...base(), maxConcurrency: 'abc' });
    expect(configModule.loadConfig().maxConcurrency).toBe(2);
  });
});

// ===========================================================================
// 5. updateConfig
// ===========================================================================
describe('updateConfig', () => {
  it('updates maxConcurrency and persists it', () => {
    configModule.loadConfig(); // ensure file exists
    configModule.updateConfig({ maxConcurrency: 8 });
    const raw = readRawConfig();
    expect(raw.maxConcurrency).toBe(8);
  });

  it('updates logsDir and persists it', () => {
    configModule.loadConfig();
    const custom = 'E:\\newlogs';
    configModule.updateConfig({ logsDir: custom });
    expect(readRawConfig().logsDir).toBe(custom);
  });

  it('preserves unrelated fields during update', () => {
    configModule.loadConfig();
    const before = readRawConfig();
    const originalKey = before.secretKey;
    configModule.updateConfig({ maxConcurrency: 4 });
    const after = readRawConfig();
    expect(after.secretKey).toBe(originalKey);
    expect(after.version).toBe(before.version);
  });

  it('applies multiple updates sequentially', () => {
    configModule.loadConfig();
    configModule.updateConfig({ maxConcurrency: 3 });
    configModule.updateConfig({ logsDir: 'F:\\logs' });
    const raw = readRawConfig();
    expect(raw.maxConcurrency).toBe(3);
    expect(raw.logsDir).toBe('F:\\logs');
  });

  it('creates config file via loadConfig if it is missing', () => {
    // updateConfig calls loadConfig internally
    configModule.updateConfig({ maxConcurrency: 6 });
    expect(existsSync(configFile())).toBe(true);
    expect(readRawConfig().maxConcurrency).toBe(6);
  });
});

// ===========================================================================
// 6. getSecretKey
// ===========================================================================
describe('getSecretKey', () => {
  it('returns a 64-char hex string', () => {
    const key = configModule.getSecretKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns a consistent value across multiple calls', () => {
    const a = configModule.getSecretKey();
    const b = configModule.getSecretKey();
    expect(a).toBe(b);
  });

  it('generates a key on first load when config is missing', () => {
    expect(existsSync(configFile())).toBe(false);
    const key = configModule.getSecretKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    // Now the file should exist
    expect(existsSync(configFile())).toBe(true);
  });
});

// ===========================================================================
// 7. Persistence / reload
// ===========================================================================
describe('Persistence and reload', () => {
  it('config survives save → module reset → reload', async () => {
    const original = configModule.loadConfig();

    // Reset module cache and re-import
    vi.resetModules();
    const fresh = await import('../../config.js');
    const reloaded = fresh.loadConfig();

    expect(reloaded.secretKey).toBe(original.secretKey);
    expect(reloaded.version).toBe(original.version);
    expect(reloaded.tasksDirs).toEqual(original.tasksDirs);
    expect(reloaded.logsDir).toBe(original.logsDir);
    expect(reloaded.maxConcurrency).toBe(original.maxConcurrency);
  });

  it('config file is valid JSON', () => {
    configModule.loadConfig();
    const raw = readFileSync(configFile(), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('config file is pretty-printed with 2-space indent', () => {
    configModule.loadConfig();
    const raw = readFileSync(configFile(), 'utf-8');
    const parsed = JSON.parse(raw);
    const expected = JSON.stringify(parsed, null, 2);
    expect(raw).toBe(expected);
  });

  it('corrupt config file → loadConfig throws (invalid JSON)', () => {
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(configFile(), '{{not json!!', 'utf-8');
    expect(() => configModule.loadConfig()).toThrow();
  });

  it('config survives multiple load/update cycles', () => {
    configModule.loadConfig();
    configModule.updateConfig({ maxConcurrency: 3 });
    configModule.updateConfig({ logsDir: 'G:\\cycle-logs' });

    const cfg = configModule.loadConfig();
    expect(cfg.maxConcurrency).toBe(3);
    expect(cfg.logsDir).toBe('G:\\cycle-logs');

    configModule.updateConfig({ maxConcurrency: 9 });
    const cfg2 = configModule.loadConfig();
    expect(cfg2.maxConcurrency).toBe(9);
    expect(cfg2.logsDir).toBe('G:\\cycle-logs');
    expect(cfg2.secretKey).toBe(cfg.secretKey);
  });
});
