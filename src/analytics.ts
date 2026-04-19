/**
 * Productivity analyzer for cron-agents.
 * Analyzes execution logs to surface insights, health checks,
 * and productivity patterns. Uses log files (persistent) as the
 * canonical data source since run records expire after 24h.
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import { loadConfig } from './config.js';
import { listTasks, getTask } from './tasks.js';
import { getDependents } from './chains.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ProductivityReport {
  period: { from: string; to: string; days: number };
  summary: SummaryMetrics;
  taskMetrics: TaskMetric[];
  insights: Insight[];
  healthChecks: HealthCheck[];
  peakHours: number[];        // 24 slots, run count per hour
  dailyActivity: DailyActivity[];
  dataQuality: DataQuality;
}

export interface SummaryMetrics {
  totalRuns: number;
  successes: number;
  failures: number;
  successRate: number;
  avgDurationSec: number;
  medianDurationSec: number;
  p95DurationSec: number;
  totalDurationSec: number;
  uniqueTasks: number;
  runsPerDay: number;
}

export interface TaskMetric {
  taskId: string;
  runs: number;
  successes: number;
  failures: number;
  successRate: number;
  avgDurationSec: number;
  medianDurationSec: number;
  p95DurationSec: number;
  maxDurationSec: number;
  retryRuns: number;
  retryRate: number;
  currentStreak: { type: 'success' | 'failure'; count: number };
  trend: 'improving' | 'declining' | 'stable' | 'insufficient_data';
  lastRun?: string;
}

export interface Insight {
  type: 'info' | 'warning' | 'success';
  icon: string;
  message: string;
}

export interface HealthCheck {
  taskId: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  recommendation: string;
}

export interface DailyActivity {
  date: string;
  runs: number;
  successes: number;
  failures: number;
}

export interface DataQuality {
  totalLogFiles: number;
  parsedSuccessfully: number;
  corruptOrInvalid: number;
  skippedOutOfRange: number;
}

/** Internal parsed log entry */
interface ParsedLogEntry {
  taskId: string;
  executionId: string;
  timestamp: Date;
  status: 'success' | 'failure';
  durationSec: number;
  isRetry: boolean;
  fileName: string;
}

// ── Minimum sample sizes for recommendations ────────────────────────────────

const MIN_RUNS_FOR_RATE = 5;
const MIN_RUNS_FOR_TREND = 10;
const MIN_WEEKS_FOR_TREND = 2;

// ── Core analyzer ───────────────────────────────────────────────────────────

/**
 * Analyze productivity over a time window.
 *
 * @param options.days - Number of days to analyze (default: 30)
 * @param options.taskId - Optional: analyze a single task only
 */
export function analyzeProductivity(options?: {
  days?: number;
  taskId?: string;
}): ProductivityReport {
  const days = options?.days ?? 30;
  const filterTaskId = options?.taskId;

  const config = loadConfig();
  const now = new Date();
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  // Parse all log files
  const { entries, quality } = parseLogFiles(config.logsDir, from, now, filterTaskId);

  // Build per-task metrics
  const taskMetrics = buildTaskMetrics(entries);

  // Build system-wide summary
  const summary = buildSummary(entries, days);

  // Build time-based distributions
  const peakHours = buildPeakHours(entries);
  const dailyActivity = buildDailyActivity(entries, from, now);

  // Generate insights and health checks
  const insights = generateInsights(summary, taskMetrics, entries);
  const healthChecks = generateHealthChecks(taskMetrics, filterTaskId);

  return {
    period: {
      from: from.toISOString(),
      to: now.toISOString(),
      days,
    },
    summary,
    taskMetrics: taskMetrics.sort((a, b) => a.successRate - b.successRate),
    insights,
    healthChecks,
    peakHours,
    dailyActivity,
    dataQuality: quality,
  };
}

// ── Log parsing ─────────────────────────────────────────────────────────────

