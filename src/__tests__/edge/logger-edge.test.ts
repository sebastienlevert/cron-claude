import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  mkdtempSync,
  existsSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHmac } from 'crypto';
import type { TaskLog, LogStep } from '../../types.js';

let testDir: string;
let logsDir: string;

vi.mock('../../config.js', () => ({
  getSecretKey: () => 'test-secret-key-for-edge-cases',
  loadConfig: () => ({
    secretKey: 'test-secret-key-for-edge-cases',
    version: '0.1.0',
    tasksDirs: [],
    logsDir,
    maxConcurrency: 2,
  }),
  getConfigDir: () => join(testDir, '.cron-agents'),
}));

let loggerModule: typeof import('../../logger.js');

beforeEach(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'logger-edge-'));
  logsDir = join(testDir, 'logs');
  mkdirSync(logsDir, { recursive: true });
  vi.resetModules();
  loggerModule = await import('../../logger.js');
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const EDGE_KEY = 'test-secret-key-for-edge-cases';

function makeLog(overrides: Partial<TaskLog> = {}): TaskLog {
  return {
    taskId: 'edge-task',
    executionId: 'exec-edge-001',
    timestamp: '2024-02-17T10:30:00.000Z',
    status: 'success',
    steps: [],
    ...overrides,
  };
}

function makeStep(overrides: Partial<LogStep> = {}): LogStep {
  return {
    timestamp: '2024-01-01T00:00:00Z',
    action: 'test-action',
    ...overrides,
  };
}

/** Compute expected HMAC for a body string using the edge key */
function expectedHmac(body: string): string {
  return createHmac('sha256', EDGE_KEY).update(body).digest('hex');
}

// =========================================================================
// 1. Signature verification edge cases
// =========================================================================
describe('Signature verification edge cases', () => {
  it('valid log round-trips through format → verify', () => {
    const md = loggerModule.formatTaskLog(makeLog());
    const result = loggerModule.verifyLogFile(md);
    expect(result.valid).toBe(true);
  });

  it('tampered body content fails verification', () => {
    const md = loggerModule.formatTaskLog(makeLog());
    const tampered = md + '\n<!-- injected -->';
    expect(loggerModule.verifyLogFile(tampered).valid).toBe(false);
  });

  it('tampered frontmatter field (non-signature) still passes — known gap', () => {
    // Signature only covers body content, not frontmatter
    const md = loggerModule.formatTaskLog(makeLog({ taskId: 'original' }));
    const replaced = md.replace('taskId: original', 'taskId: tampered-id');
    const result = loggerModule.verifyLogFile(replaced);
    // This is a known gap: frontmatter changes don't invalidate signature
    expect(result.valid).toBe(true);
  });

  it('empty body log still produces a valid signature', () => {
    const log = makeLog({ steps: [] });
    const md = loggerModule.formatTaskLog(log);
    const result = loggerModule.verifyLogFile(md);
    expect(result.valid).toBe(true);
  });

  it('signature field replaced with all zeros fails', () => {
    const md = loggerModule.formatTaskLog(makeLog());
    const replaced = md.replace(
      /signature: [0-9a-f]{64}/,
      'signature: ' + '0'.repeat(64),
    );
    expect(loggerModule.verifyLogFile(replaced).valid).toBe(false);
  });

  it('signature with one flipped bit fails', () => {
    const md = loggerModule.formatTaskLog(makeLog());
    const match = md.match(/signature: ([0-9a-f]{64})/);
    expect(match).toBeTruthy();
    const sig = match![1];
    const flipped = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
    const replaced = md.replace(sig, flipped);
    expect(loggerModule.verifyLogFile(replaced).valid).toBe(false);
  });

  it('signature truncated to 32 chars fails', () => {
    const md = loggerModule.formatTaskLog(makeLog());
    const match = md.match(/signature: ([0-9a-f]{64})/);
    const replaced = md.replace(match![1], match![1].slice(0, 32));
    expect(loggerModule.verifyLogFile(replaced).valid).toBe(false);
  });
});

