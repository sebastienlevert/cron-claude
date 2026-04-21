#!/usr/bin/env node
/**
 * cron-agents MCP Server
 * Exposes scheduled task management via Model Context Protocol
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';
import { registerTask, unregisterTask, enableTask, disableTask, getTaskStatus, getAllTaskStatuses } from './scheduler.js';
import { executeTask, dryRunTask } from './executor.js';
import { verifyLogFile } from './logger.js';
import { loadConfig, getConfigDir } from './config.js';
import { TaskDefinition, AgentType } from './types.js';
import {
  createTask,
  getTask,
  listTasks,
  taskExists,
  getTaskFilePath,
} from './tasks.js';
import { getSupportedAgents, getAgentConfig, detectAgentPath, getDefaultAgent, isValidAgent } from './agents.js';
import { createRun, updateRun, getRun, getLatestRunForTask, cleanupOldRuns } from './runs.js';
import { tryAcquireSlot, waitForSlot, getConcurrencyStatus } from './concurrency.js';
import { validateDAG, getDAGDisplay, areDependenciesMet } from './chains.js';
import { getBuiltinVariables } from './template.js';
import { analyzeProductivity, formatReportForMCP } from './analytics.js';

// Get project root (ESM equivalent of __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

// Read version from package.json
const packageJson = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'));
const VERSION = packageJson.version;

/**
 * Define MCP tools
 */
const tools: Tool[] = [
  {
    name: 'cron_create_task',
    description: 'Create a new scheduled task from a template or custom definition',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Unique identifier for the task',
        },
        schedule: {
          type: 'string',
          description: 'Cron expression (e.g., "0 9 * * *" for 9 AM daily)',
          default: '0 9 * * *',
        },
        invocation: {
          type: 'string',
          enum: ['cli', 'api'],
          description: 'Execution method: cli (coding agent CLI) or api (Anthropic API)',
          default: 'cli',
        },
        agent: {
          type: 'string',
          enum: ['claude', 'copilot'],
          description: 'Coding agent to use for CLI execution: claude (Claude Code) or copilot (GitHub Copilot CLI). Defaults to claude.',
          default: 'claude',
        },
        instructions: {
          type: 'string',
          description: 'Task instructions in markdown format',
        },
        toast_notifications: {
          type: 'boolean',
          description: 'Enable Windows toast notifications',
          default: true,
        },
        enabled: {
          type: 'boolean',
          description: 'Enable task immediately',
          default: true,
        },
        depends_on: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task IDs this task depends on (DAG chaining)',
        },
        retry: {
          type: 'object',
          description: 'Retry policy configuration',
          properties: {
            maxRetries: { type: 'number', description: 'Maximum retry attempts (default: 3)' },
            backoff: { type: 'string', enum: ['fixed', 'exponential', 'linear'], description: 'Backoff strategy' },
            initialDelay: { type: 'number', description: 'Initial delay in seconds (default: 15)' },
            maxDelay: { type: 'number', description: 'Maximum delay in seconds (default: 300)' },
          },
        },
        variables: {
          type: 'object',
          description: 'Custom template variables for this task',
        },
      },
      required: ['task_id', 'instructions'],
    },
  },
  {
    name: 'cron_register_task',
    description: 'Register a task with Windows Task Scheduler',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID to register',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'cron_unregister_task',
    description: 'Unregister a task from Windows Task Scheduler',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID to unregister',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'cron_list_tasks',
    description: 'List all scheduled tasks with their status',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'cron_enable_task',
    description: 'Enable a task in Windows Task Scheduler',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID to enable',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'cron_disable_task',
    description: 'Disable a task in Windows Task Scheduler',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID to disable',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'cron_run_task',
    description: 'Manually execute a task immediately (does not wait for schedule)',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID to run',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'cron_view_logs',
    description: 'View execution logs for a task from the memory skill',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID to view logs for',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'cron_verify_log',
    description: 'Verify the cryptographic signature of a log file',
    inputSchema: {
      type: 'object',
      properties: {
        log_content: {
          type: 'string',
          description: 'Full markdown content of the log file including frontmatter',
        },
      },
      required: ['log_content'],
    },
  },
  {
    name: 'cron_status',
    description: 'Show system status and configuration',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'cron_get_task',
    description: 'Get the full definition of a specific task',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID to retrieve',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'cron_get_run_status',
    description: 'Check the status of an async task run. Provide either run_id or task_id (returns latest run for that task).',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: {
          type: 'string',
          description: 'The run ID returned by cron_run_task',
        },
        task_id: {
          type: 'string',
          description: 'Task ID to get the latest run status for (alternative to run_id)',
        },
      },
    },
  },
  {
    name: 'cron_dry_run',
    description: 'Validate a task without executing it. Checks parsing, agent detection, concurrency, dependencies, and template variables.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID to dry-run',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'cron_list_chains',
    description: 'Show task dependency graph and chain status. Validates DAG for cycles and missing dependencies.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'cron_analytics',
    description: 'Analyze task execution patterns, productivity metrics, and health. Returns success rates, trends, peak hours, and actionable recommendations.',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'Number of days to analyze (default: 30)',
          default: 30,
        },
        task_id: {
          type: 'string',
          description: 'Optional: analyze a specific task only',
        },
      },
    },
  },
];