function parseLogFiles(
  logsDir: string,
  from: Date,
  to: Date,
  filterTaskId?: string,
): { entries: ParsedLogEntry[]; quality: DataQuality } {
  const quality: DataQuality = {
    totalLogFiles: 0,
    parsedSuccessfully: 0,
    corruptOrInvalid: 0,
    skippedOutOfRange: 0,
  };

  if (!existsSync(logsDir)) return { entries: [], quality };

  let files: string[];
  try {
    files = readdirSync(logsDir).filter(f => f.endsWith('.md'));
  } catch {
    return { entries: [], quality };
  }

  quality.totalLogFiles = files.length;
  const entries: ParsedLogEntry[] = [];

  for (const fileName of files) {
    try {
      // Quick filter by taskId from filename (format: taskId_timestamp_execId.md)
      if (filterTaskId) {
        const fileTaskId = fileName.split('_')[0];
        if (fileTaskId !== filterTaskId) continue;
      }

      const content = readFileSync(join(logsDir, fileName), 'utf-8');
      const parsed = matter(content);

      const taskId = parsed.data.taskId;
      const executionId = parsed.data.executionId || '';
      const status = parsed.data.status;
      const timestampStr = parsed.data.timestamp;

      if (!taskId || !timestampStr || (status !== 'success' && status !== 'failure')) {
        quality.corruptOrInvalid++;
        continue;
      }

      const timestamp = new Date(timestampStr);
      if (isNaN(timestamp.getTime())) {
        quality.corruptOrInvalid++;
        continue;
      }

      if (timestamp < from || timestamp > to) {
        quality.skippedOutOfRange++;
        continue;
      }

      // Estimate duration from log content (look for step timestamps)
      const durationSec = estimateDuration(parsed.content, timestamp);

      // Detect if this was a retry (execution ID contains retry hint, or log mentions retry)
      const isRetry = /retry/i.test(parsed.content) || /attempt\s+[2-9]/i.test(parsed.content);

      entries.push({
        taskId,
        executionId,
        timestamp,
        status,
        durationSec,
        isRetry,
        fileName,
      });

      quality.parsedSuccessfully++;
    } catch {
      quality.corruptOrInvalid++;
    }
  }

  // Sort chronologically
  entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return { entries, quality };
}

/**
 * Estimate execution duration from log content.
 * Looks for the last step timestamp and computes delta from start.
 */
function estimateDuration(content: string, startTime: Date): number {
  // Match ISO timestamps in the log content
  const timestamps = content.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\d]*Z?/g);
  if (!timestamps || timestamps.length === 0) return 0;

  const lastTimestamp = new Date(timestamps[timestamps.length - 1]);
  if (isNaN(lastTimestamp.getTime())) return 0;

  const durationSec = Math.max(0, (lastTimestamp.getTime() - startTime.getTime()) / 1000);
  return Math.round(durationSec);
}

// ── Metrics builders ────────────────────────────────────────────────────────

function buildTaskMetrics(entries: ParsedLogEntry[]): TaskMetric[] {
  const grouped = new Map<string, ParsedLogEntry[]>();
  for (const e of entries) {
    const arr = grouped.get(e.taskId) || [];
    arr.push(e);
    grouped.set(e.taskId, arr);
  }

  const metrics: TaskMetric[] = [];
  for (const [taskId, taskEntries] of grouped) {
    const runs = taskEntries.length;
    const successes = taskEntries.filter(e => e.status === 'success').length;
    const failures = runs - successes;
    const durations = taskEntries.map(e => e.durationSec).filter(d => d > 0);
    const retryRuns = taskEntries.filter(e => e.isRetry).length;

    // Streak: walk backwards from most recent
    let streakType: 'success' | 'failure' = taskEntries[taskEntries.length - 1]?.status || 'failure';
    let streakCount = 0;
    for (let i = taskEntries.length - 1; i >= 0; i--) {
      if (taskEntries[i].status === streakType) {
        streakCount++;
      } else {
        break;
      }
    }

    // Trend: compare first half vs second half success rates
    const trend = computeTrend(taskEntries);

    metrics.push({
      taskId,
      runs,
      successes,
      failures,
      successRate: runs > 0 ? Math.round((successes / runs) * 100) : 0,
      avgDurationSec: durations.length > 0 ? Math.round(average(durations)) : 0,
      medianDurationSec: durations.length > 0 ? Math.round(median(durations)) : 0,
      p95DurationSec: durations.length > 0 ? Math.round(percentile(durations, 95)) : 0,
      maxDurationSec: durations.length > 0 ? Math.max(...durations) : 0,
      retryRuns,
      retryRate: runs > 0 ? Math.round((retryRuns / runs) * 100) : 0,
      currentStreak: { type: streakType, count: streakCount },
      trend,
      lastRun: taskEntries.length > 0 ? taskEntries[taskEntries.length - 1].timestamp.toISOString() : undefined,
    });
  }

  return metrics;
}