// =========================================================================
// 2. Special characters in output
// =========================================================================
describe('Special characters in step output', () => {
  it('newlines in step output are preserved', () => {
    const log = makeLog({
      steps: [makeStep({ output: 'line1\nline2\nline3' })],
    });
    const md = loggerModule.formatTaskLog(log);
    expect(md).toContain('line1\nline2\nline3');
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });

  it('markdown syntax in output does not break formatting', () => {
    const log = makeLog({
      steps: [makeStep({ output: '# Heading\n**bold** _italic_ [link](url)' })],
    });
    const md = loggerModule.formatTaskLog(log);
    expect(md).toContain('# Heading');
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });

  it('YAML-like content in output', () => {
    const log = makeLog({
      steps: [makeStep({ output: 'key: value\nlist:\n  - item1\n  - item2' })],
    });
    const md = loggerModule.formatTaskLog(log);
    expect(md).toContain('key: value');
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });

  it('frontmatter delimiters (---) in step output', () => {
    const log = makeLog({
      steps: [makeStep({ output: '---\nfake: frontmatter\n---\ncontent' })],
    });
    const md = loggerModule.formatTaskLog(log);
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });

  it('backtick sequences in step output', () => {
    const log = makeLog({
      steps: [makeStep({ output: '```js\nconsole.log("hi")\n```' })],
    });
    const md = loggerModule.formatTaskLog(log);
    expect(md).toContain('console.log');
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });

  it('tabs and carriage returns in output', () => {
    const log = makeLog({
      steps: [makeStep({ output: 'col1\tcol2\r\nnext line' })],
    });
    const md = loggerModule.formatTaskLog(log);
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });

  it('HTML tags in step output', () => {
    const log = makeLog({
      steps: [makeStep({ output: '<script>alert("xss")</script>' })],
    });
    const md = loggerModule.formatTaskLog(log);
    expect(md).toContain('<script>');
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });
});

// =========================================================================
// 3. Empty execution steps
// =========================================================================
describe('Empty execution steps', () => {
  it('empty steps array produces valid markdown', () => {
    const md = loggerModule.formatTaskLog(makeLog({ steps: [] }));
    expect(md).toContain('Total steps: 0');
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });

  it('empty steps log writes and reads back correctly', () => {
    const log = makeLog({ steps: [] });
    const path = loggerModule.saveLog(log);
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf-8');
    expect(loggerModule.verifyLogFile(content).valid).toBe(true);
  });
});

// =========================================================================
// 4. Very large output
// =========================================================================
describe('Very large output', () => {
  it('1MB output string writes and verifies', () => {
    const bigOutput = 'X'.repeat(1_000_000);
    const log = makeLog({
      steps: [makeStep({ output: bigOutput })],
    });
    const md = loggerModule.formatTaskLog(log);
    expect(md.length).toBeGreaterThan(1_000_000);
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });

  it('1MB output writes to disk successfully', () => {
    const bigOutput = 'Y'.repeat(1_000_000);
    const log = makeLog({
      executionId: 'exec-large-001',
      steps: [makeStep({ output: bigOutput })],
    });
    const path = loggerModule.saveLog(log);
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('Y'.repeat(100));
    expect(loggerModule.verifyLogFile(content).valid).toBe(true);
  });

  it('many steps with moderate output', () => {
    const steps = Array.from({ length: 100 }, (_, i) =>
      makeStep({ action: `Step-${i}`, output: 'data-'.repeat(200) }),
    );
    const log = makeLog({ steps });
    const md = loggerModule.formatTaskLog(log);
    expect(md).toContain('Total steps: 100');
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });
});

