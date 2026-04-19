import { describe, it, expect, vi, beforeEach } from 'vitest';

const notifyMock = vi.fn();
vi.mock('node-notifier', () => ({
  default: { notify: notifyMock },
}));

let notifierModule: typeof import('../../notifier.js');

beforeEach(async () => {
  notifyMock.mockReset();
  notifyMock.mockImplementation((_opts: any, cb: Function) => cb(null, 'ok'));
  vi.resetModules();
  notifierModule = await import('../../notifier.js');
});

// ---------------------------------------------------------------------------
// Notification options structure
// ---------------------------------------------------------------------------
describe('Notification options structure', () => {
  it('passes title to notifier', async () => {
    await notifierModule.sendNotification('My Title', 'msg');
    const opts = notifyMock.mock.calls[0][0];
    expect(opts.title).toBe('My Title');
  });

  it('passes message to notifier', async () => {
    await notifierModule.sendNotification('t', 'My Message');
    const opts = notifyMock.mock.calls[0][0];
    expect(opts.message).toBe('My Message');
  });

  it('sets sound to true', async () => {
    await notifierModule.sendNotification('t', 'm');
    expect(notifyMock.mock.calls[0][0].sound).toBe(true);
  });

  it('sets wait to false', async () => {
    await notifierModule.sendNotification('t', 'm');
    expect(notifyMock.mock.calls[0][0].wait).toBe(false);
  });

  it('sets appID to cron-agents', async () => {
    await notifierModule.sendNotification('t', 'm');
    expect(notifyMock.mock.calls[0][0].appID).toBe('cron-agents');
  });

  it('includes icon path', async () => {
    await notifierModule.sendNotification('t', 'm');
    const opts = notifyMock.mock.calls[0][0];
    expect(opts.icon).toBeDefined();
    expect(typeof opts.icon).toBe('string');
    expect(opts.icon).toContain('icon.png');
  });

  it('no "open" field when openPath is omitted', async () => {
    await notifierModule.sendNotification('t', 'm');
    expect(notifyMock.mock.calls[0][0].open).toBeUndefined();
  });

  it('no "open" field when openPath is undefined', async () => {
    await notifierModule.sendNotification('t', 'm', undefined);
    expect(notifyMock.mock.calls[0][0].open).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Obsidian URI format
// ---------------------------------------------------------------------------
describe('Obsidian URI format', () => {
  it('sets "open" with obsidian:// prefix', async () => {
    await notifierModule.sendNotification('t', 'm', '/some/path.md');
    const opts = notifyMock.mock.calls[0][0];
    expect(opts.open).toMatch(/^obsidian:\/\/open\?path=/);
  });

  it('encodes the path component', async () => {
    await notifierModule.sendNotification('t', 'm', '/my path/file.md');
    const opts = notifyMock.mock.calls[0][0];
    expect(opts.open).toContain(encodeURIComponent('/my path/file.md'));
  });

  it('handles Windows backslash paths', async () => {
    await notifierModule.sendNotification('t', 'm', 'C:\\Users\\me\\file.md');
    const opts = notifyMock.mock.calls[0][0];
    expect(opts.open).toContain(encodeURIComponent('C:\\Users\\me\\file.md'));
  });

  it('exact format: obsidian://open?path=<encoded>', async () => {
    const p = '/logs/test.md';
    await notifierModule.sendNotification('t', 'm', p);
    expect(notifyMock.mock.calls[0][0].open).toBe(
      `obsidian://open?path=${encodeURIComponent(p)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// URL encoding edge cases
// ---------------------------------------------------------------------------
describe('URL encoding edge cases', () => {
  it('path with spaces encodes as %20', async () => {
    await notifierModule.sendNotification('t', 'm', '/my path/file.md');
    const open: string = notifyMock.mock.calls[0][0].open;
    expect(open).toContain('%20');
  });

  it('path with existing %20 double-encodes', async () => {
    await notifierModule.sendNotification('t', 'm', '/path%20already/file.md');
    const open: string = notifyMock.mock.calls[0][0].open;
    // %20 gets encoded to %2520
    expect(open).toContain('%2520');
  });

  it('path with ? is encoded', async () => {
    await notifierModule.sendNotification('t', 'm', '/path?query=1');
    const open: string = notifyMock.mock.calls[0][0].open;
    expect(open).not.toContain('?query');
    expect(open).toContain(encodeURIComponent('?'));
  });

  it('path with & is encoded', async () => {
    await notifierModule.sendNotification('t', 'm', '/path&more');
    const open: string = notifyMock.mock.calls[0][0].open;
    expect(open).toContain(encodeURIComponent('&'));
  });

  it('path with # fragment is encoded', async () => {
    await notifierModule.sendNotification('t', 'm', '/path#section');
    const open: string = notifyMock.mock.calls[0][0].open;
    expect(open).toContain(encodeURIComponent('#'));
  });

  it('path with unicode characters', async () => {
    await notifierModule.sendNotification('t', 'm', '/日本語/ファイル.md');
    const open: string = notifyMock.mock.calls[0][0].open;
    expect(open).toContain(encodeURIComponent('/日本語/ファイル.md'));
  });
});

// ---------------------------------------------------------------------------
// Error propagation
// ---------------------------------------------------------------------------
describe('Error propagation', () => {
  it('rejects when callback receives an Error object', async () => {
    notifyMock.mockImplementation((_opts: any, cb: Function) =>
      cb(new Error('notification failed'), null),
    );
    await expect(notifierModule.sendNotification('t', 'm')).rejects.toThrow(
      'notification failed',
    );
  });

  it('rejects when callback receives a string error', async () => {
    notifyMock.mockImplementation((_opts: any, cb: Function) =>
      cb('string error', null),
    );
    await expect(notifierModule.sendNotification('t', 'm')).rejects.toBe('string error');
  });

  it('resolves when callback receives null error', async () => {
    notifyMock.mockImplementation((_opts: any, cb: Function) => cb(null, 'ok'));
    await expect(notifierModule.sendNotification('t', 'm')).resolves.toBeUndefined();
  });

  it('resolves when callback receives undefined error', async () => {
    notifyMock.mockImplementation((_opts: any, cb: Function) => cb(undefined, 'ok'));
    await expect(notifierModule.sendNotification('t', 'm')).resolves.toBeUndefined();
  });

  it('notifier throwing synchronously is caught as rejection', async () => {
    notifyMock.mockImplementation(() => {
      throw new Error('sync throw');
    });
    await expect(notifierModule.sendNotification('t', 'm')).rejects.toThrow('sync throw');
  });
});

// ---------------------------------------------------------------------------
// Multiple concurrent notifications
// ---------------------------------------------------------------------------
describe('Multiple concurrent notifications', () => {
  it('5 simultaneous calls all resolve independently', async () => {
    const results = await Promise.all([
      notifierModule.sendNotification('t1', 'm1'),
      notifierModule.sendNotification('t2', 'm2'),
      notifierModule.sendNotification('t3', 'm3'),
      notifierModule.sendNotification('t4', 'm4'),
      notifierModule.sendNotification('t5', 'm5'),
    ]);
    expect(results).toHaveLength(5);
    expect(notifyMock).toHaveBeenCalledTimes(5);
  });

  it('concurrent calls with mix of success and failure', async () => {
    let callIndex = 0;
    notifyMock.mockImplementation((_opts: any, cb: Function) => {
      callIndex++;
      if (callIndex === 3) {
        cb(new Error('fail on third'), null);
      } else {
        cb(null, 'ok');
      }
    });
    const promises = Array.from({ length: 5 }, (_, i) =>
      notifierModule.sendNotification(`t${i}`, `m${i}`).then(
        () => 'resolved',
        () => 'rejected',
      ),
    );
    const outcomes = await Promise.all(promises);
    expect(outcomes.filter((o) => o === 'resolved')).toHaveLength(4);
    expect(outcomes.filter((o) => o === 'rejected')).toHaveLength(1);
  });

  it('each concurrent call gets its own options', async () => {
    await Promise.all([
      notifierModule.sendNotification('A', 'msgA'),
      notifierModule.sendNotification('B', 'msgB'),
    ]);
    const titles = notifyMock.mock.calls.map((c: any[]) => c[0].title);
    expect(titles).toContain('A');
    expect(titles).toContain('B');
  });
});

// ---------------------------------------------------------------------------
// Empty/null inputs
// ---------------------------------------------------------------------------
describe('Empty/null inputs', () => {
  it('empty title is passed through', async () => {
    await notifierModule.sendNotification('', 'msg');
    expect(notifyMock.mock.calls[0][0].title).toBe('');
  });

  it('empty message is passed through', async () => {
    await notifierModule.sendNotification('title', '');
    expect(notifyMock.mock.calls[0][0].message).toBe('');
  });

  it('empty string openPath still creates obsidian URI', async () => {
    await notifierModule.sendNotification('t', 'm', '');
    // Empty string is falsy, so no open field
    expect(notifyMock.mock.calls[0][0].open).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Very large notification content
// ---------------------------------------------------------------------------
describe('Very large notification content', () => {
  it('10KB message is passed through', async () => {
    const largeMsg = 'A'.repeat(10 * 1024);
    await notifierModule.sendNotification('t', largeMsg);
    expect(notifyMock.mock.calls[0][0].message).toBe(largeMsg);
  });

  it('500-char title is passed through', async () => {
    const longTitle = 'T'.repeat(500);
    await notifierModule.sendNotification(longTitle, 'm');
    expect(notifyMock.mock.calls[0][0].title).toBe(longTitle);
  });

  it('very long openPath is encoded', async () => {
    const longPath = '/' + 'a'.repeat(1000) + '.md';
    await notifierModule.sendNotification('t', 'm', longPath);
    expect(notifyMock.mock.calls[0][0].open).toContain('obsidian://');
  });
});

// ---------------------------------------------------------------------------
// Special characters in title/message
// ---------------------------------------------------------------------------
describe('Special characters in title/message', () => {
  it('quotes in title', async () => {
    await notifierModule.sendNotification('He said "hello"', 'm');
    expect(notifyMock.mock.calls[0][0].title).toBe('He said "hello"');
  });

  it('single quotes in message', async () => {
    await notifierModule.sendNotification('t', "it's fine");
    expect(notifyMock.mock.calls[0][0].message).toBe("it's fine");
  });

  it('backslashes in title', async () => {
    await notifierModule.sendNotification('C:\\path\\to\\file', 'm');
    expect(notifyMock.mock.calls[0][0].title).toBe('C:\\path\\to\\file');
  });

  it('newlines in message', async () => {
    await notifierModule.sendNotification('t', 'line1\nline2');
    expect(notifyMock.mock.calls[0][0].message).toBe('line1\nline2');
  });

  it('tabs in message', async () => {
    await notifierModule.sendNotification('t', 'col1\tcol2');
    expect(notifyMock.mock.calls[0][0].message).toBe('col1\tcol2');
  });

  it('null bytes in message', async () => {
    await notifierModule.sendNotification('t', 'before\0after');
    expect(notifyMock.mock.calls[0][0].message).toBe('before\0after');
  });

  it('emoji in title', async () => {
    await notifierModule.sendNotification('🎉 Done!', 'm');
    expect(notifyMock.mock.calls[0][0].title).toBe('🎉 Done!');
  });
});

// ---------------------------------------------------------------------------
// notifySuccess / notifyFailure
// ---------------------------------------------------------------------------
describe('notifySuccess', () => {
  it('title contains task ID with success prefix', async () => {
    await notifierModule.notifySuccess('my-task');
    const opts = notifyMock.mock.calls[0][0];
    expect(opts.title).toContain('my-task');
    expect(opts.title).toContain('✓');
  });

  it('uses default message when none provided', async () => {
    await notifierModule.notifySuccess('my-task');
    const opts = notifyMock.mock.calls[0][0];
    expect(opts.message).toBe('Task executed successfully');
  });

  it('custom message is passed through', async () => {
    await notifierModule.notifySuccess('my-task', 'Custom success!');
    expect(notifyMock.mock.calls[0][0].message).toBe('Custom success!');
  });
});

describe('notifyFailure', () => {
  it('title contains task ID with failure prefix', async () => {
    await notifierModule.notifyFailure('my-task');
    const opts = notifyMock.mock.calls[0][0];
    expect(opts.title).toContain('my-task');
    expect(opts.title).toContain('✗');
  });

  it('uses default error message when none provided', async () => {
    await notifierModule.notifyFailure('my-task');
    expect(notifyMock.mock.calls[0][0].message).toBe('Task execution failed');
  });

  it('custom error is passed through', async () => {
    await notifierModule.notifyFailure('my-task', 'OOM error');
    expect(notifyMock.mock.calls[0][0].message).toBe('OOM error');
  });

  it('rejects if underlying notifier errors', async () => {
    notifyMock.mockImplementation((_opts: any, cb: Function) =>
      cb(new Error('fail'), null),
    );
    await expect(notifierModule.notifyFailure('t')).rejects.toThrow('fail');
  });
});

// ---------------------------------------------------------------------------
// Icon path resolution
// ---------------------------------------------------------------------------
describe('Icon path resolution', () => {
  it('icon path ends with icon.png', async () => {
    await notifierModule.sendNotification('t', 'm');
    const icon: string = notifyMock.mock.calls[0][0].icon;
    expect(icon.endsWith('icon.png')).toBe(true);
  });

  it('icon path contains assets directory', async () => {
    await notifierModule.sendNotification('t', 'm');
    const icon: string = notifyMock.mock.calls[0][0].icon;
    expect(icon).toContain('assets');
  });

  it('icon path is absolute', async () => {
    await notifierModule.sendNotification('t', 'm');
    const icon: string = notifyMock.mock.calls[0][0].icon;
    // On Windows starts with drive letter, on Unix with /
    expect(/^([A-Z]:\\|\/)/i.test(icon)).toBe(true);
  });

  it('icon path is consistent across calls', async () => {
    await notifierModule.sendNotification('t1', 'm1');
    await notifierModule.sendNotification('t2', 'm2');
    expect(notifyMock.mock.calls[0][0].icon).toBe(notifyMock.mock.calls[1][0].icon);
  });
});