function buildSummary(entries: ParsedLogEntry[], days: number): SummaryMetrics {
  const totalRuns = entries.length;
  const successes = entries.filter(e => e.status === 'success').length;
  const failures = totalRuns - successes;
  const durations = entries.map(e => e.durationSec).filter(d => d > 0);
  const uniqueTasks = new Set(entries.map(e => e.taskId)).size;

  return {
    totalRuns,
    successes,
    failures,
    successRate: totalRuns > 0 ? Math.round((successes / totalRuns) * 100) : 0,
    avgDurationSec: durations.length > 0 ? Math.round(average(durations)) : 0,
    medianDurationSec: durations.length > 0 ? Math.round(median(durations)) : 0,
    p95DurationSec: durations.length > 0 ? Math.round(percentile(durations, 95)) : 0,
    totalDurationSec: Math.round(durations.reduce((a, b) => a + b, 0)),
    uniqueTasks,
    runsPerDay: days > 0 ? Math.round((totalRuns / days) * 10) / 10 : 0,
  };
}

function buildPeakHours(entries: ParsedLogEntry[]): number[] {
  const hours = new Array(24).fill(0);
  for (const e of entries) {
    hours[e.timestamp.getHours()]++;
  }
  return hours;
}

function buildDailyActivity(entries: ParsedLogEntry[], from: Date, to: Date): DailyActivity[] {
  const byDay = new Map<string, { runs: number; successes: number; failures: number }>();

  // Initialize all days in range
  const current = new Date(from);
  while (current <= to) {
    const key = current.toISOString().split('T')[0];
    byDay.set(key, { runs: 0, successes: 0, failures: 0 });
    current.setDate(current.getDate() + 1);
  }

  for (const e of entries) {
    const key = e.timestamp.toISOString().split('T')[0];
    const day = byDay.get(key);
    if (day) {
      day.runs++;
      if (e.status === 'success') day.successes++;
      else day.failures++;
    }
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({ date, ...data }));
}

// ── Insights ────────────────────────────────────────────────────────────────