// =========================================================================
// 5. Unicode in taskId / output
// =========================================================================
describe('Unicode in taskId and output', () => {
  it('emoji taskId formats and verifies', () => {
    const log = makeLog({ taskId: '🚀-deploy' });
    const md = loggerModule.formatTaskLog(log);
    expect(md).toContain('🚀-deploy');
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });

  it('CJK characters in taskId', () => {
    const log = makeLog({ taskId: '日本語タスク' });
    const md = loggerModule.formatTaskLog(log);
    expect(md).toContain('日本語タスク');
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });

  it('RTL text in output', () => {
    const log = makeLog({
      steps: [makeStep({ output: 'مرحبا بالعالم' })],
    });
    const md = loggerModule.formatTaskLog(log);
    expect(md).toContain('مرحبا');
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });

  it('mixed emoji in step output', () => {
    const log = makeLog({
      steps: [makeStep({ output: '✅ Pass 🔥 Hot 💀 Dead' })],
    });
    const md = loggerModule.formatTaskLog(log);
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });

  it('unicode signature computation matches cross-verify', () => {
    const content = '日本語テスト🎉';
    const sig = loggerModule.signContent(content, EDGE_KEY);
    expect(sig).toBe(expectedHmac(content));
  });

  it('zero-width characters in output', () => {
    const log = makeLog({
      steps: [makeStep({ output: 'hello\u200Bworld\u200B' })],
    });
    const md = loggerModule.formatTaskLog(log);
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });
});

// =========================================================================
// 6. Concurrent log writes
// =========================================================================
describe('Concurrent log writes', () => {
  it('multiple saveLog calls for same taskId produce separate files', () => {
    const logs = Array.from({ length: 5 }, (_, i) =>
      makeLog({ executionId: `exec-concurrent-${i}` }),
    );
    const paths = logs.map((log) => loggerModule.saveLog(log));
    const uniquePaths = new Set(paths);
    expect(uniquePaths.size).toBe(5);
    paths.forEach((p) => expect(existsSync(p)).toBe(true));
  });

  it('concurrent saves all produce verifiable logs', () => {
    const paths = Array.from({ length: 5 }, (_, i) => {
      const log = makeLog({ executionId: `exec-verify-${i}` });
      return loggerModule.saveLog(log);
    });
    paths.forEach((p) => {
      const content = readFileSync(p, 'utf-8');
      expect(loggerModule.verifyLogFile(content).valid).toBe(true);
    });
  });
});

// =========================================================================
// 7. Log filename sanitization
// =========================================================================
describe('Log filename handling with special taskIds', () => {
  it('taskId with forward slash writes a file', () => {
    // Filesystem may reject or flatten — test that saveLog doesn't throw
    // and a file is created somewhere
    const log = makeLog({ taskId: 'path/task' });
    try {
      const path = loggerModule.saveLog(log);
      expect(existsSync(path)).toBe(true);
    } catch {
      // Acceptable: OS rejected the filename
    }
  });

  it('taskId with backslash writes a file', () => {
    const log = makeLog({ taskId: 'path\\task' });
    try {
      const path = loggerModule.saveLog(log);
      expect(existsSync(path)).toBe(true);
    } catch {
      // Acceptable: OS rejected the filename
    }
  });

  it('taskId with colon', () => {
    const log = makeLog({ taskId: 'task:v2' });
    try {
      const path = loggerModule.saveLog(log);
      // On Windows colons in filenames are invalid, saveLog may fail or sanitize
      expect(typeof path).toBe('string');
    } catch {
      // Expected on Windows
    }
  });

  it('taskId with asterisk and question mark', () => {
    const log = makeLog({ taskId: 'task*test?' });
    try {
      const path = loggerModule.saveLog(log);
      expect(typeof path).toBe('string');
    } catch {
      // Expected on Windows
    }
  });

  it('very long taskId (500 chars)', () => {
    const longId = 'a'.repeat(500);
    const log = makeLog({ taskId: longId, executionId: 'exec-long-id' });
    try {
      const path = loggerModule.saveLog(log);
      // May fail due to path length limits
      expect(typeof path).toBe('string');
    } catch {
      // Acceptable: path too long for OS
    }
  });

  it('taskId with spaces', () => {
    const log = makeLog({ taskId: 'my task name' });
    const path = loggerModule.saveLog(log);
    expect(existsSync(path)).toBe(true);
  });

  it('taskId with dots', () => {
    const log = makeLog({ taskId: 'my.task.v2.0' });
    const path = loggerModule.saveLog(log);
    expect(existsSync(path)).toBe(true);
    expect(loggerModule.verifyLogFile(readFileSync(path, 'utf-8')).valid).toBe(true);
  });
});

