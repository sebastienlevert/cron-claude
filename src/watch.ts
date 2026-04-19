/**
 * Live terminal watch mode.
 * Displays a continuously refreshing view of task status, concurrency,
 * and recent activity. Uses ANSI escape codes for a clean terminal UI.
 */

import { getSystemSnapshot } from './monitoring.js';
import { SystemSnapshot, TaskSnapshot } from './types.js';

const ESC = '\x1b';
const CLEAR_SCREEN = `${ESC}[2J${ESC}[H`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const RESET = `${ESC}[0m`;
const GREEN = `${ESC}[32m`;
const RED = `${ESC}[31m`;
const YELLOW = `${ESC}[33m`;
const CYAN = `${ESC}[36m`;
const BLUE = `${ESC}[34m`;

/**
 * Format a task's status for display
 */
function formatTaskStatus(task: TaskSnapshot): string {
  const parts: string[] = [];

  // Status indicator
  if (task.latestRun) {
    switch (task.latestRun.status) {
      case 'running':
        parts.push(`${YELLOW}⏳ running${RESET} (${task.latestRun.elapsed}s)`);
        break;
      case 'queued':
        parts.push(`${BLUE}🕐 queued${RESET} (${task.latestRun.elapsed}s)`);
        break;
      case 'success':
        parts.push(`${GREEN}✅ success${RESET}`);
        break;
      case 'failure':
        parts.push(`${RED}❌ failure${RESET}`);
        break;
      default:
        parts.push(task.latestRun.status);
    }
  } else {
    parts.push(`${DIM}— no runs${RESET}`);
  }

  return parts.join(' ');
}

/**
 * Render a snapshot to a terminal string
 */
function renderSnapshot(snapshot: SystemSnapshot): string {
  const lines: string[] = [];
  const now = new Date(snapshot.timestamp);
  const timeStr = now.toLocaleTimeString();

  lines.push(CLEAR_SCREEN);
  lines.push(`${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════╗${RESET}`);
  lines.push(`${BOLD}${CYAN}║${RESET}  ${BOLD}cron-agents watch${RESET}                          ${DIM}${timeStr}${RESET}  ${BOLD}${CYAN}║${RESET}`);
  lines.push(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════╝${RESET}`);
  lines.push('');

  // Concurrency bar
  const { running, queued, maxConcurrency } = snapshot.concurrency;
  const slotBar = '█'.repeat(running) + '░'.repeat(Math.max(0, maxConcurrency - running));
  lines.push(`${BOLD}Concurrency:${RESET} [${running > 0 ? YELLOW : GREEN}${slotBar}${RESET}] ${running}/${maxConcurrency} running, ${queued} queued`);
  lines.push('');

  // Task table
  lines.push(`${BOLD}Tasks (${snapshot.tasks.length}):${RESET}`);
  lines.push(`${DIM}${'─'.repeat(62)}${RESET}`);

  if (snapshot.tasks.length === 0) {
    lines.push(`  ${DIM}No tasks configured${RESET}`);
  } else {
    // Header
    lines.push(`  ${BOLD}${'ID'.padEnd(25)} ${'Schedule'.padEnd(16)} ${'Agent'.padEnd(8)} Status${RESET}`);
    lines.push(`  ${DIM}${'─'.repeat(25)} ${'─'.repeat(16)} ${'─'.repeat(8)} ${'─'.repeat(15)}${RESET}`);

    for (const task of snapshot.tasks) {
      const enabled = task.enabled ? '' : `${RED}[disabled]${RESET} `;
      const deps = task.dependsOn?.length ? `${DIM} ← ${task.dependsOn.join(',')}${RESET}` : '';
      const status = formatTaskStatus(task);

      lines.push(`  ${enabled}${task.id.padEnd(25)} ${task.schedule.padEnd(16)} ${task.agent.padEnd(8)} ${status}${deps}`);
    }
  }

  lines.push('');

  // Recent logs
  if (snapshot.recentLogs.length > 0) {
    lines.push(`${BOLD}Recent Logs:${RESET}`);
    lines.push(`${DIM}${'─'.repeat(62)}${RESET}`);

    for (const log of snapshot.recentLogs.slice(0, 8)) {
      const statusIcon = log.status === 'success' ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
      const time = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '???';
      lines.push(`  ${statusIcon} ${time} ${log.taskId} ${DIM}${log.fileName}${RESET}`);
    }
  }

  lines.push('');
  lines.push(`${DIM}Press Ctrl+C to exit • Refreshes every 2s${RESET}`);

  return lines.join('\n');
}

/**
 * Start the watch mode. Refreshes every `intervalMs` milliseconds.
 * Returns a cleanup function to stop watching.
 */
export async function startWatch(intervalMs: number = 2000): Promise<() => void> {
  let running = true;

  // Hide cursor
  process.stdout.write(`${ESC}[?25l`);

  async function refresh() {
    try {
      const snapshot = await getSystemSnapshot({ maxLogs: 8, includeScheduler: false });
      process.stdout.write(renderSnapshot(snapshot));
    } catch (err) {
      process.stdout.write(`${CLEAR_SCREEN}${RED}Error refreshing: ${err}${RESET}\n`);
    }
  }

  // Initial render
  await refresh();

  // Periodic refresh
  const timer = setInterval(async () => {
    if (running) await refresh();
  }, intervalMs);

  // Cleanup function
  return () => {
    running = false;
    clearInterval(timer);
    // Show cursor
    process.stdout.write(`${ESC}[?25h`);
    process.stdout.write('\n');
  };
}

/**
 * Run watch mode as a blocking CLI command.
 * Handles Ctrl+C gracefully.
 */
export async function runWatch(intervalMs?: number): Promise<void> {
  const cleanup = await startWatch(intervalMs);

  return new Promise<void>((resolve) => {
    const handler = () => {
      cleanup();
      process.removeListener('SIGINT', handler);
      process.removeListener('SIGTERM', handler);
      resolve();
    };

    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
  });
}
