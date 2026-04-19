#!/usr/bin/env node
/**
 * CLI interface for cron-agents
 * Manage scheduled Claude tasks
 */

import { Command } from 'commander';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';
import { registerTask, unregisterTask, enableTask, disableTask, getTaskStatus } from './scheduler.js';
import { executeTask } from './executor.js';
import { verifyLogFile } from './logger.js';
import { loadConfig, getConfigDir } from './config.js';
import { execSync } from 'child_process';

const program = new Command();

// Get project root (ESM equivalent of __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const TASKS_DIR = join(PROJECT_ROOT, 'tasks');

// Ensure tasks directory exists
if (!existsSync(TASKS_DIR)) {
  mkdirSync(TASKS_DIR, { recursive: true });
}

/**
 * Get all task files
 */
function getTaskFiles(): string[] {
  try {
    return readdirSync(TASKS_DIR).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
}

/**
 * Parse task file
 */
function parseTask(filename: string): any {
  const filePath = join(TASKS_DIR, filename);
  const content = readFileSync(filePath, 'utf-8');
  const parsed = matter(content);
  return { filePath, ...parsed.data, instructions: parsed.content };
}

program
  .name('cron-agents')
  .description('Manage scheduled Claude tasks (cron jobs for Claude)')
  .version('0.1.0');

/**
 * Create a new task
 */
program
  .command('create')
  .description('Create a new scheduled task')
  .option('-i, --interactive', 'Interactive mode (default)', true)
  .action(async (options) => {
    console.log('Creating new scheduled task...\n');

    // TODO: Add interactive prompts
    // For now, create a template
    const taskId = `task-${Date.now()}`;
    const template = `---
id: ${taskId}
schedule: "0 9 * * *"  # Every day at 9 AM
invocation: cli  # or 'api'
notifications:
  toast: true
enabled: true
---

# Task Instructions

Write your instructions for Claude here.

## Example
- Check email
- Summarize important messages
- Create a daily report
`;

    const filename = `${taskId}.md`;
    const filePath = join(TASKS_DIR, filename);
    writeFileSync(filePath, template, 'utf-8');

    console.log(`✓ Task template created: ${filename}`);
    console.log(`  Location: ${filePath}`);
    console.log('\nNext steps:');
    console.log('1. Edit the task file to add your instructions');
    console.log('2. Run: cron-agents register ' + taskId);
  });

/**
 * Register a task with Task Scheduler
 */
program
  .command('register <task-id>')
  .description('Register a task with Windows Task Scheduler')
  .action(async (taskId) => {
    try {
      const filename = `${taskId}.md`;
      const filePath = join(TASKS_DIR, filename);

      if (!existsSync(filePath)) {
        console.error(`Error: Task file not found: ${filename}`);
        process.exit(1);
      }

      const task = parseTask(filename);

      if (!task.schedule) {
        console.error('Error: Task must have a schedule defined');
        process.exit(1);
      }

      await registerTask(taskId, filePath, task.schedule, PROJECT_ROOT);
    } catch (error) {
      console.error('Error registering task:', error);
      process.exit(1);
    }
  });

/**
 * Unregister a task
 */
program
  .command('unregister <task-id>')
  .alias('delete')
  .description('Unregister a task from Windows Task Scheduler')
  .action(async (taskId) => {
    try {
      await unregisterTask(taskId);
    } catch (error) {
      console.error('Error unregistering task:', error);
      process.exit(1);
    }
  });

/**
 * List all tasks
 */
program
  .command('list')
  .description('List all scheduled tasks')
  .action(async () => {
    const files = getTaskFiles();

    if (files.length === 0) {
      console.log('No tasks found. Create one with: cron-agents create');
      return;
    }

    console.log('Scheduled Tasks:\n');

    for (const file of files) {
      try {
        const task = parseTask(file);
        const status = await getTaskStatus(task.id);

        console.log(`📋 ${task.id}`);
        console.log(`   Schedule: ${task.schedule}`);
        console.log(`   Method: ${task.invocation}`);
        console.log(`   Enabled: ${task.enabled ? '✓' : '✗'} (file)`);

        if (status.exists) {
          console.log(`   Registered: ✓`);
          console.log(`   Status: ${status.enabled ? 'Enabled' : 'Disabled'}`);
          if (status.lastRunTime) {
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
        console.error(`Error parsing ${file}:`, error);
      }
    }
  });

/**
 * Enable a task
 */
program
  .command('enable <task-id>')
  .description('Enable a task in Windows Task Scheduler')
  .action(async (taskId) => {
    try {
      await enableTask(taskId);
    } catch (error) {
      console.error('Error enabling task:', error);
      process.exit(1);
    }
  });

/**
 * Disable a task
 */
program
  .command('disable <task-id>')
  .description('Disable a task in Windows Task Scheduler')
  .action(async (taskId) => {
    try {
      await disableTask(taskId);
    } catch (error) {
      console.error('Error disabling task:', error);
      process.exit(1);
    }
  });

/**
 * Manually run a task
 */
program
  .command('run <task-id>')
  .description('Manually execute a task now')
  .action(async (taskId) => {
    try {
      const filename = `${taskId}.md`;
      const filePath = join(TASKS_DIR, filename);

      if (!existsSync(filePath)) {
        console.error(`Error: Task file not found: ${filename}`);
        process.exit(1);
      }

      console.log(`Executing task: ${taskId}...\n`);
      await executeTask(filePath);
      console.log('\n✓ Task execution completed');
    } catch (error) {
      console.error('Error executing task:', error);
      process.exit(1);
    }
  });

/**
 * View task logs
 */
program
  .command('logs <task-id>')
  .description('View execution logs for a task')
  .action((taskId) => {
    try {
      // Query memory skill for logs
      const result = execSync(`odsp-memory recall --category=cron-task "${taskId}"`, {
        encoding: 'utf-8',
      });

      console.log(result);
    } catch (error) {
      console.error('Error fetching logs:', error);
      process.exit(1);
    }
  });

/**
 * Verify a log signature
 */
program
  .command('verify <log-file>')
  .description('Verify the signature of a log file')
  .action((logFile) => {
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

/**
 * Show system status
 */
program
  .command('status')
  .description('Show cron-agents system status')
  .action(() => {
    const config = loadConfig();
    const taskCount = getTaskFiles().length;

    console.log('cron-agents System Status\n');
    console.log(`Version: 0.1.0`);
    console.log(`Config directory: ${getConfigDir()}`);
    console.log(`Tasks directory: ${TASKS_DIR}`);
    console.log(`Total tasks: ${taskCount}`);
    console.log(`Secret key: ${config.secretKey ? '✓ Configured' : '✗ Not configured'}`);
    console.log(`\nNode version: ${process.version}`);
    console.log(`Platform: ${process.platform}`);
  });

// Parse arguments and execute
program.parse();
