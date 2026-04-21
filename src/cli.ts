#!/usr/bin/env node
/**
 * CLI interface for cron-agents
 * Manage scheduled coding agent tasks
 */

import { Command } from 'commander';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';
import { registerTask, unregisterTask, enableTask, disableTask, getTaskStatus } from './scheduler.js';
import { executeTask, dryRunTask } from './executor.js';
import { verifyLogFile } from './logger.js';
import { loadConfig, getConfigDir } from './config.js';
import { listTasks, getTask, getTaskFilePath, taskExists, createTask } from './tasks.js';
import { getSupportedAgents, getAgentConfig, detectAgentPath, isValidAgent, getDefaultAgent } from './agents.js';
import { getRun, getLatestRunForTask } from './runs.js';
import { getConcurrencyStatus, tryAcquireSlot, waitForSlot } from './concurrency.js';
import { createRun, updateRun, cleanupOldRuns } from './runs.js';
import { TaskDefinition, AgentType } from './types.js';
import { validateDAG, getDAGDisplay, getDependents, areDependenciesMet } from './chains.js';
import { getBuiltinVariables } from './template.js';
import { runWatch } from './watch.js';
import { startDashboard } from './dashboard.js';
import { analyzeProductivity, formatReportForCLI } from './analytics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const packageJson = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'));
const VERSION = packageJson.version || '0.0.0';

const program = new Command();

program
  .name('cron-agents')
  .description('Manage scheduled coding agent tasks')
  .version(VERSION);

// ── create ──────────────────────────────────────────────────────────────────
program
  .command('create <task-id>')
  .description('Create a new scheduled task')
  .option('-s, --schedule <cron>', 'Cron schedule expression', '0 9 * * *')
  .option('-a, --agent <agent>', 'Coding agent to use (claude, copilot)', getDefaultAgent())
  .option('-m, --method <method>', 'Invocation method (cli, api)', 'cli')
  .option('--no-toast', 'Disable toast notifications')
  .option('--depends-on <tasks>', 'Comma-separated task IDs this task depends on')
  .option('--retry-max <n>', 'Max retry attempts', '3')
  .option('--retry-backoff <strategy>', 'Backoff strategy (fixed, exponential, linear)', 'fixed')
  .action(async (taskId: string, options) => {
    if (taskExists(taskId)) {
      console.error(`Error: Task "${taskId}" already exists`);
      process.exit(1);
    }

    if (!isValidAgent(options.agent)) {
      console.error(`Error: Unknown agent "${options.agent}". Supported: ${getSupportedAgents().join(', ')}`);
      process.exit(1);
    }

    const task: TaskDefinition = {
      id: taskId,
      schedule: options.schedule,
      invocation: options.method as 'cli' | 'api',
      agent: options.agent as AgentType,
      notifications: { toast: options.toast !== false },
      enabled: true,
      instructions: `# Task Instructions\n\nWrite your instructions for the coding agent here.\n`,
    };

    if (options.dependsOn) {
      task.dependsOn = options.dependsOn.split(',').map((s: string) => s.trim()).filter(Boolean);
    }

    if (options.retryMax !== '3' || options.retryBackoff !== 'fixed') {
      task.retry = {
        maxRetries: parseInt(options.retryMax) || 3,
        backoff: options.retryBackoff as any,
      };
    }

    createTask(task);
    const filePath = getTaskFilePath(taskId);

    console.log(`✓ Task "${taskId}" created`);
    console.log(`  Location: ${filePath}`);
    console.log(`  Agent: ${options.agent}`);
    console.log(`  Schedule: ${options.schedule}`);
    if (task.dependsOn?.length) {
      console.log(`  Depends on: ${task.dependsOn.join(', ')}`);
    }
    console.log(`\nNext steps:`);
    console.log(`  1. Edit the task file to add your instructions`);
    console.log(`  2. Run: cron-agents register ${taskId}`);
  });

