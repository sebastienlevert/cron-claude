/**
 * E2E / boundary integration tests for Windows Task Scheduler integration.
 *
 * Strategy:
 *   - Mock child_process at the OS boundary (exec, execSync, spawn)
 *   - Mock config.ts and agents.ts for deterministic paths
 *   - Use real scheduler.ts functions — they construct PowerShell commands and parse output
 *   - Each test creates fresh temp dirs via helpers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promisify } from 'util';
import {
  createTestDirs,
  cleanupTestDirs,
  writeTestConfig,
  fakePsTaskStatusJson,
  type TestDirs,
  type ExecCall,
} from './helpers.js';

// ─── Custom exec mock with promisify.custom support ─────────────────────────

const execCalls: ExecCall[] = [];
const execResponses = new Map<string | RegExp, { stdout?: string; stderr?: string; error?: Error }>();

function findExecResponse(command: string) {
  for (const [pattern, response] of execResponses) {
    if (typeof pattern === 'string') {
      if (command.includes(pattern)) return response;
    } else {
      if (pattern.test(command)) return response;
    }
  }
  return null;
}

function setExecResponse(pattern: string | RegExp, response: { stdout?: string; stderr?: string; error?: Error }) {
  execResponses.set(pattern, response);
}

function resetExecMock() {
  execCalls.length = 0;
  execResponses.clear();
  mockExec.mockClear();
  mockExecSync.mockClear();
}

// exec mock that works correctly with util.promisify via custom symbol
const mockExec: any = vi.fn((command: string, options?: any, callback?: Function) => {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'function' ? undefined : options;
  execCalls.push({ command, options: opts });
  const response = findExecResponse(command);
  if (cb) {
    if (response?.error) {
      cb(response.error, '', response.error.message);
    } else {
      cb(null, response?.stdout || '', response?.stderr || '');
    }
  }
});

// Custom promisify so execAsync returns { stdout, stderr } like real child_process.exec
mockExec[promisify.custom] = (command: string, options?: any): Promise<{ stdout: string; stderr: string }> => {
  execCalls.push({ command, options });
  const response = findExecResponse(command);
  if (response?.error) {
    return Promise.reject(response.error);
  }
  return Promise.resolve({ stdout: response?.stdout || '', stderr: response?.stderr || '' });
};

const mockExecSync = vi.fn((command: string, options?: any) => {
  execCalls.push({ command, options });
  const response = findExecResponse(command);
  if (response?.error) throw response.error;
  return response?.stdout || '';
});

// ─── Hoisted mocks ─────────────────────────────────────────────────────────

vi.mock('child_process', () => ({
  exec: mockExec,
  execSync: mockExecSync,
  spawn: vi.fn(),
}));

vi.mock('../../config.js', () => ({
  loadConfig: vi.fn(() => ({
    secretKey: 'test-secret-key',
    version: '0.1.0',
    tasksDirs: ['C:\\test\\.cron-agents\\tasks'],
    logsDir: 'C:\\test\\.cron-agents\\logs',
    maxConcurrency: 2,
  })),
  getSecretKey: vi.fn(() => 'test-secret-key'),
  getConfigDir: vi.fn(() => 'C:\\test\\.cron-agents'),
}));

vi.mock('../../agents.js', () => ({
  detectAgentPath: vi.fn((agent: string) => {
    if (agent === 'claude') return 'claude-code';
    if (agent === 'copilot') return 'copilot';
    return null;
  }),
  getAgentConfig: vi.fn((agent: string) => {
    if (agent === 'claude') {
      return {
        name: 'claude',
        displayName: 'Claude Code',
        executables: ['claude-code', 'claude'],
        printArgs: ['--print', '--dangerously-skip-permissions'],
        inputMode: 'file',
        pathEnvVar: 'CLAUDE_CODE_PATH',
        description: 'Anthropic Claude Code CLI',
      };
    }
    if (agent === 'copilot') {
      return {
        name: 'copilot',
        displayName: 'GitHub Copilot CLI',
        executables: ['copilot'],
        printArgs: ['--yolo', '-p'],
        inputMode: 'file-reference',
        pathEnvVar: 'COPILOT_CLI_PATH',
        description: 'GitHub Copilot CLI',
      };
    }
    throw new Error(`Unknown agent: ${agent}`);
  }),
  getDefaultAgent: vi.fn(() => 'claude'),
}));

// Track temp .ps1 script writes/deletions via fs mock
const ps1WriteTracker = vi.fn();
const ps1UnlinkTracker = vi.fn();

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    writeFileSync: vi.fn((...args: any[]) => {
      const filePath = args[0] as string;
      if (typeof filePath === 'string' && filePath.endsWith('.ps1')) {
        ps1WriteTracker(filePath, args[1]);
      }
      return actual.writeFileSync(...(args as Parameters<typeof actual.writeFileSync>));
    }),
    unlinkSync: vi.fn((...args: any[]) => {
      const filePath = args[0] as string;
      if (typeof filePath === 'string' && filePath.endsWith('.ps1')) {
        ps1UnlinkTracker(filePath);
      }
      try {
        return actual.unlinkSync(...(args as Parameters<typeof actual.unlinkSync>));
      } catch {
        // Temp file may not exist in test
      }
    }),
  };
});

// ─── Import scheduler functions AFTER mocks ─────────────────────────────────

const {
  registerTask,
  unregisterTask,
  enableTask,
  disableTask,
  getTaskStatus,
  parseCronExpression,
  buildScheduledTaskName,
  generateTaskSchedulerCommand,
} = await import('../../scheduler.js');

// ─── Shared state ───────────────────────────────────────────────────────────

let dirs: TestDirs;
const PROJECT_ROOT = 'C:\\Projects\\cron-agents';
const TASK_FILE = 'C:\\test\\.cron-agents\\tasks\\my-task.md';

beforeEach(() => {
  dirs = createTestDirs();
  writeTestConfig(dirs);
  resetExecMock();
  ps1WriteTracker.mockClear();
  ps1UnlinkTracker.mockClear();

  // Default: node detection returns a fake path
  setExecResponse('where node', { stdout: 'C:\\Program Files\\nodejs\\node.exe\n' });
  setExecResponse('which node', { stdout: '/usr/local/bin/node\n' });
});

afterEach(() => {
  cleanupTestDirs(dirs);
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. registerTask
// ═══════════════════════════════════════════════════════════════════════════

describe('registerTask', () => {
  it('generates correct PS command for daily cron', async () => {
    setExecResponse(/Bypass -File/, { stdout: 'Task registered successfully' });

    await registerTask('daily-task', TASK_FILE, '0 9 * * *', PROJECT_ROOT);

    const psFileCall = execCalls.find(c => c.command.includes('Bypass -File'));
    expect(psFileCall).toBeDefined();
    expect(psFileCall!.command).toContain('powershell.exe');
    expect(psFileCall!.command).toContain('-NoProfile');
    expect(psFileCall!.command).toContain('-NonInteractive');
    expect(psFileCall!.command).toContain('-ExecutionPolicy Bypass');
  });

  it('generates correct PS command for weekly cron (Mon-Fri)', async () => {
    setExecResponse(/Bypass -File/, { stdout: 'Task registered successfully' });

    await registerTask('weekday-task', TASK_FILE, '0 9 * * 1-5', PROJECT_ROOT);

    const psCall = execCalls.find(c => c.command.includes('Bypass -File'));
    expect(psCall).toBeDefined();
  });

  it('generates correct PS command for monthly cron', async () => {
    setExecResponse(/Bypass -File/, { stdout: 'Task registered successfully' });

    await registerTask('monthly-task', TASK_FILE, '0 9 1 * *', PROJECT_ROOT);

    const psCall = execCalls.find(c => c.command.includes('Bypass -File'));
    expect(psCall).toBeDefined();
  });

  it('uses correct task name format: cron-agents-<taskId>', async () => {
    setExecResponse(/Bypass -File/, { stdout: 'Task registered successfully' });

    await registerTask('my-task', TASK_FILE, '0 9 * * *', PROJECT_ROOT);

    // The temp .ps1 script is written with the task name embedded
    expect(ps1WriteTracker).toHaveBeenCalled();
    const scriptContent = ps1WriteTracker.mock.calls[0][1] as string;
    expect(scriptContent).toContain('cron-agents-my-task');
  });

  it('includes node path in XML via temp script', async () => {
    setExecResponse(/Bypass -File/, { stdout: 'Task registered' });

    await registerTask('node-test', TASK_FILE, '0 9 * * *', PROJECT_ROOT);

    expect(ps1WriteTracker).toHaveBeenCalled();
    const scriptContent = ps1WriteTracker.mock.calls[0][1] as string;
    // The XML in the script contains the node path in <Command>
    expect(scriptContent).toContain('<Command>');
    expect(scriptContent).toContain('node.exe');
  });

  it('includes executor path and task file path in arguments', async () => {
    setExecResponse(/Bypass -File/, { stdout: 'registered' });

    await registerTask('arg-test', TASK_FILE, '0 9 * * *', PROJECT_ROOT);

    const scriptContent = ps1WriteTracker.mock.calls[0][1] as string;
    expect(scriptContent).toContain('executor.js');
    expect(scriptContent).toContain('my-task.md');
  });

  it('with claude agent includes agent path in arguments', async () => {
    setExecResponse(/Bypass -File/, { stdout: 'registered' });

    await registerTask('claude-task', TASK_FILE, '0 9 * * *', PROJECT_ROOT, 'claude');

    const scriptContent = ps1WriteTracker.mock.calls[0][1] as string;
    // detectAgentPath('claude') returns 'claude-code', included in XML Arguments
    expect(scriptContent).toContain('claude-code');
  });

  it('with copilot agent includes different agent path', async () => {
    setExecResponse(/Bypass -File/, { stdout: 'registered' });

    await registerTask('copilot-task', TASK_FILE, '0 9 * * *', PROJECT_ROOT, 'copilot');

    const scriptContent = ps1WriteTracker.mock.calls[0][1] as string;
    // detectAgentPath('copilot') returns 'copilot' — single-quoted and XML-escaped in task XML
    expect(scriptContent).toContain("&apos;copilot&apos;");
  });

  it('creates temp .ps1 file, execs it, and cleans up', async () => {
    setExecResponse(/Bypass -File/, { stdout: 'registered' });

    await registerTask('cleanup-test', TASK_FILE, '0 9 * * *', PROJECT_ROOT);

    // writeFileSync was called with a .ps1 path
    expect(ps1WriteTracker).toHaveBeenCalled();
    const ps1Path = ps1WriteTracker.mock.calls[0][0] as string;
    expect(ps1Path).toMatch(/\.ps1$/);

    // unlinkSync was called in finally block
    expect(ps1UnlinkTracker).toHaveBeenCalled();
    expect(ps1UnlinkTracker.mock.calls[0][0]).toBe(ps1Path);
  });

  it('succeeds without throwing on successful registration', async () => {
    setExecResponse(/Bypass -File/, { stdout: 'Task registered successfully' });

    await expect(
      registerTask('success-test', TASK_FILE, '0 9 * * *', PROJECT_ROOT),
    ).resolves.toBeUndefined();
  });

  it('throws on non-access-denied failure', async () => {
    const error = new Error('Some PowerShell error');
    (error as any).stderr = 'Something went wrong';
    setExecResponse(/Bypass -File/, { error });

    await expect(
      registerTask('fail-test', TASK_FILE, '0 9 * * *', PROJECT_ROOT),
    ).rejects.toThrow();
  });

  it('retries with elevation on access denied error', async () => {
    const accessDeniedError = new Error('Access is denied');
    (accessDeniedError as any).stderr = 'Access is denied';

    // Initial registration fails with access denied
    setExecResponse(/Bypass -File/, { error: accessDeniedError });
    // Elevation command succeeds
    setExecResponse(/Start-Process powershell/, { stdout: '' });
    // Verification command returns the task name
    setExecResponse(/ErrorAction SilentlyContinue/, { stdout: 'cron-agents-elevate-test' });

    await registerTask('elevate-test', TASK_FILE, '0 9 * * *', PROJECT_ROOT);

    const elevatedCall = execCalls.find(c => c.command.includes('Start-Process'));
    expect(elevatedCall).toBeDefined();
    expect(elevatedCall!.command).toContain('-Verb RunAs');
  });

  it('succeeds when access denied + elevation succeeds', async () => {
    const accessDeniedError = new Error('Access is denied');
    (accessDeniedError as any).stderr = 'Access is denied';

    setExecResponse(/Bypass -File/, { error: accessDeniedError });
    setExecResponse(/Start-Process powershell/, { stdout: '' });
    setExecResponse(/ErrorAction SilentlyContinue/, { stdout: 'cron-agents-elevate-ok' });

    await expect(
      registerTask('elevate-ok', TASK_FILE, '0 9 * * *', PROJECT_ROOT),
    ).resolves.toBeUndefined();
  });

  it('throws when access denied + elevation fails', async () => {
    const accessDeniedError = new Error('Access is denied');
    (accessDeniedError as any).stderr = 'Access is denied';
    const elevationError = new Error('Elevation was cancelled');

    setExecResponse(/Bypass -File/, { error: accessDeniedError });
    setExecResponse(/Start-Process powershell/, { error: elevationError });

    await expect(
      registerTask('elevate-fail', TASK_FILE, '0 9 * * *', PROJECT_ROOT),
    ).rejects.toThrow();
  });

  it('throws on invalid cron before calling PowerShell', async () => {
    await expect(
      registerTask('bad-cron', TASK_FILE, 'not-a-cron', PROJECT_ROOT),
    ).rejects.toThrow('Invalid cron expression');

    // No PowerShell -File calls should have been made
    const psCalls = execCalls.filter(c => c.command.includes('Bypass -File'));
    expect(psCalls).toHaveLength(0);
  });

  it('handles 0x80070005 error code as access denied', async () => {
    const accessDeniedError = new Error('error 0x80070005');
    (accessDeniedError as any).stderr = 'error 0x80070005';

    setExecResponse(/Bypass -File/, { error: accessDeniedError });
    setExecResponse(/Start-Process powershell/, { stdout: '' });
    setExecResponse(/ErrorAction SilentlyContinue/, { stdout: 'cron-agents-hex-test' });

    await registerTask('hex-test', TASK_FILE, '0 9 * * *', PROJECT_ROOT);

    const elevatedCall = execCalls.find(c => c.command.includes('Start-Process'));
    expect(elevatedCall).toBeDefined();
  });

  it('handles PermissionDenied error as access denied', async () => {
    const permError = new Error('PermissionDenied');
    (permError as any).stderr = 'PermissionDenied';

    setExecResponse(/Bypass -File/, { error: permError });
    setExecResponse(/Start-Process powershell/, { stdout: '' });
    setExecResponse(/ErrorAction SilentlyContinue/, { stdout: 'cron-agents-perm-test' });

    await registerTask('perm-test', TASK_FILE, '0 9 * * *', PROJECT_ROOT);

    const elevatedCall = execCalls.find(c => c.command.includes('Start-Process'));
    expect(elevatedCall).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. unregisterTask
// ═══════════════════════════════════════════════════════════════════════════

describe('unregisterTask', () => {
  it('sends correct PS Unregister-ScheduledTask command', async () => {
    // findScheduledTaskName returns null → fallback to CronAgents_<id>
    setExecResponse(/Get-ScheduledTask.*Where-Object/, { stdout: '' });
    setExecResponse(/Unregister-ScheduledTask/, { stdout: '' });

    await unregisterTask('my-task');

    const unregCall = execCalls.find(c => c.command.includes('Unregister-ScheduledTask'));
    expect(unregCall).toBeDefined();
    expect(unregCall!.command).toContain('Unregister-ScheduledTask');
  });

  it('calls findScheduledTaskName first', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, { stdout: '' });
    setExecResponse(/Unregister-ScheduledTask/, { stdout: '' });

    await unregisterTask('lookup-test');

    const lookupCall = execCalls.find(c =>
      c.command.includes('Get-ScheduledTask') && c.command.includes('Where-Object'),
    );
    expect(lookupCall).toBeDefined();
  });

  it('uses found task name when findScheduledTaskName succeeds', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, {
      stdout: 'cron-agents-found-task\n',
    });
    setExecResponse(/Unregister-ScheduledTask/, { stdout: '' });

    await unregisterTask('found-task');

    const unregCall = execCalls.find(c => c.command.includes('Unregister-ScheduledTask'));
    expect(unregCall!.command).toContain('cron-agents-found-task');
  });

  it('falls back to CronAgents_<taskId> when not found', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, { stdout: '' });
    setExecResponse(/Unregister-ScheduledTask/, { stdout: '' });

    await unregisterTask('fallback-task');

    const unregCall = execCalls.find(c => c.command.includes('Unregister-ScheduledTask'));
    expect(unregCall!.command).toContain('CronAgents_fallback-task');
  });

  it('includes -Confirm:$false flag', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, { stdout: '' });
    setExecResponse(/Unregister-ScheduledTask/, { stdout: '' });

    await unregisterTask('confirm-test');

    const unregCall = execCalls.find(c => c.command.includes('Unregister-ScheduledTask'));
    expect(unregCall!.command).toContain('-Confirm');
    expect(unregCall!.command).toContain('$false');
  });

  it('succeeds without error on successful unregistration', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, { stdout: '' });
    setExecResponse(/Unregister-ScheduledTask/, { stdout: '' });

    await expect(unregisterTask('success-unreg')).resolves.toBeUndefined();
  });

  it('throws on PS failure', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, { stdout: '' });
    setExecResponse(/Unregister-ScheduledTask/, {
      error: new Error('Task not found or access denied'),
    });

    await expect(unregisterTask('fail-unreg')).rejects.toThrow();
  });

  it('throws when trying to unregister non-existent task', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, { stdout: '' });
    setExecResponse(/Unregister-ScheduledTask/, {
      error: new Error('No task found with the given name'),
    });

    await expect(unregisterTask('ghost-task')).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. enableTask / disableTask
// ═══════════════════════════════════════════════════════════════════════════

describe('enableTask', () => {
  it('sends correct schtasks /ENABLE command', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, { stdout: '' });
    setExecResponse(/schtasks.*\/ENABLE/, { stdout: 'SUCCESS' });

    await enableTask('enable-test');

    const enableCall = execCalls.find(c => c.command.includes('/ENABLE'));
    expect(enableCall).toBeDefined();
    expect(enableCall!.command).toContain('schtasks');
    expect(enableCall!.command).toContain('/Change');
    expect(enableCall!.command).toContain('/TN');
  });

  it('calls findScheduledTaskName first', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, { stdout: '' });
    setExecResponse(/schtasks.*\/ENABLE/, { stdout: 'SUCCESS' });

    await enableTask('lookup-enable');

    const lookupCall = execCalls.find(c =>
      c.command.includes('Get-ScheduledTask') && c.command.includes('Where-Object'),
    );
    expect(lookupCall).toBeDefined();
  });

  it('uses found name when findScheduledTaskName succeeds', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, {
      stdout: 'cron-agents-found-enable\n',
    });
    setExecResponse(/schtasks/, { stdout: 'SUCCESS' });

    await enableTask('found-enable');

    const enableCall = execCalls.find(c => c.command.includes('schtasks'));
    expect(enableCall!.command).toContain('cron-agents-found-enable');
  });

  it('uses fallback name when not found', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, { stdout: '' });
    setExecResponse(/schtasks/, { stdout: 'SUCCESS' });

    await enableTask('fallback-enable');

    const enableCall = execCalls.find(c => c.command.includes('schtasks'));
    expect(enableCall!.command).toContain('CronAgents_fallback-enable');
  });

  it('succeeds without error', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, { stdout: '' });
    setExecResponse(/schtasks.*\/ENABLE/, { stdout: 'SUCCESS' });

    await expect(enableTask('ok-enable')).resolves.toBeUndefined();
  });

  it('throws on failure', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, { stdout: '' });
    setExecResponse(/schtasks/, { error: new Error('schtasks failed') });

    await expect(enableTask('fail-enable')).rejects.toThrow();
  });
});

describe('disableTask', () => {
  it('sends correct schtasks /DISABLE command', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, { stdout: '' });
    setExecResponse(/schtasks.*\/DISABLE/, { stdout: 'SUCCESS' });

    await disableTask('disable-test');

    const disableCall = execCalls.find(c => c.command.includes('/DISABLE'));
    expect(disableCall).toBeDefined();
    expect(disableCall!.command).toContain('schtasks');
    expect(disableCall!.command).toContain('/Change');
  });

  it('succeeds without error', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, { stdout: '' });
    setExecResponse(/schtasks.*\/DISABLE/, { stdout: 'SUCCESS' });

    await expect(disableTask('ok-disable')).resolves.toBeUndefined();
  });

  it('throws on failure', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, { stdout: '' });
    setExecResponse(/schtasks/, { error: new Error('schtasks failed') });

    await expect(disableTask('fail-disable')).rejects.toThrow();
  });

  it('succeeds for already-disabled task (schtasks succeeds)', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, { stdout: '' });
    setExecResponse(/schtasks.*\/DISABLE/, { stdout: 'SUCCESS: already disabled' });

    await expect(disableTask('already-disabled')).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. getTaskStatus
// ═══════════════════════════════════════════════════════════════════════════

describe('getTaskStatus', () => {
  it('returns exists:true, enabled:true for Ready state', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, {
      stdout: 'cron-agents-ready-task\n',
    });
    setExecResponse(/Get-ScheduledTask -TaskName.*ConvertTo-Json/, {
      stdout: fakePsTaskStatusJson('Ready'),
    });

    const status = await getTaskStatus('ready-task');
    expect(status.exists).toBe(true);
    expect(status.enabled).toBe(true);
  });

  it('returns exists:true, enabled:false for Disabled state', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, {
      stdout: 'cron-agents-disabled-task\n',
    });
    setExecResponse(/Get-ScheduledTask -TaskName.*ConvertTo-Json/, {
      stdout: fakePsTaskStatusJson('Disabled'),
    });

    const status = await getTaskStatus('disabled-task');
    expect(status.exists).toBe(true);
    expect(status.enabled).toBe(false);
  });

  it('returns exists:true for Running state (enabled is false since State !== Ready)', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, {
      stdout: 'cron-agents-running-task\n',
    });
    setExecResponse(/Get-ScheduledTask -TaskName.*ConvertTo-Json/, {
      stdout: fakePsTaskStatusJson('Running'),
    });

    const status = await getTaskStatus('running-task');
    expect(status.exists).toBe(true);
    expect(status.enabled).toBe(false);
  });

  it('returns exists:false when PS errors (task not found)', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, { stdout: '' });
    setExecResponse(/Get-ScheduledTask -TaskName.*ConvertTo-Json/, {
      error: new Error('No task found'),
    });

    const status = await getTaskStatus('nonexistent');
    expect(status.exists).toBe(false);
  });

  it('includes lastRunTime from PS output', async () => {
    const lastRun = '2025-01-15T09:00:00';
    setExecResponse(/Get-ScheduledTask.*Where-Object/, {
      stdout: 'cron-agents-last-run\n',
    });
    setExecResponse(/Get-ScheduledTask -TaskName.*ConvertTo-Json/, {
      stdout: fakePsTaskStatusJson('Ready', lastRun),
    });

    const status = await getTaskStatus('last-run');
    expect(status.lastRunTime).toBe(lastRun);
  });

  it('includes nextRunTime from PS output', async () => {
    const nextRun = '2025-02-01T09:00:00';
    setExecResponse(/Get-ScheduledTask.*Where-Object/, {
      stdout: 'cron-agents-next-run\n',
    });
    setExecResponse(/Get-ScheduledTask -TaskName.*ConvertTo-Json/, {
      stdout: fakePsTaskStatusJson('Ready', undefined, nextRun),
    });

    const status = await getTaskStatus('next-run');
    expect(status.nextRunTime).toBe(nextRun);
  });

  it('returns lastRunTime even when default/empty', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, {
      stdout: 'cron-agents-empty-run\n',
    });
    setExecResponse(/Get-ScheduledTask -TaskName.*ConvertTo-Json/, {
      stdout: fakePsTaskStatusJson('Ready', '/Date(0)/'),
    });

    const status = await getTaskStatus('empty-run');
    expect(status.exists).toBe(true);
    expect(status.lastRunTime).toBe('/Date(0)/');
  });

  it('findScheduledTaskName finds cron-agents-<id> format', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, {
      stdout: 'cron-agents-new-format\n',
    });
    setExecResponse(/Get-ScheduledTask -TaskName.*ConvertTo-Json/, {
      stdout: fakePsTaskStatusJson('Ready'),
    });

    const status = await getTaskStatus('new-format');
    expect(status.exists).toBe(true);

    const statusCall = execCalls.find(c =>
      c.command.includes("Get-ScheduledTask -TaskName 'cron-agents-new-format'"),
    );
    expect(statusCall).toBeDefined();
  });

  it('findScheduledTaskName finds legacy CronAgents_<id> format', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, {
      stdout: 'CronAgents_legacy-task\n',
    });
    setExecResponse(/Get-ScheduledTask -TaskName.*ConvertTo-Json/, {
      stdout: fakePsTaskStatusJson('Ready'),
    });

    const status = await getTaskStatus('legacy-task');
    expect(status.exists).toBe(true);

    const statusCall = execCalls.find(c =>
      c.command.includes("Get-ScheduledTask -TaskName 'CronAgents_legacy-task'"),
    );
    expect(statusCall).toBeDefined();
  });

  it('findScheduledTaskName finds CronAgents_*_<id> regex pattern', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, {
      stdout: 'CronAgents_Daily_regex-task\n',
    });
    setExecResponse(/Get-ScheduledTask -TaskName.*ConvertTo-Json/, {
      stdout: fakePsTaskStatusJson('Ready'),
    });

    const status = await getTaskStatus('regex-task');
    expect(status.exists).toBe(true);

    const statusCall = execCalls.find(c =>
      c.command.includes("Get-ScheduledTask -TaskName 'CronAgents_Daily_regex-task'"),
    );
    expect(statusCall).toBeDefined();
  });

  it('findScheduledTaskName returns null when not found → uses fallback', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, { stdout: '' });
    setExecResponse(/Get-ScheduledTask -TaskName.*ConvertTo-Json/, {
      stdout: fakePsTaskStatusJson('Ready'),
    });

    const status = await getTaskStatus('not-found');

    const statusCall = execCalls.find(c =>
      c.command.includes("Get-ScheduledTask -TaskName 'CronAgents_not-found'"),
    );
    expect(statusCall).toBeDefined();
  });

  it('returns exists:false on timeout (PS error)', async () => {
    setExecResponse(/Get-ScheduledTask.*Where-Object/, { stdout: '' });
    const timeoutError = new Error('Command timed out');
    (timeoutError as any).killed = true;
    setExecResponse(/Get-ScheduledTask -TaskName.*ConvertTo-Json/, {
      error: timeoutError,
    });

    const status = await getTaskStatus('timeout-task');
    expect(status.exists).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. parseCronExpression edge cases (via integration / registerTask)
// ═══════════════════════════════════════════════════════════════════════════

describe('parseCronExpression edge cases (integration)', () => {
  it('parses step hours "0 */2 * * *" as daily trigger', () => {
    const trigger = parseCronExpression('0 */2 * * *');
    expect(trigger.type).toBe('daily');
  });

  it('parses multiple hours "0 9,13,18 * * *" as daily trigger', () => {
    const trigger = parseCronExpression('0 9,13,18 * * *');
    expect(trigger.type).toBe('daily');
    expect(trigger.time).toBe('09:00');
  });

  it('parses quarterly "0 9 1 1,4,7,10 *" as monthly trigger with 4 months', () => {
    const trigger = parseCronExpression('0 9 1 1,4,7,10 *');
    expect(trigger.type).toBe('monthly');
    expect(trigger.daysOfMonth).toEqual([1]);
    expect(trigger.monthNames).toEqual(['January', 'April', 'July', 'October']);
  });

  it('parses "0 9 * * 0" as weekly Sunday', () => {
    const trigger = parseCronExpression('0 9 * * 0');
    expect(trigger.type).toBe('weekly');
    expect(trigger.daysOfWeek).toEqual(['Sunday']);
  });

  it('parses "0 9 15 * *" as monthly on 15th', () => {
    const trigger = parseCronExpression('0 9 15 * *');
    expect(trigger.type).toBe('monthly');
    expect(trigger.daysOfMonth).toEqual([15]);
    expect(trigger.monthNames).toHaveLength(12);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Command construction
// ═══════════════════════════════════════════════════════════════════════════

describe('generateTaskSchedulerCommand', () => {
  it('includes proper XML task structure', () => {
    const trigger = { type: 'daily' as const, time: '09:00' };
    const result = generateTaskSchedulerCommand('xml-test', TASK_FILE, trigger, PROJECT_ROOT);

    expect(result).toContain('<?xml version="1.0"');
    expect(result).toContain('<Task version="1.4"');
    expect(result).toContain('</Task>');
    expect(result).toContain('<Actions');
    expect(result).toContain('<Triggers>');
  });

  it('generates correct XML trigger for daily', () => {
    const trigger = { type: 'daily' as const, time: '09:00' };
    const result = generateTaskSchedulerCommand('daily-xml', TASK_FILE, trigger, PROJECT_ROOT);

    expect(result).toContain('<ScheduleByDay>');
    expect(result).toContain('<DaysInterval>1</DaysInterval>');
    expect(result).toContain('T09:00:00');
  });

  it('generates correct XML trigger for weekly', () => {
    const trigger = {
      type: 'weekly' as const,
      time: '10:00',
      daysOfWeek: ['Monday', 'Wednesday', 'Friday'],
    };
    const result = generateTaskSchedulerCommand('weekly-xml', TASK_FILE, trigger, PROJECT_ROOT);

    expect(result).toContain('<ScheduleByWeek>');
    expect(result).toContain('<WeeksInterval>1</WeeksInterval>');
    expect(result).toContain('<DaysOfWeek>');
    expect(result).toContain('<Monday />');
    expect(result).toContain('<Wednesday />');
    expect(result).toContain('<Friday />');
    expect(result).toContain('T10:00:00');
  });

  it('generates correct XML Settings block', () => {
    const trigger = { type: 'daily' as const, time: '09:00' };
    const result = generateTaskSchedulerCommand('settings-xml', TASK_FILE, trigger, PROJECT_ROOT);

    expect(result).toContain('<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>');
    expect(result).toContain('<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>');
    expect(result).toContain('<AllowHardTerminate>true</AllowHardTerminate>');
    expect(result).toContain('<StartWhenAvailable>true</StartWhenAvailable>');
    expect(result).toContain('<AllowStartOnDemand>true</AllowStartOnDemand>');
    expect(result).toContain('<Enabled>true</Enabled>');
    expect(result).toContain('<Hidden>true</Hidden>');
  });

  it('task name in generated command matches buildScheduledTaskName', () => {
    const taskId = 'name-match-test';
    const expectedName = buildScheduledTaskName(taskId);
    const trigger = { type: 'daily' as const, time: '09:00' };
    const result = generateTaskSchedulerCommand(taskId, TASK_FILE, trigger, PROJECT_ROOT);

    expect(result).toContain(`$taskName = "${expectedName}"`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. buildScheduledTaskName (integration verification)
// ═══════════════════════════════════════════════════════════════════════════

describe('buildScheduledTaskName (integration)', () => {
  it('returns correct format for standard task id', () => {
    expect(buildScheduledTaskName('daily-summary')).toBe('cron-agents-daily-summary');
  });

  it('ignores optional cronExpr parameter', () => {
    expect(buildScheduledTaskName('my-task', '0 9 * * *')).toBe('cron-agents-my-task');
  });

  it('handles special characters in task id', () => {
    expect(buildScheduledTaskName('task_v1.0')).toBe('cron-agents-task_v1.0');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Cross-function integration scenarios
// ═══════════════════════════════════════════════════════════════════════════

describe('Cross-function integration', () => {
  it('register then getTaskStatus shows exists:true', async () => {
    // Register
    setExecResponse(/Bypass -File/, { stdout: 'Task registered' });
    await registerTask('full-cycle', TASK_FILE, '0 9 * * *', PROJECT_ROOT);

    // Reset for status check
    resetExecMock();
    setExecResponse('where node', { stdout: 'C:\\Program Files\\nodejs\\node.exe\n' });
    setExecResponse(/Get-ScheduledTask.*Where-Object/, {
      stdout: 'cron-agents-full-cycle\n',
    });
    setExecResponse(/Get-ScheduledTask -TaskName.*ConvertTo-Json/, {
      stdout: fakePsTaskStatusJson('Ready'),
    });

    const status = await getTaskStatus('full-cycle');
    expect(status.exists).toBe(true);
    expect(status.enabled).toBe(true);
  });

  it('register then disable then getTaskStatus shows enabled:false', async () => {
    // Register
    setExecResponse(/Bypass -File/, { stdout: 'Task registered' });
    await registerTask('disable-cycle', TASK_FILE, '0 9 * * *', PROJECT_ROOT);

    // Disable
    resetExecMock();
    setExecResponse('where node', { stdout: 'C:\\Program Files\\nodejs\\node.exe\n' });
    setExecResponse(/Get-ScheduledTask.*Where-Object/, {
      stdout: 'cron-agents-disable-cycle\n',
    });
    setExecResponse(/schtasks.*\/DISABLE/, { stdout: 'SUCCESS' });
    await disableTask('disable-cycle');

    // Status
    resetExecMock();
    setExecResponse('where node', { stdout: 'C:\\Program Files\\nodejs\\node.exe\n' });
    setExecResponse(/Get-ScheduledTask.*Where-Object/, {
      stdout: 'cron-agents-disable-cycle\n',
    });
    setExecResponse(/Get-ScheduledTask -TaskName.*ConvertTo-Json/, {
      stdout: fakePsTaskStatusJson('Disabled'),
    });

    const status = await getTaskStatus('disable-cycle');
    expect(status.exists).toBe(true);
    expect(status.enabled).toBe(false);
  });

  it('register then unregister then getTaskStatus shows exists:false', async () => {
    // Register
    setExecResponse(/Bypass -File/, { stdout: 'Task registered' });
    await registerTask('unreg-cycle', TASK_FILE, '0 9 * * *', PROJECT_ROOT);

    // Unregister
    resetExecMock();
    setExecResponse('where node', { stdout: 'C:\\Program Files\\nodejs\\node.exe\n' });
    setExecResponse(/Get-ScheduledTask.*Where-Object/, {
      stdout: 'cron-agents-unreg-cycle\n',
    });
    setExecResponse(/Unregister-ScheduledTask/, { stdout: '' });
    await unregisterTask('unreg-cycle');

    // Status
    resetExecMock();
    setExecResponse('where node', { stdout: 'C:\\Program Files\\nodejs\\node.exe\n' });
    setExecResponse(/Get-ScheduledTask.*Where-Object/, { stdout: '' });
    setExecResponse(/Get-ScheduledTask -TaskName.*ConvertTo-Json/, {
      error: new Error('Not found'),
    });

    const status = await getTaskStatus('unreg-cycle');
    expect(status.exists).toBe(false);
  });

  it('enable after disable restores task', async () => {
    // Disable
    setExecResponse(/Get-ScheduledTask.*Where-Object/, {
      stdout: 'cron-agents-toggle-task\n',
    });
    setExecResponse(/schtasks.*\/DISABLE/, { stdout: 'SUCCESS' });
    await disableTask('toggle-task');

    // Enable
    resetExecMock();
    setExecResponse('where node', { stdout: 'C:\\Program Files\\nodejs\\node.exe\n' });
    setExecResponse(/Get-ScheduledTask.*Where-Object/, {
      stdout: 'cron-agents-toggle-task\n',
    });
    setExecResponse(/schtasks.*\/ENABLE/, { stdout: 'SUCCESS' });
    await enableTask('toggle-task');

    // Status
    resetExecMock();
    setExecResponse('where node', { stdout: 'C:\\Program Files\\nodejs\\node.exe\n' });
    setExecResponse(/Get-ScheduledTask.*Where-Object/, {
      stdout: 'cron-agents-toggle-task\n',
    });
    setExecResponse(/Get-ScheduledTask -TaskName.*ConvertTo-Json/, {
      stdout: fakePsTaskStatusJson('Ready'),
    });

    const status = await getTaskStatus('toggle-task');
    expect(status.exists).toBe(true);
    expect(status.enabled).toBe(true);
  });

  it('generateTaskSchedulerCommand output is used by registerTask flow', async () => {
    const trigger = parseCronExpression('0 9 * * 1-5');
    const command = generateTaskSchedulerCommand('gen-cmd', TASK_FILE, trigger, PROJECT_ROOT);

    expect(command).toContain('Register-ScheduledTask');
    expect(command).toContain('cron-agents-gen-cmd');
    expect(command).toContain('ScheduleByWeek');
    expect(command).toContain('Monday');
    expect(command).toContain('Friday');
  });

  it('monthly trigger XML includes correct months and days', () => {
    const trigger = parseCronExpression('0 9 1 3,6,9,12 *');
    const command = generateTaskSchedulerCommand('monthly-gen', TASK_FILE, trigger, PROJECT_ROOT);

    expect(command).toContain('<ScheduleByMonth>');
    expect(command).toContain('<March />');
    expect(command).toContain('<June />');
    expect(command).toContain('<September />');
    expect(command).toContain('<December />');
    expect(command).toContain('<Day>1</Day>');
  });
});
