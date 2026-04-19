import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveRetryPolicy,
  isRetryableError,
  getRetryDelay,
  shouldRetry,
  getRetryablePatterns,
} from '../retry.js';
import { DEFAULT_RETRY_POLICY, ExecutionResult, RetryPolicy } from '../types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return { success: false, output: '', steps: [], ...overrides };
}

const defaultPolicy: RetryPolicy = { ...DEFAULT_RETRY_POLICY };

// ── resolveRetryPolicy ──────────────────────────────────────────────────────

describe('resolveRetryPolicy', () => {
  describe('default / missing input', () => {
    it('returns default when called with undefined', () => {
      expect(resolveRetryPolicy(undefined)).toEqual(defaultPolicy);
    });

    it('returns default when called with no arguments', () => {
      expect(resolveRetryPolicy()).toEqual(defaultPolicy);
    });

    it('returns default when called with empty object', () => {
      expect(resolveRetryPolicy({})).toEqual(defaultPolicy);
    });

    it('returns a new object each time (not same reference)', () => {
      const a = resolveRetryPolicy();
      const b = resolveRetryPolicy();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  describe('partial overrides', () => {
    it('overrides only maxRetries', () => {
      const result = resolveRetryPolicy({ maxRetries: 5 });
      expect(result.maxRetries).toBe(5);
      expect(result.backoff).toBe(defaultPolicy.backoff);
      expect(result.initialDelay).toBe(defaultPolicy.initialDelay);
      expect(result.maxDelay).toBe(defaultPolicy.maxDelay);
    });

    it('overrides only backoff', () => {
      const result = resolveRetryPolicy({ backoff: 'exponential' });
      expect(result.backoff).toBe('exponential');
      expect(result.maxRetries).toBe(defaultPolicy.maxRetries);
    });

    it('overrides only initialDelay', () => {
      const result = resolveRetryPolicy({ initialDelay: 30 });
      expect(result.initialDelay).toBe(30);
      expect(result.maxRetries).toBe(defaultPolicy.maxRetries);
    });

    it('overrides only maxDelay', () => {
      const result = resolveRetryPolicy({ maxDelay: 600 });
      expect(result.maxDelay).toBe(600);
      expect(result.maxRetries).toBe(defaultPolicy.maxRetries);
    });

    it('overrides multiple fields at once', () => {
      const result = resolveRetryPolicy({ maxRetries: 1, backoff: 'linear' });
      expect(result.maxRetries).toBe(1);
      expect(result.backoff).toBe('linear');
      expect(result.initialDelay).toBe(defaultPolicy.initialDelay);
      expect(result.maxDelay).toBe(defaultPolicy.maxDelay);
    });
  });

  describe('full override', () => {
    it('applies all fields when all provided', () => {
      const full = { maxRetries: 10, backoff: 'exponential' as const, initialDelay: 5, maxDelay: 120 };
      expect(resolveRetryPolicy(full)).toEqual(full);
    });
  });

  describe('maxRetries validation', () => {
    it('accepts 0', () => {
      expect(resolveRetryPolicy({ maxRetries: 0 }).maxRetries).toBe(0);
    });

    it('accepts 1', () => {
      expect(resolveRetryPolicy({ maxRetries: 1 }).maxRetries).toBe(1);
    });

    it('accepts 100', () => {
      expect(resolveRetryPolicy({ maxRetries: 100 }).maxRetries).toBe(100);
    });

    it('floors 2.7 to 2', () => {
      expect(resolveRetryPolicy({ maxRetries: 2.7 }).maxRetries).toBe(2);
    });

    it('floors 0.9 to 0', () => {
      expect(resolveRetryPolicy({ maxRetries: 0.9 }).maxRetries).toBe(0);
    });

    it('falls back to default for NaN', () => {
      expect(resolveRetryPolicy({ maxRetries: NaN }).maxRetries).toBe(defaultPolicy.maxRetries);
    });

    it('falls back to default for Infinity', () => {
      expect(resolveRetryPolicy({ maxRetries: Infinity }).maxRetries).toBe(defaultPolicy.maxRetries);
    });

    it('falls back to default for -Infinity', () => {
      expect(resolveRetryPolicy({ maxRetries: -Infinity }).maxRetries).toBe(defaultPolicy.maxRetries);
    });

    it('falls back to default for negative number', () => {
      expect(resolveRetryPolicy({ maxRetries: -1 }).maxRetries).toBe(defaultPolicy.maxRetries);
    });

    it('falls back to default for string coerced as number', () => {
      expect(resolveRetryPolicy({ maxRetries: '5' as unknown as number }).maxRetries).toBe(defaultPolicy.maxRetries);
    });
  });

  describe('backoff validation', () => {
    it('accepts fixed', () => {
      expect(resolveRetryPolicy({ backoff: 'fixed' }).backoff).toBe('fixed');
    });

    it('accepts exponential', () => {
      expect(resolveRetryPolicy({ backoff: 'exponential' }).backoff).toBe('exponential');
    });

    it('accepts linear', () => {
      expect(resolveRetryPolicy({ backoff: 'linear' }).backoff).toBe('linear');
    });

    it('falls back to default for invalid string', () => {
      expect(resolveRetryPolicy({ backoff: 'invalid' as any }).backoff).toBe(defaultPolicy.backoff);
    });

    it('falls back to default for empty string', () => {
      expect(resolveRetryPolicy({ backoff: '' as any }).backoff).toBe(defaultPolicy.backoff);
    });

    it('falls back to default for null', () => {
      expect(resolveRetryPolicy({ backoff: null as any }).backoff).toBe(defaultPolicy.backoff);
    });

    it('falls back to default for undefined', () => {
      expect(resolveRetryPolicy({ backoff: undefined }).backoff).toBe(defaultPolicy.backoff);
    });
  });

  describe('initialDelay validation', () => {
    it('accepts 0', () => {
      expect(resolveRetryPolicy({ initialDelay: 0 }).initialDelay).toBe(0);
    });

    it('accepts 0.5', () => {
      expect(resolveRetryPolicy({ initialDelay: 0.5 }).initialDelay).toBe(0.5);
    });

    it('accepts 100', () => {
      expect(resolveRetryPolicy({ initialDelay: 100 }).initialDelay).toBe(100);
    });

    it('falls back to default for NaN', () => {
      expect(resolveRetryPolicy({ initialDelay: NaN }).initialDelay).toBe(defaultPolicy.initialDelay);
    });

    it('falls back to default for Infinity', () => {
      expect(resolveRetryPolicy({ initialDelay: Infinity }).initialDelay).toBe(defaultPolicy.initialDelay);
    });

    it('falls back to default for -Infinity', () => {
      expect(resolveRetryPolicy({ initialDelay: -Infinity }).initialDelay).toBe(defaultPolicy.initialDelay);
    });

    it('falls back to default for negative number', () => {
      expect(resolveRetryPolicy({ initialDelay: -5 }).initialDelay).toBe(defaultPolicy.initialDelay);
    });
  });

  describe('maxDelay validation', () => {
    it('accepts 0', () => {
      expect(resolveRetryPolicy({ maxDelay: 0 }).maxDelay).toBe(0);
    });

    it('accepts 0.1', () => {
      expect(resolveRetryPolicy({ maxDelay: 0.1 }).maxDelay).toBe(0.1);
    });

    it('accepts 999', () => {
      expect(resolveRetryPolicy({ maxDelay: 999 }).maxDelay).toBe(999);
    });

    it('falls back to default for NaN', () => {
      expect(resolveRetryPolicy({ maxDelay: NaN }).maxDelay).toBe(defaultPolicy.maxDelay);
    });

    it('falls back to default for Infinity', () => {
      expect(resolveRetryPolicy({ maxDelay: Infinity }).maxDelay).toBe(defaultPolicy.maxDelay);
    });

    it('falls back to default for negative', () => {
      expect(resolveRetryPolicy({ maxDelay: -10 }).maxDelay).toBe(defaultPolicy.maxDelay);
    });
  });
});

// ── isRetryableError ────────────────────────────────────────────────────────

describe('isRetryableError', () => {
  describe('CAPIError pattern', () => {
    it('matches CAPIError: 400', () => {
      expect(isRetryableError(makeResult({ error: 'CAPIError: 400' }))).toBe(true);
    });

    it('matches CAPIError: 429', () => {
      expect(isRetryableError(makeResult({ error: 'CAPIError: 429 rate limited' }))).toBe(true);
    });

    it('matches CAPIError: 499', () => {
      expect(isRetryableError(makeResult({ error: 'CAPIError: 499' }))).toBe(true);
    });

    it('does not match CAPIError: 500', () => {
      expect(isRetryableError(makeResult({ error: 'CAPIError: 500' }))).toBe(false);
    });

    it('case insensitive: capierror: 401', () => {
      expect(isRetryableError(makeResult({ error: 'capierror: 401' }))).toBe(true);
    });
  });

  describe('unexpected tool_use_id pattern', () => {
    it('matches unexpected `tool_use_id`', () => {
      expect(isRetryableError(makeResult({ error: 'unexpected `tool_use_id`' }))).toBe(true);
    });

    it('matches with varied spacing', () => {
      expect(isRetryableError(makeResult({ error: 'Unexpected  `tool_use_id` found' }))).toBe(true);
    });

    it('case insensitive', () => {
      expect(isRetryableError(makeResult({ error: 'UNEXPECTED `TOOL_USE_ID`' }))).toBe(true);
    });
  });

  describe('rate limit pattern', () => {
    it('matches "rate limit"', () => {
      expect(isRetryableError(makeResult({ error: 'rate limit exceeded' }))).toBe(true);
    });

    it('matches "ratelimit"', () => {
      expect(isRetryableError(makeResult({ error: 'ratelimit hit' }))).toBe(true);
    });

    it('matches "Rate Limit"', () => {
      expect(isRetryableError(makeResult({ error: 'Rate Limit' }))).toBe(true);
    });
  });

  describe('ECONNRESET pattern', () => {
    it('matches ECONNRESET', () => {
      expect(isRetryableError(makeResult({ error: 'Error: ECONNRESET' }))).toBe(true);
    });

    it('case insensitive', () => {
      expect(isRetryableError(makeResult({ error: 'econnreset' }))).toBe(true);
    });
  });

  describe('ETIMEDOUT pattern', () => {
    it('matches ETIMEDOUT', () => {
      expect(isRetryableError(makeResult({ error: 'ETIMEDOUT' }))).toBe(true);
    });

    it('case insensitive', () => {
      expect(isRetryableError(makeResult({ error: 'etimedout' }))).toBe(true);
    });
  });

  describe('socket hang up pattern', () => {
    it('matches "socket hang up"', () => {
      expect(isRetryableError(makeResult({ error: 'socket hang up' }))).toBe(true);
    });

    it('matches with extra spacing', () => {
      expect(isRetryableError(makeResult({ error: 'socket  hang up' }))).toBe(true);
    });

    it('case insensitive', () => {
      expect(isRetryableError(makeResult({ error: 'Socket Hang Up' }))).toBe(true);
    });
  });

  describe('502 Bad Gateway pattern', () => {
    it('matches "502 Bad Gateway"', () => {
      expect(isRetryableError(makeResult({ error: '502 Bad Gateway' }))).toBe(true);
    });

    it('case insensitive', () => {
      expect(isRetryableError(makeResult({ error: '502 bad gateway' }))).toBe(true);
    });
  });

  describe('503 Service Unavailable pattern', () => {
    it('matches "503 Service Unavailable"', () => {
      expect(isRetryableError(makeResult({ error: '503 Service Unavailable' }))).toBe(true);
    });

    it('case insensitive', () => {
      expect(isRetryableError(makeResult({ error: '503 service unavailable' }))).toBe(true);
    });
  });

  describe('504 Gateway Timeout pattern', () => {
    it('matches "504 Gateway Timeout"', () => {
      expect(isRetryableError(makeResult({ error: '504 Gateway Timeout' }))).toBe(true);
    });

    it('case insensitive', () => {
      expect(isRetryableError(makeResult({ error: '504 gateway timeout' }))).toBe(true);
    });
  });

  describe('field placement', () => {
    it('detects error in .error field only', () => {
      expect(isRetryableError(makeResult({ error: 'ECONNRESET', output: '' }))).toBe(true);
    });

    it('detects error in .output field only', () => {
      expect(isRetryableError(makeResult({ output: 'ECONNRESET' }))).toBe(true);
    });

    it('detects error when present in both fields', () => {
      expect(isRetryableError(makeResult({ error: 'ECONNRESET', output: 'ETIMEDOUT' }))).toBe(true);
    });

    it('handles undefined error field', () => {
      expect(isRetryableError(makeResult({ error: undefined, output: 'ECONNRESET' }))).toBe(true);
    });

    it('handles undefined output field', () => {
      const result: ExecutionResult = { success: false, output: undefined as any, steps: [], error: 'ECONNRESET' };
      expect(isRetryableError(result)).toBe(true);
    });
  });

  describe('non-retryable errors', () => {
    it('returns false for "Invalid request"', () => {
      expect(isRetryableError(makeResult({ error: 'Invalid request' }))).toBe(false);
    });

    it('returns false for "auth failed"', () => {
      expect(isRetryableError(makeResult({ error: 'auth failed' }))).toBe(false);
    });

    it('returns false for "permission denied"', () => {
      expect(isRetryableError(makeResult({ error: 'permission denied' }))).toBe(false);
    });

    it('returns false for random text', () => {
      expect(isRetryableError(makeResult({ error: 'something went wrong' }))).toBe(false);
    });

    it('returns false for empty strings', () => {
      expect(isRetryableError(makeResult({ error: '', output: '' }))).toBe(false);
    });

    it('returns false for no error or output', () => {
      expect(isRetryableError(makeResult())).toBe(false);
    });
  });

  describe('success result with retryable text', () => {
    it('still returns true because it only checks text content', () => {
      expect(isRetryableError(makeResult({ success: true, error: 'ECONNRESET' }))).toBe(true);
    });
  });
});

// ── getRetryDelay ───────────────────────────────────────────────────────────

describe('getRetryDelay', () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    randomSpy = vi.spyOn(Math, 'random');
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  describe('jitter behavior', () => {
    it('returns exact base delay when random=0.5 (zero jitter)', () => {
      randomSpy.mockReturnValue(0.5);
      const policy: RetryPolicy = { maxRetries: 3, backoff: 'fixed', initialDelay: 10, maxDelay: 300 };
      // base = 10*1000 = 10000ms, jitter = 10000 * 0.25 * (0.5*2-1) = 10000 * 0.25 * 0 = 0
      expect(getRetryDelay(1, policy)).toBe(10000);
    });

    it('returns base - 25% when random=0 (minimum jitter)', () => {
      randomSpy.mockReturnValue(0);
      const policy: RetryPolicy = { maxRetries: 3, backoff: 'fixed', initialDelay: 10, maxDelay: 300 };
      // jitter = 10000 * 0.25 * (0 - 1) = -2500
      expect(getRetryDelay(1, policy)).toBe(7500);
    });

    it('returns base + 25% when random=1 (maximum jitter)', () => {
      randomSpy.mockReturnValue(1);
      const policy: RetryPolicy = { maxRetries: 3, backoff: 'fixed', initialDelay: 10, maxDelay: 300 };
      // jitter = 10000 * 0.25 * (2 - 1) = 2500
      expect(getRetryDelay(1, policy)).toBe(12500);
    });
  });

  describe('fixed backoff', () => {
    const policy: RetryPolicy = { maxRetries: 3, backoff: 'fixed', initialDelay: 10, maxDelay: 300 };

    it('returns same base delay for attempt 1', () => {
      randomSpy.mockReturnValue(0.5);
      expect(getRetryDelay(1, policy)).toBe(10000);
    });

    it('returns same base delay for attempt 2', () => {
      randomSpy.mockReturnValue(0.5);
      expect(getRetryDelay(2, policy)).toBe(10000);
    });

    it('returns same base delay for attempt 5', () => {
      randomSpy.mockReturnValue(0.5);
      expect(getRetryDelay(5, policy)).toBe(10000);
    });
  });

  describe('exponential backoff', () => {
    const policy: RetryPolicy = { maxRetries: 10, backoff: 'exponential', initialDelay: 10, maxDelay: 300 };

    it('attempt 1 = initialDelay', () => {
      randomSpy.mockReturnValue(0.5);
      // 10000 * 2^0 = 10000
      expect(getRetryDelay(1, policy)).toBe(10000);
    });

    it('attempt 2 = 2x initialDelay', () => {
      randomSpy.mockReturnValue(0.5);
      // 10000 * 2^1 = 20000
      expect(getRetryDelay(2, policy)).toBe(20000);
    });

    it('attempt 3 = 4x initialDelay', () => {
      randomSpy.mockReturnValue(0.5);
      // 10000 * 2^2 = 40000
      expect(getRetryDelay(3, policy)).toBe(40000);
    });

    it('attempt 4 = 8x initialDelay', () => {
      randomSpy.mockReturnValue(0.5);
      // 10000 * 2^3 = 80000
      expect(getRetryDelay(4, policy)).toBe(80000);
    });
  });

  describe('linear backoff', () => {
    const policy: RetryPolicy = { maxRetries: 10, backoff: 'linear', initialDelay: 10, maxDelay: 300 };

    it('attempt 1 = 1x initialDelay', () => {
      randomSpy.mockReturnValue(0.5);
      expect(getRetryDelay(1, policy)).toBe(10000);
    });

    it('attempt 2 = 2x initialDelay', () => {
      randomSpy.mockReturnValue(0.5);
      expect(getRetryDelay(2, policy)).toBe(20000);
    });

    it('attempt 3 = 3x initialDelay', () => {
      randomSpy.mockReturnValue(0.5);
      expect(getRetryDelay(3, policy)).toBe(30000);
    });

    it('attempt 5 = 5x initialDelay', () => {
      randomSpy.mockReturnValue(0.5);
      expect(getRetryDelay(5, policy)).toBe(50000);
    });
  });

  describe('maxDelay cap', () => {
    it('exponential is capped at maxDelay', () => {
      randomSpy.mockReturnValue(0.5);
      const policy: RetryPolicy = { maxRetries: 10, backoff: 'exponential', initialDelay: 10, maxDelay: 30 };
      // attempt 3: 10000*4=40000 → capped at 30000
      expect(getRetryDelay(3, policy)).toBe(30000);
    });

    it('linear is capped at maxDelay', () => {
      randomSpy.mockReturnValue(0.5);
      const policy: RetryPolicy = { maxRetries: 10, backoff: 'linear', initialDelay: 10, maxDelay: 25 };
      // attempt 3: 10000*3=30000 → capped at 25000
      expect(getRetryDelay(3, policy)).toBe(25000);
    });

    it('fixed is capped at maxDelay when initialDelay > maxDelay', () => {
      randomSpy.mockReturnValue(0.5);
      const policy: RetryPolicy = { maxRetries: 3, backoff: 'fixed', initialDelay: 50, maxDelay: 10 };
      // min(50000, 10000) = 10000
      expect(getRetryDelay(1, policy)).toBe(10000);
    });
  });

  describe('edge cases', () => {
    it('attempt 0 with exponential', () => {
      randomSpy.mockReturnValue(0.5);
      const policy: RetryPolicy = { maxRetries: 3, backoff: 'exponential', initialDelay: 10, maxDelay: 300 };
      // 10000 * 2^(-1) = 5000
      expect(getRetryDelay(0, policy)).toBe(5000);
    });

    it('very large attempt (100) is capped by maxDelay', () => {
      randomSpy.mockReturnValue(0.5);
      const policy: RetryPolicy = { maxRetries: 200, backoff: 'exponential', initialDelay: 1, maxDelay: 60 };
      expect(getRetryDelay(100, policy)).toBe(60000);
    });

    it('initialDelay 0 always returns 0 for fixed', () => {
      randomSpy.mockReturnValue(0.5);
      const policy: RetryPolicy = { maxRetries: 3, backoff: 'fixed', initialDelay: 0, maxDelay: 300 };
      // base=0, jitter=0*0.25*...=0
      expect(getRetryDelay(1, policy)).toBe(0);
    });

    it('maxDelay 0 always returns 0', () => {
      randomSpy.mockReturnValue(0.5);
      const policy: RetryPolicy = { maxRetries: 3, backoff: 'exponential', initialDelay: 10, maxDelay: 0 };
      // min(anything, 0) = 0, jitter = 0
      expect(getRetryDelay(1, policy)).toBe(0);
    });

    it('never returns negative values (clamped to 0)', () => {
      // Force extreme negative jitter on a small base
      randomSpy.mockReturnValue(0);
      const policy: RetryPolicy = { maxRetries: 3, backoff: 'fixed', initialDelay: 0.001, maxDelay: 300 };
      expect(getRetryDelay(1, policy)).toBeGreaterThanOrEqual(0);
    });

    it('returns a rounded integer', () => {
      randomSpy.mockReturnValue(0.3);
      const policy: RetryPolicy = { maxRetries: 3, backoff: 'fixed', initialDelay: 7, maxDelay: 300 };
      const result = getRetryDelay(1, policy);
      expect(result).toBe(Math.round(result));
    });
  });
});

// ── shouldRetry ─────────────────────────────────────────────────────────────

describe('shouldRetry', () => {
  const policy: RetryPolicy = { maxRetries: 3, backoff: 'fixed', initialDelay: 15, maxDelay: 300 };

  describe('success result', () => {
    it('returns false even with attempt < maxRetries', () => {
      expect(shouldRetry(makeResult({ success: true }), 1, policy)).toBe(false);
    });

    it('returns false on attempt 0', () => {
      expect(shouldRetry(makeResult({ success: true }), 0, policy)).toBe(false);
    });
  });

  describe('attempt >= maxRetries', () => {
    it('returns false when attempt equals maxRetries', () => {
      expect(shouldRetry(makeResult({ error: 'ECONNRESET' }), 3, policy)).toBe(false);
    });

    it('returns false when attempt exceeds maxRetries', () => {
      expect(shouldRetry(makeResult({ error: 'ECONNRESET' }), 5, policy)).toBe(false);
    });
  });

  describe('retryable errors below maxRetries', () => {
    it('returns true for ECONNRESET on attempt 1', () => {
      expect(shouldRetry(makeResult({ error: 'ECONNRESET' }), 1, policy)).toBe(true);
    });

    it('returns true for ETIMEDOUT on attempt 2', () => {
      expect(shouldRetry(makeResult({ error: 'ETIMEDOUT' }), 2, policy)).toBe(true);
    });

    it('returns true for rate limit on attempt 1', () => {
      expect(shouldRetry(makeResult({ error: 'rate limit exceeded' }), 1, policy)).toBe(true);
    });

    it('returns true for 502 Bad Gateway on attempt 2', () => {
      expect(shouldRetry(makeResult({ error: '502 Bad Gateway' }), 2, policy)).toBe(true);
    });

    it('returns true for CAPIError: 429 on attempt 1', () => {
      expect(shouldRetry(makeResult({ error: 'CAPIError: 429' }), 1, policy)).toBe(true);
    });
  });

  describe('non-retryable errors below maxRetries', () => {
    it('returns false for auth failed', () => {
      expect(shouldRetry(makeResult({ error: 'auth failed' }), 1, policy)).toBe(false);
    });

    it('returns false for permission denied', () => {
      expect(shouldRetry(makeResult({ error: 'permission denied' }), 1, policy)).toBe(false);
    });

    it('returns false for unknown error', () => {
      expect(shouldRetry(makeResult({ error: 'something broke' }), 1, policy)).toBe(false);
    });
  });

  describe('maxRetries = 0', () => {
    const zeroPolicy: RetryPolicy = { maxRetries: 0, backoff: 'fixed', initialDelay: 15, maxDelay: 300 };

    it('returns false on attempt 0', () => {
      expect(shouldRetry(makeResult({ error: 'ECONNRESET' }), 0, zeroPolicy)).toBe(false);
    });

    it('returns false on attempt 1', () => {
      expect(shouldRetry(makeResult({ error: 'ECONNRESET' }), 1, zeroPolicy)).toBe(false);
    });
  });

  describe('maxRetries = 1', () => {
    const onePolicy: RetryPolicy = { maxRetries: 1, backoff: 'fixed', initialDelay: 15, maxDelay: 300 };

    it('returns false when attempt equals maxRetries (1)', () => {
      expect(shouldRetry(makeResult({ error: 'ECONNRESET' }), 1, onePolicy)).toBe(false);
    });

    it('returns true when attempt is 0 and error is retryable', () => {
      expect(shouldRetry(makeResult({ error: 'ECONNRESET' }), 0, onePolicy)).toBe(true);
    });
  });
});

// ── getRetryablePatterns ────────────────────────────────────────────────────

describe('getRetryablePatterns', () => {
  it('returns an array', () => {
    expect(Array.isArray(getRetryablePatterns())).toBe(true);
  });

  it('returns an array of strings', () => {
    getRetryablePatterns().forEach(p => expect(typeof p).toBe('string'));
  });

  it('has exactly 9 patterns', () => {
    expect(getRetryablePatterns()).toHaveLength(9);
  });

  it('contains ECONNRESET pattern', () => {
    expect(getRetryablePatterns().some(p => p.includes('ECONNRESET'))).toBe(true);
  });

  it('contains ETIMEDOUT pattern', () => {
    expect(getRetryablePatterns().some(p => p.includes('ETIMEDOUT'))).toBe(true);
  });

  it('contains CAPIError pattern', () => {
    expect(getRetryablePatterns().some(p => p.includes('CAPI') || p.includes('capi') || p.includes('4\\d'))).toBe(true);
  });

  it('contains rate limit pattern', () => {
    expect(getRetryablePatterns().some(p => p.toLowerCase().includes('rate'))).toBe(true);
  });

  it('contains socket hang up pattern', () => {
    expect(getRetryablePatterns().some(p => p.toLowerCase().includes('socket'))).toBe(true);
  });

  it('contains 502 pattern', () => {
    expect(getRetryablePatterns().some(p => p.includes('502'))).toBe(true);
  });

  it('contains 503 pattern', () => {
    expect(getRetryablePatterns().some(p => p.includes('503'))).toBe(true);
  });

  it('contains 504 pattern', () => {
    expect(getRetryablePatterns().some(p => p.includes('504'))).toBe(true);
  });

  it('contains tool_use_id pattern', () => {
    expect(getRetryablePatterns().some(p => p.includes('tool_use_id'))).toBe(true);
  });
});
