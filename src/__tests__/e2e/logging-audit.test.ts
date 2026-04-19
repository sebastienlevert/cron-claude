/**
 * E2E tests for the audit logging system.
 *
 * Uses REAL logger.ts (file-based) with temp directories.
 * Each test creates fresh temp dirs for isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import type { TaskLog } from '../../types.js';

// ─── Mock config.ts to point at temp dirs with a test secret key ────────────

// Hoist mock state so it's shared between the mock factory and tests
const mockState = vi.hoisted(() => ({
  config: null as any,
  configDir: '' as string,
}));

vi.mock('../../config.js', () => ({
  loadConfig: () => mockState.config,
  getConfigDir: () => mockState.configDir,
  getSecretKey: () => mockState.config?.secretKey || 'test-key',
  updateConfig: () => {},
}));

import {
  signContent,
  verifySignature,
  formatTaskLog,
  saveLog,
  verifyLogFile,
  createLog,
  addLogStep,
  finalizeLog,
} from '../../logger.js';

import {
  createTestDirs,
  cleanupTestDirs,
  writeTestConfig,
  writeFakeLogFile,
  type TestDirs,
} from './helpers.js';

// ─── Per-test setup / teardown ──────────────────────────────────────────────

let dirs: TestDirs;
let config: ReturnType<typeof writeTestConfig>;

beforeEach(() => {
  dirs = createTestDirs();
  config = writeTestConfig(dirs);
  mockState.config = config;
  mockState.configDir = dirs.configDir;
});

afterEach(() => {
  cleanupTestDirs(dirs);
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeLog(overrides: Partial<TaskLog> = {}): TaskLog {
  return {
    taskId: 'test-task',
    executionId: 'exec-1234567890-abc123def',
    timestamp: '2024-02-17T10:30:00.000Z',
    status: 'success',
    steps: [],
    ...overrides,
  };
}

/** List all .md files in the logs dir, sorted by name */
function listLogFiles(): string[] {
  if (!existsSync(dirs.logsDir)) return [];
  return readdirSync(dirs.logsDir)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

// ===========================================================================
// 1. Log creation lifecycle (~10 tests)
// ===========================================================================
describe('Log creation lifecycle', () => {
  it('createLog returns TaskLog with correct taskId', () => {
    const log = createLog('my-task');
    expect(log.taskId).toBe('my-task');
  });

  it('createLog generates a unique executionId per call', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createLog('t').executionId));
    expect(ids.size).toBe(50);
  });

  it('createLog timestamp is a valid ISO string', () => {
    const log = createLog('t');
    const d = new Date(log.timestamp);
    expect(d.toISOString()).toBe(log.timestamp);
  });

  it('createLog initial status is "running"', () => {
    expect(createLog('t').status).toBe('running');
  });

  it('createLog steps is an empty array', () => {
    expect(createLog('t').steps).toEqual([]);
  });

  it('addLogStep appends a step with a timestamp', () => {
    const log = createLog('t');
    addLogStep(log, 'Initialize');
    expect(log.steps).toHaveLength(1);
    expect(new Date(log.steps[0].timestamp).toISOString()).toBe(log.steps[0].timestamp);
  });

  it('addLogStep with output stores output', () => {
    const log = createLog('t');
    addLogStep(log, 'Run', 'stdout data');
    expect(log.steps[0].output).toBe('stdout data');
  });

  it('addLogStep with error stores error', () => {
    const log = createLog('t');
    addLogStep(log, 'Fail', undefined, 'something broke');
    expect(log.steps[0].error).toBe('something broke');
  });

  it('addLogStep multiple times preserves all steps in order', () => {
    const log = createLog('t');
    addLogStep(log, 'A');
    addLogStep(log, 'B');
    addLogStep(log, 'C');
    expect(log.steps.map((s) => s.action)).toEqual(['A', 'B', 'C']);
  });

  it('addLogStep each step gets its own timestamp', async () => {
    const log = createLog('t');
    addLogStep(log, 'First');
    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 5));
    addLogStep(log, 'Second');
    // Timestamps should both be valid; may or may not differ depending on resolution
    expect(log.steps[0].timestamp).toBeTruthy();
    expect(log.steps[1].timestamp).toBeTruthy();
    // Both are valid ISO strings
    expect(new Date(log.steps[0].timestamp).toISOString()).toBe(log.steps[0].timestamp);
    expect(new Date(log.steps[1].timestamp).toISOString()).toBe(log.steps[1].timestamp);
  });
});