// ── list ────────────────────────────────────────────────────────────────────
program
  .command('list')
  .description('List all scheduled tasks')
  .action(async () => {
    const tasks = listTasks();

    if (tasks.length === 0) {
      console.log('No tasks found. Create one with: cron-agents create <task-id>');
      return;
    }

    console.log('Scheduled Tasks:\n');

    for (const task of tasks) {
      try {
        const status = await getTaskStatus(task.id);
        const full = getTask(task.id);

        console.log(`📋 ${task.id}`);
        console.log(`   Schedule: ${task.schedule}`);
        console.log(`   Method: ${task.invocation}`);
        console.log(`   Agent: ${task.agent}`);
        console.log(`   Enabled (file): ${task.enabled ? '✓' : '✗'}`);

        // Show dependencies
        if (full?.dependsOn?.length) {
          const { met } = areDependenciesMet(task.id);
          console.log(`   Depends on: ${full.dependsOn.join(', ')} ${met ? '(✓ met)' : '(⏳ waiting)'}`);
        }

        // Show retry policy
        if (full?.retry) {
          console.log(`   Retry: ${full.retry.maxRetries || 3}x ${full.retry.backoff || 'fixed'}`);
        }

        // Show active run status
        const latestRun = getLatestRunForTask(task.id);
        if (latestRun && (latestRun.status === 'running' || latestRun.status === 'queued')) {
          const elapsed = Math.round((Date.now() - new Date(latestRun.startedAt).getTime()) / 1000);
          if (latestRun.status === 'running') {
            console.log(`   Run: ⏳ Running (${elapsed}s, run_id=${latestRun.runId})`);
          } else {
            console.log(`   Run: 🕐 Queued (${elapsed}s, run_id=${latestRun.runId})`);
          }
        }

        if (status.exists) {
          console.log(`   Registered: ✓`);
          console.log(`   Status: ${status.enabled ? 'Enabled' : 'Disabled'}`);
          if (status.lastRunTime && status.lastRunTime !== '12/30/1899 12:00:00 AM') {
            console.log(`   Last run: ${status.lastRunTime}`);
          }
          if (status.nextRunTime) {
            console.log(`   Next run: ${status.nextRunTime}`);
          }
        } else {
          console.log(`   Registered: ✗ (run 'cron-agents register ${task.id}')`);
        }

        console.log('');
      } catch (error) {
        console.error(`Error processing task ${task.id}: ${error}`);
      }
    }
  });

// ── get ─────────────────────────────────────────────────────────────────────
program
  .command('get <task-id>')
  .description('View a task definition and instructions')
  .action(async (taskId: string) => {
    const task = getTask(taskId);
    if (!task) {
      console.error(`Error: Task not found: ${taskId}`);
      process.exit(1);
    }

    const status = await getTaskStatus(taskId);

    console.log(`Task: ${taskId}\n`);
    console.log(`Schedule: ${task.schedule}`);
    console.log(`Method: ${task.invocation}`);
    console.log(`Agent: ${task.agent}`);
    console.log(`Enabled: ${task.enabled ? '✓' : '✗'}`);
    console.log(`Notifications: ${task.notifications?.toast ? 'Toast' : 'None'}`);
    console.log(`Registered: ${status.exists ? '✓' : '✗'}`);
    console.log(`File: ${getTaskFilePath(taskId)}`);

    if (task.dependsOn?.length) {
      console.log(`Depends on: ${task.dependsOn.join(', ')}`);
      const { met, details } = areDependenciesMet(taskId);
      console.log(`Dependencies: ${met ? '✓ All met' : '⏳ Waiting'}`);
      for (const d of details) {
        console.log(`  - ${d.taskId}: ${d.status} (${d.met ? '✓' : '✗'})`);
      }
    }

    if (task.retry) {
      console.log(`Retry: ${task.retry.maxRetries || 3}x, ${task.retry.backoff || 'fixed'} backoff, ${task.retry.initialDelay || 15}s initial`);
    }

    if (task.variables && Object.keys(task.variables).length > 0) {
      console.log(`Variables: ${JSON.stringify(task.variables)}`);
    }

    console.log(`\n--- Instructions ---\n`);
    console.log(task.instructions.trim());
  });

// ── register ────────────────────────────────────────────────────────────────
program
  .command('register <task-id>')
  .description('Register a task with Windows Task Scheduler')
  .action(async (taskId: string) => {
    try {
      const task = getTask(taskId);
      if (!task) {
        console.error(`Error: Task not found: ${taskId}`);
        process.exit(1);
      }

      const filePath = getTaskFilePath(taskId);
      await registerTask(taskId, filePath, task.schedule, PROJECT_ROOT, task.agent);
    } catch (error) {
      console.error('Error registering task:', error);
      process.exit(1);
    }
  });

