import { describe, it, expect, vi } from 'vitest';
import {
  getRecurrenceLabel,
  buildScheduledTaskName,
  parseCronExpression,
  generateTaskSchedulerCommand,
} from '../scheduler.js';

// ─── getRecurrenceLabel ─────────────────────────────────────────────────────

describe('getRecurrenceLabel', () => {
  describe('Daily expressions', () => {
    it('returns Daily for "0 9 * * *"', () => {
      expect(getRecurrenceLabel('0 9 * * *')).toBe('Daily');
    });

    it('returns Daily for "30 14 * * *"', () => {
      expect(getRecurrenceLabel('30 14 * * *')).toBe('Daily');
    });

    it('returns Daily for "0 0 * * *"', () => {
      expect(getRecurrenceLabel('0 0 * * *')).toBe('Daily');
    });

    it('returns Daily for "45 22 * * *"', () => {
      expect(getRecurrenceLabel('45 22 * * *')).toBe('Daily');
    });
  });

  describe('Hourly expressions', () => {
    it('returns Hourly for wildcard hour "0 * * * *"', () => {
      expect(getRecurrenceLabel('0 * * * *')).toBe('Hourly');
    });

    it('returns Hourly for hour range "0 7-17 * * *"', () => {
      expect(getRecurrenceLabel('0 7-17 * * *')).toBe('Hourly');
    });

    it('returns Hourly for hour step "0 */2 * * *"', () => {
      expect(getRecurrenceLabel('0 */2 * * *')).toBe('Hourly');
    });

    it('returns Hourly for "30 */4 * * *"', () => {
      expect(getRecurrenceLabel('30 */4 * * *')).toBe('Hourly');
    });

    it('returns Hourly for "*/5 * * * *" (wildcard hour)', () => {
      expect(getRecurrenceLabel('*/5 * * * *')).toBe('Hourly');
    });

    it('returns Hourly for "0 1-3 * * *"', () => {
      expect(getRecurrenceLabel('0 1-3 * * *')).toBe('Hourly');
    });
  });

  describe('Weekly expressions', () => {
    it('returns Weekly for "0 9 * * 1"', () => {
      expect(getRecurrenceLabel('0 9 * * 1')).toBe('Weekly');
    });

    it('returns Weekly for "0 9 * * 0,6" (weekend)', () => {
      expect(getRecurrenceLabel('0 9 * * 0,6')).toBe('Weekly');
    });

    it('returns Weekly for "0 9 * * 1-5" (weekdays)', () => {
      expect(getRecurrenceLabel('0 9 * * 1-5')).toBe('Weekly');
    });

    it('returns Weekly for Sunday "0 9 * * 0"', () => {
      expect(getRecurrenceLabel('0 9 * * 0')).toBe('Weekly');
    });

    it('returns Weekly for "0 9 * * 7" (Sunday alternate)', () => {
      expect(getRecurrenceLabel('0 9 * * 7')).toBe('Weekly');
    });
  });

  describe('Monthly expressions', () => {
    it('returns Monthly for "0 9 1 * *"', () => {
      expect(getRecurrenceLabel('0 9 1 * *')).toBe('Monthly');
    });

    it('returns Monthly for "0 9 15 * *"', () => {
      expect(getRecurrenceLabel('0 9 15 * *')).toBe('Monthly');
    });

    it('returns Monthly for "0 9 1,15 * *"', () => {
      expect(getRecurrenceLabel('0 9 1,15 * *')).toBe('Monthly');
    });

    it('returns Monthly for 5 specific months "0 9 1 1,2,3,4,5 *"', () => {
      expect(getRecurrenceLabel('0 9 1 1,2,3,4,5 *')).toBe('Monthly');
    });

    it('returns Monthly for 6 months "0 9 1 1,3,5,7,9,11 *"', () => {
      expect(getRecurrenceLabel('0 9 1 1,3,5,7,9,11 *')).toBe('Monthly');
    });
  });

  describe('Quarterly expressions', () => {
    it('returns Quarterly for "0 9 1 1,4,7,10 *"', () => {
      expect(getRecurrenceLabel('0 9 1 1,4,7,10 *')).toBe('Quarterly');
    });

    it('returns Quarterly for "0 9 1 3,6,9,12 *"', () => {
      expect(getRecurrenceLabel('0 9 1 3,6,9,12 *')).toBe('Quarterly');
    });

    it('returns Quarterly for 1 month "0 9 1 1 *" (≤4)', () => {
      expect(getRecurrenceLabel('0 9 1 1 *')).toBe('Quarterly');
    });

    it('returns Quarterly for 2 months "0 9 1 1,7 *"', () => {
      expect(getRecurrenceLabel('0 9 1 1,7 *')).toBe('Quarterly');
    });

    it('returns Quarterly for 3 months "0 9 1 1,5,9 *"', () => {
      expect(getRecurrenceLabel('0 9 1 1,5,9 *')).toBe('Quarterly');
    });
  });

  describe('Edge cases', () => {
    it('returns Daily for invalid format (too few parts)', () => {
      expect(getRecurrenceLabel('bad cron')).toBe('Daily');
    });

    it('returns Daily for empty string', () => {
      expect(getRecurrenceLabel('')).toBe('Daily');
    });

    it('returns Daily for single word', () => {
      expect(getRecurrenceLabel('daily')).toBe('Daily');
    });

    it('returns Daily for too many parts', () => {
      expect(getRecurrenceLabel('0 9 * * * *')).toBe('Daily');
    });
  });
});

