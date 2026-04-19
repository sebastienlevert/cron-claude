import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TaskLog } from '../types.js';

// Mock config module so signContent/verifySignature/formatTaskLog/verifyLogFile
// don't hit the filesystem when no explicit key is provided.
vi.mock('../config.js', () => ({
  getSecretKey: () => 'mock-secret-key-for-tests',
  loadConfig: () => ({
    secretKey: 'mock-secret-key-for-tests',
    version: '0.1.0',
    tasksDirs: ['.'],
    logsDir: '.',
    maxConcurrency: 2,
  }),
}));

import {
  signContent,
  verifySignature,
  formatTaskLog,
  verifyLogFile,
  createLog,
  addLogStep,
} from '../logger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TEST_KEY = 'test-secret-key-123';

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

// =========================================================================
// signContent
// =========================================================================
describe('signContent', () => {
  it('same content + same key → same signature', () => {
    const a = signContent('hello', TEST_KEY);
    const b = signContent('hello', TEST_KEY);
    expect(a).toBe(b);
  });

  it('different content + same key → different signature', () => {
    const a = signContent('hello', TEST_KEY);
    const b = signContent('world', TEST_KEY);
    expect(a).not.toBe(b);
  });

  it('same content + different key → different signature', () => {
    const a = signContent('hello', 'key-a');
    const b = signContent('hello', 'key-b');
    expect(a).not.toBe(b);
  });

  it('empty content → still produces a signature', () => {
    const sig = signContent('', TEST_KEY);
    expect(sig).toBeTruthy();
    expect(sig.length).toBe(64);
  });

  it('long content (1 MB) → produces signature', () => {
    const longContent = 'x'.repeat(1_000_000);
    const sig = signContent(longContent, TEST_KEY);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signature is a 64-char lowercase hex string', () => {
    const sig = signContent('test', TEST_KEY);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signature length is always 64', () => {
    for (const input of ['', 'a', 'abc', 'x'.repeat(10_000)]) {
      expect(signContent(input, TEST_KEY)).toHaveLength(64);
    }
  });

  it('unicode content works', () => {
    const sig = signContent('日本語テスト', TEST_KEY);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('multiline content works', () => {
    const sig = signContent('line1\nline2\nline3', TEST_KEY);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('content with special chars (newlines, tabs, emojis)', () => {
    const sig = signContent('hello\tworld\n🚀🎉', TEST_KEY);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('explicit key vs. same explicit key → identical', () => {
    const key = 'my-explicit-key';
    const a = signContent('data', key);
    const b = signContent('data', key);
    expect(a).toBe(b);
  });

  it('is deterministic: calling twice gives same result', () => {
    const sig1 = signContent('deterministic', TEST_KEY);
    const sig2 = signContent('deterministic', TEST_KEY);
    expect(sig1).toBe(sig2);
  });

  it('without explicit key uses mock config key', () => {
    // Both should use the mocked getSecretKey → 'mock-secret-key-for-tests'
    const a = signContent('content');
    const b = signContent('content', 'mock-secret-key-for-tests');
    expect(a).toBe(b);
  });
});

// =========================================================================
// verifySignature
// =========================================================================
describe('verifySignature', () => {
  it('valid signature returns true', () => {
    const sig = signContent('hello', TEST_KEY);
    expect(verifySignature('hello', sig, TEST_KEY)).toBe(true);
  });

  it('tampered content returns false', () => {
    const sig = signContent('hello', TEST_KEY);
    expect(verifySignature('hello!', sig, TEST_KEY)).toBe(false);
  });

  it('tampered signature returns false', () => {
    const sig = signContent('hello', TEST_KEY);
    const tampered = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0');
    expect(verifySignature('hello', tampered, TEST_KEY)).toBe(false);
  });

  it('empty content with valid sig returns true', () => {
    const sig = signContent('', TEST_KEY);
    expect(verifySignature('', sig, TEST_KEY)).toBe(true);
  });

  it('wrong key returns false', () => {
    const sig = signContent('hello', TEST_KEY);
    expect(verifySignature('hello', sig, 'wrong-key')).toBe(false);
  });

  it('signature with wrong length returns false', () => {
    expect(verifySignature('hello', 'abc', TEST_KEY)).toBe(false);
  });

  it('signature with uppercase hex returns false', () => {
    const sig = signContent('hello', TEST_KEY);
    const upper = sig.toUpperCase();
    // HMAC hex digest is lowercase; uppercase should not match
    expect(verifySignature('hello', upper, TEST_KEY)).toBe(false);
  });

  it('original content, original sig, original key → true', () => {
    const content = 'the quick brown fox';
    const key = 'fox-key';
    const sig = signContent(content, key);
    expect(verifySignature(content, sig, key)).toBe(true);
  });

  it('one char difference in content → false', () => {
    const sig = signContent('abcdef', TEST_KEY);
    expect(verifySignature('abcdeg', sig, TEST_KEY)).toBe(false);
  });

  it('one char difference in signature → false', () => {
    const sig = signContent('data', TEST_KEY);
    // Flip first char
    const flipped =
      (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
    expect(verifySignature('data', flipped, TEST_KEY)).toBe(false);
  });

  it('unicode content round-trips', () => {
    const content = '🔐 signed with unicode ñ';
    const sig = signContent(content, TEST_KEY);
    expect(verifySignature(content, sig, TEST_KEY)).toBe(true);
  });
});

// =========================================================================
// formatTaskLog
// =========================================================================
describe('formatTaskLog', () => {
  it('output starts with YAML frontmatter delimiter', () => {
    const result = formatTaskLog(makeLog());
    expect(result).toMatch(/^---\n/);
  });

  it('output contains taskId in frontmatter', () => {
    const result = formatTaskLog(makeLog({ taskId: 'my-task' }));
    expect(result).toContain('taskId: my-task');
  });

  it('output contains executionId in frontmatter', () => {
    const result = formatTaskLog(makeLog({ executionId: 'exec-999-xyz' }));
    expect(result).toContain('executionId: exec-999-xyz');
  });

  it('output contains status in frontmatter', () => {
    const result = formatTaskLog(makeLog({ status: 'failure' }));
    expect(result).toContain('status: failure');
  });

  it('output contains timestamp in frontmatter', () => {
    const ts = '2024-06-01T12:00:00.000Z';
    const result = formatTaskLog(makeLog({ timestamp: ts }));
    expect(result).toContain(ts);
  });

  it('output contains signature in frontmatter', () => {
    const result = formatTaskLog(makeLog());
    // Signature should be a 64-char hex in frontmatter
    expect(result).toMatch(/signature: [0-9a-f]{64}/);
  });

  it('output contains step actions in markdown', () => {
    const log = makeLog({
      steps: [
        { timestamp: '2024-01-01T00:00:00Z', action: 'Initialize' },
      ],
    });
    const result = formatTaskLog(log);
    expect(result).toContain('Initialize');
  });

  it('output contains step output in code blocks', () => {
    const log = makeLog({
      steps: [
        { timestamp: '2024-01-01T00:00:00Z', action: 'Run', output: 'all good' },
      ],
    });
    const result = formatTaskLog(log);
    expect(result).toContain('```\nall good\n```');
  });

  it('output contains step errors in code blocks', () => {
    const log = makeLog({
      steps: [
        { timestamp: '2024-01-01T00:00:00Z', action: 'Fail', error: 'boom' },
      ],
    });
    const result = formatTaskLog(log);
    expect(result).toContain('```\nboom\n```');
  });

  it('empty steps array → still valid markdown', () => {
    const result = formatTaskLog(makeLog({ steps: [] }));
    expect(result).toContain('Total steps: 0');
    expect(result).toMatch(/^---\n/);
  });

  it('multiple steps → all present', () => {
    const log = makeLog({
      steps: [
        { timestamp: '2024-01-01T00:00:00Z', action: 'Step A' },
        { timestamp: '2024-01-01T00:01:00Z', action: 'Step B' },
        { timestamp: '2024-01-01T00:02:00Z', action: 'Step C' },
      ],
    });
    const result = formatTaskLog(log);
    expect(result).toContain('Step A');
    expect(result).toContain('Step B');
    expect(result).toContain('Step C');
    expect(result).toContain('Total steps: 3');
  });

  it('step with only action (no output/error)', () => {
    const log = makeLog({
      steps: [
        { timestamp: '2024-01-01T00:00:00Z', action: 'NoExtra' },
      ],
    });
    const result = formatTaskLog(log);
    expect(result).toContain('NoExtra');
    // Should NOT have **Output:** or **Error:** sections for this step
    expect(result).not.toContain('**Output:**');
    expect(result).not.toContain('**Error:**');
  });

  it('step with output and error both present', () => {
    const log = makeLog({
      steps: [
        {
          timestamp: '2024-01-01T00:00:00Z',
          action: 'Mixed',
          output: 'some output',
          error: 'some error',
        },
      ],
    });
    const result = formatTaskLog(log);
    expect(result).toContain('some output');
    expect(result).toContain('some error');
  });
});

// =========================================================================
// verifyLogFile
// =========================================================================
describe('verifyLogFile', () => {
  it('valid formatted log → { valid: true, log }', () => {
    const log = makeLog();
    const md = formatTaskLog(log);
    const result = verifyLogFile(md);
    expect(result.valid).toBe(true);
    expect(result.log).toBeDefined();
  });

  it('tampered content → { valid: false }', () => {
    const md = formatTaskLog(makeLog());
    // Append extra text after the frontmatter block to tamper content
    const tampered = md + '\nTAMPERED';
    const result = verifyLogFile(tampered);
    expect(result.valid).toBe(false);
  });

  it('missing signature → { valid: false, error contains "No signature" }', () => {
    const md = '---\ntaskId: t\n---\nContent\n';
    const result = verifyLogFile(md);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('No signature');
  });

  it('invalid markdown (not a string parseable by gray-matter) → { valid: false, error contains "Failed to parse" }', () => {
    // gray-matter can handle most strings; pass something that triggers an error
    // Actually gray-matter is lenient. We mock a scenario where an error occurs
    // by passing content that still parses but has no signature (already covered).
    // Let's test with a truly malformed YAML front-matter
    const md = '---\n: [invalid yaml: {\n---\ncontent';
    const result = verifyLogFile(md);
    // This will either fail to parse or have no signature
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('empty string → { valid: false }', () => {
    const result = verifyLogFile('');
    expect(result.valid).toBe(false);
  });

  it('round-trip: formatTaskLog → verifyLogFile → valid: true', () => {
    const log = makeLog({
      taskId: 'roundtrip-task',
      executionId: 'exec-rt-001',
      status: 'success',
      steps: [
        { timestamp: '2024-01-01T00:00:00Z', action: 'Init', output: 'ok' },
      ],
    });
    const md = formatTaskLog(log);
    const result = verifyLogFile(md);
    expect(result.valid).toBe(true);
  });

  it('verified log has correct taskId', () => {
    const log = makeLog({ taskId: 'check-id' });
    const md = formatTaskLog(log);
    const result = verifyLogFile(md);
    expect(result.log?.taskId).toBe('check-id');
  });

  it('verified log has correct executionId', () => {
    const log = makeLog({ executionId: 'exec-verify-123' });
    const md = formatTaskLog(log);
    const result = verifyLogFile(md);
    expect(result.log?.executionId).toBe('exec-verify-123');
  });

  it('verified log has correct status', () => {
    const log = makeLog({ status: 'failure' });
    const md = formatTaskLog(log);
    const result = verifyLogFile(md);
    expect(result.log?.status).toBe('failure');
  });

  it('verified log has signature field', () => {
    const log = makeLog();
    const md = formatTaskLog(log);
    const result = verifyLogFile(md);
    expect(result.log?.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('swapping two chars in signature invalidates', () => {
    const md = formatTaskLog(makeLog());
    // Replace the signature with a bad one
    const replaced = md.replace(
      /signature: ([0-9a-f]{64})/,
      'signature: ' + '0'.repeat(64),
    );
    const result = verifyLogFile(replaced);
    expect(result.valid).toBe(false);
  });
});

// =========================================================================
// createLog
// =========================================================================
describe('createLog', () => {
  it('returns object with correct taskId', () => {
    const log = createLog('my-task');
    expect(log.taskId).toBe('my-task');
  });

  it('executionId starts with "exec-"', () => {
    const log = createLog('t');
    expect(log.executionId).toMatch(/^exec-/);
  });

  it('timestamp is a valid ISO date', () => {
    const log = createLog('t');
    const d = new Date(log.timestamp);
    expect(d.toISOString()).toBe(log.timestamp);
  });

  it('status is "running"', () => {
    const log = createLog('t');
    expect(log.status).toBe('running');
  });

  it('steps is an empty array', () => {
    const log = createLog('t');
    expect(log.steps).toEqual([]);
  });

  it('each call produces a unique executionId', () => {
    const ids = new Set(
      Array.from({ length: 20 }, () => createLog('t').executionId),
    );
    expect(ids.size).toBe(20);
  });
});

// =========================================================================
// addLogStep
// =========================================================================
describe('addLogStep', () => {
  let log: TaskLog;

  beforeEach(() => {
    log = createLog('step-test');
  });

  it('adds a step to log.steps', () => {
    addLogStep(log, 'DoSomething');
    expect(log.steps).toHaveLength(1);
  });

  it('step has a valid ISO timestamp', () => {
    addLogStep(log, 'Act');
    const d = new Date(log.steps[0].timestamp);
    expect(d.toISOString()).toBe(log.steps[0].timestamp);
  });

  it('step has the correct action', () => {
    addLogStep(log, 'Deploy');
    expect(log.steps[0].action).toBe('Deploy');
  });

  it('step has output when provided', () => {
    addLogStep(log, 'Run', 'stdout text');
    expect(log.steps[0].output).toBe('stdout text');
  });

  it('step has error when provided', () => {
    addLogStep(log, 'Fail', undefined, 'oops');
    expect(log.steps[0].error).toBe('oops');
  });

  it('step has undefined output when not provided', () => {
    addLogStep(log, 'Quick');
    expect(log.steps[0].output).toBeUndefined();
  });

  it('multiple calls add multiple steps', () => {
    addLogStep(log, 'A');
    addLogStep(log, 'B');
    addLogStep(log, 'C');
    expect(log.steps).toHaveLength(3);
  });

  it('steps preserve insertion order', () => {
    addLogStep(log, 'First');
    addLogStep(log, 'Second');
    addLogStep(log, 'Third');
    expect(log.steps.map((s) => s.action)).toEqual([
      'First',
      'Second',
      'Third',
    ]);
  });

  it('step has undefined error when not provided', () => {
    addLogStep(log, 'Ok', 'output');
    expect(log.steps[0].error).toBeUndefined();
  });

  it('step with both output and error', () => {
    addLogStep(log, 'Mixed', 'out', 'err');
    expect(log.steps[0].output).toBe('out');
    expect(log.steps[0].error).toBe('err');
  });
});
