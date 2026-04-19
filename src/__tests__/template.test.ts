import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn((cmd: string) => {
    if (cmd.includes('abbrev-ref')) return 'main\n';
    if (cmd.includes('pretty=%s')) return 'last commit msg\n';
    if (cmd.includes('--short')) return 'abc1234\n';
    if (cmd.includes('rev-parse HEAD')) return 'abc1234567890abcdef\n';
    if (cmd.includes('pretty=%an')) return 'Test Author\n';
    if (cmd.includes('show-toplevel')) return '/some/path/my-repo\n';
    return '';
  }),
}));

import {
  resolveVariables,
  redactForDisplay,
  listVariables,
  getBuiltinVariables,
  TemplateContext,
} from '../template.js';
import { execSync } from 'child_process';

const mockedExecSync = vi.mocked(execSync);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseContext(overrides?: Partial<TemplateContext>): TemplateContext {
  return { taskId: 'test-task', ...overrides };
}

// ---------------------------------------------------------------------------
// resolveVariables – date/time builtins
// ---------------------------------------------------------------------------
describe('resolveVariables', () => {
  describe('date/time built-in variables', () => {
    it('resolves {{date}} to YYYY-MM-DD format', () => {
      const { resolved } = resolveVariables('{{date}}', baseContext());
      expect(resolved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('resolves {{date}} to today\'s date', () => {
      const expected = new Date().toISOString().split('T')[0];
      const { resolved } = resolveVariables('{{date}}', baseContext());
      expect(resolved).toBe(expected);
    });

    it('resolves {{time}} to HH:mm format', () => {
      const { resolved } = resolveVariables('{{time}}', baseContext());
      expect(resolved).toMatch(/^\d{2}:\d{2}$/);
    });

    it('resolves {{datetime}} to ISO 8601 format', () => {
      const { resolved } = resolveVariables('{{datetime}}', baseContext());
      expect(resolved).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('resolves {{timestamp}} to a numeric string', () => {
      const { resolved } = resolveVariables('{{timestamp}}', baseContext());
      expect(resolved).toMatch(/^\d+$/);
      expect(Number(resolved)).toBeGreaterThan(0);
    });

    it('resolves {{timestamp}} close to Date.now()', () => {
      const before = Date.now();
      const { resolved } = resolveVariables('{{timestamp}}', baseContext());
      const after = Date.now();
      const ts = Number(resolved);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it('resolves {{weekday}} to a valid day name', () => {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const { resolved } = resolveVariables('{{weekday}}', baseContext());
      expect(days).toContain(resolved);
    });

    it('resolves {{weekday}} matching current day', () => {
      const expected = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];
      const { resolved } = resolveVariables('{{weekday}}', baseContext());
      expect(resolved).toBe(expected);
    });

    it('resolves {{month}} to a valid month name', () => {
      const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const { resolved } = resolveVariables('{{month}}', baseContext());
      expect(months).toContain(resolved);
    });

    it('resolves {{month}} matching current month', () => {
      const expected = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][new Date().getMonth()];
      const { resolved } = resolveVariables('{{month}}', baseContext());
      expect(resolved).toBe(expected);
    });

    it('resolves {{year}} to 4-digit year string', () => {
      const { resolved } = resolveVariables('{{year}}', baseContext());
      expect(resolved).toMatch(/^\d{4}$/);
    });

    it('resolves {{year}} to current year', () => {
      const { resolved } = resolveVariables('{{year}}', baseContext());
      expect(resolved).toBe(String(new Date().getFullYear()));
    });

    it('produces no warnings for valid date/time vars', () => {
      const { warnings } = resolveVariables('{{date}} {{time}} {{datetime}}', baseContext());
      expect(warnings).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Task context variables
  // -------------------------------------------------------------------------
  describe('task context variables', () => {
    it('resolves {{taskId}} from context', () => {
      const { resolved } = resolveVariables('{{taskId}}', baseContext({ taskId: 'my-task' }));
      expect(resolved).toBe('my-task');
    });

    it('resolves {{runId}} when provided', () => {
      const { resolved } = resolveVariables('{{runId}}', baseContext({ runId: 'run-42' }));
      expect(resolved).toBe('run-42');
    });

    it('resolves {{runId}} to "none" when not provided', () => {
      const { resolved } = resolveVariables('{{runId}}', baseContext());
      expect(resolved).toBe('none');
    });

    it('resolves {{attempt}} when provided', () => {
      const { resolved } = resolveVariables('{{attempt}}', baseContext({ attempt: 3 }));
      expect(resolved).toBe('3');
    });

    it('resolves {{attempt}} to "1" when not provided', () => {
      const { resolved } = resolveVariables('{{attempt}}', baseContext());
      expect(resolved).toBe('1');
    });

    it('resolves {{attempt}} to "1" when attempt is 0', () => {
      const { resolved } = resolveVariables('{{attempt}}', baseContext({ attempt: 0 }));
      expect(resolved).toBe('1');
    });

    it('resolves {{agent}} when provided', () => {
      const { resolved } = resolveVariables('{{agent}}', baseContext({ agent: 'claude' }));
      expect(resolved).toBe('claude');
    });

    it('resolves {{agent}} to "unknown" when not provided', () => {
      const { resolved } = resolveVariables('{{agent}}', baseContext());
      expect(resolved).toBe('unknown');
    });

    it('produces no warnings for context vars', () => {
      const { warnings } = resolveVariables('{{taskId}} {{runId}} {{attempt}} {{agent}}', baseContext());
      expect(warnings).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Multiple variables in one string
  // -------------------------------------------------------------------------
  describe('multiple variables in one string', () => {
    it('resolves multiple known variables', () => {
      const { resolved, warnings } = resolveVariables('Task {{taskId}} on {{date}}', baseContext({ taskId: 'multi' }));
      expect(resolved).toContain('Task multi on ');
      expect(resolved).toMatch(/Task multi on \d{4}-\d{2}-\d{2}/);
      expect(warnings).toHaveLength(0);
    });

    it('resolves adjacent variables with no separator', () => {
      const { resolved } = resolveVariables('{{taskId}}{{year}}', baseContext({ taskId: 'A' }));
      expect(resolved).toBe(`A${new Date().getFullYear()}`);
    });

    it('resolves three or more variables', () => {
      const { resolved, warnings } = resolveVariables('{{taskId}}-{{runId}}-{{agent}}', baseContext({ taskId: 't', runId: 'r', agent: 'a' }));
      expect(resolved).toBe('t-r-a');
      expect(warnings).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // No variables / empty input
  // -------------------------------------------------------------------------
  describe('no variables or empty input', () => {
    it('returns plain text unchanged', () => {
      const { resolved, warnings } = resolveVariables('just plain text', baseContext());
      expect(resolved).toBe('just plain text');
      expect(warnings).toHaveLength(0);
    });

    it('returns empty string unchanged', () => {
      const { resolved, warnings } = resolveVariables('', baseContext());
      expect(resolved).toBe('');
      expect(warnings).toHaveLength(0);
    });

    it('ignores single braces', () => {
      const { resolved } = resolveVariables('{notavar}', baseContext());
      expect(resolved).toBe('{notavar}');
    });

    it('ignores incomplete double braces', () => {
      const { resolved } = resolveVariables('{{incomplete', baseContext());
      expect(resolved).toBe('{{incomplete');
    });
  });

  // -------------------------------------------------------------------------
  // Unknown variables
  // -------------------------------------------------------------------------
  describe('unknown variables', () => {
    it('leaves unknown variable as-is', () => {
      const { resolved } = resolveVariables('{{foobar}}', baseContext());
      expect(resolved).toBe('{{foobar}}');
    });

    it('adds warning for unknown variable', () => {
      const { warnings } = resolveVariables('{{foobar}}', baseContext());
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toBe('Unresolved variable: {{foobar}}');
    });

    it('warns for each distinct unknown variable', () => {
      const { warnings } = resolveVariables('{{foo}} {{bar}}', baseContext());
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toContain('foo');
      expect(warnings[1]).toContain('bar');
    });

    it('warns for repeated unknown variable each occurrence', () => {
      const { warnings } = resolveVariables('{{foo}} {{foo}}', baseContext());
      expect(warnings).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Mixed known and unknown
  // -------------------------------------------------------------------------
  describe('mixed known and unknown variables', () => {
    it('resolves known and leaves unknown', () => {
      const { resolved, warnings } = resolveVariables('{{taskId}} {{unknown}}', baseContext({ taskId: 'hello' }));
      expect(resolved).toBe('hello {{unknown}}');
      expect(warnings).toHaveLength(1);
    });

    it('resolves some and warns about others', () => {
      const { resolved, warnings } = resolveVariables('Date: {{date}}, Foo: {{foo}}, Agent: {{agent}}', baseContext({ agent: 'copilot' }));
      expect(resolved).toMatch(/^Date: \d{4}-\d{2}-\d{2}, Foo: \{\{foo\}\}, Agent: copilot$/);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('foo');
    });
  });

  // -------------------------------------------------------------------------
  // Nested / edge-case brace patterns
  // -------------------------------------------------------------------------
  describe('edge-case brace patterns', () => {
    it('handles triple braces: {{{date}}} resolves inner', () => {
      const { resolved } = resolveVariables('{{{date}}}', baseContext());
      // The regex matches {{date}} inside the triple braces, so result is {<date_value>}
      expect(resolved).toMatch(/^\{\d{4}-\d{2}-\d{2}\}$/);
    });

    it('handles text with curly braces that are not templates', () => {
      const { resolved } = resolveVariables('JSON: {"key": "val"}', baseContext());
      expect(resolved).toBe('JSON: {"key": "val"}');
    });

    it('handles whitespace inside braces (not matched)', () => {
      const { resolved } = resolveVariables('{{ date }}', baseContext());
      expect(resolved).toBe('{{ date }}');
    });

    it('does not match empty double braces', () => {
      const { resolved, warnings } = resolveVariables('{{}}', baseContext());
      expect(resolved).toBe('{{}}');
      expect(warnings).toHaveLength(0);
    });

    it('handles variable names with underscores', () => {
      const { resolved } = resolveVariables('{{env.CRON_AGENTS_MY_VAR}}', baseContext());
      // env var not set, so warning, but the name is valid syntactically
      expect(resolved).toContain('CRON_AGENTS_MY_VAR');
    });
  });

  // -------------------------------------------------------------------------
  // Environment variables
  // -------------------------------------------------------------------------
  describe('environment variables (env.*)', () => {
    const savedEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
      savedEnv.CRON_AGENTS_TEST_VAR = process.env.CRON_AGENTS_TEST_VAR;
      savedEnv.HOME = process.env.HOME;
      savedEnv.USERPROFILE = process.env.USERPROFILE;
      savedEnv.USERNAME = process.env.USERNAME;
      savedEnv.USER = process.env.USER;
      savedEnv.NODE_ENV = process.env.NODE_ENV;
      savedEnv.TZ = process.env.TZ;
      savedEnv.LANG = process.env.LANG;
      savedEnv.LANGUAGE = process.env.LANGUAGE;
      savedEnv.LC_ALL = process.env.LC_ALL;
      savedEnv.COMPUTERNAME = process.env.COMPUTERNAME;
      savedEnv.HOSTNAME = process.env.HOSTNAME;
      savedEnv.OS = process.env.OS;
      savedEnv.PROCESSOR_ARCHITECTURE = process.env.PROCESSOR_ARCHITECTURE;
      savedEnv.SECRET_API_KEY = process.env.SECRET_API_KEY;
      savedEnv.CRON_AGENTS_CUSTOM = process.env.CRON_AGENTS_CUSTOM;
      savedEnv.NONEXISTENT_VAR_12345 = process.env.NONEXISTENT_VAR_12345;
    });

    afterEach(() => {
      for (const [key, val] of Object.entries(savedEnv)) {
        if (val === undefined) delete process.env[key];
        else process.env[key] = val;
      }
    });

    it('resolves CRON_AGENTS_ prefixed var', () => {
      process.env.CRON_AGENTS_TEST_VAR = 'hello-safe';
      const { resolved, warnings } = resolveVariables('{{env.CRON_AGENTS_TEST_VAR}}', baseContext());
      expect(resolved).toBe('hello-safe');
      expect(warnings).toHaveLength(0);
    });

    it('resolves another CRON_AGENTS_ prefixed var', () => {
      process.env.CRON_AGENTS_CUSTOM = 'custom-value';
      const { resolved } = resolveVariables('{{env.CRON_AGENTS_CUSTOM}}', baseContext());
      expect(resolved).toBe('custom-value');
    });

    it('resolves safe var HOME', () => {
      process.env.HOME = '/home/user';
      const { resolved } = resolveVariables('{{env.HOME}}', baseContext());
      expect(resolved).toBe('/home/user');
    });

    it('resolves safe var USERPROFILE', () => {
      process.env.USERPROFILE = 'C:\\Users\\test';
      const { resolved } = resolveVariables('{{env.USERPROFILE}}', baseContext());
      expect(resolved).toBe('C:\\Users\\test');
    });

    it('resolves safe var USERNAME', () => {
      process.env.USERNAME = 'testuser';
      const { resolved } = resolveVariables('{{env.USERNAME}}', baseContext());
      expect(resolved).toBe('testuser');
    });

    it('resolves safe var USER', () => {
      process.env.USER = 'testuser2';
      const { resolved } = resolveVariables('{{env.USER}}', baseContext());
      expect(resolved).toBe('testuser2');
    });

    it('resolves safe var NODE_ENV', () => {
      process.env.NODE_ENV = 'production';
      const { resolved } = resolveVariables('{{env.NODE_ENV}}', baseContext());
      expect(resolved).toBe('production');
    });

    it('resolves safe var COMPUTERNAME', () => {
      process.env.COMPUTERNAME = 'MY-PC';
      const { resolved } = resolveVariables('{{env.COMPUTERNAME}}', baseContext());
      expect(resolved).toBe('MY-PC');
    });

    it('resolves safe var HOSTNAME', () => {
      process.env.HOSTNAME = 'my-host';
      const { resolved } = resolveVariables('{{env.HOSTNAME}}', baseContext());
      expect(resolved).toBe('my-host');
    });

    it('resolves safe var OS', () => {
      process.env.OS = 'Windows_NT';
      const { resolved } = resolveVariables('{{env.OS}}', baseContext());
      expect(resolved).toBe('Windows_NT');
    });

    it('resolves safe var PROCESSOR_ARCHITECTURE', () => {
      process.env.PROCESSOR_ARCHITECTURE = 'AMD64';
      const { resolved } = resolveVariables('{{env.PROCESSOR_ARCHITECTURE}}', baseContext());
      expect(resolved).toBe('AMD64');
    });

    it('resolves safe var TZ', () => {
      process.env.TZ = 'UTC';
      const { resolved } = resolveVariables('{{env.TZ}}', baseContext());
      expect(resolved).toBe('UTC');
    });

    it('resolves safe var LANG', () => {
      process.env.LANG = 'en_US.UTF-8';
      const { resolved } = resolveVariables('{{env.LANG}}', baseContext());
      expect(resolved).toBe('en_US.UTF-8');
    });

    it('resolves safe var LANGUAGE', () => {
      process.env.LANGUAGE = 'en';
      const { resolved } = resolveVariables('{{env.LANGUAGE}}', baseContext());
      expect(resolved).toBe('en');
    });

    it('resolves safe var LC_ALL', () => {
      process.env.LC_ALL = 'C';
      const { resolved } = resolveVariables('{{env.LC_ALL}}', baseContext());
      expect(resolved).toBe('C');
    });

    it('redacts unsafe env var', () => {
      process.env.SECRET_API_KEY = 'supersecret';
      const { resolved, warnings } = resolveVariables('{{env.SECRET_API_KEY}}', baseContext());
      expect(resolved).toContain('[REDACTED');
      expect(resolved).toContain('env.SECRET_API_KEY');
      expect(resolved).not.toContain('supersecret');
      expect(warnings).toHaveLength(0);
    });

    it('redacts unsafe var with helpful message', () => {
      process.env.SECRET_API_KEY = 'key123';
      const { resolved } = resolveVariables('{{env.SECRET_API_KEY}}', baseContext());
      expect(resolved).toBe('[REDACTED: env.SECRET_API_KEY — use CRON_AGENTS_ prefix for safe access]');
    });

    it('returns warning for non-existent env var', () => {
      delete process.env.NONEXISTENT_VAR_12345;
      const { resolved, warnings } = resolveVariables('{{env.NONEXISTENT_VAR_12345}}', baseContext());
      expect(resolved).toBe('{{env.NONEXISTENT_VAR_12345}}');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('env.NONEXISTENT_VAR_12345');
    });

    it('resolves multiple env vars in one string', () => {
      process.env.CRON_AGENTS_A = 'alpha';
      process.env.CRON_AGENTS_B = 'beta';
      savedEnv.CRON_AGENTS_A = undefined;
      savedEnv.CRON_AGENTS_B = undefined;
      const { resolved, warnings } = resolveVariables('{{env.CRON_AGENTS_A}}-{{env.CRON_AGENTS_B}}', baseContext());
      expect(resolved).toBe('alpha-beta');
      expect(warnings).toHaveLength(0);
    });

    it('mixes safe and redacted env vars', () => {
      process.env.HOME = '/home/test';
      process.env.SECRET_API_KEY = 'secret';
      const { resolved } = resolveVariables('{{env.HOME}} {{env.SECRET_API_KEY}}', baseContext());
      expect(resolved).toContain('/home/test');
      expect(resolved).toContain('[REDACTED');
    });
  });

  // -------------------------------------------------------------------------
  // Git variables
  // -------------------------------------------------------------------------
  describe('git variables (git.*)', () => {
    beforeEach(() => {
      mockedExecSync.mockClear();
    });

    it('resolves git.branch', () => {
      const { resolved, warnings } = resolveVariables('{{git.branch}}', baseContext());
      expect(resolved).toBe('main');
      expect(warnings).toHaveLength(0);
    });

    it('resolves git.lastCommit', () => {
      const { resolved } = resolveVariables('{{git.lastCommit}}', baseContext());
      expect(resolved).toBe('last commit msg');
    });

    it('resolves git.shortHash', () => {
      const { resolved } = resolveVariables('{{git.shortHash}}', baseContext());
      expect(resolved).toBe('abc1234');
    });

    it('resolves git.hash', () => {
      const { resolved } = resolveVariables('{{git.hash}}', baseContext());
      expect(resolved).toBe('abc1234567890abcdef');
    });

    it('resolves git.author', () => {
      const { resolved } = resolveVariables('{{git.author}}', baseContext());
      expect(resolved).toBe('Test Author');
    });

    it('resolves git.repoName', () => {
      const { resolved } = resolveVariables('{{git.repoName}}', baseContext());
      expect(resolved).toBe('my-repo');
    });

    it('calls execSync for git.branch with correct command', () => {
      resolveVariables('{{git.branch}}', baseContext());
      expect(mockedExecSync).toHaveBeenCalledWith(
        'git rev-parse --abbrev-ref HEAD',
        expect.objectContaining({ encoding: 'utf-8', timeout: 5000 }),
      );
    });

    it('returns [git error: ...] when execSync throws', () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error('git not found');
      });
      const { resolved, warnings } = resolveVariables('{{git.branch}}', baseContext());
      expect(resolved).toBe('[git error: branch]');
      expect(warnings).toHaveLength(0);
    });

    it('returns [git error: ...] for each failing git var', () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error('fail');
      });
      const { resolved } = resolveVariables('{{git.branch}} {{git.author}}', baseContext());
      expect(resolved).toBe('[git error: branch] [git error: author]');
    });

    it('returns undefined (warning) for unknown git subvar', () => {
      const { resolved, warnings } = resolveVariables('{{git.unknown}}', baseContext());
      expect(resolved).toBe('{{git.unknown}}');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('git.unknown');
    });

    it('resolves multiple git vars', () => {
      // Restore default mock after beforeEach clear
      mockedExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('abbrev-ref')) return 'main\n';
        if (typeof cmd === 'string' && cmd.includes('--short')) return 'abc1234\n';
        return '';
      });
      const { resolved } = resolveVariables('{{git.branch}}/{{git.shortHash}}', baseContext());
      expect(resolved).toBe('main/abc1234');
    });
  });

  // -------------------------------------------------------------------------
  // Custom variables (task-level and global)
  // -------------------------------------------------------------------------
  describe('custom variables (task and global)', () => {
    it('resolves task-level variable', () => {
      const ctx = baseContext({ taskVariables: { project: 'myproject' } });
      const { resolved, warnings } = resolveVariables('{{project}}', ctx);
      expect(resolved).toBe('myproject');
      expect(warnings).toHaveLength(0);
    });

    it('resolves global variable', () => {
      const ctx = baseContext({ globalVariables: { org: 'myorg' } });
      const { resolved, warnings } = resolveVariables('{{org}}', ctx);
      expect(resolved).toBe('myorg');
      expect(warnings).toHaveLength(0);
    });

    it('task variable overrides global variable', () => {
      const ctx = baseContext({
        taskVariables: { name: 'task-val' },
        globalVariables: { name: 'global-val' },
      });
      const { resolved } = resolveVariables('{{name}}', ctx);
      expect(resolved).toBe('task-val');
    });

    it('falls back to global when task variable not present', () => {
      const ctx = baseContext({
        taskVariables: { other: 'x' },
        globalVariables: { name: 'global-val' },
      });
      const { resolved } = resolveVariables('{{name}}', ctx);
      expect(resolved).toBe('global-val');
    });

    it('warns when custom var not in either', () => {
      const ctx = baseContext({ taskVariables: {}, globalVariables: {} });
      const { resolved, warnings } = resolveVariables('{{missing}}', ctx);
      expect(resolved).toBe('{{missing}}');
      expect(warnings).toHaveLength(1);
    });

    it('warns when custom var not in either (no maps)', () => {
      const { warnings } = resolveVariables('{{missing}}', baseContext());
      expect(warnings).toHaveLength(1);
    });

    it('does not resolve custom var if it matches a builtin name', () => {
      // Built-in takes precedence over custom
      const ctx = baseContext({ taskVariables: { date: 'custom-date' } });
      const { resolved } = resolveVariables('{{date}}', ctx);
      // Built-in date wins
      expect(resolved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('resolves multiple custom vars in one string', () => {
      const ctx = baseContext({
        taskVariables: { greeting: 'hello' },
        globalVariables: { target: 'world' },
      });
      const { resolved } = resolveVariables('{{greeting}} {{target}}', ctx);
      expect(resolved).toBe('hello world');
    });

    it('mixes built-in and custom variables', () => {
      const ctx = baseContext({
        taskId: 'mix',
        taskVariables: { extra: 'bonus' },
      });
      const { resolved } = resolveVariables('{{taskId}}-{{extra}}', ctx);
      expect(resolved).toBe('mix-bonus');
    });
  });
});

// ---------------------------------------------------------------------------
// redactForDisplay
// ---------------------------------------------------------------------------
describe('redactForDisplay', () => {
  it('replaces REDACTED pattern with [REDACTED]', () => {
    const input = '[REDACTED: env.SECRET_KEY — use CRON_AGENTS_ prefix for safe access]';
    expect(redactForDisplay(input)).toBe('[REDACTED]');
  });

  it('replaces multiple REDACTED patterns', () => {
    const input = 'a [REDACTED: env.A — use CRON_AGENTS_ prefix for safe access] b [REDACTED: env.B — use CRON_AGENTS_ prefix for safe access]';
    const result = redactForDisplay(input);
    expect(result).toBe('a [REDACTED] b [REDACTED]');
  });

  it('does not modify text without REDACTED', () => {
    const input = 'just normal text {{date}} hello';
    expect(redactForDisplay(input)).toBe(input);
  });

  it('handles empty string', () => {
    expect(redactForDisplay('')).toBe('');
  });

  it('handles text that contains "REDACTED" but not the pattern', () => {
    const input = 'This is REDACTED info';
    expect(redactForDisplay(input)).toBe(input);
  });

  it('handles the exact bracket pattern only', () => {
    const input = 'before [REDACTED: env.X] after';
    expect(redactForDisplay(input)).toBe('before [REDACTED] after');
  });

  it('preserves surrounding text', () => {
    const input = 'Home: /home/user Key: [REDACTED: env.API_KEY] Done';
    const result = redactForDisplay(input);
    expect(result).toBe('Home: /home/user Key: [REDACTED] Done');
  });

  it('handles adjacent REDACTED patterns', () => {
    const input = '[REDACTED: env.A][REDACTED: env.B]';
    expect(redactForDisplay(input)).toBe('[REDACTED][REDACTED]');
  });
});

// ---------------------------------------------------------------------------
// listVariables
// ---------------------------------------------------------------------------
describe('listVariables', () => {
  it('finds all variable names in text', () => {
    const result = listVariables('{{date}} {{taskId}} {{git.branch}}');
    expect(result).toEqual(['date', 'taskId', 'git.branch']);
  });

  it('returns unique variable names (no duplicates)', () => {
    const result = listVariables('{{date}} {{date}} {{date}}');
    expect(result).toEqual(['date']);
  });

  it('returns empty array for empty string', () => {
    expect(listVariables('')).toEqual([]);
  });

  it('returns empty array for text without variables', () => {
    expect(listVariables('just plain text')).toEqual([]);
  });

  it('finds variables with underscores', () => {
    const result = listVariables('{{env.CRON_AGENTS_VAR}}');
    expect(result).toEqual(['env.CRON_AGENTS_VAR']);
  });

  it('finds variables with dots', () => {
    const result = listVariables('{{git.branch}}');
    expect(result).toEqual(['git.branch']);
  });

  it('finds multiple unique variables in mixed text', () => {
    const result = listVariables('Hello {{taskId}}, date is {{date}} and {{taskId}} again, plus {{agent}}');
    expect(result).toEqual(['taskId', 'date', 'agent']);
  });

  it('does not match empty braces', () => {
    expect(listVariables('{{}}')).toEqual([]);
  });

  it('does not match braces with spaces', () => {
    expect(listVariables('{{ date }}')).toEqual([]);
  });

  it('handles single variable', () => {
    expect(listVariables('{{year}}')).toEqual(['year']);
  });

  it('preserves order of first occurrence', () => {
    const result = listVariables('{{b}} {{a}} {{c}} {{b}}');
    expect(result).toEqual(['b', 'a', 'c']);
  });
});

// ---------------------------------------------------------------------------
// getBuiltinVariables
// ---------------------------------------------------------------------------
describe('getBuiltinVariables', () => {
  it('returns an array', () => {
    expect(Array.isArray(getBuiltinVariables())).toBe(true);
  });

  it('returns 18 items', () => {
    expect(getBuiltinVariables()).toHaveLength(18);
  });

  it('contains date', () => {
    expect(getBuiltinVariables()).toContain('date');
  });

  it('contains time', () => {
    expect(getBuiltinVariables()).toContain('time');
  });

  it('contains datetime', () => {
    expect(getBuiltinVariables()).toContain('datetime');
  });

  it('contains timestamp', () => {
    expect(getBuiltinVariables()).toContain('timestamp');
  });

  it('contains weekday', () => {
    expect(getBuiltinVariables()).toContain('weekday');
  });

  it('contains month', () => {
    expect(getBuiltinVariables()).toContain('month');
  });

  it('contains year', () => {
    expect(getBuiltinVariables()).toContain('year');
  });

  it('contains taskId', () => {
    expect(getBuiltinVariables()).toContain('taskId');
  });

  it('contains runId', () => {
    expect(getBuiltinVariables()).toContain('runId');
  });

  it('contains attempt', () => {
    expect(getBuiltinVariables()).toContain('attempt');
  });

  it('contains agent', () => {
    expect(getBuiltinVariables()).toContain('agent');
  });

  it('contains env.<VAR_NAME>', () => {
    expect(getBuiltinVariables()).toContain('env.<VAR_NAME>');
  });

  it('contains git.branch', () => {
    expect(getBuiltinVariables()).toContain('git.branch');
  });

  it('contains git.lastCommit', () => {
    expect(getBuiltinVariables()).toContain('git.lastCommit');
  });

  it('contains git.shortHash', () => {
    expect(getBuiltinVariables()).toContain('git.shortHash');
  });

  it('contains git.hash', () => {
    expect(getBuiltinVariables()).toContain('git.hash');
  });

  it('contains git.author', () => {
    expect(getBuiltinVariables()).toContain('git.author');
  });

  it('contains git.repoName', () => {
    expect(getBuiltinVariables()).toContain('git.repoName');
  });

  it('returns same array on repeated calls', () => {
    const a = getBuiltinVariables();
    const b = getBuiltinVariables();
    expect(a).toEqual(b);
  });
});
