/**
 * Task execution engine
 * Executes tasks via CLI or API based on task configuration
 */

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { pathToFileURL } from 'url';
import matter from 'gray-matter';
import { TaskDefinition, ExecutionResult, TaskLog } from './types.js';
import { createLog, addLogStep, finalizeLog } from './logger.js';
import { sendNotification } from './notifier.js';
import { getAgentConfig, detectAgentPath, getDefaultAgent } from './agents.js';

/**
 * Parse task definition from markdown file
 */
export function parseTaskDefinition(filePath: string): TaskDefinition {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = matter(content);

  const taskDef: TaskDefinition = {
    id: parsed.data.id || 'unknown',
    schedule: parsed.data.schedule || '0 0 * * *',
    invocation: parsed.data.invocation || 'cli',
    agent: parsed.data.agent || getDefaultAgent(),
    notifications: parsed.data.notifications || { toast: false },
    enabled: parsed.data.enabled !== false, // Default to true
    instructions: parsed.content,
  };

  return taskDef;
}

/**
 * Execute task via coding agent CLI (visible interactive session)
 * Supports multiple agents (Claude Code, GitHub Copilot CLI, etc.)
 */
async function executeViaCLI(
  task: TaskDefinition,
  log: TaskLog,
  agentPath?: string
): Promise<ExecutionResult> {
  const agentConfig = getAgentConfig(task.agent);
  addLogStep(log, `Starting ${agentConfig.displayName} CLI session`);

  return new Promise((resolve) => {
    try {
      // Create a temporary file with the instructions
      const tempFile = `${process.env.TEMP || '/tmp'}/cron-claude-task-${task.id}-${Date.now()}.md`;
      writeFileSync(tempFile, task.instructions, 'utf-8');

      addLogStep(log, 'Created temporary task file', tempFile);

      // Resolve the agent command
      const agentCommand = agentPath
        || process.env[agentConfig.pathEnvVar]
        || detectAgentPath(task.agent)
        || agentConfig.executables[0];

      addLogStep(log, `Launching ${agentConfig.displayName} CLI`, `Using: ${agentCommand}`);

      // Build CLI arguments based on agent input mode
      let cliArgs: string[];
      if (agentConfig.inputMode === 'file-reference') {
        // Write full instructions to temp file, pass a short prompt referencing it
        cliArgs = [...agentConfig.printArgs, `Read and execute the complete instructions from this file: ${tempFile}`];
      } else if (agentConfig.inputMode === 'inline') {
        // Pass instructions text directly (e.g. copilot -p "instructions")
        cliArgs = [...agentConfig.printArgs, task.instructions];
      } else {
        // Pass temp file path (e.g. claude --print --dangerously-skip-permissions tempFile)
        cliArgs = [...agentConfig.printArgs, tempFile];
      }

      const fullCommand = `${agentCommand} ${cliArgs.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`;
      addLogStep(log, `Full CLI command`, fullCommand);

      const agentProcess = spawn(agentCommand, cliArgs, {
        stdio: 'inherit', // Use parent's stdio (makes window visible)
        shell: true,
        detached: false
      });

      // Set timeout (5 minutes default)
      const timeout = setTimeout(() => {
        addLogStep(log, 'Execution timeout', 'Task exceeded 5 minute limit');
        agentProcess.kill('SIGTERM');
        resolve({
          success: false,
          output: '',
          error: 'Execution timeout after 5 minutes',
          steps: log.steps
        });
      }, 5 * 60 * 1000);

      agentProcess.on('close', (code) => {
        clearTimeout(timeout);

        // Clean up temp file
        try {
          unlinkSync(tempFile);
          addLogStep(log, 'Cleaned up temporary file');
        } catch (e) {
          addLogStep(log, 'Warning: Could not clean up temp file', undefined, String(e));
        }

        if (code === 0) {
          addLogStep(log, `${agentConfig.displayName} session completed successfully`, `Exit code: ${code}`);
          resolve({
            success: true,
            output: `Interactive session completed via ${agentConfig.displayName}`,
            steps: log.steps,
          });
        } else {
          addLogStep(log, `${agentConfig.displayName} session exited with error`, `Exit code: ${code}`);
          resolve({
            success: false,
            output: '',
            error: `${agentConfig.displayName} exited with code ${code}`,
            steps: log.steps,
          });
        }
      });

      agentProcess.on('error', (err) => {
        clearTimeout(timeout);
        addLogStep(log, `Failed to launch ${agentConfig.displayName}`, undefined, err.message);
        resolve({
          success: false,
          output: '',
          error: err.message,
          steps: log.steps,
        });
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      addLogStep(log, 'Execution setup failed', undefined, errorMsg);
      resolve({
        success: false,
        output: '',
        error: errorMsg,
        steps: log.steps,
      });
    }
  });
}

/**
 * Execute task via Claude API
 */
async function executeViaAPI(
  task: TaskDefinition,
  log: TaskLog
): Promise<ExecutionResult> {
  addLogStep(log, 'Starting API execution');

  try {
    // Check for API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable not set');
    }

    addLogStep(log, 'API key found, making request');

    // Make API call using fetch
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: task.instructions,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} ${errorText}`);
    }

    const data: any = await response.json();
    const output = data.content?.[0]?.text || JSON.stringify(data);

    addLogStep(log, 'API request completed', output);

    return {
      success: true,
      output,
      steps: log.steps,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    addLogStep(log, 'API execution failed', undefined, errorMsg);

    return {
      success: false,
      output: '',
      error: errorMsg,
      steps: log.steps,
    };
  }
}

/**
 * Execute a task
 */
export async function executeTask(taskFilePath: string, agentPath?: string): Promise<void> {
  // Parse task definition
  const task = parseTaskDefinition(taskFilePath);

  // Create log
  const log = createLog(task.id);
  addLogStep(log, 'Task execution started', `Task: ${task.id}, Method: ${task.invocation}, Agent: ${task.agent}`);

  // Check if task is enabled
  if (!task.enabled) {
    addLogStep(log, 'Task skipped - disabled');
    finalizeLog(log, false);
    return;
  }

  // Execute based on invocation method
  let result: ExecutionResult;

  if (task.invocation === 'cli') {
    result = await executeViaCLI(task, log, agentPath);
  } else if (task.invocation === 'api') {
    result = await executeViaAPI(task, log);
  } else {
    addLogStep(log, 'Invalid invocation method', undefined, `Unknown method: ${task.invocation}`);
    finalizeLog(log, false);
    return;
  }

  // Finalize log
  finalizeLog(log, result.success);

  // Send notification if enabled
  if (task.notifications.toast) {
    try {
      await sendNotification(
        `Task ${task.id} ${result.success ? 'completed' : 'failed'}`,
        result.success
          ? `Task executed successfully via ${task.agent}`
          : `Task failed: ${result.error || 'Unknown error'}`
      );
    } catch (error) {
      console.error('Failed to send notification:', error);
    }
  }
}

/**
 * Entry point for scheduled task execution
 * Called by Windows Task Scheduler
 */
export async function main() {
  // Get task file path and optional agent path from command line arguments
  const taskFile = process.argv[2];
  const agentPath = process.argv[3]; // Optional: full path to agent CLI executable

  if (!taskFile) {
    console.error('Usage: node executor.js <task-file-path> [agent-cli-path]');
    process.exit(1);
  }

  try {
    await executeTask(taskFile, agentPath);
    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run if called directly (ESM equivalent of require.main === module)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