// ===========================================================================
// 2. Log formatting (~8 tests)
// ===========================================================================
describe('Log formatting', () => {
  it('formatTaskLog output contains YAML frontmatter', () => {
    const result = formatTaskLog(makeLog());
    expect(result).toMatch(/^---\n/);
    expect(result).toMatch(/\n---\n/);
  });

  it('formatTaskLog frontmatter has taskId, executionId, timestamp, status', () => {
    const log = makeLog({
      taskId: 'fmt-task',
      executionId: 'exec-fmt-001',
      timestamp: '2024-06-01T12:00:00.000Z',
      status: 'failure',
    });
    const result = formatTaskLog(log);
    expect(result).toContain('taskId: fmt-task');
    expect(result).toContain('executionId: exec-fmt-001');
    expect(result).toContain('2024-06-01T12:00:00.000Z');
    expect(result).toContain('status: failure');
  });

  it('formatTaskLog frontmatter has signature field', () => {
    const result = formatTaskLog(makeLog());
    expect(result).toMatch(/signature: [0-9a-f]{64}/);
  });

  it('formatTaskLog body has markdown heading "# Task Execution Log"', () => {
    const result = formatTaskLog(makeLog({ taskId: 'heading-test' }));
    expect(result).toContain('# Task Execution Log: heading-test');
  });

  it('formatTaskLog body includes each step as numbered heading', () => {
    const log = makeLog({
      steps: [
        { timestamp: '2024-01-01T00:00:00Z', action: 'Alpha' },
        { timestamp: '2024-01-01T00:01:00Z', action: 'Beta' },
      ],
    });
    const result = formatTaskLog(log);
    expect(result).toContain('### Step 1: Alpha');
    expect(result).toContain('### Step 2: Beta');
  });

  it('formatTaskLog step output shown in code block', () => {
    const log = makeLog({
      steps: [{ timestamp: '2024-01-01T00:00:00Z', action: 'Run', output: 'all good' }],
    });
    const result = formatTaskLog(log);
    expect(result).toContain('```\nall good\n```');
  });

  it('formatTaskLog step error shown in code block', () => {
    const log = makeLog({
      steps: [{ timestamp: '2024-01-01T00:00:00Z', action: 'Crash', error: 'segfault' }],
    });
    const result = formatTaskLog(log);
    expect(result).toContain('```\nsegfault\n```');
  });

  it('formatTaskLog summary section with step count and status', () => {
    const log = makeLog({
      status: 'success',
      steps: [
        { timestamp: '2024-01-01T00:00:00Z', action: 'A' },
        { timestamp: '2024-01-01T00:01:00Z', action: 'B' },
      ],
    });
    const result = formatTaskLog(log);
    expect(result).toContain('## Summary');
    expect(result).toContain('Total steps: 2');
    expect(result).toContain('Status: success');
  });
});

