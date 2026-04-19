/**
 * Smart retry with configurable backoff strategies.
 * Supports fixed, exponential, and linear backoff with jitter.
 */

import { RetryPolicy, DEFAULT_RETRY_POLICY, ExecutionResult } from './types.js';

// Patterns that indicate a transient/retryable error
const RETRYABLE_ERROR_PATTERNS = [
  /CAPIError:\s*4\d\d/i,             // CAPIError 400, 429, etc.
  /unexpected\s+`tool_use_id`/i,     // tool_use_id mismatch
  /rate\s*limit/i,                    // rate limiting
  /ECONNRESET/i,                     // connection reset
  /ETIMEDOUT/i,                      // connection timeout
  /socket\s*hang\s*up/i,            // socket hang up
  /502\s*Bad\s*Gateway/i,           // proxy errors
  /503\s*Service\s*Unavailable/i,
  /504\s*Gateway\s*Timeout/i,
];

/**
 * Merge partial retry config with defaults
 */
export function resolveRetryPolicy(partial?: Partial<RetryPolicy>): RetryPolicy {
  if (!partial) return { ...DEFAULT_RETRY_POLICY };

  return {
    maxRetries: typeof partial.maxRetries === 'number' && Number.isFinite(partial.maxRetries) && partial.maxRetries >= 0
      ? Math.floor(partial.maxRetries)
      : DEFAULT_RETRY_POLICY.maxRetries,
    backoff: partial.backoff && ['fixed', 'exponential', 'linear'].includes(partial.backoff)
      ? partial.backoff
      : DEFAULT_RETRY_POLICY.backoff,
    initialDelay: typeof partial.initialDelay === 'number' && Number.isFinite(partial.initialDelay) && partial.initialDelay >= 0
      ? partial.initialDelay
      : DEFAULT_RETRY_POLICY.initialDelay,
    maxDelay: typeof partial.maxDelay === 'number' && Number.isFinite(partial.maxDelay) && partial.maxDelay >= 0
      ? partial.maxDelay
      : DEFAULT_RETRY_POLICY.maxDelay,
  };
}

/**
 * Check if an execution result indicates a retryable error
 */
export function isRetryableError(result: ExecutionResult): boolean {
  const errorText = `${result.error || ''} ${result.output || ''}`;
  return RETRYABLE_ERROR_PATTERNS.some(pattern => pattern.test(errorText));
}

/**
 * Compute the delay in milliseconds for a given retry attempt.
 * Includes ±25% jitter to avoid thundering herd.
 *
 * @param attempt - 1-based attempt number (1 = first retry)
 * @param policy - Retry policy configuration
 * @returns Delay in milliseconds
 */
export function getRetryDelay(attempt: number, policy: RetryPolicy): number {
  const initialMs = policy.initialDelay * 1000;
  const maxMs = policy.maxDelay * 1000;

  let baseDelay: number;

  switch (policy.backoff) {
    case 'exponential':
      // 2^(attempt-1) * initialDelay
      baseDelay = Math.min(initialMs * Math.pow(2, attempt - 1), maxMs);
      break;

    case 'linear':
      // attempt * initialDelay
      baseDelay = Math.min(initialMs * attempt, maxMs);
      break;

    case 'fixed':
    default:
      baseDelay = Math.min(initialMs, maxMs);
      break;
  }

  // Add ±25% jitter
  const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(baseDelay + jitter));
}

/**
 * Check whether a retry should be attempted
 */
export function shouldRetry(
  result: ExecutionResult,
  attempt: number,
  policy: RetryPolicy,
): boolean {
  if (result.success) return false;
  if (attempt >= policy.maxRetries) return false;
  return isRetryableError(result);
}

/**
 * Get the retryable error patterns (for dry-run display)
 */
export function getRetryablePatterns(): string[] {
  return RETRYABLE_ERROR_PATTERNS.map(p => p.source);
}