// ─── buildScheduledTaskName ─────────────────────────────────────────────────

describe('buildScheduledTaskName', () => {
  it('returns "cron-agents-my-task" for "my-task"', () => {
    expect(buildScheduledTaskName('my-task')).toBe('cron-agents-my-task');
  });

  it('returns "cron-agents-daily-summary" for "daily-summary"', () => {
    expect(buildScheduledTaskName('daily-summary')).toBe('cron-agents-daily-summary');
  });

  it('returns "cron-agents-task_123" for "task_123"', () => {
    expect(buildScheduledTaskName('task_123')).toBe('cron-agents-task_123');
  });

  it('handles task id with spaces', () => {
    expect(buildScheduledTaskName('task with spaces')).toBe('cron-agents-task with spaces');
  });

  it('handles UPPERCASE task id', () => {
    expect(buildScheduledTaskName('UPPERCASE')).toBe('cron-agents-UPPERCASE');
  });

  it('ignores optional cronExpr parameter', () => {
    expect(buildScheduledTaskName('my-task', '0 9 * * *')).toBe('cron-agents-my-task');
  });

  it('ignores undefined cronExpr', () => {
    expect(buildScheduledTaskName('my-task', undefined)).toBe('cron-agents-my-task');
  });

  it('handles empty string taskId', () => {
    expect(buildScheduledTaskName('')).toBe('cron-agents-');
  });

  it('handles numeric-like taskId', () => {
    expect(buildScheduledTaskName('42')).toBe('cron-agents-42');
  });

  it('handles dots in taskId', () => {
    expect(buildScheduledTaskName('v1.0.0')).toBe('cron-agents-v1.0.0');
  });
});

// ─── parseCronExpression ────────────────────────────────────────────────────