function generateInsights(
  summary: SummaryMetrics,
  taskMetrics: TaskMetric[],
  entries: ParsedLogEntry[],
): Insight[] {
  const insights: Insight[] = [];

  // Overall health
  if (summary.totalRuns === 0) {
    insights.push({ type: 'info', icon: '📭', message: 'No task executions found in this period.' });
    return insights;
  }

  if (summary.successRate >= 95) {
    insights.push({ type: 'success', icon: '🌟', message: `Excellent reliability: ${summary.successRate}% success rate across ${summary.totalRuns} runs.` });
  } else if (summary.successRate >= 80) {
    insights.push({ type: 'info', icon: '👍', message: `Good reliability: ${summary.successRate}% success rate. Some room for improvement.` });
  } else {
    insights.push({ type: 'warning', icon: '⚠️', message: `Low reliability: ${summary.successRate}% success rate. ${summary.failures} failures need attention.` });
  }

  // Productivity volume
  if (summary.runsPerDay >= 5) {
    insights.push({ type: 'success', icon: '🚀', message: `High automation: averaging ${summary.runsPerDay} runs/day across ${summary.uniqueTasks} tasks.` });
  } else if (summary.runsPerDay >= 1) {
    insights.push({ type: 'info', icon: '⚙️', message: `Steady automation: ${summary.runsPerDay} runs/day. Consider automating more repetitive tasks.` });
  }

  // Retry analysis
  const totalRetries = entries.filter(e => e.isRetry).length;
  if (totalRetries > 0) {
    const retryPct = Math.round((totalRetries / summary.totalRuns) * 100);
    if (retryPct > 30) {
      insights.push({ type: 'warning', icon: '🔄', message: `High retry rate (${retryPct}%): ${totalRetries} of ${summary.totalRuns} runs involved retries. Check for flaky APIs or rate limits.` });
    } else if (retryPct > 10) {
      insights.push({ type: 'info', icon: '🔄', message: `Moderate retry rate (${retryPct}%): retries are recovering some transient failures.` });
    }
  }

  // Peak hours insight
  const peakHours = buildPeakHours(entries);
  const maxHour = peakHours.indexOf(Math.max(...peakHours));
  const maxCount = peakHours[maxHour];
  if (maxCount > 0) {
    insights.push({
      type: 'info',
      icon: '🕐',
      message: `Peak activity at ${String(maxHour).padStart(2, '0')}:00 (${maxCount} runs). ${
        maxCount > summary.totalRuns * 0.4
          ? 'Consider spreading schedules to reduce concurrency pressure.'
          : 'Schedule distribution looks healthy.'
      }`,
    });
  }

  // Improving/declining tasks
  const improving = taskMetrics.filter(t => t.trend === 'improving');
  const declining = taskMetrics.filter(t => t.trend === 'declining');

  if (improving.length > 0) {
    insights.push({ type: 'success', icon: '📈', message: `${improving.length} task(s) trending better: ${improving.map(t => t.taskId).join(', ')}` });
  }
  if (declining.length > 0) {
    insights.push({ type: 'warning', icon: '📉', message: `${declining.length} task(s) trending worse: ${declining.map(t => t.taskId).join(', ')}` });
  }

  // Duration insight
  if (summary.totalDurationSec > 3600) {
    const hours = Math.round(summary.totalDurationSec / 3600 * 10) / 10;
    insights.push({ type: 'info', icon: '⏱️', message: `Total automated work: ${hours} hours of agent execution time this period.` });
  }

  return insights;
}

// ── Health checks ───────────────────────────────────────────────────────────