// ===========================================================================
// 3. Log saving (~8 tests)
// ===========================================================================
describe('Log saving', () => {
  it('saveLog creates a file in logsDir', () => {
    saveLog(makeLog());
    expect(listLogFiles().length).toBe(1);
  });

  it('saveLog filename format: {taskId}_{timestamp}_{executionId}.md', () => {
    const log = makeLog({ taskId: 'save-task', executionId: 'exec-save-001' });
    saveLog(log);
    const files = listLogFiles();
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^save-task_.*_exec-save-001\.md$/);
  });

  it('saveLog file content matches formatTaskLog output', () => {
    const log = makeLog();
    const logPath = saveLog(log);
    const fileContent = readFileSync(logPath, 'utf-8');
    const formatted = formatTaskLog(log);
    expect(fileContent).toBe(formatted);
  });

  it('saveLog returns an absolute file path', () => {
    const logPath = saveLog(makeLog());
    // On Windows absolute paths start with drive letter; on POSIX with /
    expect(logPath).toMatch(/^([A-Z]:\\|\/)/i);
  });

  it('saveLog creates logsDir if it does not exist', () => {
    // Point logsDir to a non-existent subdirectory
    const newLogsDir = join(dirs.root, 'new-logs-subdir');
    const newConfig = { ...config, logsDir: newLogsDir };
    mockState.config = newConfig;
    mockState.configDir = dirs.configDir;

    saveLog(makeLog());
    expect(existsSync(newLogsDir)).toBe(true);
    const files = readdirSync(newLogsDir).filter((f) => f.endsWith('.md'));
    expect(files.length).toBe(1);

    // Restore original config
    mockState.config = config;
    mockState.configDir = dirs.configDir;
  });

  it('finalizeLog with success sets status to "success"', () => {
    const log = createLog('fin-task');
    addLogStep(log, 'work');
    finalizeLog(log, true);
    expect(log.status).toBe('success');
  });

  it('finalizeLog with failure sets status to "failure"', () => {
    const log = createLog('fin-task');
    addLogStep(log, 'fail');
    finalizeLog(log, false);
    expect(log.status).toBe('failure');
  });

  it('multiple saves each create a separate file', () => {
    saveLog(makeLog({ taskId: 'multi-1', executionId: 'exec-m1' }));
    saveLog(makeLog({ taskId: 'multi-2', executionId: 'exec-m2' }));
    saveLog(makeLog({ taskId: 'multi-3', executionId: 'exec-m3' }));
    expect(listLogFiles().length).toBe(3);
  });
});

// ===========================================================================
// 4. Signature verification — valid cases (~8 tests)
// ===========================================================================
describe('Signature verification — valid cases', () => {
  const KEY = config?.secretKey || 'e2e-test-secret-key-0123456789abcdef0123456789abcdef';

  it('signContent returns a hex string', () => {
    const sig = signContent('hello', KEY);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signContent same content + same key → same signature', () => {
    const a = signContent('data', KEY);
    const b = signContent('data', KEY);
    expect(a).toBe(b);
  });

  it('signContent different content → different signature', () => {
    const a = signContent('alpha', KEY);
    const b = signContent('bravo', KEY);
    expect(a).not.toBe(b);
  });

  it('signContent different key → different signature', () => {
    const a = signContent('data', 'key-one');
    const b = signContent('data', 'key-two');
    expect(a).not.toBe(b);
  });

  it('verifySignature correct signature → true', () => {
    const sig = signContent('payload', KEY);
    expect(verifySignature('payload', sig, KEY)).toBe(true);
  });

  it('verifySignature wrong signature → false', () => {
    const sig = signContent('payload', KEY);
    expect(verifySignature('payload', 'a'.repeat(64), KEY)).toBe(false);
  });

  it('verifyLogFile on saveLog output → valid=true', () => {
    const log = makeLog();
    const logPath = saveLog(log);
    const content = readFileSync(logPath, 'utf-8');
    const result = verifyLogFile(content);
    expect(result.valid).toBe(true);
  });

  it('full lifecycle: createLog → addSteps → finalizeLog → read → verifyLogFile → valid', () => {
    const log = createLog('lifecycle-task');
    addLogStep(log, 'Step one', 'output one');
    addLogStep(log, 'Step two', undefined, 'error two');
    addLogStep(log, 'Step three', 'output three');
    const logPath = finalizeLog(log, true);

    const content = readFileSync(logPath, 'utf-8');
    const result = verifyLogFile(content);
    expect(result.valid).toBe(true);
    expect(result.log?.taskId).toBe('lifecycle-task');
    expect(result.log?.status).toBe('success');
  });
});

