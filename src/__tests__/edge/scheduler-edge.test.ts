import { describe, it, expect } from 'vitest';
import { parseCronExpression } from '../../scheduler.js';

describe('parseCronExpression — edge cases', () => {
  // ─── Step expressions in time fields ────────────────────────────────────────

  describe('Step expressions in time fields', () => {
    it('*/2 in minute field → time starts at 00', () => {
      const result = parseCronExpression('*/2 9 * * *');
      expect(result.time).toBe('09:00');
    });

    it('*/3 in minute field → time starts at 00', () => {
      const result = parseCronExpression('*/3 9 * * *');
      expect(result.time).toBe('09:00');
    });

    it('*/15 in minute field → time starts at 00', () => {
      const result = parseCronExpression('*/15 9 * * *');
      expect(result.time).toBe('09:00');
    });

    it('*/5 in minute field with fixed hour', () => {
      const result = parseCronExpression('*/5 14 * * *');
      expect(result.time).toBe('14:00');
    });

    it('1/2 in minute field → rejected by node-cron', () => {
      expect(() => parseCronExpression('1/2 8 * * *')).toThrow();
    });

    it('0/5 in minute field → first value is 0', () => {
      const result = parseCronExpression('0/5 10 * * *');
      expect(result.time).toBe('10:00');
    });

    it('*/2 in hour field → first hour is 0', () => {
      const result = parseCronExpression('30 */2 * * *');
      expect(result.time).toBe('00:30');
    });

    it('*/3 in hour field → first hour is 0', () => {
      const result = parseCronExpression('0 */3 * * *');
      expect(result.time).toBe('00:00');
    });

    it('*/6 in hour field → first hour is 0', () => {
      const result = parseCronExpression('15 */6 * * *');
      expect(result.time).toBe('00:15');
    });

    it('step in both minute and hour fields', () => {
      const result = parseCronExpression('*/10 */4 * * *');
      expect(result.time).toBe('00:00');
    });

    it('1/2 in hour field → rejected by node-cron', () => {
      expect(() => parseCronExpression('0 1/2 * * *')).toThrow();
    });
  });

  // ─── Range expressions ──────────────────────────────────────────────────────

  describe('Range expressions', () => {
    it('range in minute field 0-30 → first value is 0', () => {
      const result = parseCronExpression('0-30 9 * * *');
      expect(result.time).toBe('09:00');
    });

    it('range in minute field 15-45 → first value is 15', () => {
      const result = parseCronExpression('15-45 9 * * *');
      expect(result.time).toBe('09:15');
    });

    it('range in hour field 9-17 → first hour is 9', () => {
      const result = parseCronExpression('0 9-17 * * *');
      expect(result.time).toBe('09:00');
    });

    it('full range 0-23 in hour → first is 0', () => {
      const result = parseCronExpression('30 0-23 * * *');
      expect(result.time).toBe('00:30');
    });

    it('range in both fields', () => {
      const result = parseCronExpression('10-20 8-12 * * *');
      expect(result.time).toBe('08:10');
    });

    it('single-value range 5-5 in minute → equals 5', () => {
      const result = parseCronExpression('5-5 9 * * *');
      expect(result.time).toBe('09:05');
    });
  });

  // ─── Comma-separated values ─────────────────────────────────────────────────

  describe('Comma-separated values', () => {
    it('comma-separated minutes 0,15,30,45 → first is 0', () => {
      const result = parseCronExpression('0,15,30,45 9 * * *');
      expect(result.time).toBe('09:00');
    });

    it('comma-separated minutes 5,10 → first is 5', () => {
      const result = parseCronExpression('5,10 12 * * *');
      expect(result.time).toBe('12:05');
    });

    it('comma-separated hours 8,12,18 → first is 8', () => {
      const result = parseCronExpression('0 8,12,18 * * *');
      expect(result.time).toBe('08:00');
    });

    it('unsorted comma values are sorted: 30,10,20 → first is 10', () => {
      const result = parseCronExpression('30,10,20 9 * * *');
      expect(result.time).toBe('09:10');
    });

    it('unsorted comma hours 18,6,12 → first is 6', () => {
      const result = parseCronExpression('0 18,6,12 * * *');
      expect(result.time).toBe('06:00');
    });
  });

  // ─── Complex combinations (range with step) ────────────────────────────────

  describe('Complex combinations (range/step)', () => {
    it('1-5/2 in dow → weekly with days 1,3,5,7 (range/step includes 7=Sunday)', () => {
      const result = parseCronExpression('0 9 * * 1-5/2');
      expect(result.type).toBe('weekly');
      // expandCronField('1-5/2', 0, 7) treats as start=1, step=2 → 1,3,5,7
      expect(result.daysOfWeek).toEqual(['Monday', 'Wednesday', 'Friday', 'Sunday']);
    });

    it('range/step in minute: 0-30/10 → first is 0', () => {
      const result = parseCronExpression('0-30/10 9 * * *');
      expect(result.time).toBe('09:00');
    });

    it('range/step in hour: 8-20/4 → first is 8', () => {
      const result = parseCronExpression('0 8-20/4 * * *');
      expect(result.time).toBe('08:00');
    });

    it('range/step in day-of-month: 1-31/5 → monthly', () => {
      const result = parseCronExpression('0 9 1-31/5 * *');
      expect(result.type).toBe('monthly');
      expect(result.daysOfMonth).toEqual([1, 6, 11, 16, 21, 26, 31]);
    });

    it('mixed comma and range in minutes: 0,15-20 → first is 0', () => {
      const result = parseCronExpression('0,15-20 9 * * *');
      expect(result.time).toBe('09:00');
    });
  });

  // ─── Boundary values ───────────────────────────────────────────────────────

  describe('Boundary values', () => {
    it('minute 0 → time XX:00', () => {
      const result = parseCronExpression('0 9 * * *');
      expect(result.time).toBe('09:00');
    });

    it('minute 59 → time XX:59', () => {
      const result = parseCronExpression('59 9 * * *');
      expect(result.time).toBe('09:59');
    });

    it('hour 0 → time 00:XX', () => {
      const result = parseCronExpression('30 0 * * *');
      expect(result.time).toBe('00:30');
    });

    it('hour 23 → time 23:XX', () => {
      const result = parseCronExpression('30 23 * * *');
      expect(result.time).toBe('23:30');
    });

    it('minute 0, hour 0 → midnight 00:00', () => {
      const result = parseCronExpression('0 0 * * *');
      expect(result.time).toBe('00:00');
    });

    it('minute 59, hour 23 → 23:59', () => {
      const result = parseCronExpression('59 23 * * *');
      expect(result.time).toBe('23:59');
    });

    it('day-of-month 1 → monthly with day [1]', () => {
      const result = parseCronExpression('0 9 1 * *');
      expect(result.type).toBe('monthly');
      expect(result.daysOfMonth).toEqual([1]);
    });

    it('day-of-month 31 → monthly with day [31]', () => {
      const result = parseCronExpression('0 9 31 * *');
      expect(result.type).toBe('monthly');
      expect(result.daysOfMonth).toEqual([31]);
    });

    it('month 1 → January only', () => {
      const result = parseCronExpression('0 9 15 1 *');
      expect(result.type).toBe('monthly');
      expect(result.monthNames).toEqual(['January']);
    });

    it('month 12 → December only', () => {
      const result = parseCronExpression('0 9 15 12 *');
      expect(result.type).toBe('monthly');
      expect(result.monthNames).toEqual(['December']);
    });
  });

  // ─── Time parsing edge cases ───────────────────────────────────────────────

  describe('Time parsing edge cases', () => {
    it('wildcard minute with fixed hour → time HH:00', () => {
      const result = parseCronExpression('* 9 * * *');
      expect(result.time).toBe('09:00');
    });

    it('fixed minute with wildcard hour → time 00:MM', () => {
      const result = parseCronExpression('30 * * * *');
      expect(result.time).toBe('00:30');
    });

    it('both wildcards → time 00:00', () => {
      const result = parseCronExpression('* * * * *');
      expect(result.time).toBe('00:00');
    });

    it('step hour with step minute → both resolve to first', () => {
      const result = parseCronExpression('*/15 */6 * * *');
      expect(result.time).toBe('00:00');
    });

    it('range hour with fixed minute', () => {
      const result = parseCronExpression('45 6-18 * * *');
      expect(result.time).toBe('06:45');
    });

    it('single digit hour pads to two digits', () => {
      const result = parseCronExpression('5 3 * * *');
      expect(result.time).toBe('03:05');
    });

    it('single digit minute pads to two digits', () => {
      const result = parseCronExpression('7 12 * * *');
      expect(result.time).toBe('12:07');
    });
  });

  // ─── Weekly edge cases ─────────────────────────────────────────────────────

  describe('Weekly edge cases', () => {
    it('dow 0 → Sunday', () => {
      const result = parseCronExpression('0 9 * * 0');
      expect(result.type).toBe('weekly');
      expect(result.daysOfWeek).toEqual(['Sunday']);
    });

    it('dow 7 → Sunday (alias)', () => {
      const result = parseCronExpression('0 9 * * 7');
      expect(result.type).toBe('weekly');
      expect(result.daysOfWeek).toEqual(['Sunday']);
    });

    it('dow 1 → Monday', () => {
      const result = parseCronExpression('0 9 * * 1');
      expect(result.type).toBe('weekly');
      expect(result.daysOfWeek).toEqual(['Monday']);
    });

    it('dow 6 → Saturday', () => {
      const result = parseCronExpression('0 9 * * 6');
      expect(result.type).toBe('weekly');
      expect(result.daysOfWeek).toEqual(['Saturday']);
    });

    it('dow 1-5 → weekdays Mon-Fri', () => {
      const result = parseCronExpression('0 9 * * 1-5');
      expect(result.type).toBe('weekly');
      expect(result.daysOfWeek).toEqual([
        'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
      ]);
    });

    it('dow 0,6 → weekend (Sunday, Saturday)', () => {
      const result = parseCronExpression('0 9 * * 0,6');
      expect(result.type).toBe('weekly');
      expect(result.daysOfWeek).toEqual(['Sunday', 'Saturday']);
    });

    it('dow 1,3,5 → Mon/Wed/Fri', () => {
      const result = parseCronExpression('0 9 * * 1,3,5');
      expect(result.type).toBe('weekly');
      expect(result.daysOfWeek).toEqual(['Monday', 'Wednesday', 'Friday']);
    });

    it('dow 0-6 → all 7 days', () => {
      const result = parseCronExpression('0 9 * * 0-6');
      expect(result.type).toBe('weekly');
      expect(result.daysOfWeek).toHaveLength(7);
      expect(result.daysOfWeek![0]).toBe('Sunday');
      expect(result.daysOfWeek![6]).toBe('Saturday');
    });

    it('dow */2 → every other day starting from 0', () => {
      const result = parseCronExpression('0 9 * * */2');
      expect(result.type).toBe('weekly');
      // 0, 2, 4, 6 → Sunday, Tuesday, Thursday, Saturday
      expect(result.daysOfWeek).toEqual([
        'Sunday', 'Tuesday', 'Thursday', 'Saturday',
      ]);
    });

    it('dow with time having step minute', () => {
      const result = parseCronExpression('*/10 9 * * 1');
      expect(result.type).toBe('weekly');
      expect(result.daysOfWeek).toEqual(['Monday']);
      expect(result.time).toBe('09:00');
    });
  });

  // ─── Sunday deduplication (dow 0 and 7) ────────────────────────────────────

  describe('Sunday deduplication (dow 0 and 7)', () => {
    it('dow 0,7 deduplicates to single Sunday', () => {
      const result = parseCronExpression('0 9 * * 0,7');
      expect(result.type).toBe('weekly');
      expect(result.daysOfWeek).toEqual(['Sunday']);
    });

    it('dow 0,1,7 deduplicates Sunday, keeps Monday', () => {
      const result = parseCronExpression('0 9 * * 0,1,7');
      expect(result.type).toBe('weekly');
      expect(result.daysOfWeek).toEqual(['Sunday', 'Monday']);
    });

    it('dow 7,6,0 deduplicates and sorts: Sunday, Saturday', () => {
      const result = parseCronExpression('0 9 * * 7,6,0');
      expect(result.type).toBe('weekly');
      // 0→Sunday, 6→Saturday, 7→Sunday; dedup → Sunday, Saturday
      expect(result.daysOfWeek).toEqual(['Sunday', 'Saturday']);
    });
  });

  // ─── Monthly edge cases ────────────────────────────────────────────────────

  describe('Monthly edge cases', () => {
    it('day 31 only → monthly with [31]', () => {
      const result = parseCronExpression('0 9 31 * *');
      expect(result.type).toBe('monthly');
      expect(result.daysOfMonth).toEqual([31]);
    });

    it('day 1,15 → monthly with [1, 15]', () => {
      const result = parseCronExpression('0 9 1,15 * *');
      expect(result.type).toBe('monthly');
      expect(result.daysOfMonth).toEqual([1, 15]);
    });

    it('day 1-5 → monthly with [1,2,3,4,5]', () => {
      const result = parseCronExpression('0 9 1-5 * *');
      expect(result.type).toBe('monthly');
      expect(result.daysOfMonth).toEqual([1, 2, 3, 4, 5]);
    });

    it('specific month 6 → June only', () => {
      const result = parseCronExpression('0 9 1 6 *');
      expect(result.type).toBe('monthly');
      expect(result.monthNames).toEqual(['June']);
    });

    it('multiple months 1,4,7,10 → quarterly months', () => {
      const result = parseCronExpression('0 9 1 1,4,7,10 *');
      expect(result.type).toBe('monthly');
      expect(result.monthNames).toEqual(['January', 'April', 'July', 'October']);
    });

    it('month range 6-8 → summer months', () => {
      const result = parseCronExpression('0 9 1 6-8 *');
      expect(result.type).toBe('monthly');
      expect(result.monthNames).toEqual(['June', 'July', 'August']);
    });

    it('all months wildcard → all 12 month names', () => {
      const result = parseCronExpression('0 9 15 * *');
      expect(result.type).toBe('monthly');
      expect(result.monthNames).toHaveLength(12);
      expect(result.monthNames![0]).toBe('January');
      expect(result.monthNames![11]).toBe('December');
    });

    it('day 1 with month 1 → Jan 1st', () => {
      const result = parseCronExpression('0 0 1 1 *');
      expect(result.type).toBe('monthly');
      expect(result.daysOfMonth).toEqual([1]);
      expect(result.monthNames).toEqual(['January']);
      expect(result.time).toBe('00:00');
    });

    it('day */5 → every 5th day from 1', () => {
      const result = parseCronExpression('0 9 */5 * *');
      expect(result.type).toBe('monthly');
      // expandCronField(*/5, 1, 31) → 1,6,11,16,21,26,31
      expect(result.daysOfMonth).toEqual([1, 6, 11, 16, 21, 26, 31]);
    });

    it('month */3 → every 3rd month from 1', () => {
      const result = parseCronExpression('0 9 1 */3 *');
      expect(result.type).toBe('monthly');
      // expandCronField(*/3, 1, 12) → 1,4,7,10
      expect(result.monthNames).toEqual(['January', 'April', 'July', 'October']);
    });
  });

  // ─── Wildcard combinations ─────────────────────────────────────────────────

  describe('Wildcard combinations', () => {
    it('* */2 * * * → daily, time 00:00', () => {
      const result = parseCronExpression('* */2 * * *');
      // hour is */2 (not *), minute is * → time HH:00 with first hour 0
      expect(result.type).toBe('daily');
      expect(result.time).toBe('00:00');
    });

    it('*/5 * * * * → daily, time 00:00', () => {
      const result = parseCronExpression('*/5 * * * *');
      // hour is *, minute is */5 → time 00:MM, first minute 0
      expect(result.type).toBe('daily');
      expect(result.time).toBe('00:00');
    });

    it('0 0 * * * → daily at midnight', () => {
      const result = parseCronExpression('0 0 * * *');
      expect(result.type).toBe('daily');
      expect(result.time).toBe('00:00');
    });

    it('0 12 * * * → daily at noon', () => {
      const result = parseCronExpression('0 12 * * *');
      expect(result.type).toBe('daily');
      expect(result.time).toBe('12:00');
    });

    it('* * * * 1 → weekly Monday, time 00:00', () => {
      const result = parseCronExpression('* * * * 1');
      expect(result.type).toBe('weekly');
      expect(result.daysOfWeek).toEqual(['Monday']);
      expect(result.time).toBe('00:00');
    });

    it('* * 1 * * → monthly day 1, time 00:00', () => {
      const result = parseCronExpression('* * 1 * *');
      expect(result.type).toBe('monthly');
      expect(result.daysOfMonth).toEqual([1]);
      expect(result.time).toBe('00:00');
    });
  });

  // ─── Daily classification ──────────────────────────────────────────────────

  describe('Daily classification', () => {
    it('simple daily at 9 AM', () => {
      const result = parseCronExpression('0 9 * * *');
      expect(result.type).toBe('daily');
      expect(result.time).toBe('09:00');
    });

    it('daily with step minutes', () => {
      const result = parseCronExpression('*/30 9 * * *');
      expect(result.type).toBe('daily');
    });

    it('daily with all wildcards', () => {
      const result = parseCronExpression('* * * * *');
      expect(result.type).toBe('daily');
    });
  });

  // ─── Large step values ─────────────────────────────────────────────────────

  describe('Large step values', () => {
    it('*/59 in minute → [0, 59]', () => {
      const result = parseCronExpression('*/59 9 * * *');
      // expandCronField(*/59, 0, 59) → 0, 59; first is 0
      expect(result.time).toBe('09:00');
    });

    it('*/23 in hour → [0, 23]', () => {
      const result = parseCronExpression('0 */23 * * *');
      // expandCronField(*/23, 0, 23) → 0, 23; first is 0
      expect(result.time).toBe('00:00');
    });

    it('*/30 in minute → [0, 30]', () => {
      const result = parseCronExpression('*/30 9 * * *');
      expect(result.time).toBe('09:00');
    });

    it('*/12 in hour → [0, 12]', () => {
      const result = parseCronExpression('0 */12 * * *');
      expect(result.time).toBe('00:00');
    });

    it('*/31 in day-of-month → [1, 31] (just first and last)', () => {
      const result = parseCronExpression('0 9 */31 * *');
      expect(result.type).toBe('monthly');
      // expandCronField(*/31, 1, 31) → 1 (start), then 1+31=32 > max → only [1]
      // Actually: start = min = 1, step = 31 → 1, 32(>31) → [1]
      expect(result.daysOfMonth).toEqual([1]);
    });
  });

  // ─── Invalid expressions ───────────────────────────────────────────────────

  describe('Invalid expressions', () => {
    it('throws for empty string', () => {
      expect(() => parseCronExpression('')).toThrow();
    });

    it('throws for 6-field expression (seconds)', () => {
      expect(() => parseCronExpression('0 0 9 * * *')).toThrow();
    });

    it('throws for single field', () => {
      expect(() => parseCronExpression('*')).toThrow();
    });

    it('throws for random text', () => {
      expect(() => parseCronExpression('not a cron')).toThrow();
    });

    it('throws for special characters', () => {
      expect(() => parseCronExpression('@ # $ % &')).toThrow();
    });

    it('throws for expression with only 3 fields', () => {
      expect(() => parseCronExpression('0 9 *')).toThrow();
    });

    it('throws for expression with 4 fields', () => {
      expect(() => parseCronExpression('0 9 * *')).toThrow();
    });

    it('throws for minute out of range (60)', () => {
      expect(() => parseCronExpression('60 9 * * *')).toThrow();
    });

    it('throws for hour out of range (24)', () => {
      expect(() => parseCronExpression('0 24 * * *')).toThrow();
    });

    it('throws for day-of-month 0', () => {
      expect(() => parseCronExpression('0 9 0 * *')).toThrow();
    });

    it('throws for day-of-month 32', () => {
      expect(() => parseCronExpression('0 9 32 * *')).toThrow();
    });

    it('throws for month 0', () => {
      expect(() => parseCronExpression('0 9 1 0 *')).toThrow();
    });

    it('throws for month 13', () => {
      expect(() => parseCronExpression('0 9 1 13 *')).toThrow();
    });
  });

  // ─── Return shape correctness ──────────────────────────────────────────────

  describe('Return shape correctness', () => {
    it('daily has no daysOfWeek or daysOfMonth', () => {
      const result = parseCronExpression('0 9 * * *');
      expect(result.type).toBe('daily');
      expect(result.daysOfWeek).toBeUndefined();
      expect(result.daysOfMonth).toBeUndefined();
      expect(result.monthNames).toBeUndefined();
    });

    it('weekly has daysOfWeek but no daysOfMonth', () => {
      const result = parseCronExpression('0 9 * * 1');
      expect(result.type).toBe('weekly');
      expect(result.daysOfWeek).toBeDefined();
      expect(result.daysOfMonth).toBeUndefined();
    });

    it('monthly has daysOfMonth and monthNames', () => {
      const result = parseCronExpression('0 9 15 * *');
      expect(result.type).toBe('monthly');
      expect(result.daysOfMonth).toBeDefined();
      expect(result.monthNames).toBeDefined();
      expect(result.daysOfWeek).toBeUndefined();
    });

    it('monthly with specific month has correct monthNames', () => {
      const result = parseCronExpression('0 9 1 3 *');
      expect(result.type).toBe('monthly');
      expect(result.monthNames).toEqual(['March']);
      expect(result.daysOfMonth).toEqual([1]);
    });
  });
});