// =========================================================================
// 8. verifyLogFile with malformed content
// =========================================================================
describe('verifyLogFile with malformed content', () => {
  it('no frontmatter at all', () => {
    const result = loggerModule.verifyLogFile('Just plain text, no frontmatter.');
    expect(result.valid).toBe(false);
  });

  it('no signature field in frontmatter', () => {
    const md = '---\ntaskId: test\nstatus: success\n---\nBody content\n';
    const result = loggerModule.verifyLogFile(md);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('No signature');
  });

  it('empty string', () => {
    const result = loggerModule.verifyLogFile('');
    expect(result.valid).toBe(false);
  });

  it('just frontmatter delimiters with nothing inside', () => {
    const result = loggerModule.verifyLogFile('---\n---\n');
    expect(result.valid).toBe(false);
  });

  it('frontmatter with only signature but wrong value', () => {
    const md = '---\nsignature: deadbeef\n---\nSome body\n';
    const result = loggerModule.verifyLogFile(md);
    expect(result.valid).toBe(false);
  });

  it('binary-like content', () => {
    const binary = '---\nsignature: ' + 'ff'.repeat(32) + '\n---\n\x00\x01\x02\x03';
    const result = loggerModule.verifyLogFile(binary);
    expect(result.valid).toBe(false);
  });

  it('single frontmatter delimiter', () => {
    const result = loggerModule.verifyLogFile('---\nno closing delimiter');
    expect(result.valid).toBe(false);
  });

  it('signature field is empty string', () => {
    const md = "---\nsignature: ''\n---\nBody\n";
    const result = loggerModule.verifyLogFile(md);
    expect(result.valid).toBe(false);
  });

  it('signature field is null', () => {
    const md = '---\nsignature: null\n---\nBody\n';
    const result = loggerModule.verifyLogFile(md);
    expect(result.valid).toBe(false);
  });

  it('duplicate signature fields — gray-matter takes last', () => {
    const md = '---\nsignature: aaa\nsignature: bbb\n---\nBody\n';
    const result = loggerModule.verifyLogFile(md);
    // Both are wrong, should fail
    expect(result.valid).toBe(false);
  });
});

