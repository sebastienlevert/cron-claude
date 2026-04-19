import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock node-notifier before any module import
// ---------------------------------------------------------------------------
const notifyMock = vi.fn();
vi.mock('node-notifier', () => ({
  default: { notify: notifyMock },
}));

let notifierModule: typeof import('../notifier.js');

beforeEach(async () => {
  notifyMock.mockReset();
  notifyMock.mockImplementation((_opts: unknown, cb: Function) => cb(null, 'ok'));
  vi.resetModules();
  notifierModule = await import('../notifier.js');
});

// ===========================================================================
// sendNotification – basics
// ===========================================================================
describe('sendNotification basics', () => {
  it('passes the title to notifier', async () => {
    await notifierModule.sendNotification('My Title', 'body');
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][0].title).toBe('My Title');
  });

  it('passes the message to notifier', async () => {
    await notifierModule.sendNotification('T', 'My Message');
    expect(notifyMock.mock.calls[0][0].message).toBe('My Message');
  });

  it('includes the icon path ending in assets/icon.png', async () => {
    await notifierModule.sendNotification('T', 'M');
    const icon = notifyMock.mock.calls[0][0].icon as string;
    expect(icon).toMatch(/assets[/\\]icon\.png$/);
  });

  it('sets appID to cron-agents', async () => {
    await notifierModule.sendNotification('T', 'M');
    expect(notifyMock.mock.calls[0][0].appID).toBe('cron-agents');
  });

  it('sets sound to true', async () => {
    await notifierModule.sendNotification('T', 'M');
    expect(notifyMock.mock.calls[0][0].sound).toBe(true);
  });

  it('sets wait to false', async () => {
    await notifierModule.sendNotification('T', 'M');
    expect(notifyMock.mock.calls[0][0].wait).toBe(false);
  });

  it('resolves on successful callback', async () => {
    await expect(notifierModule.sendNotification('T', 'M')).resolves.toBeUndefined();
  });

  it('calls notifier exactly once per invocation', async () => {
    await notifierModule.sendNotification('T', 'M');
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Obsidian deep-link (openPath)
// ===========================================================================
describe('Obsidian deep-link', () => {
  it('generates obsidian://open?path=... when openPath given', async () => {
    await notifierModule.sendNotification('T', 'M', '/some/path');
    const open = notifyMock.mock.calls[0][0].open as string;
    expect(open).toMatch(/^obsidian:\/\/open\?path=/);
  });

  it('encodes spaces in the path', async () => {
    await notifierModule.sendNotification('T', 'M', '/my path/file name.md');
    const open = notifyMock.mock.calls[0][0].open as string;
    expect(open).toContain(encodeURIComponent('/my path/file name.md'));
  });

  it('encodes backslashes (Windows paths)', async () => {
    await notifierModule.sendNotification('T', 'M', 'C:\\Users\\bob\\file.md');
    const open = notifyMock.mock.calls[0][0].open as string;
    expect(open).toContain(encodeURIComponent('C:\\Users\\bob\\file.md'));
  });

  it('encodes unicode characters', async () => {
    await notifierModule.sendNotification('T', 'M', '/docs/日本語.md');
    const open = notifyMock.mock.calls[0][0].open as string;
    expect(open).toContain(encodeURIComponent('/docs/日本語.md'));
  });

  it('encodes colons in the path', async () => {
    await notifierModule.sendNotification('T', 'M', 'D:\\logs\\task:1.md');
    const open = notifyMock.mock.calls[0][0].open as string;
    expect(open).toContain(encodeURIComponent('D:\\logs\\task:1.md'));
  });

  it('does not include open field when openPath is undefined', async () => {
    await notifierModule.sendNotification('T', 'M');
    expect(notifyMock.mock.calls[0][0]).not.toHaveProperty('open');
  });

  it('does not include open field when openPath is not provided', async () => {
    await notifierModule.sendNotification('T', 'M', undefined);
    expect(notifyMock.mock.calls[0][0]).not.toHaveProperty('open');
  });
});

// ===========================================================================
// Error handling
// ===========================================================================
describe('error handling', () => {
  it('rejects when notifier callback receives an error', async () => {
    notifyMock.mockImplementation((_opts: unknown, cb: Function) =>
      cb(new Error('notify failed')),
    );
    await expect(notifierModule.sendNotification('T', 'M')).rejects.toThrow('notify failed');
  });

  it('rejects with the original error object', async () => {
    const err = new Error('original');
    notifyMock.mockImplementation((_opts: unknown, cb: Function) => cb(err));
    await expect(notifierModule.sendNotification('T', 'M')).rejects.toBe(err);
  });

  it('rejects with non-Error truthy value', async () => {
    notifyMock.mockImplementation((_opts: unknown, cb: Function) => cb('string error'));
    await expect(notifierModule.sendNotification('T', 'M')).rejects.toBe('string error');
  });

  it('resolves when callback error is null', async () => {
    notifyMock.mockImplementation((_opts: unknown, cb: Function) => cb(null));
    await expect(notifierModule.sendNotification('T', 'M')).resolves.toBeUndefined();
  });

  it('resolves when callback error is undefined', async () => {
    notifyMock.mockImplementation((_opts: unknown, cb: Function) => cb(undefined));
    await expect(notifierModule.sendNotification('T', 'M')).resolves.toBeUndefined();
  });
});

// ===========================================================================
// notifySuccess
// ===========================================================================
describe('notifySuccess', () => {
  it('uses default success message when none provided', async () => {
    await notifierModule.notifySuccess('my-task');
    expect(notifyMock.mock.calls[0][0].message).toBe('Task executed successfully');
  });

  it('includes taskId in the title', async () => {
    await notifierModule.notifySuccess('my-task');
    expect(notifyMock.mock.calls[0][0].title).toContain('my-task');
  });

  it('title contains checkmark', async () => {
    await notifierModule.notifySuccess('t');
    expect(notifyMock.mock.calls[0][0].title).toContain('✓');
  });

  it('uses custom message when provided', async () => {
    await notifierModule.notifySuccess('t', 'Custom OK');
    expect(notifyMock.mock.calls[0][0].message).toBe('Custom OK');
  });

  it('handles taskId with special characters', async () => {
    await notifierModule.notifySuccess('task/with:special&chars');
    expect(notifyMock.mock.calls[0][0].title).toContain('task/with:special&chars');
  });

  it('handles taskId with emoji', async () => {
    await notifierModule.notifySuccess('🚀-deploy');
    expect(notifyMock.mock.calls[0][0].title).toContain('🚀-deploy');
  });

  it('handles empty string taskId', async () => {
    await notifierModule.notifySuccess('');
    expect(notifyMock.mock.calls[0][0].title).toContain('✓');
  });
});

// ===========================================================================
// notifyFailure
// ===========================================================================
describe('notifyFailure', () => {
  it('uses default failure message when none provided', async () => {
    await notifierModule.notifyFailure('my-task');
    expect(notifyMock.mock.calls[0][0].message).toBe('Task execution failed');
  });

  it('includes taskId in the title', async () => {
    await notifierModule.notifyFailure('my-task');
    expect(notifyMock.mock.calls[0][0].title).toContain('my-task');
  });

  it('title contains cross mark', async () => {
    await notifierModule.notifyFailure('t');
    expect(notifyMock.mock.calls[0][0].title).toContain('✗');
  });

  it('uses custom error when provided', async () => {
    await notifierModule.notifyFailure('t', 'Disk full');
    expect(notifyMock.mock.calls[0][0].message).toBe('Disk full');
  });

  it('handles taskId with special characters', async () => {
    await notifierModule.notifyFailure('task/with:special&chars');
    expect(notifyMock.mock.calls[0][0].title).toContain('task/with:special&chars');
  });

  it('handles taskId with unicode', async () => {
    await notifierModule.notifyFailure('タスク-1');
    expect(notifyMock.mock.calls[0][0].title).toContain('タスク-1');
  });

  it('handles empty string taskId', async () => {
    await notifierModule.notifyFailure('');
    expect(notifyMock.mock.calls[0][0].title).toContain('✗');
  });
});

// ===========================================================================
// Path encoding edge cases
// ===========================================================================
describe('path encoding edge cases', () => {
  it('encodes full Windows path with drive letter', async () => {
    const p = 'C:\\Users\\alice\\Documents\\notes.md';
    await notifierModule.sendNotification('T', 'M', p);
    const open = notifyMock.mock.calls[0][0].open as string;
    expect(open).toBe(`obsidian://open?path=${encodeURIComponent(p)}`);
  });

  it('encodes hash in path', async () => {
    await notifierModule.sendNotification('T', 'M', '/docs/section#2.md');
    const open = notifyMock.mock.calls[0][0].open as string;
    expect(open).toContain('%23');
  });

  it('encodes percent in path', async () => {
    await notifierModule.sendNotification('T', 'M', '/docs/100%done.md');
    const open = notifyMock.mock.calls[0][0].open as string;
    expect(open).toContain('%25');
  });

  it('encodes ampersand in path', async () => {
    await notifierModule.sendNotification('T', 'M', '/docs/a&b.md');
    const open = notifyMock.mock.calls[0][0].open as string;
    expect(open).toContain('%26');
  });

  it('encodes equals sign in path', async () => {
    await notifierModule.sendNotification('T', 'M', '/docs/key=val.md');
    const open = notifyMock.mock.calls[0][0].open as string;
    expect(open).toContain('%3D');
  });

  it('encodes paths with spaces', async () => {
    await notifierModule.sendNotification('T', 'M', '/my docs/my file.md');
    const open = notifyMock.mock.calls[0][0].open as string;
    expect(open).not.toContain(' ');
  });

  it('handles very long paths (260+ chars)', async () => {
    const longPath = 'C:\\' + 'a'.repeat(260) + '.md';
    await notifierModule.sendNotification('T', 'M', longPath);
    const open = notifyMock.mock.calls[0][0].open as string;
    expect(open).toContain(encodeURIComponent(longPath));
  });

  it('includes open field when openPath is a non-empty string', async () => {
    await notifierModule.sendNotification('T', 'M', 'x');
    expect(notifyMock.mock.calls[0][0]).toHaveProperty('open');
  });

  it('encodes path with plus sign', async () => {
    await notifierModule.sendNotification('T', 'M', '/docs/c++.md');
    const open = notifyMock.mock.calls[0][0].open as string;
    expect(open).toContain(encodeURIComponent('/docs/c++.md'));
  });

  it('encodes path with question mark', async () => {
    await notifierModule.sendNotification('T', 'M', '/docs/what?.md');
    const open = notifyMock.mock.calls[0][0].open as string;
    expect(open).toContain('%3F');
  });
});

// ===========================================================================
// Title / message edge cases
// ===========================================================================
describe('title and message edge cases', () => {
  it('handles empty title string', async () => {
    await notifierModule.sendNotification('', 'M');
    expect(notifyMock.mock.calls[0][0].title).toBe('');
  });

  it('handles empty message string', async () => {
    await notifierModule.sendNotification('T', '');
    expect(notifyMock.mock.calls[0][0].message).toBe('');
  });

  it('handles very long title (1000+ chars)', async () => {
    const longTitle = 'A'.repeat(1200);
    await notifierModule.sendNotification(longTitle, 'M');
    expect(notifyMock.mock.calls[0][0].title).toBe(longTitle);
  });

  it('handles very long message (1000+ chars)', async () => {
    const longMsg = 'B'.repeat(1500);
    await notifierModule.sendNotification('T', longMsg);
    expect(notifyMock.mock.calls[0][0].message).toBe(longMsg);
  });

  it('handles unicode / emoji in title', async () => {
    await notifierModule.sendNotification('🎉 Done!', 'M');
    expect(notifyMock.mock.calls[0][0].title).toBe('🎉 Done!');
  });

  it('handles unicode / emoji in message', async () => {
    await notifierModule.sendNotification('T', '✅ All good 🚀');
    expect(notifyMock.mock.calls[0][0].message).toBe('✅ All good 🚀');
  });

  it('handles HTML tags in title', async () => {
    await notifierModule.sendNotification('<b>Bold</b>', 'M');
    expect(notifyMock.mock.calls[0][0].title).toBe('<b>Bold</b>');
  });

  it('handles HTML tags in message', async () => {
    await notifierModule.sendNotification('T', '<script>alert(1)</script>');
    expect(notifyMock.mock.calls[0][0].message).toBe('<script>alert(1)</script>');
  });

  it('handles newlines in message', async () => {
    await notifierModule.sendNotification('T', 'line1\nline2');
    expect(notifyMock.mock.calls[0][0].message).toBe('line1\nline2');
  });

  it('handles newlines in title', async () => {
    await notifierModule.sendNotification('line1\nline2', 'M');
    expect(notifyMock.mock.calls[0][0].title).toBe('line1\nline2');
  });
});

// ===========================================================================
// Concurrent notifications
// ===========================================================================
describe('concurrent notifications', () => {
  it('can send multiple notifications in parallel', async () => {
    const promises = [
      notifierModule.sendNotification('T1', 'M1'),
      notifierModule.sendNotification('T2', 'M2'),
      notifierModule.sendNotification('T3', 'M3'),
    ];
    await Promise.all(promises);
    expect(notifyMock).toHaveBeenCalledTimes(3);
  });

  it('each concurrent call receives its own options', async () => {
    await Promise.all([
      notifierModule.sendNotification('A', 'X'),
      notifierModule.sendNotification('B', 'Y'),
    ]);
    const titles = notifyMock.mock.calls.map((c: unknown[]) => (c[0] as Record<string, unknown>).title);
    expect(titles).toContain('A');
    expect(titles).toContain('B');
  });

  it('one failure does not prevent others from resolving', async () => {
    let callIdx = 0;
    notifyMock.mockImplementation((_opts: unknown, cb: Function) => {
      callIdx++;
      if (callIdx === 2) cb(new Error('fail'));
      else cb(null, 'ok');
    });
    const results = await Promise.allSettled([
      notifierModule.sendNotification('T1', 'M1'),
      notifierModule.sendNotification('T2', 'M2'),
      notifierModule.sendNotification('T3', 'M3'),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(2);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
  });
});

// ===========================================================================
// Icon path
// ===========================================================================
describe('icon path', () => {
  it('icon path is an absolute path', async () => {
    await notifierModule.sendNotification('T', 'M');
    const icon = notifyMock.mock.calls[0][0].icon as string;
    // Absolute: starts with / (posix) or drive letter (Windows)
    expect(/^(\/|[A-Z]:\\)/i.test(icon)).toBe(true);
  });

  it('icon path ends with assets/icon.png', async () => {
    await notifierModule.sendNotification('T', 'M');
    const icon = notifyMock.mock.calls[0][0].icon as string;
    expect(icon).toMatch(/assets[/\\]icon\.png$/);
  });

  it('icon path is the same across multiple calls', async () => {
    await notifierModule.sendNotification('T1', 'M1');
    await notifierModule.sendNotification('T2', 'M2');
    expect(notifyMock.mock.calls[0][0].icon).toBe(notifyMock.mock.calls[1][0].icon);
  });
});

// ===========================================================================
// Callback behavior edge cases
// ===========================================================================
describe('callback behavior', () => {
  it('resolves even when callback passes extra arguments', async () => {
    notifyMock.mockImplementation((_opts: unknown, cb: Function) =>
      cb(null, 'response', 'extra1', 'extra2'),
    );
    await expect(notifierModule.sendNotification('T', 'M')).resolves.toBeUndefined();
  });

  it('callback error null and response undefined still resolves', async () => {
    notifyMock.mockImplementation((_opts: unknown, cb: Function) => cb(null, undefined));
    await expect(notifierModule.sendNotification('T', 'M')).resolves.toBeUndefined();
  });

  it('callback called synchronously still resolves', async () => {
    // The default mock already calls cb synchronously
    await expect(notifierModule.sendNotification('T', 'M')).resolves.toBeUndefined();
  });

  it('callback called asynchronously still resolves', async () => {
    notifyMock.mockImplementation((_opts: unknown, cb: Function) => {
      setTimeout(() => cb(null, 'ok'), 5);
    });
    await expect(notifierModule.sendNotification('T', 'M')).resolves.toBeUndefined();
  });

  it('rejects when callback error is a string', async () => {
    notifyMock.mockImplementation((_opts: unknown, cb: Function) => cb('oops'));
    await expect(notifierModule.sendNotification('T', 'M')).rejects.toBe('oops');
  });
});
