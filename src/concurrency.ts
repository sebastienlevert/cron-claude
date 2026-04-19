/**
 * Concurrency control for task execution.
 * Uses a lockfile for atomic slot acquisition and file-based run records
 * to track running/queued tasks across all entry points (MCP, CLI, Task Scheduler).
 */

import { openSync, closeSync, unlinkSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { getConfigDir, loadConfig } from './config.js';
import { getRunningCount, cleanupStaleRuns, getQueuedRuns, updateRun } from './runs.js';
import { RunRecord } from './types.js';

const LOCK_FILE_NAME = 'concurrency.lock';
const LOCK_STALE_MS = 30_000; // Consider lock stale after 30s
const QUEUE_POLL_INTERVAL_MS = 15_000; // Check for available slot every 15s
const QUEUE_TIMEOUT_MS = 15 * 60 * 1000; // Give up after 15 minutes in queue

function getLockPath(): string {
  return join(getConfigDir(), LOCK_FILE_NAME);
}

/**
 * Acquire an exclusive lock using atomic file creation (O_CREAT | O_EXCL).
 * Returns true if lock was acquired, false if already held.
 */
function acquireLock(): boolean {
  const lockPath = getLockPath();

  // Check for stale lockfile
  if (existsSync(lockPath)) {
    try {
      const stat = statSync(lockPath);
      const age = Date.now() - stat.mtimeMs;
      if (age > LOCK_STALE_MS) {
        // Stale lock — force remove
        unlinkSync(lockPath);
      }
    } catch {
      // Race: another process removed it already
    }
  }

  try {
    // 'wx' = O_CREAT | O_EXCL | O_WRONLY — fails if file already exists
    const fd = openSync(lockPath, 'wx');
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Release the concurrency lock
 */
function releaseLock(): void {
  try {
    unlinkSync(getLockPath());
  } catch {
    // Already released or never acquired
  }
}

/**
 * Execute a function while holding the concurrency lock.
 * Retries acquiring the lock for up to 5 seconds.
 */
async function withLock<T>(fn: () => T): Promise<T> {
  const maxWait = 5_000;
  const retryInterval = 100;
  const deadline = Date.now() + maxWait;

  while (Date.now() < deadline) {
    if (acquireLock()) {
      try {
        return fn();
      } finally {
        releaseLock();
      }
    }
    await new Promise(resolve => setTimeout(resolve, retryInterval));
  }

  // Fallback: force-remove stale lock and retry once
  releaseLock();
  if (acquireLock()) {
    try {
      return fn();
    } finally {
      releaseLock();
    }
  }

  throw new Error('Failed to acquire concurrency lock after timeout');
}

export interface SlotResult {
  acquired: boolean;
  runningCount: number;
  maxConcurrency: number;
}

/**
 * Try to acquire an execution slot (atomic check-and-count under lock).
 * Returns whether a slot is available. Does NOT create/update run records.
 */
export async function tryAcquireSlot(): Promise<SlotResult> {
  const config = loadConfig();

  return withLock(() => {
    // Clean up stale runs before counting
    cleanupStaleRuns();
    const running = getRunningCount();
    return {
      acquired: running < config.maxConcurrency,
      runningCount: running,
      maxConcurrency: config.maxConcurrency,
    };
  });
}

/**
 * Wait for an execution slot to become available.
 * Transitions the run from 'queued' → 'running' when a slot opens.
 * Throws if timeout is reached.
 */
export async function waitForSlot(runId: string): Promise<void> {
  const deadline = Date.now() + QUEUE_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const result = await tryAcquireSlot();

    if (result.acquired) {
      // Slot available — check if this run is next in FIFO order
      const queued = getQueuedRuns();
      const ourPosition = queued.findIndex(r => r.runId === runId);

      // Only proceed if we're first in queue (or our record was already transitioned)
      if (ourPosition === 0 || ourPosition === -1) {
        // Transition to running under lock
        await withLock(() => {
          // Double-check slot is still available
          cleanupStaleRuns();
          const currentRunning = getRunningCount();
          const config = loadConfig();
          if (currentRunning < config.maxConcurrency) {
            updateRun(runId, { status: 'running', pid: process.pid });
            return;
          }
          // Slot was taken — will retry on next iteration
          throw new Error('RETRY');
        }).catch(err => {
          if (err.message === 'RETRY') return; // Will retry in next loop iteration
          throw err;
        });

        // Verify we actually transitioned
        const queued2 = getQueuedRuns();
        if (!queued2.find(r => r.runId === runId)) {
          return; // Successfully transitioned to 'running'
        }
      }
    }

    await new Promise(resolve => setTimeout(resolve, QUEUE_POLL_INTERVAL_MS));
  }

  // Timeout — mark as failed
  updateRun(runId, {
    status: 'failure',
    finishedAt: new Date().toISOString(),
    error: `Queue timeout: no execution slot available within ${QUEUE_TIMEOUT_MS / 60000} minutes`,
  });
  throw new Error(`Queue timeout for run ${runId}`);
}

/**
 * Get concurrency status summary
 */
export async function getConcurrencyStatus(): Promise<{
  running: number;
  queued: number;
  maxConcurrency: number;
}> {
  const config = loadConfig();
  cleanupStaleRuns();
  return {
    running: getRunningCount(),
    queued: getQueuedRuns().length,
    maxConcurrency: config.maxConcurrency,
  };
}