// ===========================================================================
// 5. Signature verification — tampering (~10 tests)
// ===========================================================================
describe('Signature verification — tampering', () => {
  it('tamper body text → verification fails', () => {
    const log = makeLog();
    const md = formatTaskLog(log);
    const tampered = md + '\nTAMPERED CONTENT';
    expect(verifyLogFile(tampered).valid).toBe(false);
  });

  it('tamper signature hex → verification fails', () => {
    const log = makeLog();
    const md = formatTaskLog(log);
    const tampered = md.replace(/signature: [0-9a-f]{64}/, 'signature: ' + '0'.repeat(64));
    expect(verifyLogFile(tampered).valid).toBe(false);
  });

  it('remove signature from frontmatter → error "No signature found"', () => {
    const md = '---\ntaskId: t\nexecutionId: e\ntimestamp: ts\nstatus: success\n---\nBody\n';
    const result = verifyLogFile(md);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('No signature');
  });

  it('tamper body then re-sign with wrong key → fails', () => {
    const log = makeLog();
    const md = formatTaskLog(log);
    const parsed = matter(md);

    // Tamper body and re-sign with a different key
    const tamperedBody = parsed.content + '\nEXTRA';
    const wrongKeySig = signContent(tamperedBody, 'wrong-key-entirely');
    // Use a cloned data object to avoid mutating gray-matter's internal reference
    const tamperedData = { ...parsed.data, signature: wrongKeySig };

    const rebuilt = matter.stringify(tamperedBody, tamperedData);
    expect(verifyLogFile(rebuilt).valid).toBe(false);
  });

  it('log with empty steps list → formatTaskLog + verifyLogFile round-trips', () => {
    // A log with zero steps still produces valid signed content
    const log = makeLog({ steps: [] });
    const md = formatTaskLog(log);
    // Read back and verify - use the file written by saveLog for full round-trip
    const logPath = saveLog(log);
    const fromFile = readFileSync(logPath, 'utf-8');
    // Both the in-memory and from-file versions should verify
    expect(verifyLogFile(md).valid).toBe(true);
    expect(verifyLogFile(fromFile).valid).toBe(true);
  });

  // ──── CRITICAL BUG TESTS ────────────────────────────────────────────────
  // The signature is computed over parsed.content (markdown body) only,
  // NOT the frontmatter. Modifying frontmatter while keeping the body
  // unchanged will pass verification. These tests document this gap.

  it('BUG: tampered frontmatter taskId still passes verification (body-only signing)', () => {
    const log = makeLog({ taskId: 'original-task' });
    const md = formatTaskLog(log);

    // Tamper the taskId in frontmatter only
    const tampered = md.replace('taskId: original-task', 'taskId: attacker-task');
    const result = verifyLogFile(tampered);

    // This SHOULD fail but PASSES because the signature only covers the body
    expect(result.valid).toBe(true);
    // The returned log has the tampered taskId
    expect(result.log?.taskId).toBe('attacker-task');
  });

  it('BUG: tampered frontmatter status still passes verification (body-only signing)', () => {
    const log = makeLog({ status: 'failure' });
    const md = formatTaskLog(log);

    // Tamper the status in frontmatter from 'failure' to 'success'
    const parsed = matter(md);
    const tamperedData = { ...parsed.data, status: 'success' };
    const tampered = matter.stringify(parsed.content, tamperedData);

    const result = verifyLogFile(tampered);

    // This SHOULD fail but PASSES because the signature only covers the body
    expect(result.valid).toBe(true);
    // The returned log has the tampered status
    expect(result.log?.status).toBe('success');
  });

  it('BUG: tampered frontmatter timestamp still passes verification (body-only signing)', () => {
    const log = makeLog({ timestamp: '2024-02-17T10:30:00.000Z' });
    const md = formatTaskLog(log);

    // Tamper the timestamp in frontmatter using string replacement to avoid gray-matter whitespace issues
    const tampered = md.replace(
      /timestamp: .*$/m,
      "timestamp: '1999-01-01T00:00:00.000Z'",
    );

    const result = verifyLogFile(tampered);

    // This SHOULD fail but PASSES because the signature only covers the body
    expect(result.valid).toBe(true);
    expect(result.log?.timestamp).toBe('1999-01-01T00:00:00.000Z');
  });

  it('add extra frontmatter field → verification still passes (body unchanged)', () => {
    const log = makeLog();
    const md = formatTaskLog(log);

    // Insert an extra field in frontmatter using string replacement
    // This avoids gray-matter re-stringify whitespace changes
    const modified = md.replace(
      /^(---\n)/,
      '---\nextraField: injected-value\n',
    );

    // Verify it's still parseable and valid (body unchanged)
    const parsed = matter(modified);
    expect(parsed.data.extraField).toBe('injected-value');
    expect(verifyLogFile(modified).valid).toBe(true);
  });

  it('remove entire body → verification fails (different content)', () => {
    const log = makeLog();
    const md = formatTaskLog(log);

    // Keep frontmatter, remove body
    const parsed = matter(md);
    const emptyBody = matter.stringify('', parsed.data);

    expect(verifyLogFile(emptyBody).valid).toBe(false);
  });
});

