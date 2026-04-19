/**
 * Run state management for async task execution
 * Persists run records to disk so status survives MCP server restarts
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { getConfigDir } from './config.js';
import { RunRecord } from './types.js';

const RUNS_DIR_NAME = 'runs';
const COMPLETED_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
/** Max age for a 'running' record before we check PID liveness (accounts for retries) */
const STALE_RUNNING_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours

function getRunsDir(): string {
  const dir = join(getConfigDir(), RUNS_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function runFilePath(runId: string): string {
  return join(getRunsDir(), `${runId}.json`);
}

/**
 * Check if a process with the given PID is still alive
 */
function isProcessAlive(pid: number): boolean {
  try {
    // Sending signal 0 tests for existence without killing
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create and persist a new run record
 */
export function createRun(taskId: string, status: 'queued' | 'running' = 'running'): RunRecord {
  const run: RunRecord = {
    runId: `run-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    taskId,
    startedAt: new Date().toISOString(),
    status,
    pid: process.pid,
  };
  writeFileSync(runFilePath(run.runId), JSON.stringify(run, null, 2), 'utf-8');
  return run;
}

/**
 * Update an existing run record
 */
export function updateRun(runId: string, updates: Partial<RunRecord>): RunRecord | null {
  const filePath = runFilePath(runId);
  if (!existsSync(filePath)) return null;

  try {
    const run: RunRecord = JSON.parse(readFileSync(filePath, 'utf-8'));
    const updated = { ...run, ...updates };
    writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8');
    return updated;
  } catch {
    return null; // Corrupt run file
  }
}

/**
 * Get a run record by ID
 */
export function getRun(runId: string): RunRecord | null {
  const filePath = runFilePath(runId);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null; // Corrupt run file
  }
}

/**
 * Get the latest run for a given task ID
 */
export function getLatestRunForTask(taskId: string): RunRecord | null {
  const dir = getRunsDir();
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse();

  for (const file of files) {
    try {
      const run: RunRecord = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
      if (run.taskId === taskId) return run;
    } catch {
      // Skip corrupt files
    }
  }
  return null;
}

/**
 * Get all runs with a given status
 */
export function getRunsByStatus(status: RunRecord['status']): RunRecord[] {
  const dir = getRunsDir();
  const runs: RunRecord[] = [];

  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    try {
      const run: RunRecord = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
      if (run.status === status) runs.push(run);
    } catch {
      // Skip corrupt files
    }
  }
  return runs;
}

/**
 * Get count of currently running tasks (excluding stale ones)
 */
export function getRunningCount(): number {
  return getRunsByStatus('running').length;
}

/**
 * Get queued runs ordered by creation time (FIFO)
 */
export function getQueuedRuns(): RunRecord[] {
  return getRunsByStatus('queued').sort((a, b) =>
    new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  );
}

/**
 * Clean up stale 'running' records where the process has died.
 * Returns the number of stale runs cleaned up.
 */
export function cleanupStaleRuns(): number {
  const dir = getRunsDir();
  const now = Date.now();
  let cleaned = 0;

  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    try {
      const filePath = join(dir, file);
      const run: RunRecord = JSON.parse(readFileSync(filePath, 'utf-8'));

      if (run.status !== 'running' && run.status !== 'queued') continue;

      const age = now - new Date(run.startedAt).getTime();

      // Check PID liveness for runs older than threshold
      if (age > STALE_RUNNING_THRESHOLD_MS) {
        if (!run.pid || !isProcessAlive(run.pid)) {
          const updated: RunRecord = {
            ...run,
            status: 'failure',
            finishedAt: new Date().toISOString(),
            error: `Stale run detected: process ${run.pid || 'unknown'} no longer alive after ${Math.round(age / 60000)}min`,
          };
          writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8');
          cleaned++;
        }
      }
    } catch {
      // Skip corrupt files
    }
  }
  return cleaned;
}

/**
 * Clean up completed run records older than TTL
 */
export function cleanupOldRuns(): number {
  const dir = getRunsDir();
  const now = Date.now();
  let cleaned = 0;

  // Also clean stale running records
  cleaned += cleanupStaleRuns();

  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    try {
      const run: RunRecord = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
      if (run.status !== 'running' && run.status !== 'queued' && run.finishedAt) {
        const finishedTime = new Date(run.finishedAt).getTime();
        if (Number.isNaN(finishedTime)) continue; // Skip invalid dates
        const age = now - finishedTime;
        if (age > COMPLETED_TTL_MS) {
          unlinkSync(join(dir, file));
          cleaned++;
        }
      }
    } catch {
      // Skip corrupt files
    }
  }
  return cleaned;
}