describe('parseCronExpression', () => {
  describe('Daily triggers', () => {
    it('parses "0 9 * * *" as daily at 09:00', () => {
      const result = parseCronExpression('0 9 * * *');
      expect(result).toEqual({ type: 'daily', time: '09:00' });
    });

    it('parses "0 0 * * *" as daily at 00:00 (midnight)', () => {
      const result = parseCronExpression('0 0 * * *');
      expect(result).toEqual({ type: 'daily', time: '00:00' });
    });

    it('parses "30 14 * * *" as daily at 14:30', () => {
      const result = parseCronExpression('30 14 * * *');
      expect(result).toEqual({ type: 'daily', time: '14:30' });
    });

    it('parses "59 23 * * *" as daily at 23:59', () => {
      const result = parseCronExpression('59 23 * * *');
      expect(result).toEqual({ type: 'daily', time: '23:59' });
    });

    it('parses "5 3 * * *" with zero-padded time 03:05', () => {
      const result = parseCronExpression('5 3 * * *');
      expect(result).toEqual({ type: 'daily', time: '03:05' });
    });

    it('parses step-based hour "0 */2 * * *" as daily with first step value', () => {
      const result = parseCronExpression('0 */2 * * *');
      expect(result.type).toBe('daily');
      // Hour "*/2" expands to [0,2,4,...22], first value is 0
      expect(result.time).toBe('00:00');
    });
  });

  describe('Weekly triggers', () => {
    it('parses "0 9 * * 1" as weekly Monday at 09:00', () => {
      const result = parseCronExpression('0 9 * * 1');
      expect(result.type).toBe('weekly');
      expect(result.time).toBe('09:00');
      expect(result.daysOfWeek).toEqual(['Monday']);
    });

    it('parses "0 9 * * 0" as weekly Sunday', () => {
      const result = parseCronExpression('0 9 * * 0');
      expect(result.type).toBe('weekly');
      expect(result.daysOfWeek).toEqual(['Sunday']);
    });

    it('parses "0 9 * * 7" as weekly Sunday (alternate)', () => {
      const result = parseCronExpression('0 9 * * 7');
      expect(result.type).toBe('weekly');
      expect(result.daysOfWeek).toEqual(['Sunday']);
    });

    it('parses "0 9 * * 1,3,5" as Monday, Wednesday, Friday', () => {
      const result = parseCronExpression('0 9 * * 1,3,5');
      expect(result.type).toBe('weekly');
      expect(result.daysOfWeek).toEqual(['Monday', 'Wednesday', 'Friday']);
    });

    it('parses "0 9 * * 1-5" as weekdays (Mon-Fri)', () => {
      const result = parseCronExpression('0 9 * * 1-5');
      expect(result.type).toBe('weekly');
      expect(result.daysOfWeek).toHaveLength(5);
      expect(result.daysOfWeek).toEqual([
        'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
      ]);
    });

    it('parses "0 9 * * 0,6" as weekend (Sunday, Saturday)', () => {
      const result = parseCronExpression('0 9 * * 0,6');
      expect(result.type).toBe('weekly');
      expect(result.daysOfWeek).toContain('Sunday');
      expect(result.daysOfWeek).toContain('Saturday');
    });

    it('parses "0 9 * * 6" as Saturday', () => {
      const result = parseCronExpression('0 9 * * 6');
      expect(result.type).toBe('weekly');
      expect(result.daysOfWeek).toEqual(['Saturday']);
    });

    it('deduplicates Sunday for "0 9 * * 0,7"', () => {
      const result = parseCronExpression('0 9 * * 0,7');
      expect(result.type).toBe('weekly');
      // 0 and 7 both map to Sunday, should be deduplicated
      expect(result.daysOfWeek).toEqual(['Sunday']);
    });

    it('parses full week "0 9 * * 0-6" with all 7 days', () => {
      const result = parseCronExpression('0 9 * * 0-6');
      expect(result.type).toBe('weekly');
      expect(result.daysOfWeek).toHaveLength(7);
    });
  });

  describe('Monthly triggers', () => {
    it('parses "0 9 1 * *" as monthly on 1st, all months', () => {
      const result = parseCronExpression('0 9 1 * *');
      expect(result.type).toBe('monthly');
      expect(result.time).toBe('09:00');
      expect(result.daysOfMonth).toEqual([1]);
      expect(result.monthNames).toHaveLength(12);
      expect(result.monthNames).toContain('January');
      expect(result.monthNames).toContain('December');
    });

    it('parses "0 9 15 * *" as monthly on 15th', () => {
      const result = parseCronExpression('0 9 15 * *');
      expect(result.type).toBe('monthly');
      expect(result.daysOfMonth).toEqual([15]);
    });

    it('parses "0 9 1,15 * *" as monthly on 1st and 15th', () => {
      const result = parseCronExpression('0 9 1,15 * *');
      expect(result.type).toBe('monthly');
      expect(result.daysOfMonth).toEqual([1, 15]);
    });

    it('parses "0 9 1 1,4,7,10 *" with specific months', () => {
      const result = parseCronExpression('0 9 1 1,4,7,10 *');
      expect(result.type).toBe('monthly');
      expect(result.daysOfMonth).toEqual([1]);
      expect(result.monthNames).toEqual(['January', 'April', 'July', 'October']);
    });

    it('parses "0 9 1 3,6,9,12 *" with Q-end months', () => {
      const result = parseCronExpression('0 9 1 3,6,9,12 *');
      expect(result.type).toBe('monthly');
      expect(result.monthNames).toEqual(['March', 'June', 'September', 'December']);
    });

    it('parses "0 9 1 6 *" with single month (June)', () => {
      const result = parseCronExpression('0 9 1 6 *');
      expect(result.type).toBe('monthly');
      expect(result.monthNames).toEqual(['June']);
    });

    it('parses day range "0 9 1-5 * *"', () => {
      const result = parseCronExpression('0 9 1-5 * *');
      expect(result.type).toBe('monthly');
      expect(result.daysOfMonth).toEqual([1, 2, 3, 4, 5]);
    });

    it('parses "0 9 31 * *" for last day of long months', () => {
      const result = parseCronExpression('0 9 31 * *');
      expect(result.type).toBe('monthly');
      expect(result.daysOfMonth).toEqual([31]);
    });
  });

  describe('Time parsing', () => {
    it('uses 00 for hour when hour is wildcard, resolves minute', () => {
      const result = parseCronExpression('30 * * * *');
      expect(result.time).toBe('00:30');
    });

    it('uses 00 for minute when minute is wildcard, resolves hour', () => {
      const result = parseCronExpression('* 9 * * *');
      expect(result.time).toBe('09:00');
    });

    it('defaults to 00:00 when both are wildcard', () => {
      const result = parseCronExpression('* * * * *');
      expect(result.time).toBe('00:00');
    });

    it('zero-pads single-digit hour', () => {
      const result = parseCronExpression('0 3 * * *');
      expect(result.time).toBe('03:00');
    });

    it('zero-pads single-digit minute', () => {
      const result = parseCronExpression('5 12 * * *');
      expect(result.time).toBe('12:05');
    });

    it('handles double-digit hour and minute', () => {
      const result = parseCronExpression('45 22 * * *');
      expect(result.time).toBe('22:45');
    });
  });

  describe('Invalid expressions', () => {
    it('throws for "bad"', () => {
      expect(() => parseCronExpression('bad')).toThrow('Invalid cron expression');
    });

    it('throws for empty string', () => {
      expect(() => parseCronExpression('')).toThrow('Invalid cron expression');
    });

    it('throws for 6 fields "1 2 3 4 5 6"', () => {
      expect(() => parseCronExpression('1 2 3 4 5 6')).toThrow();
    });

    it('throws for random text "hello world foo bar baz"', () => {
      expect(() => parseCronExpression('hello world foo bar baz')).toThrow();
    });
  });
});