// ===========================================================================
// 6. Log viewing (file listing) (~5 tests)
// ===========================================================================
describe('Log viewing (file listing)', () => {
  it('multiple log files for same task → all found in logsDir', () => {
    writeFakeLogFile(dirs.logsDir, 'multi-task', { executionId: 'exec-a' });
    writeFakeLogFile(dirs.logsDir, 'multi-task', { executionId: 'exec-b' });
    writeFakeLogFile(dirs.logsDir, 'multi-task', { executionId: 'exec-c' });

    const files = listLogFiles().filter((f) => f.startsWith('multi-task'));
    expect(files.length).toBe(3);
  });

  it('logs sorted chronologically by filename', () => {
    writeFakeLogFile(dirs.logsDir, 'sort-task', {
      executionId: 'exec-1',
      timestamp: '2024-01-01T10:00:00.000Z',
    });
    writeFakeLogFile(dirs.logsDir, 'sort-task', {
      executionId: 'exec-2',
      timestamp: '2024-01-02T10:00:00.000Z',
    });
    writeFakeLogFile(dirs.logsDir, 'sort-task', {
      executionId: 'exec-3',
      timestamp: '2024-01-03T10:00:00.000Z',
    });

    const files = listLogFiles().filter((f) => f.startsWith('sort-task'));
    expect(files.length).toBe(3);
    // Filenames embed timestamp, so lexicographic sort = chronological
    expect(files[0]).toContain('exec-1');
    expect(files[2]).toContain('exec-3');
  });

  it('log files from different tasks → filterable by prefix', () => {
    writeFakeLogFile(dirs.logsDir, 'task-alpha', { executionId: 'exec-a1' });
    writeFakeLogFile(dirs.logsDir, 'task-beta', { executionId: 'exec-b1' });
    writeFakeLogFile(dirs.logsDir, 'task-alpha', { executionId: 'exec-a2' });

    const alphaFiles = listLogFiles().filter((f) => f.startsWith('task-alpha'));
    const betaFiles = listLogFiles().filter((f) => f.startsWith('task-beta'));
    expect(alphaFiles.length).toBe(2);
    expect(betaFiles.length).toBe(1);
  });

  it('log frontmatter parseable with gray-matter', () => {
    const logPath = writeFakeLogFile(dirs.logsDir, 'parseable-task');
    const content = readFileSync(logPath, 'utf-8');
    const parsed = matter(content);

    expect(parsed.data.taskId).toBe('parseable-task');
    expect(parsed.data.signature).toBeTruthy();
    expect(parsed.content).toContain('# Task Execution Log');
  });

  it('each log has correct category: "cron-task"', () => {
    const logPath = writeFakeLogFile(dirs.logsDir, 'cat-task');
    const content = readFileSync(logPath, 'utf-8');
    const parsed = matter(content);
    expect(parsed.data.category).toBe('cron-task');
  });
});

// ===========================================================================
// 7. Edge cases (~5 tests)
// ===========================================================================
describe('Edge cases', () => {
  it('very long output in log step is stored fully', () => {
    const longOutput = 'x'.repeat(100_000);
    const log = makeLog({
      steps: [{ timestamp: '2024-01-01T00:00:00Z', action: 'BigOutput', output: longOutput }],
    });
    const md = formatTaskLog(log);
    expect(md).toContain(longOutput);

    // Also verify the saved file
    const logPath = saveLog(log);
    const content = readFileSync(logPath, 'utf-8');
    expect(content).toContain(longOutput);
  });

  it('special characters in instructions/output are preserved in log', () => {
    const specialChars = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~';
    const log = makeLog({
      steps: [
        { timestamp: '2024-01-01T00:00:00Z', action: 'SpecialChars', output: specialChars },
      ],
    });
    const logPath = saveLog(log);
    const content = readFileSync(logPath, 'utf-8');
    expect(content).toContain(specialChars);
  });

  it('log with no steps → still valid format and verifiable', () => {
    const log = makeLog({ steps: [] });
    const logPath = saveLog(log);
    const content = readFileSync(logPath, 'utf-8');
    expect(content).toContain('Total steps: 0');

    const result = verifyLogFile(content);
    expect(result.valid).toBe(true);
  });

  it('multiple rapid log creations → unique filenames (no collision)', () => {
    const paths: string[] = [];
    for (let i = 0; i < 20; i++) {
      const log = createLog(`rapid-task-${i}`);
      addLogStep(log, 'work');
      paths.push(finalizeLog(log, true));
    }
    // All paths should be unique
    const uniquePaths = new Set(paths);
    expect(uniquePaths.size).toBe(20);
  });

  it('log with unicode content → signature still works', () => {
    const log = makeLog({
      taskId: 'unicode-task',
      steps: [
        {
          timestamp: '2024-01-01T00:00:00Z',
          action: '日本語テスト 🚀',
          output: 'Ñoño résulté — «success» 🎉',
        },
      ],
    });
    const logPath = saveLog(log);
    const content = readFileSync(logPath, 'utf-8');

    expect(content).toContain('日本語テスト 🚀');
    expect(content).toContain('Ñoño résulté — «success» 🎉');

    const result = verifyLogFile(content);
    expect(result.valid).toBe(true);
  });
});