/**
 * Initialize MCP server
 */
const server = new Server(
  {
    name: 'cron-agents',
    version: VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * List available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

/**
 * Handle tool calls
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'cron_create_task': {
        const { task_id, schedule, invocation, agent, instructions, toast_notifications, enabled, depends_on, retry, variables } =
          args as any;

        // Validate agent if provided
        const agentType: AgentType = agent && isValidAgent(agent) ? agent : getDefaultAgent();

        const taskDef: TaskDefinition = {
          id: task_id,
          schedule: schedule || '0 9 * * *',
          invocation: invocation || 'cli',
          agent: agentType,
          notifications: { toast: toast_notifications !== false },
          enabled: enabled !== false,
          instructions,
        };

        // Optional new fields
        if (Array.isArray(depends_on) && depends_on.length > 0) {
          taskDef.dependsOn = depends_on;
        }
        if (retry && typeof retry === 'object') {
          taskDef.retry = retry;
        }
        if (variables && typeof variables === 'object') {
          taskDef.variables = variables;
        }

        if (taskExists(task_id)) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Task "${task_id}" already exists. Use a different ID or delete the existing task first.`,
              },
            ],
          };
        }

        createTask(taskDef);

        const filePath = getTaskFilePath(task_id);

        return {
          content: [
            {
              type: 'text',
              text: `✓ Task created successfully: ${task_id}\n\nLocation: ${filePath}\n\nNext step: Register it with:\ncron_register_task(task_id="${task_id}")`,
            },
          ],
        };
      }

      case 'cron_register_task': {
        const { task_id } = args as any;

        if (!taskExists(task_id)) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Task not found: ${task_id}`,
              },
            ],
          };
        }

        const task = getTask(task_id);

        if (!task || !task.schedule) {
          return {
            content: [
              {
                type: 'text',
                text: 'Error: Task must have a schedule defined',
              },
            ],
          };
        }

        const filePath = getTaskFilePath(task_id);
        await registerTask(task_id, filePath, task.schedule, PROJECT_ROOT, task.agent);

        return {
          content: [
            {
              type: 'text',
              text: `✓ Task "${task_id}" registered successfully with Windows Task Scheduler\n\nSchedule: ${task.schedule}\nNext run will occur according to the schedule.`,
            },
          ],
        };
      }

      case 'cron_unregister_task': {
        const { task_id } = args as any;
        await unregisterTask(task_id);

        return {
          content: [
            {
              type: 'text',
              text: `✓ Task "${task_id}" unregistered successfully`,
            },
          ],
        };
      }

      case 'cron_list_tasks': {
        const tasks = listTasks();

        if (tasks.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No tasks found. Create one with cron_create_task.',
              },
            ],
          };
        }

        // Bulk-fetch all task statuses in one PowerShell call
        const statuses = await getAllTaskStatuses();

        let output = 'Scheduled Tasks:\n\n';

        for (const task of tasks) {
          try {
            const status = statuses.get(task.id) || { exists: false };

            output += `📋 ${task.id}\n`;
            output += `   Schedule: ${task.schedule}\n`;
            output += `   Method: ${task.invocation}\n`;
            output += `   Agent: ${task.agent}\n`;
            output += `   Enabled (file): ${task.enabled ? '✓' : '✗'}\n`;

            // Show active run status (queued vs running)
            const latestRun = getLatestRunForTask(task.id);
            if (latestRun && (latestRun.status === 'running' || latestRun.status === 'queued')) {
              const elapsed = Math.round((Date.now() - new Date(latestRun.startedAt).getTime()) / 1000);
              if (latestRun.status === 'running') {
                output += `   Run: ⏳ Running (${elapsed}s, run_id=${latestRun.runId})\n`;
              } else {
                output += `   Run: 🕐 Queued (${elapsed}s, run_id=${latestRun.runId})\n`;
              }
            }

            if (status.exists) {
              output += `   Registered: ✓\n`;
              output += `   Status: ${status.enabled ? 'Enabled' : 'Disabled'}\n`;
              if (status.lastRunTime && status.lastRunTime !== '12/30/1899 12:00:00 AM') {
                output += `   Last run: ${status.lastRunTime}\n`;
              }
              if (status.nextRunTime) {
                output += `   Next run: ${status.nextRunTime}\n`;
              }
            } else {
              output += `   Registered: ✗ (use cron_register_task)\n`;
            }

            output += '\n';
          } catch (error) {
            output += `Error processing task ${task.id}: ${error}\n\n`;
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: output,
            },
          ],
        };
      }

      case 'cron_enable_task': {
        const { task_id } = args as any;
        await enableTask(task_id);

        return {
          content: [
            {
              type: 'text',
              text: `✓ Task "${task_id}" enabled`,
            },
          ],
        };
      }

      case 'cron_disable_task': {
        const { task_id } = args as any;
        await disableTask(task_id);

        return {
          content: [
            {
              type: 'text',
              text: `✓ Task "${task_id}" disabled`,
            },
          ],
        };
      }

      case 'cron_run_task': {
        const { task_id } = args as any;

        const task = getTask(task_id);
        if (!task) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Task not found: ${task_id}`,
              },
            ],
          };
        }

        const filePath = getTaskFilePath(task_id);

        // Detect agent path for CLI tasks
        let agentCliPath: string | undefined;
        if (task.invocation === 'cli') {
          agentCliPath = detectAgentPath(task.agent) || undefined;
        }

        // Create a persistent run record
        const slotResult = await tryAcquireSlot();
        const initialStatus = slotResult.acquired ? 'running' as const : 'queued' as const;
        const run = createRun(task_id, initialStatus);

        // Fire-and-forget: handle concurrency and execution in background
        (async () => {
          try {
            // If queued, wait for a slot before executing
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

        // Clean up old completed runs opportunistically
        cleanupOldRuns();

        const statusEmoji = initialStatus === 'queued' ? '⏳' : '✓';
        const statusMsg = initialStatus === 'queued'
          ? `Task "${task_id}" queued (${slotResult.runningCount}/${slotResult.maxConcurrency} slots in use). Will start when a slot opens.`
          : `Task "${task_id}" started in background`;

        return {
          content: [
            {
              type: 'text',
              text: `${statusEmoji} ${statusMsg}\n\nRun ID: ${run.runId}\n\nCheck status with: cron_get_run_status(run_id="${run.runId}")\nOr by task:       cron_get_run_status(task_id="${task_id}")`,
            },
          ],
        };
      }

      case 'cron_view_logs': {
        const { task_id } = args as any;

        try {
          const config = loadConfig();
          const logFiles = readdirSync(config.logsDir)
            .filter((f) => f.startsWith(`${task_id}_`) && f.endsWith('.md'))
            .sort()
            .reverse(); // Most recent first

          if (logFiles.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: `No logs found for task: ${task_id}`,
                },
              ],
            };
          }

          // Return list of log files with timestamps
          let output = `Execution logs for task: ${task_id}\n\n`;
          output += `Total executions: ${logFiles.length}\n\n`;
          output += `Recent logs:\n`;

          for (const file of logFiles.slice(0, 10)) {
            // Show last 10
            const filePath = join(config.logsDir, file);
            const content = readFileSync(filePath, 'utf-8');
            const parsed = matter(content);
            output += `\n📄 ${file}\n`;
            output += `   Status: ${parsed.data.status || 'unknown'}\n`;
            output += `   Time: ${parsed.data.timestamp || 'unknown'}\n`;
          }

          output += `\n\nLog directory: ${config.logsDir}`;

          return {
            content: [
              {
                type: 'text',
                text: output,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error fetching logs: ${error}`,
              },
            ],
          };
        }
      }

      case 'cron_verify_log': {
        const { log_content } = args as any;
        const result = verifyLogFile(log_content);

        if (result.valid) {
          let output = '✓ Signature is valid - log has not been tampered with\n\n';
          if (result.log) {
            output += `Task: ${result.log.taskId}\n`;
            output += `Execution: ${result.log.executionId}\n`;
            output += `Status: ${result.log.status}\n`;
          }

          return {
            content: [
              {
                type: 'text',
                text: output,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: `✗ Signature verification failed!\n\n${result.error}`,
              },
            ],
          };
        }
      }

      case 'cron_status': {
        const config = loadConfig();
        const tasks = listTasks();
        const taskCount = tasks.length;
        const concurrency = await getConcurrencyStatus();

        const output = `cron-agents System Status

Version: ${VERSION}
Config directory: ${getConfigDir()}
Task directories:
${config.tasksDirs.map((d, i) => `  ${i === 0 ? '(primary) ' : '          '}${d}`).join('\n')}
Logs directory: ${config.logsDir}
Total tasks: ${taskCount}
Secret key: ${config.secretKey ? '✓ Configured' : '✗ Not configured'}

Concurrency:
  Max concurrent tasks: ${concurrency.maxConcurrency}
  Currently running: ${concurrency.running} (actively executing)
  Currently queued: ${concurrency.queued} (waiting for a slot)

Node version: ${process.version}
Platform: ${process.platform}

Supported Agents:
${getSupportedAgents().map(a => {
  const ac = getAgentConfig(a);
  const detected = detectAgentPath(a);
  return `- ${ac.displayName} (${a}): ${detected ? `✓ Found at ${detected}` : '✗ Not found'}`;
}).join('\n')}

Available tools:
- cron_create_task - Create new scheduled tasks (supports agent selection)
- cron_register_task - Register with Task Scheduler
- cron_list_tasks - View all tasks
- cron_run_task - Execute immediately (with concurrency control)
- cron_enable/disable_task - Toggle tasks
- cron_view_logs - View execution history
- cron_verify_log - Verify log signatures
`;

        return {
          content: [
            {
              type: 'text',
              text: output,
            },
          ],
        };
      }

      case 'cron_get_task': {
        const { task_id } = args as any;

        const task = getTask(task_id);

        if (!task) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Task not found: ${task_id}`,
              },
            ],
          };
        }

        const status = await getTaskStatus(task_id);

        // Reconstruct full definition as markdown
        const fullDefinition = `---
id: ${task.id}
schedule: "${task.schedule}"
invocation: ${task.invocation}
agent: ${task.agent}
notifications:
  toast: ${task.notifications.toast}
enabled: ${task.enabled}
---

${task.instructions}`;

        let output = `Task: ${task_id}\n\n`;
        output += `Schedule: ${task.schedule}\n`;
        output += `Method: ${task.invocation}\n`;
        output += `Agent: ${task.agent}\n`;
        output += `Enabled: ${task.enabled}\n`;
        output += `Notifications: ${task.notifications?.toast ? 'Yes' : 'No'}\n`;
        output += `Registered: ${status.exists ? 'Yes' : 'No'}\n\n`;
        output += `Full Definition:\n\n${fullDefinition}`;

        return {
          content: [
            {
              type: 'text',
              text: output,
            },
          ],
        };
      }

      case 'cron_get_run_status': {
        const { run_id, task_id } = args as any;

        let run;
        if (run_id) {
          run = getRun(run_id);
        } else if (task_id) {
          run = getLatestRunForTask(task_id);
        } else {
          return {
            content: [
              {
                type: 'text',
                text: 'Error: Provide either run_id or task_id',
              },
            ],
          };
        }

        if (!run) {
          return {
            content: [
              {
                type: 'text',
                text: `No run found for ${run_id ? `run_id="${run_id}"` : `task_id="${task_id}"`}`,
              },
            ],
          };
        }

        const elapsed = run.finishedAt
          ? `${Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s`
          : `${Math.round((Date.now() - new Date(run.startedAt).getTime()) / 1000)}s (${run.status})`;

        const statusIcon = {
          queued: '🕐 queued',
          running: '⏳ running',
          success: '✅ success',
          failure: '❌ failure',
        }[run.status] || run.status;

        let output = `Run: ${run.runId}\n`;
        output += `Task: ${run.taskId}\n`;
        output += `Status: ${statusIcon}\n`;
        output += `Started: ${run.startedAt}\n`;
        if (run.finishedAt) output += `Finished: ${run.finishedAt}\n`;
        output += `Elapsed: ${elapsed}\n`;
        if (run.logPath) output += `Log: ${run.logPath}\n`;
        if (run.error) output += `Error: ${run.error}\n`;

        if (run.triggerType) output += `Trigger: ${run.triggerType}\n`;
        if (run.triggeredBy) output += `Triggered by: ${run.triggeredBy}\n`;
        if (run.chainId) output += `Chain: ${run.chainId}\n`;
        if (run.attempt && run.attempt > 1) output += `Attempt: ${run.attempt}\n`;

        return {
          content: [
            {
              type: 'text',
              text: output,
            },
          ],
        };
      }

      case 'cron_dry_run': {
        const { task_id } = args as any;

        if (!taskExists(task_id)) {
          return {
            content: [{ type: 'text', text: `Error: Task not found: ${task_id}` }],
          };
        }

        const filePath = getTaskFilePath(task_id);
        const result = await dryRunTask(filePath);

        let output = `Dry-run for task: ${result.taskId}\n\n`;
        for (const check of result.checks) {
          const icon = check.passed ? '✅' : '❌';
          output += `${icon} ${check.name}: ${check.detail}\n`;
        }
        output += `\nOverall: ${result.valid ? '✓ All checks passed' : '✗ Some checks failed'}`;

        if (result.resolvedInstructions) {
          output += `\n\n--- Resolved Instructions (preview) ---\n${result.resolvedInstructions.slice(0, 1000)}`;
          if (result.resolvedInstructions.length > 1000) output += '\n...(truncated)';
        }

        return {
          content: [{ type: 'text', text: output }],
        };
      }

      case 'cron_list_chains': {
        const errors = validateDAG();
        let output = '';

        if (errors.length > 0) {
          output += '⚠️ DAG validation errors:\n';
          for (const err of errors) {
            output += `  ✗ ${err}\n`;
          }
          output += '\n';
        }

        output += getDAGDisplay();

        return {
          content: [{ type: 'text', text: output }],
        };
      }

      case 'cron_analytics': {
        const days = typeof args?.days === 'number' ? args.days : 30;
        const taskId = typeof args?.task_id === 'string' ? args.task_id : undefined;
        const report = analyzeProductivity({ days, taskId });
        const text = formatReportForMCP(report);

        return {
          content: [{ type: 'text', text }],
        };
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

/**
 * Start the MCP server on stdio.
 * Exported so it can be called from the CLI `mcp` subcommand.
 */
export async function startMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error('cron-agents MCP server running on stdio');
}

// Auto-start when run directly (e.g. node dist/mcp-server.js)
const isDirectRun = process.argv[1]?.endsWith('mcp-server.js');
if (isDirectRun) {
  startMcpServer().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