function generateHealthChecks(
  taskMetrics: TaskMetric[],
  filterTaskId?: string,
): HealthCheck[] {
  const checks: HealthCheck[] = [];

  // Also check tasks that have NO runs (stale/never-run)
  const allTasks = listTasks();
  const tasksWithRuns = new Set(taskMetrics.map(m => m.taskId));

  for (const task of allTasks) {
    if (filterTaskId && task.id !== filterTaskId) continue;

    const full = getTask(task.id);

    // Disabled tasks
    if (!task.enabled) {
      checks.push({
        taskId: task.id,
        severity: 'info',
        message: `Task is disabled.`,
        recommendation: 'Remove the task if no longer needed, or re-enable it.',
      });
      continue;
    }

    // Never-run tasks
    if (!tasksWithRuns.has(task.id)) {
      checks.push({
        taskId: task.id,
        severity: 'warning',
        message: `Task has no executions in the analysis period.`,
        recommendation: 'Verify the schedule is correct and the task is registered with the scheduler.',
      });
    }

    // Chain bottleneck detection
    if (full) {
      const dependents = getDependents(task.id);
      if (dependents.length >= 3) {
        const metric = taskMetrics.find(m => m.taskId === task.id);
        if (metric && metric.successRate < 90 && metric.runs >= MIN_RUNS_FOR_RATE) {
          checks.push({
            taskId: task.id,
            severity: 'critical',
            message: `Blocks ${dependents.length} downstream tasks with only ${metric.successRate}% success rate.`,
            recommendation: 'Improve reliability of this task — failures cascade to the entire chain.',
          });
        }
      }
    }
  }

  // Per-task checks (only for tasks with sufficient data)
  for (const m of taskMetrics) {
    if (filterTaskId && m.taskId !== filterTaskId) continue;

    // High failure rate
    if (m.runs >= MIN_RUNS_FOR_RATE && m.successRate < 50) {
      checks.push({
        taskId: m.taskId,
        severity: 'critical',
        message: `${m.successRate}% success rate over ${m.runs} runs.`,
        recommendation: 'Review failure logs. Consider fixing the task instructions or adjusting retry policy.',
      });
    } else if (m.runs >= MIN_RUNS_FOR_RATE && m.successRate < 80) {
      checks.push({
        taskId: m.taskId,
        severity: 'warning',
        message: `${m.successRate}% success rate over ${m.runs} runs.`,
        recommendation: 'Investigate recent failures to identify patterns.',
      });
    }

    // Failure streak
    if (m.currentStreak.type === 'failure' && m.currentStreak.count >= 3) {
      checks.push({
        taskId: m.taskId,
        severity: 'critical',
        message: `${m.currentStreak.count} consecutive failures.`,
        recommendation: 'Task may be permanently broken. Check recent logs and fix the root cause.',
      });
    }

    // High retry rate
    if (m.runs >= MIN_RUNS_FOR_RATE && m.retryRate > 40) {
      checks.push({
        taskId: m.taskId,
        severity: 'warning',
        message: `${m.retryRate}% retry rate — ${m.retryRuns} of ${m.runs} runs needed retries.`,
        recommendation: 'Investigate transient failures. Consider adjusting schedule to avoid rate limits.',
      });
    }

    // Very long executions
    if (m.p95DurationSec > 600) {
      checks.push({
        taskId: m.taskId,
        severity: 'info',
        message: `P95 execution time is ${formatDuration(m.p95DurationSec)}.`,
        recommendation: 'Consider splitting into smaller tasks or optimizing instructions for faster execution.',
      });
    }

    // Declining trend
    if (m.trend === 'declining') {
      checks.push({
        taskId: m.taskId,
        severity: 'warning',
        message: `Success rate is declining over time.`,
        recommendation: 'Recent runs are failing more often. Check for API changes or environment drift.',
      });
    }
  }

  // Sort: critical first, then warning, then info
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  checks.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return checks;
}

// ── Trend detection ─────────────────────────────────────────────────────────

function computeTrend(entries: ParsedLogEntry[]): TaskMetric['trend'] {
  if (entries.length < MIN_RUNS_FOR_TREND) return 'insufficient_data';

  // Need at least 2 weeks of data spread
  const firstDate = entries[0].timestamp;
  const lastDate = entries[entries.length - 1].timestamp;
  const spanDays = (lastDate.getTime() - firstDate.getTime()) / (24 * 60 * 60 * 1000);
  if (spanDays < MIN_WEEKS_FOR_TREND * 7) return 'insufficient_data';

  const mid = Math.floor(entries.length / 2);
  const firstHalf = entries.slice(0, mid);
  const secondHalf = entries.slice(mid);

  const firstRate = firstHalf.filter(e => e.status === 'success').length / firstHalf.length;
  const secondRate = secondHalf.filter(e => e.status === 'success').length / secondHalf.length;

  const diff = secondRate - firstRate;

  if (diff > 0.15) return 'improving';
  if (diff < -0.15) return 'declining';
  return 'stable';
}

// ── Formatting helpers ──────────────────────────────────────────────────────

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

/**
 * Format a full report for CLI display (with ANSI colors)
 */