// ─── generateTaskSchedulerCommand ───────────────────────────────────────────

describe('generateTaskSchedulerCommand', () => {
  const projectRoot = 'C:\\Projects\\cron-agents';

  describe('Daily trigger', () => {
    it('generates PowerShell with ScheduleByDay XML', () => {
      const trigger = { type: 'daily' as const, time: '09:00' };
      const result = generateTaskSchedulerCommand('my-task', 'C:\\tasks\\my-task.md', trigger, projectRoot);
      expect(result).toContain('ScheduleByDay');
      expect(result).toContain('DaysInterval');
    });

    it('includes Register-ScheduledTask', () => {
      const trigger = { type: 'daily' as const, time: '09:00' };
      const result = generateTaskSchedulerCommand('my-task', 'C:\\tasks\\my-task.md', trigger, projectRoot);
      expect(result).toContain('Register-ScheduledTask');
    });

    it('includes the task name', () => {
      const trigger = { type: 'daily' as const, time: '09:00' };
      const result = generateTaskSchedulerCommand('my-task', 'C:\\tasks\\my-task.md', trigger, projectRoot);
      expect(result).toContain('cron-agents-my-task');
    });

    it('includes executor.js path from projectRoot', () => {
      const trigger = { type: 'daily' as const, time: '09:00' };
      const result = generateTaskSchedulerCommand('my-task', 'C:\\tasks\\my-task.md', trigger, projectRoot);
      expect(result).toContain('executor.js');
    });

    it('includes the task file path', () => {
      const trigger = { type: 'daily' as const, time: '09:00' };
      const result = generateTaskSchedulerCommand('my-task', 'C:\\tasks\\my-task.md', trigger, projectRoot);
      expect(result).toContain('my-task.md');
    });

    it('includes time in StartBoundary', () => {
      const trigger = { type: 'daily' as const, time: '14:30' };
      const result = generateTaskSchedulerCommand('t', 'f.md', trigger, projectRoot);
      expect(result).toContain('T14:30:00');
    });
  });

  describe('Weekly trigger', () => {
    it('generates PowerShell with ScheduleByWeek XML', () => {
      const trigger = {
        type: 'weekly' as const,
        time: '09:00',
        daysOfWeek: ['Monday', 'Wednesday', 'Friday'],
      };
      const result = generateTaskSchedulerCommand('weekly-task', 'C:\\tasks\\w.md', trigger, projectRoot);
      expect(result).toContain('ScheduleByWeek');
      expect(result).toContain('DaysOfWeek');
    });

    it('includes day names in XML', () => {
      const trigger = {
        type: 'weekly' as const,
        time: '09:00',
        daysOfWeek: ['Monday', 'Friday'],
      };
      const result = generateTaskSchedulerCommand('w', 'f.md', trigger, projectRoot);
      expect(result).toContain('<Monday />');
      expect(result).toContain('<Friday />');
    });

    it('includes WeeksInterval', () => {
      const trigger = {
        type: 'weekly' as const,
        time: '09:00',
        daysOfWeek: ['Tuesday'],
      };
      const result = generateTaskSchedulerCommand('w', 'f.md', trigger, projectRoot);
      expect(result).toContain('WeeksInterval');
    });
  });

  describe('Monthly trigger', () => {
    it('generates PowerShell with ScheduleByMonth XML', () => {
      const trigger = {
        type: 'monthly' as const,
        time: '09:00',
        daysOfMonth: [1],
        monthNames: ['January', 'April', 'July', 'October'],
      };
      const result = generateTaskSchedulerCommand('monthly-task', 'C:\\tasks\\m.md', trigger, projectRoot);
      expect(result).toContain('ScheduleByMonth');
      expect(result).toContain('DaysOfMonth');
      expect(result).toContain('Months');
    });

    it('includes month names in XML', () => {
      const trigger = {
        type: 'monthly' as const,
        time: '09:00',
        daysOfMonth: [15],
        monthNames: ['March', 'September'],
      };
      const result = generateTaskSchedulerCommand('m', 'f.md', trigger, projectRoot);
      expect(result).toContain('<March />');
      expect(result).toContain('<September />');
    });

    it('includes day values in XML', () => {
      const trigger = {
        type: 'monthly' as const,
        time: '09:00',
        daysOfMonth: [1, 15],
        monthNames: ['January'],
      };
      const result = generateTaskSchedulerCommand('m', 'f.md', trigger, projectRoot);
      expect(result).toContain('<Day>1</Day>');
      expect(result).toContain('<Day>15</Day>');
    });
  });

  describe('General output structure', () => {
    it('output is a valid PowerShell script (contains $taskName)', () => {
      const trigger = { type: 'daily' as const, time: '09:00' };
      const result = generateTaskSchedulerCommand('t', 'f.md', trigger, projectRoot);
      expect(result).toContain('$taskName');
      expect(result).toContain('$taskXml');
    });

    it('contains XML task declaration', () => {
      const trigger = { type: 'daily' as const, time: '09:00' };
      const result = generateTaskSchedulerCommand('t', 'f.md', trigger, projectRoot);
      expect(result).toContain('<?xml version="1.0"');
      expect(result).toContain('<Task version="1.4"');
    });

    it('contains -Force flag for idempotent registration', () => {
      const trigger = { type: 'daily' as const, time: '09:00' };
      const result = generateTaskSchedulerCommand('t', 'f.md', trigger, projectRoot);
      expect(result).toContain('-Force');
    });

    it('contains task settings (StartWhenAvailable, AllowStartOnDemand)', () => {
      const trigger = { type: 'daily' as const, time: '09:00' };
      const result = generateTaskSchedulerCommand('t', 'f.md', trigger, projectRoot);
      expect(result).toContain('<StartWhenAvailable>true</StartWhenAvailable>');
      expect(result).toContain('<AllowStartOnDemand>true</AllowStartOnDemand>');
    });

    it('contains trigger type info in Write-Host', () => {
      const trigger = { type: 'weekly' as const, time: '10:00', daysOfWeek: ['Monday'] };
      const result = generateTaskSchedulerCommand('t', 'f.md', trigger, projectRoot);
      expect(result).toContain('weekly at 10:00');
    });
  });
});