// ── unregister ──────────────────────────────────────────────────────────────
program
  .command('unregister <task-id>')
  .alias('delete')
  .description('Unregister a task from Windows Task Scheduler')
  .action(async (taskId: string) => {
    try {
      await unregisterTask(taskId);
    } catch (error) {
      console.error('Error unregistering task:', error);
      process.exit(1);
    }
  });

// ── enable ──────────────────────────────────────────────────────────────────
program
  .command('enable <task-id>')
  .description('Enable a task in Windows Task Scheduler')
  .action(async (taskId: string) => {
    try {
      await enableTask(taskId);
    } catch (error) {
      console.error('Error enabling task:', error);
      process.exit(1);
    }
  });

// ── disable ─────────────────────────────────────────────────────────────────
program
  .command('disable <task-id>')
  .description('Disable a task in Windows Task Scheduler')
  .action(async (taskId: string) => {
    try {
      await disableTask(taskId);
    } catch (error) {
      console.error('Error disabling task:', error);
      process.exit(1);
    }
  });

// ── run ─────────────────────────────────────────────────────────────────────
program
  .command('run <task-id>')
  .description('Execute a task (foreground by default, --background for async)')
  .option('-b, --background', 'Run in background and return immediately')
  .option('-n, --dry-run', 'Validate without executing')
  .action(async (taskId: string, options) => {
    try {
      const task = getTask(taskId);
      if (!task) {
        console.error(`Error: Task not found: ${taskId}`);
        process.exit(1);
      }

      const filePath = getTaskFilePath(taskId);

      // --- Dry-run mode ---
      if (options.dryRun) {
        const result = await dryRunTask(filePath);
        console.log(`\nDry-run for task: ${result.taskId}\n`);

        for (const check of result.checks) {
          const icon = check.passed ? '✅' : '❌';
          console.log(`  ${icon} ${check.name}: ${check.detail}`);
        }

        console.log(`\nOverall: ${result.valid ? '✓ All checks passed' : '✗ Some checks failed'}`);

        if (result.resolvedInstructions) {
          console.log(`\n--- Resolved Instructions (preview) ---\n`);
          console.log(result.resolvedInstructions.slice(0, 500));
          if (result.resolvedInstructions.length > 500) console.log('...(truncated)');
        }
        return;
      }

      // Detect agent path for CLI tasks
      let agentCliPath: string | undefined;
      if (task.invocation === 'cli') {
        agentCliPath = detectAgentPath(task.agent) || undefined;
      }

      if (options.background) {
        // Background mode
        const slotResult = await tryAcquireSlot();
        const initialStatus = slotResult.acquired ? 'running' as const : 'queued' as const;
        const run = createRun(taskId, initialStatus);

        (async () => {
          try {
            if (initialStatus === 'queued') {
              await waitForSlot(run.runId);
            } else {
              updateRun(run.runId, { status: 'running', pid: process.pid });
            }

            const result = await executeTask(filePath, { agentPath: agentCliPath, runId: run.runId });
            updateRun(run.runId, {
              status: result.success ? 'success' : 'failure',
              finishedAt: new Date().toISOString(),
              logPath: result.logPath,
              error: result.error,
            });
          } catch (err) {
            updateRun(run.runId, {
              status: 'failure',
              finishedAt: new Date().toISOString(),
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();

        cleanupOldRuns();

        if (initialStatus === 'queued') {
          console.log(`⏳ Task "${taskId}" queued (${slotResult.runningCount}/${slotResult.maxConcurrency} slots in use)`);
        } else {
          console.log(`✓ Task "${taskId}" started in background`);
        }
        console.log(`\nRun ID: ${run.runId}`);
        console.log(`Check status: cron-agents run-status --run-id ${run.runId}`);
      } else {
        // Foreground mode
        console.log(`Executing task: ${taskId}...\n`);
        const result = await executeTask(filePath, { agentPath: agentCliPath });

        if (result.success) {
          console.log(`\n✓ Task execution completed`);
        } else {
          console.error(`\n✗ Task execution failed: ${result.error || 'Unknown error'}`);
          process.exit(1);
        }
        if (result.logPath) {
          console.log(`Log: ${result.logPath}`);
        }
      }
    } catch (error) {
      console.error('Error executing task:', error);
      process.exit(1);
    }
  });

// ── run-status ──────────────────────────────────────────────────────────────
program
  .command('run-status')
  .description('Check the status of a task run')
  .option('-r, --run-id <id>', 'Run ID to check')
  .option('-t, --task-id <id>', 'Task ID (returns latest run)')
  .action((options) => {
    if (options.runId && options.taskId) {
      console.error('Error: Provide either --run-id or --task-id, not both');
      process.exit(1);
    }
    if (!options.runId && !options.taskId) {
      console.error('Error: Provide either --run-id or --task-id');
      process.exit(1);
    }

    const run = options.runId ? getRun(options.runId) : getLatestRunForTask(options.taskId);

    if (!run) {
      console.error(`No run found for ${options.runId ? `run_id="${options.runId}"` : `task_id="${options.taskId}"`}`);
      process.exit(1);
    }

    const elapsed = run.finishedAt
      ? `${Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s`
      : `${Math.round((Date.now() - new Date(run.startedAt).getTime()) / 1000)}s (${run.status})`;

    const statusIcon: Record<string, string> = {
      queued: '🕐 queued',
      running: '⏳ running',
      success: '✅ success',
      failure: '❌ failure',
    };

    console.log(`Run: ${run.runId}`);
    console.log(`Task: ${run.taskId}`);
    console.log(`Status: ${statusIcon[run.status] || run.status}`);
    console.log(`Started: ${run.startedAt}`);
    if (run.finishedAt) console.log(`Finished: ${run.finishedAt}`);
    console.log(`Elapsed: ${elapsed}`);
    if (run.logPath) console.log(`Log: ${run.logPath}`);
    if (run.error) console.log(`Error: ${run.error}`);
    if (run.triggerType) console.log(`Trigger: ${run.triggerType}`);
    if (run.triggeredBy) console.log(`Triggered by: ${run.triggeredBy}`);
    if (run.chainId) console.log(`Chain: ${run.chainId}`);
    if (run.attempt && run.attempt > 1) console.log(`Attempt: ${run.attempt}`);
  });

// ── logs ────────────────────────────────────────────────────────────────────
program
  .command('logs <task-id>')
  .description('View execution logs for a task')
  .option('-n, --count <number>', 'Number of recent logs to show', '10')
  .action((taskId: string, options) => {
    try {
      const config = loadConfig();
      const logFiles = readdirSync(config.logsDir)
        .filter((f) => f.startsWith(`${taskId}_`) && f.endsWith('.md'))
        .sort()
        .reverse();

      if (logFiles.length === 0) {
        console.log(`No logs found for task: ${taskId}`);
        console.log(`Log directory: ${config.logsDir}`);
        return;
      }

      const count = parseInt(options.count) || 10;

      console.log(`Execution logs for task: ${taskId}\n`);
      console.log(`Total executions: ${logFiles.length}\n`);
      console.log(`Recent logs:`);

      for (const file of logFiles.slice(0, count)) {
        const filePath = join(config.logsDir, file);
        const content = readFileSync(filePath, 'utf-8');
        const parsed = matter(content);
        console.log(`\n📄 ${file}`);
        console.log(`   Status: ${parsed.data.status || 'unknown'}`);
        console.log(`   Time: ${parsed.data.timestamp || 'unknown'}`);
      }

      console.log(`\nLog directory: ${config.logsDir}`);
    } catch (error) {
      console.error('Error fetching logs:', error);
      process.exit(1);
    }
  });

// ── verify ──────────────────────────────────────────────────────────────────
program
  .command('verify <log-file>')
  .description('Verify the signature of a log file')
  .action((logFile: string) => {
    try {
      const content = readFileSync(logFile, 'utf-8');
      const result = verifyLogFile(content);

      if (result.valid) {
        console.log('✓ Signature is valid - log has not been tampered with');
        if (result.log) {
          console.log(`\nTask: ${result.log.taskId}`);
          console.log(`Execution: ${result.log.executionId}`);
          console.log(`Status: ${result.log.status}`);
        }
      } else {
        console.error('✗ Signature verification failed!');
        console.error(`  ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error('Error verifying log:', error);
      process.exit(1);
    }
  });

// ── status ──────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show cron-agents system status')
  .action(async () => {
    const config = loadConfig();
    const tasks = listTasks();
    const concurrency = await getConcurrencyStatus();

    console.log('cron-agents System Status\n');
    console.log(`Version: ${VERSION}`);
    console.log(`Config directory: ${getConfigDir()}`);
    console.log(`Task directories:`);
    config.tasksDirs.forEach((d, i) => {
      console.log(`  ${i === 0 ? '(primary)' : '         '} ${d}`);
    });
    console.log(`Logs directory: ${config.logsDir}`);
    console.log(`Total tasks: ${tasks.length}`);
    console.log(`Secret key: ${config.secretKey ? '✓ Configured' : '✗ Not configured'}`);
    console.log('');
    console.log('Concurrency:');
    console.log(`  Max concurrent tasks: ${concurrency.maxConcurrency}`);
    console.log(`  Currently running: ${concurrency.running} (actively executing)`);
    console.log(`  Currently queued: ${concurrency.queued} (waiting for a slot)`);
    console.log('');
    console.log(`Node version: ${process.version}`);
    console.log(`Platform: ${process.platform}`);
    console.log('');
    console.log('Supported Agents:');
    for (const agent of getSupportedAgents()) {
      const ac = getAgentConfig(agent);
      const detected = detectAgentPath(agent);
      console.log(`  - ${ac.displayName} (${agent}): ${detected ? `✓ Found at ${detected}` : '✗ Not found'}`);
    }

    if (config.variables && Object.keys(config.variables).length > 0) {
      console.log('');
      console.log('Global Variables:');
      for (const [k, v] of Object.entries(config.variables)) {
        console.log(`  ${k}: ${v}`);
      }
    }
  });

// ── chains ──────────────────────────────────────────────────────────────────
program
  .command('chains')
  .description('Show task dependency graph and chain status')
  .action(() => {
    const errors = validateDAG();
    if (errors.length > 0) {
      console.error('⚠️  DAG validation errors:');
      for (const err of errors) {
        console.error(`  ✗ ${err}`);
      }
      console.error('');
    }

    console.log(getDAGDisplay());
  });

// ── watch ───────────────────────────────────────────────────────────────────
program
  .command('watch')
  .description('Live terminal monitoring of tasks and runs')
  .option('-i, --interval <ms>', 'Refresh interval in milliseconds', '2000')
  .action(async (options) => {
    const interval = parseInt(options.interval) || 2000;
    await runWatch(interval);
  });

// ── dashboard ───────────────────────────────────────────────────────────────
program
  .command('dashboard')
  .description('Start web dashboard for monitoring')
  .option('-p, --port <port>', 'Port number', '7890')
  .action((options) => {
    const port = parseInt(options.port) || 7890;
    const { url, stop } = startDashboard(port);

    console.log(`✓ Dashboard started at ${url}`);
    console.log(`Press Ctrl+C to stop\n`);

    const handler = () => {
      console.log('\nStopping dashboard...');
      stop().then(() => process.exit(0));
    };

    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
  });

// ── variables ───────────────────────────────────────────────────────────────
program
  .command('variables')
  .description('List available template variables')
  .action(() => {
    console.log('Available Template Variables:\n');
    console.log('Use {{variable}} syntax in task instructions.\n');

    const builtins = getBuiltinVariables();
    console.log('Built-in:');
    for (const v of builtins) {
      console.log(`  {{${v}}}`);
    }

    const config = loadConfig();
    if (config.variables && Object.keys(config.variables).length > 0) {
      console.log('\nGlobal (from config):');
      for (const k of Object.keys(config.variables)) {
        console.log(`  {{${k}}} = "${config.variables[k]}"`);
      }
    }

    console.log('\nTask-level variables can be defined in frontmatter:');
    console.log('  variables:');
    console.log('    myVar: "value"');
  });

// ── analytics ───────────────────────────────────────────────────────────────
program
  .command('analytics')
  .description('Analyze task execution patterns and productivity')
  .option('-d, --days <n>', 'Number of days to analyze', '30')
  .option('-t, --task <id>', 'Analyze a specific task only')
  .option('--json', 'Output raw JSON instead of formatted report')
  .action((options) => {
    const days = parseInt(options.days) || 30;
    const report = analyzeProductivity({ days, taskId: options.task });

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatReportForCLI(report));
    }
  });

// ── mcp ─────────────────────────────────────────────────────────────────────
program
  .command('mcp')
  .description('Start the MCP (Model Context Protocol) server on stdio')
  .action(async () => {
    const { startMcpServer } = await import('./mcp-server.js');
    await startMcpServer();
  });

// Parse arguments and execute
program.parse();
