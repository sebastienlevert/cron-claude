/**
 * Run state management for async task execution
 * Persists run records to disk so status survives MCP server restarts
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { getConfigDir } from './config.js';
import { RunRecord } from './types.js';

const RUNS_DIR_NAME = 'runs';
const COMPLETED_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function getRunsDir(): string {
  const dir = join(getConfigDir(), RUNS_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function runFilePath(runId: string): string {
  return join(getRunsDir(), `${runId}.json`);
}

/**
 * Create and persist a new run record
 */
export function createRun(taskId: string): RunRecord {
  const run: RunRecord = {
    runId: `run-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    taskId,
    startedAt: new Date().toISOString(),
    status: 'running',
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

  const run: RunRecord = JSON.parse(readFileSync(filePath, 'utf-8'));
  const updated = { ...run, ...updates };
  writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}

/**
 * Get a run record by ID
 */
export function getRun(runId: string): RunRecord | null {
  const filePath = runFilePath(runId);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

/**
 * Get the latest run for a given task ID
 */
export function getLatestRunForTask(taskId: string): RunRecord | null {
  const dir = getRunsDir();
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse();

  for (const file of files) {
    const run: RunRecord = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
    if (run.taskId === taskId) return run;
  }
  return null;
}

/**
 * Clean up completed run records older than TTL
 */
export function cleanupOldRuns(): number {
  const dir = getRunsDir();
  const now = Date.now();
  let cleaned = 0;

  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    try {
      const run: RunRecord = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
      if (run.status !== 'running' && run.finishedAt) {
        const age = now - new Date(run.finishedAt).getTime();
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
