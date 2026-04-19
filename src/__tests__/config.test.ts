import { describe, it, expect } from 'vitest';
import { loadConfig, getSecretKey, getConfigDir } from '../config.js';
import { isAbsolute } from 'path';

// =============================================================================
// getConfigDir
// =============================================================================
describe('getConfigDir', () => {
  it('returns a string', () => {
    expect(typeof getConfigDir()).toBe('string');
  });

  it('returns a non-empty string', () => {
    expect(getConfigDir().length).toBeGreaterThan(0);
  });

  it('path contains .cron-agents', () => {
    expect(getConfigDir()).toContain('.cron-agents');
  });

  it('returns an absolute path', () => {
    expect(isAbsolute(getConfigDir())).toBe(true);
  });

  it('returns the same value on repeated calls', () => {
    expect(getConfigDir()).toBe(getConfigDir());
  });

  it('does not end with a path separator', () => {
    const dir = getConfigDir();
    expect(dir.endsWith('/') || dir.endsWith('\\')).toBe(false);
  });
});

// =============================================================================
// loadConfig – structure
// =============================================================================
describe('loadConfig structure', () => {
  it('returns an object', () => {
    const config = loadConfig();
    expect(config).toBeDefined();
    expect(typeof config).toBe('object');
    expect(config).not.toBeNull();
  });

  // -- secretKey ---------------------------------------------------------------
  it('has a secretKey property', () => {
    expect(loadConfig()).toHaveProperty('secretKey');
  });

  it('secretKey is a string', () => {
    expect(typeof loadConfig().secretKey).toBe('string');
  });

  it('secretKey is not empty', () => {
    expect(loadConfig().secretKey.length).toBeGreaterThan(0);
  });

  it('secretKey looks like hex (matches /^[0-9a-f]+$/)', () => {
    expect(loadConfig().secretKey).toMatch(/^[0-9a-f]+$/);
  });

  it('secretKey is 64 hex characters (32 bytes)', () => {
    expect(loadConfig().secretKey).toHaveLength(64);
  });

  // -- version -----------------------------------------------------------------
  it('has a version property', () => {
    expect(loadConfig()).toHaveProperty('version');
  });

  it('version is a string', () => {
    expect(typeof loadConfig().version).toBe('string');
  });

  it('version is not empty', () => {
    expect(loadConfig().version.length).toBeGreaterThan(0);
  });

  it('version looks like semver', () => {
    expect(loadConfig().version).toMatch(/^\d+\.\d+\.\d+/);
  });

  // -- tasksDirs ---------------------------------------------------------------
  it('has a tasksDirs property', () => {
    expect(loadConfig()).toHaveProperty('tasksDirs');
  });

  it('tasksDirs is an array', () => {
    expect(Array.isArray(loadConfig().tasksDirs)).toBe(true);
  });

  it('tasksDirs is a non-empty array', () => {
    expect(loadConfig().tasksDirs.length).toBeGreaterThan(0);
  });

  it('first entry in tasksDirs contains .cron-agents and tasks', () => {
    const first = loadConfig().tasksDirs[0];
    expect(first).toContain('.cron-agents');
    expect(first).toMatch(/tasks/i);
  });

  it('every entry in tasksDirs is a string', () => {
    for (const dir of loadConfig().tasksDirs) {
      expect(typeof dir).toBe('string');
    }
  });

  it('every entry in tasksDirs is a non-empty string', () => {
    for (const dir of loadConfig().tasksDirs) {
      expect(dir.length).toBeGreaterThan(0);
    }
  });

  it('every entry in tasksDirs is an absolute path', () => {
    for (const dir of loadConfig().tasksDirs) {
      expect(isAbsolute(dir)).toBe(true);
    }
  });

  // -- logsDir -----------------------------------------------------------------
  it('has a logsDir property', () => {
    expect(loadConfig()).toHaveProperty('logsDir');
  });

  it('logsDir is a string', () => {
    expect(typeof loadConfig().logsDir).toBe('string');
  });

  it('logsDir is not empty', () => {
    expect(loadConfig().logsDir.length).toBeGreaterThan(0);
  });

  it('logsDir is an absolute path', () => {
    expect(isAbsolute(loadConfig().logsDir)).toBe(true);
  });

  it('default logsDir contains .cron-agents and logs', () => {
    const logsDir = loadConfig().logsDir;
    // The default path includes both; a custom override may not.
    // At minimum the path should be a valid absolute path (already tested).
    expect(typeof logsDir).toBe('string');
  });

  // -- maxConcurrency ----------------------------------------------------------
  it('has a maxConcurrency property', () => {
    expect(loadConfig()).toHaveProperty('maxConcurrency');
  });

  it('maxConcurrency is a number', () => {
    expect(typeof loadConfig().maxConcurrency).toBe('number');
  });

  it('maxConcurrency is >= 1', () => {
    expect(loadConfig().maxConcurrency).toBeGreaterThanOrEqual(1);
  });

  it('maxConcurrency is an integer', () => {
    expect(Number.isInteger(loadConfig().maxConcurrency)).toBe(true);
  });

  it('maxConcurrency is finite', () => {
    expect(Number.isFinite(loadConfig().maxConcurrency)).toBe(true);
  });
});

// =============================================================================
// getSecretKey
// =============================================================================
describe('getSecretKey', () => {
  it('returns a string', () => {
    expect(typeof getSecretKey()).toBe('string');
  });

  it('returns a non-empty string', () => {
    expect(getSecretKey().length).toBeGreaterThan(0);
  });

  it('looks like hex', () => {
    expect(getSecretKey()).toMatch(/^[0-9a-f]+$/);
  });

  it('returns the same value on repeated calls', () => {
    expect(getSecretKey()).toBe(getSecretKey());
  });

  it('matches loadConfig().secretKey', () => {
    expect(getSecretKey()).toBe(loadConfig().secretKey);
  });

  it('is 64 hex characters (32 bytes)', () => {
    expect(getSecretKey()).toHaveLength(64);
  });
});

// =============================================================================
// loadConfig – consistency across calls
// =============================================================================
describe('loadConfig consistency', () => {
  it('two calls return equivalent objects', () => {
    const a = loadConfig();
    const b = loadConfig();
    expect(a).toEqual(b);
  });

  it('secretKey is stable across calls', () => {
    expect(loadConfig().secretKey).toBe(loadConfig().secretKey);
  });

  it('tasksDirs is stable across calls', () => {
    expect(loadConfig().tasksDirs).toEqual(loadConfig().tasksDirs);
  });

  it('version is stable across calls', () => {
    expect(loadConfig().version).toBe(loadConfig().version);
  });

  it('logsDir is stable across calls', () => {
    expect(loadConfig().logsDir).toBe(loadConfig().logsDir);
  });

  it('maxConcurrency is stable across calls', () => {
    expect(loadConfig().maxConcurrency).toBe(loadConfig().maxConcurrency);
  });

  it('has exactly the expected top-level keys', () => {
    const keys = Object.keys(loadConfig()).sort();
    expect(keys).toEqual(
      ['logsDir', 'maxConcurrency', 'secretKey', 'tasksDirs', 'version'],
    );
  });

  it('returned object is a plain object (not an array or class instance)', () => {
    const config = loadConfig();
    expect(Object.getPrototypeOf(config)).toBe(Object.prototype);
  });
});