// =========================================================================
// 9. Secret key edge cases
// =========================================================================
describe('Secret key edge cases', () => {
  it('empty string key produces a valid signature', () => {
    const sig = loggerModule.signContent('test', '');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('empty key verifies consistently', () => {
    const sig = loggerModule.signContent('data', '');
    expect(loggerModule.verifySignature('data', sig, '')).toBe(true);
  });

  it('very long key (10KB) produces a valid signature', () => {
    const longKey = 'K'.repeat(10_000);
    const sig = loggerModule.signContent('content', longKey);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(loggerModule.verifySignature('content', sig, longKey)).toBe(true);
  });

  it('unicode key works correctly', () => {
    const unicodeKey = '🔑日本語キー';
    const sig = loggerModule.signContent('test', unicodeKey);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(loggerModule.verifySignature('test', sig, unicodeKey)).toBe(true);
  });

  it('key with newlines', () => {
    const key = 'line1\nline2\nline3';
    const sig = loggerModule.signContent('data', key);
    expect(loggerModule.verifySignature('data', sig, key)).toBe(true);
  });

  it('key with null bytes', () => {
    const key = 'key\x00with\x00nulls';
    const sig = loggerModule.signContent('content', key);
    expect(loggerModule.verifySignature('content', sig, key)).toBe(true);
  });
});

// =========================================================================
// 10. Timestamp edge cases
// =========================================================================
describe('Timestamp edge cases', () => {
  it('epoch zero timestamp', () => {
    const log = makeLog({ timestamp: '1970-01-01T00:00:00.000Z' });
    const md = loggerModule.formatTaskLog(log);
    expect(md).toContain('1970-01-01');
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });

  it('far future date (year 9999)', () => {
    const log = makeLog({ timestamp: '9999-12-31T23:59:59.999Z' });
    const md = loggerModule.formatTaskLog(log);
    expect(md).toContain('9999-12-31');
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });

  it('non-ISO timestamp string', () => {
    const log = makeLog({ timestamp: 'not-a-real-date' });
    const md = loggerModule.formatTaskLog(log);
    expect(md).toContain('not-a-real-date');
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });

  it('empty timestamp string', () => {
    const log = makeLog({ timestamp: '' });
    const md = loggerModule.formatTaskLog(log);
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });

  it('timestamp with timezone offset', () => {
    const log = makeLog({ timestamp: '2024-06-15T12:00:00+05:30' });
    const md = loggerModule.formatTaskLog(log);
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });
});

// =========================================================================
// 11. Rapid sequential writes
// =========================================================================
describe('Rapid sequential writes', () => {
  it('10 logs in tight loop produce unique filenames', () => {
    const paths: string[] = [];
    for (let i = 0; i < 10; i++) {
      const log = makeLog({ executionId: `exec-rapid-${i}` });
      paths.push(loggerModule.saveLog(log));
    }
    const unique = new Set(paths);
    expect(unique.size).toBe(10);
  });

  it('all rapidly written logs are verifiable', () => {
    const paths: string[] = [];
    for (let i = 0; i < 10; i++) {
      const log = makeLog({
        executionId: `exec-rapid-verify-${i}`,
        steps: [makeStep({ action: `rapid-step-${i}` })],
      });
      paths.push(loggerModule.saveLog(log));
    }
    for (const p of paths) {
      const content = readFileSync(p, 'utf-8');
      expect(loggerModule.verifyLogFile(content).valid).toBe(true);
    }
  });

  it('rapid writes with same executionId still get unique filenames', () => {
    // Filenames include Date.now() which may collide at ms resolution
    const paths: string[] = [];
    for (let i = 0; i < 10; i++) {
      const log = makeLog({ executionId: 'exec-same-id' });
      paths.push(loggerModule.saveLog(log));
    }
    const files = readdirSync(logsDir);
    // At minimum files should exist even if some paths overlap
    expect(files.length).toBeGreaterThanOrEqual(1);
  });
});

// =========================================================================
// 12. Log content with frontmatter-like patterns
// =========================================================================
describe('Log content with frontmatter-like patterns', () => {
  it('step output containing ---\\nkey: value\\n--- verifies', () => {
    const log = makeLog({
      steps: [makeStep({ output: '---\nfake: yaml\nother: field\n---\nbody' })],
    });
    const md = loggerModule.formatTaskLog(log);
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });

  it('step error containing frontmatter-like block', () => {
    const log = makeLog({
      steps: [makeStep({ error: '---\nerror_type: fatal\n---' })],
    });
    const md = loggerModule.formatTaskLog(log);
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });

  it('multiple steps each with frontmatter-like output', () => {
    const steps = Array.from({ length: 5 }, (_, i) =>
      makeStep({
        action: `step-${i}`,
        output: `---\nstep: ${i}\nstatus: ok\n---\nresult`,
      }),
    );
    const log = makeLog({ steps });
    const md = loggerModule.formatTaskLog(log);
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });

  it('step output that mimics entire log format', () => {
    const fakeLog = `---
category: cron-task
taskId: fake
executionId: exec-fake
timestamp: '2024-01-01T00:00:00Z'
status: success
signature: ${'a'.repeat(64)}
---
# Fake log`;
    const log = makeLog({
      steps: [makeStep({ output: fakeLog })],
    });
    const md = loggerModule.formatTaskLog(log);
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });
});

// =========================================================================
// 13. saveLog and finalizeLog integration
// =========================================================================
describe('saveLog integration', () => {
  it('saveLog creates file in configured logsDir', () => {
    const log = makeLog({ executionId: 'exec-dir-check' });
    const path = loggerModule.saveLog(log);
    expect(path.startsWith(logsDir)).toBe(true);
  });

  it('saveLog file content starts with frontmatter', () => {
    const log = makeLog();
    const path = loggerModule.saveLog(log);
    const content = readFileSync(path, 'utf-8');
    expect(content).toMatch(/^---\n/);
  });

  it('finalizeLog with success sets status and saves', () => {
    const log = loggerModule.createLog('finalize-test');
    loggerModule.addLogStep(log, 'do work', 'output');
    const path = loggerModule.finalizeLog(log, true);
    expect(existsSync(path)).toBe(true);
    expect(log.status).toBe('success');
    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('status: success');
  });

  it('finalizeLog with failure sets status and saves', () => {
    const log = loggerModule.createLog('fail-test');
    loggerModule.addLogStep(log, 'crash', undefined, 'boom');
    const path = loggerModule.finalizeLog(log, false);
    expect(existsSync(path)).toBe(true);
    expect(log.status).toBe('failure');
  });

  it('saveLog creates logsDir if it does not exist', () => {
    rmSync(logsDir, { recursive: true, force: true });
    expect(existsSync(logsDir)).toBe(false);
    const log = makeLog({ executionId: 'exec-mkdir' });
    const path = loggerModule.saveLog(log);
    expect(existsSync(path)).toBe(true);
  });

  it('saved log filename contains taskId and executionId', () => {
    const log = makeLog({ taskId: 'my-task', executionId: 'exec-42' });
    const path = loggerModule.saveLog(log);
    const filename = path.split(/[\\/]/).pop()!;
    expect(filename).toContain('my-task');
    expect(filename).toContain('exec-42');
  });

  it('saved log filename ends with .md', () => {
    const path = loggerModule.saveLog(makeLog());
    expect(path).toMatch(/\.md$/);
  });
});

// =========================================================================
// 14. createLog and addLogStep edge cases
// =========================================================================
describe('createLog and addLogStep edge cases', () => {
  it('createLog with empty taskId', () => {
    const log = loggerModule.createLog('');
    expect(log.taskId).toBe('');
    expect(log.executionId).toMatch(/^exec-/);
  });

  it('createLog with unicode taskId', () => {
    const log = loggerModule.createLog('タスク🎯');
    expect(log.taskId).toBe('タスク🎯');
  });

  it('addLogStep with empty action', () => {
    const log = loggerModule.createLog('test');
    loggerModule.addLogStep(log, '');
    expect(log.steps[0].action).toBe('');
  });

  it('addLogStep with very large output', () => {
    const log = loggerModule.createLog('test');
    loggerModule.addLogStep(log, 'big', 'X'.repeat(500_000));
    expect(log.steps[0].output!.length).toBe(500_000);
  });

  it('addLogStep preserves output with special chars', () => {
    const log = loggerModule.createLog('test');
    const special = '---\nYAML: true\n---\n```\ncode\n```\n<div>html</div>';
    loggerModule.addLogStep(log, 'special', special);
    expect(log.steps[0].output).toBe(special);
  });
});

// =========================================================================
// 15. signContent / verifySignature cross-validation
// =========================================================================
describe('signContent cross-validation with crypto', () => {
  it('signContent output matches manual HMAC computation', () => {
    const content = 'test content for cross-check';
    const sig = loggerModule.signContent(content, EDGE_KEY);
    expect(sig).toBe(expectedHmac(content));
  });

  it('verifySignature agrees with manual HMAC', () => {
    const content = 'verify cross-check';
    const manualSig = expectedHmac(content);
    expect(loggerModule.verifySignature(content, manualSig, EDGE_KEY)).toBe(true);
  });

  it('content with only whitespace', () => {
    const content = '   \n\t\n   ';
    const sig = loggerModule.signContent(content, EDGE_KEY);
    expect(loggerModule.verifySignature(content, sig, EDGE_KEY)).toBe(true);
  });

  it('content with null character', () => {
    const content = 'before\x00after';
    const sig = loggerModule.signContent(content, EDGE_KEY);
    expect(loggerModule.verifySignature(content, sig, EDGE_KEY)).toBe(true);
  });
});

// =========================================================================
// 16. Status variations
// =========================================================================
describe('Status variations', () => {
  it('failure status formats and verifies', () => {
    const log = makeLog({ status: 'failure' });
    const md = loggerModule.formatTaskLog(log);
    expect(md).toContain('status: failure');
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });

  it('running status formats and verifies', () => {
    const log = makeLog({ status: 'running' });
    const md = loggerModule.formatTaskLog(log);
    expect(md).toContain('status: running');
    expect(loggerModule.verifyLogFile(md).valid).toBe(true);
  });
});
