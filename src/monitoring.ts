/**
 * Shared monitoring module.
 * Provides a unified system snapshot consumed by both watch UI and web dashboard.
 * Single source of truth to prevent status drift between different consumers.
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import { loadConfig, getConfigDir } from './config.js';
import { listTasks, getTask } from './tasks.js';
import { getLatestRunForTask, getRunsByStatus, cleanupStaleRuns } from './runs.js';
import { getConcurrencyStatus } from './concurrency.js';
import { getTaskStatus } from './scheduler.js';
import { SystemSnapshot, TaskSnapshot, LogSummary } from './types.js';

// Cache version for consumers to detect changes
let snapshotVersion = 0;

/**
 * Get a complete system snapshot.
 * This is the single source of truth for all monitoring UIs.
 */
export async function getSystemSnapshot(options?: {
  /** Maximum number of recent logs to include (default: 20) */
  maxLogs?: number;
  /** Whether to include scheduler status (slower, requires PS calls) */
  includeScheduler?: boolean;
}): Promise<SystemSnapshot> {
  const maxLogs = options?.maxLogs ?? 20;
  const includeScheduler = options?.includeScheduler ?? true;
  const config = loadConfig();

  // Read package version
  let version = '0.0.0';
  try {
    const pkgPath = join(getConfigDir(), '..', '.cron-agents', 'package.json');
    // Try multiple locations for version
    const altPkgPath = join(process.cwd(), 'package.json');
    if (existsSync(altPkgPath)) {
      const pkg = JSON.parse(readFileSync(altPkgPath, 'utf-8'));
      version = pkg.version || version;
    }
  } catch {
    // Use default
  }

  // Clean up stale runs first
  cleanupStaleRuns();

  // Build task snapshots
  const rawTasks = listTasks();
  const tasks: TaskSnapshot[] = [];

  for (const t of rawTasks) {
    const full = getTask(t.id);
    const snapshot: TaskSnapshot = {
      id: t.id,
      schedule: t.schedule,
      invocation: t.invocation,
      agent: t.agent,
      enabled: t.enabled,
      dependsOn: full?.dependsOn,
    };

    // Latest run
    const latestRun = getLatestRunForTask(t.id);
    if (latestRun) {
      const elapsed = latestRun.finishedAt
        ? Math.round((new Date(latestRun.finishedAt).getTime() - new Date(latestRun.startedAt).getTime()) / 1000)
        : Math.round((Date.now() - new Date(latestRun.startedAt).getTime()) / 1000);

      snapshot.latestRun = {
        runId: latestRun.runId,
        status: latestRun.status,
        startedAt: latestRun.startedAt,
        finishedAt: latestRun.finishedAt,
        elapsed,
      };
    }

    // Scheduler status (optional, slower)
    if (includeScheduler) {
      try {
        const status = await getTaskStatus(t.id);
        snapshot.schedulerStatus = {
          registered: status.exists,
          enabled: status.enabled || false,
          nextRunTime: status.nextRunTime,
          lastRunTime: status.lastRunTime,
        };
      } catch {
        snapshot.schedulerStatus = { registered: false, enabled: false };
      }
    }

    tasks.push(snapshot);
  }

  // Concurrency
  const concurrency = await getConcurrencyStatus();

  // Recent logs
  const recentLogs = getRecentLogs(config.logsDir, maxLogs);

  snapshotVersion++;

  return {
    timestamp: new Date().toISOString(),
    version,
    config: {
      tasksDirs: config.tasksDirs,
      logsDir: config.logsDir,
      maxConcurrency: config.maxConcurrency,
    },
    tasks,
    concurrency,
    recentLogs,
  };
}

/**
 * Get recent log summaries from the logs directory
 */
function getRecentLogs(logsDir: string, max: number): LogSummary[] {
  if (!existsSync(logsDir)) return [];

  try {
    const files = readdirSync(logsDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, max);

    return files.map(fileName => {
      try {
        const content = readFileSync(join(logsDir, fileName), 'utf-8');
        const parsed = matter(content);
        return {
          fileName,
          taskId: parsed.data.taskId || fileName.split('_')[0],
          status: parsed.data.status || 'unknown',
          timestamp: parsed.data.timestamp || '',
        };
      } catch {
        return {
          fileName,
          taskId: fileName.split('_')[0],
          status: 'unknown',
          timestamp: '',
        };
      }
    });
  } catch {
    return [];
  }
}

/**
 * Get a quick concurrency summary (no scheduler calls, fast)
 */
export async function getQuickStatus(): Promise<{
  running: number;
  queued: number;
  maxConcurrency: number;
  tasks: { id: string; status: string }[];
}> {
  cleanupStaleRuns();
  const concurrency = await getConcurrencyStatus();
  const runningRuns = getRunsByStatus('running');
  const queuedRuns = getRunsByStatus('queued');

  const tasks = [
    ...runningRuns.map(r => ({ id: r.taskId, status: '⏳ running' as string })),
    ...queuedRuns.map(r => ({ id: r.taskId, status: '🕐 queued' as string })),
  ];

  return {
    running: concurrency.running,
    queued: concurrency.queued,
    maxConcurrency: concurrency.maxConcurrency,
    tasks,
  };
}