// ===========================================================================
// 8. Additional coverage — full integration round-trips
// ===========================================================================
describe('Full integration round-trips', () => {
  it('createLog → multiple addLogStep → finalizeLog(true) → verifyLogFile', () => {
    const log = createLog('round-trip-success');
    addLogStep(log, 'Initialize environment');
    addLogStep(log, 'Run build', 'Build succeeded');
    addLogStep(log, 'Run tests', 'All 42 tests passed');
    const logPath = finalizeLog(log, true);

    const content = readFileSync(logPath, 'utf-8');
    const result = verifyLogFile(content);
    expect(result.valid).toBe(true);
    expect(result.log?.taskId).toBe('round-trip-success');
    expect(result.log?.status).toBe('success');
  });

  it('createLog → addLogStep with error → finalizeLog(false) → verifyLogFile', () => {
    const log = createLog('round-trip-failure');
    addLogStep(log, 'Initialize');
    addLogStep(log, 'Run deploy', undefined, 'Connection refused');
    const logPath = finalizeLog(log, false);

    const content = readFileSync(logPath, 'utf-8');
    const result = verifyLogFile(content);
    expect(result.valid).toBe(true);
    expect(result.log?.status).toBe('failure');
  });

  it('saveLog twice with same log object → two distinct files', () => {
    const log = makeLog({ taskId: 'dup-save' });
    const p1 = saveLog(log);
    const p2 = saveLog(log);
    expect(p1).not.toBe(p2);
    expect(listLogFiles().filter((f) => f.startsWith('dup-save')).length).toBe(2);
  });

  it('formatTaskLog → parse with gray-matter → content matches re-signing', () => {
    const log = makeLog({
      steps: [{ timestamp: '2024-01-01T00:00:00Z', action: 'Test', output: 'ok' }],
    });
    const md = formatTaskLog(log);
    const parsed = matter(md);

    // Re-sign the content portion and verify it matches the embedded signature
    const reSigned = signContent(parsed.content);
    expect(reSigned).toBe(parsed.data.signature);
  });

  it('writeFakeLogFile produces verifiable logs', () => {
    const logPath = writeFakeLogFile(dirs.logsDir, 'fake-task');
    const content = readFileSync(logPath, 'utf-8');
    // Fake logs use the same secret key as the test config
    const result = verifyLogFile(content);
    expect(result.valid).toBe(true);
    expect(result.log?.taskId).toBe('fake-task');
  });

  it('finalizeLog returns the same path that saveLog would write to', () => {
    const log = createLog('finalize-path-test');
    addLogStep(log, 'work');
    const path = finalizeLog(log, true);
    expect(existsSync(path)).toBe(true);
    expect(path).toContain('finalize-path-test');
  });

  it('log file content round-trips through read/verify without corruption', () => {
    const log = createLog('corruption-test');
    addLogStep(log, 'Step with newlines', 'line1\nline2\nline3');
    addLogStep(log, 'Step with tabs', 'col1\tcol2\tcol3');
    const path = finalizeLog(log, true);

    // Read the file back, verify, re-read and verify again
    const content1 = readFileSync(path, 'utf-8');
    const result1 = verifyLogFile(content1);
    expect(result1.valid).toBe(true);

    const content2 = readFileSync(path, 'utf-8');
    expect(content1).toBe(content2);
  });
});