export function formatReportForCLI(report: ProductivityReport): string {
  const ESC = '\x1b';
  const BOLD = `${ESC}[1m`;
  const DIM = `${ESC}[2m`;
  const RESET = `${ESC}[0m`;
  const GREEN = `${ESC}[32m`;
  const RED = `${ESC}[31m`;
  const YELLOW = `${ESC}[33m`;
  const CYAN = `${ESC}[36m`;
  const BLUE = `${ESC}[34m`;

  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(`${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════╗${RESET}`);
  lines.push(`${BOLD}${CYAN}║${RESET}  ${BOLD}📊 Productivity Analysis${RESET}                                   ${BOLD}${CYAN}║${RESET}`);
  lines.push(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════╝${RESET}`);
  lines.push(`${DIM}Period: ${report.period.from.split('T')[0]} → ${report.period.to.split('T')[0]} (${report.period.days} days)${RESET}`);
  lines.push('');

  // Summary
  const s = report.summary;
  lines.push(`${BOLD}Summary${RESET}`);
  lines.push(`${'─'.repeat(50)}`);

  const rateColor = s.successRate >= 95 ? GREEN : s.successRate >= 80 ? YELLOW : RED;
  lines.push(`  Total runs:      ${BOLD}${s.totalRuns}${RESET}`);
  lines.push(`  Success rate:    ${rateColor}${BOLD}${s.successRate}%${RESET} ${DIM}(${s.successes} ✓ / ${s.failures} ✗)${RESET}`);
  lines.push(`  Runs/day:        ${s.runsPerDay}`);
  lines.push(`  Unique tasks:    ${s.uniqueTasks}`);
  lines.push(`  Avg duration:    ${formatDuration(s.avgDurationSec)}`);
  lines.push(`  Median duration: ${formatDuration(s.medianDurationSec)}`);
  lines.push(`  P95 duration:    ${formatDuration(s.p95DurationSec)}`);
  lines.push(`  Total exec time: ${formatDuration(s.totalDurationSec)}`);
  lines.push('');

  // Insights
  if (report.insights.length > 0) {
    lines.push(`${BOLD}Insights${RESET}`);
    lines.push(`${'─'.repeat(50)}`);
    for (const insight of report.insights) {
      const color = insight.type === 'success' ? GREEN : insight.type === 'warning' ? YELLOW : BLUE;
      lines.push(`  ${insight.icon} ${color}${insight.message}${RESET}`);
    }
    lines.push('');
  }

  // Health checks
  if (report.healthChecks.length > 0) {
    lines.push(`${BOLD}Health Checks${RESET}`);
    lines.push(`${'─'.repeat(50)}`);
    for (const check of report.healthChecks) {
      const icon = check.severity === 'critical' ? `${RED}🔴` : check.severity === 'warning' ? `${YELLOW}🟡` : `${BLUE}🔵`;
      lines.push(`  ${icon} ${BOLD}${check.taskId}${RESET}: ${check.message}`);
      lines.push(`     ${DIM}→ ${check.recommendation}${RESET}`);
    }
    lines.push('');
  }

  // Task table
  if (report.taskMetrics.length > 0) {
    lines.push(`${BOLD}Per-Task Metrics${RESET}`);
    lines.push(`${'─'.repeat(70)}`);
    lines.push(`  ${BOLD}${'Task'.padEnd(22)} ${'Runs'.padStart(5)} ${'Rate'.padStart(6)} ${'Avg'.padStart(7)} ${'Med'.padStart(7)} ${'P95'.padStart(7)} ${'Streak'.padStart(10)}${RESET}`);
    lines.push(`  ${DIM}${'─'.repeat(22)} ${'─'.repeat(5)} ${'─'.repeat(6)} ${'─'.repeat(7)} ${'─'.repeat(7)} ${'─'.repeat(7)} ${'─'.repeat(10)}${RESET}`);

    for (const m of report.taskMetrics) {
      const rc = m.successRate >= 95 ? GREEN : m.successRate >= 80 ? YELLOW : RED;
      const streakIcon = m.currentStreak.type === 'success' ? `${GREEN}✓` : `${RED}✗`;
      const trendIcon = m.trend === 'improving' ? '📈' : m.trend === 'declining' ? '📉' : m.trend === 'stable' ? '→' : '?';

      lines.push(
        `  ${m.taskId.padEnd(22).slice(0, 22)} ` +
        `${String(m.runs).padStart(5)} ` +
        `${rc}${String(m.successRate + '%').padStart(6)}${RESET} ` +
        `${formatDuration(m.avgDurationSec).padStart(7)} ` +
        `${formatDuration(m.medianDurationSec).padStart(7)} ` +
        `${formatDuration(m.p95DurationSec).padStart(7)} ` +
        `${streakIcon}${m.currentStreak.count}${RESET} ${trendIcon}`
      );
    }
    lines.push('');
  }

  // Peak hours heatmap
  if (report.peakHours.some(h => h > 0)) {
    lines.push(`${BOLD}Activity by Hour${RESET}`);
    lines.push(`${'─'.repeat(50)}`);
    const maxH = Math.max(...report.peakHours);
    const barWidth = 30;
    for (let h = 0; h < 24; h++) {
      const count = report.peakHours[h];
      if (count === 0) continue;
      const barLen = maxH > 0 ? Math.round((count / maxH) * barWidth) : 0;
      const bar = '█'.repeat(barLen);
      const color = count >= maxH * 0.8 ? YELLOW : GREEN;
      lines.push(`  ${String(h).padStart(2)}:00 ${color}${bar}${RESET} ${DIM}${count}${RESET}`);
    }
    lines.push('');
  }

  // Data quality
  const dq = report.dataQuality;
  if (dq.corruptOrInvalid > 0) {
    lines.push(`${DIM}Data quality: ${dq.parsedSuccessfully} logs parsed, ${dq.corruptOrInvalid} corrupt/invalid (excluded)${RESET}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format report as plain text (for MCP tool output, no ANSI)
 */
export function formatReportForMCP(report: ProductivityReport): string {
  const lines: string[] = [];

  lines.push(`📊 Productivity Analysis (${report.period.days} days)`);
  lines.push(`Period: ${report.period.from.split('T')[0]} → ${report.period.to.split('T')[0]}`);
  lines.push('');

  const s = report.summary;
  lines.push(`## Summary`);
  lines.push(`- Total runs: ${s.totalRuns}`);
  lines.push(`- Success rate: ${s.successRate}% (${s.successes} ✓ / ${s.failures} ✗)`);
  lines.push(`- Runs/day: ${s.runsPerDay}`);
  lines.push(`- Unique tasks: ${s.uniqueTasks}`);
  lines.push(`- Duration: avg ${formatDuration(s.avgDurationSec)}, median ${formatDuration(s.medianDurationSec)}, P95 ${formatDuration(s.p95DurationSec)}`);
  lines.push(`- Total execution time: ${formatDuration(s.totalDurationSec)}`);
  lines.push('');

  if (report.insights.length > 0) {
    lines.push(`## Insights`);
    for (const i of report.insights) {
      lines.push(`${i.icon} ${i.message}`);
    }
    lines.push('');
  }

  if (report.healthChecks.length > 0) {
    lines.push(`## Health Checks`);
    for (const c of report.healthChecks) {
      const icon = c.severity === 'critical' ? '🔴' : c.severity === 'warning' ? '🟡' : '🔵';
      lines.push(`${icon} **${c.taskId}**: ${c.message}`);
      lines.push(`   → ${c.recommendation}`);
    }
    lines.push('');
  }

  if (report.taskMetrics.length > 0) {
    lines.push(`## Per-Task Metrics`);
    for (const m of report.taskMetrics) {
      const trendIcon = m.trend === 'improving' ? '📈' : m.trend === 'declining' ? '📉' : m.trend === 'stable' ? '→' : '';
      lines.push(`- **${m.taskId}**: ${m.successRate}% (${m.runs} runs), avg ${formatDuration(m.avgDurationSec)}, streak ${m.currentStreak.type} ×${m.currentStreak.count} ${trendIcon}`);
    }
    lines.push('');
  }

  if (report.dataQuality.corruptOrInvalid > 0) {
    lines.push(`_Data quality: ${report.dataQuality.corruptOrInvalid} log(s) excluded (corrupt/invalid)_`);
  }

  return lines.join('\n');
}

// ── Math helpers ────────────────────────────────────────────────────────────

function average(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
