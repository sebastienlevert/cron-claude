/**
 * Task execution engine
 * Executes tasks via CLI or API based on task configuration
 */

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { pathToFileURL } from 'url';
import matter from 'gray-matter';
import { TaskDefinition, ExecutionResult, TaskLog, ExecuteTaskResult, ExecuteTaskOptions, DryRunResult, DryRunCheck, RetryPolicy } from './types.js';
import { createLog, addLogStep, finalizeLog } from './logger.js';
import { sendNotification } from './notifier.js';
import { getAgentConfig, detectAgentPath, getDefaultAgent } from './agents.js';
import { tryAcquireSlot, waitForSlot } from './concurrency.js';
import { createRun, updateRun } from './runs.js';
import { resolveRetryPolicy, shouldRetry, getRetryDelay, isRetryableError } from './retry.js';
import { resolveVariables, TemplateContext, redactForDisplay } from './template.js';
import { triggerDependents, areDependenciesMet, validateDAG } from './chains.js';
import { loadConfig } from './config.js';
import { getTask, getTaskFilePath } from './tasks.js';

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
    enabled: parsed.data.enabled !== false,
    instructions: parsed.content,
  };

  // Parse optional fields
  if (Array.isArray(parsed.data.dependsOn)) {
    taskDef.dependsOn = parsed.data.dependsOn.filter((d: unknown) => typeof d === 'string' && d.trim());
  }
  if (parsed.data.retry && typeof parsed.data.retry === 'object') {
    taskDef.retry = {};
    const r = parsed.data.retry;
    if (typeof r.maxRetries === 'number') taskDef.retry.maxRetries = r.maxRetries;
    if (typeof r.backoff === 'string') taskDef.retry.backoff = r.backoff;
    if (typeof r.initialDelay === 'number') taskDef.retry.initialDelay = r.initialDelay;
    if (typeof r.maxDelay === 'number') taskDef.retry.maxDelay = r.maxDelay;
  }
  if (parsed.data.variables && typeof parsed.data.variables === 'object' && !Array.isArray(parsed.data.variables)) {
    taskDef.variables = {};
    for (const [k, v] of Object.entries(parsed.data.variables)) {
      taskDef.variables[k] = String(v);
    }
  }
  if (typeof parsed.data.timeout === 'number' && parsed.data.timeout > 0) {
    taskDef.timeout = parsed.data.timeout;
  }

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
      const tempFile = `${process.env.TEMP || '/tmp'}/cron-agents-task-${task.id}-${Date.now()}.md`;
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
        cliArgs = [...agentConfig.printArgs, `Read and execute the complete instructions from this file: ${tempFile}`];
      } else if (agentConfig.inputMode === 'inline') {
        cliArgs = [...agentConfig.printArgs, task.instructions];
      } else {
        cliArgs = [...agentConfig.printArgs, tempFile];
      }

      const quotedArgs = cliArgs.map(a => a.includes(' ') ? `"${a}"` : a);
      const fullCommand = `${agentCommand} ${quotedArgs.join(' ')}`;
      addLogStep(log, `Full CLI command`, fullCommand);

      const agentProcess = spawn(fullCommand, [], {
        stdio: 'pipe',
        shell: true,
        detached: false,
        windowsHide: true
      });

      let stdoutData = '';
      let stderrData = '';
      agentProcess.stdout?.on('data', (chunk: Buffer) => { stdoutData += chunk.toString(); });
      agentProcess.stderr?.on('data', (chunk: Buffer) => { stderrData += chunk.toString(); });

      const timeoutMinutes = task.timeout || 60;
      const timeout = setTimeout(() => {
        addLogStep(log, 'Execution timeout', `Task exceeded ${timeoutMinutes} minute limit`);
        agentProcess.kill('SIGTERM');
        resolve({
          success: false,
          output: stdoutData,
          error: `Execution timeout after ${timeoutMinutes} minutes`,
          steps: log.steps
        });
      }, timeoutMinutes * 60 * 1000);

      agentProcess.on('close', (code) => {
        clearTimeout(timeout);

        try {
          unlinkSync(tempFile);
          addLogStep(log, 'Cleaned up temporary file');
        } catch (e) {
          addLogStep(log, 'Warning: Could not clean up temp file', undefined, String(e));
        }

        if (stdoutData) {
          addLogStep(log, 'Agent output', stdoutData.slice(0, 10000));
        }
        if (stderrData) {
          addLogStep(log, 'Agent stderr', stderrData.slice(0, 5000));
        }

        if (code === 0) {
          addLogStep(log, `${agentConfig.displayName} session completed successfully`, `Exit code: ${code}`);
          resolve({
            success: true,
            output: stdoutData || `Session completed via ${agentConfig.displayName}`,
            steps: log.steps,
          });
        } else {
          addLogStep(log, `${agentConfig.displayName} session exited with error`, `Exit code: ${code}`);
          resolve({
            success: false,
            output: stdoutData,
            error: stderrData || `${agentConfig.displayName} exited with code ${code}`,
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
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable not set');
    }

    addLogStep(log, 'API key found, making request');

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

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Perform a dry-run validation of a task without executing it.
 * No run records, notifications, or chain triggers.
 */
export async function dryRunTask(taskFilePath: string): Promise<DryRunResult> {
  const checks: DryRunCheck[] = [];
  let task: TaskDefinition;

  // Check 1: Parse task file
  try {
    task = parseTaskDefinition(taskFilePath);
    checks.push({ name: 'Task parsing', passed: true, detail: `Task "${task.id}" parsed successfully` });
  } catch (err) {
    return {
      taskId: 'unknown',
      valid: false,
      checks: [{ name: 'Task parsing', passed: false, detail: `Failed to parse: ${err}` }],
    };
  }

  // Check 2: Task enabled
  checks.push({
    name: 'Task enabled',
    passed: task.enabled,
    detail: task.enabled ? 'Task is enabled' : 'Task is DISABLED — would be skipped',
  });

  // Check 3: Agent detection (for CLI tasks)
  if (task.invocation === 'cli') {
    const agentConfig = getAgentConfig(task.agent);
    const agentPath = detectAgentPath(task.agent);
    checks.push({
      name: 'Agent detection',
      passed: !!agentPath,
      detail: agentPath
        ? `${agentConfig.displayName} found at: ${agentPath}`
        : `${agentConfig.displayName} NOT FOUND in PATH`,
    });
  } else {
    const hasKey = !!process.env.ANTHROPIC_API_KEY;
    checks.push({
      name: 'API key',
      passed: hasKey,
      detail: hasKey ? 'ANTHROPIC_API_KEY is set' : 'ANTHROPIC_API_KEY is NOT SET',
    });
  }

  // Check 4: Cron schedule validity
  try {
    const { validate } = await import('node-cron');
    const validCron = validate(task.schedule);
    checks.push({
      name: 'Cron schedule',
      passed: validCron,
      detail: validCron ? `"${task.schedule}" is valid` : `"${task.schedule}" is INVALID`,
    });
  } catch {
    checks.push({ name: 'Cron schedule', passed: true, detail: `Schedule: "${task.schedule}" (validator unavailable)` });
  }

  // Check 5: Concurrency
  const slotResult = await tryAcquireSlot();
  checks.push({
    name: 'Concurrency',
    passed: true,
    detail: slotResult.acquired
      ? `Slot available (${slotResult.runningCount}/${slotResult.maxConcurrency} in use)`
      : `Would be QUEUED (${slotResult.runningCount}/${slotResult.maxConcurrency} in use)`,
  });

  // Check 6: Dependencies
  if (task.dependsOn && task.dependsOn.length > 0) {
    const dagErrors = validateDAG(task.id);
    if (dagErrors.length > 0) {
      checks.push({
        name: 'Dependencies (DAG)',
        passed: false,
        detail: `DAG errors: ${dagErrors.join('; ')}`,
      });
    } else {
      const { met, details } = areDependenciesMet(task.id);
      const detailStr = details.map(d => `${d.taskId}: ${d.status} (${d.met ? '✓' : '✗'})`).join(', ');
      checks.push({
        name: 'Dependencies',
        passed: met,
        detail: met ? `All deps met: ${detailStr}` : `Deps NOT met: ${detailStr}`,
      });
    }
  }

  // Check 7: Retry policy
  const retryPolicy = resolveRetryPolicy(task.retry);
  checks.push({
    name: 'Retry policy',
    passed: true,
    detail: `maxRetries=${retryPolicy.maxRetries}, backoff=${retryPolicy.backoff}, initialDelay=${retryPolicy.initialDelay}s, maxDelay=${retryPolicy.maxDelay}s`,
  });

  // Check 8: Template variables
  const config = loadConfig();
  const templateCtx: TemplateContext = {
    taskId: task.id,
    runId: 'dry-run',
    attempt: 1,
    agent: task.agent,
    taskVariables: task.variables,
    globalVariables: config.variables,
  };
  const { resolved, warnings } = resolveVariables(task.instructions, templateCtx);
  if (warnings.length > 0) {
    checks.push({
      name: 'Template variables',
      passed: true, // Warnings, not errors
      detail: `Warnings: ${warnings.join('; ')}`,
    });
  } else {
    checks.push({
      name: 'Template variables',
      passed: true,
      detail: 'All variables resolved successfully',
    });
  }

  const allPassed = checks.every(c => c.passed);

  return {
    taskId: task.id,
    valid: allPassed,
    checks,
    resolvedInstructions: redactForDisplay(resolved),
  };
}

/**
 * Execute a task with smart retry, template resolution, and chain triggering.
 *
 * Concurrency control: if a runId is provided, the caller has already created
 * the run record and is managing concurrency externally (e.g. MCP fire-and-forget).
 * If no runId is provided (CLI / Task Scheduler), this function handles concurrency
 * internally by creating a run record and waiting for a slot if needed.
 */
export async function executeTask(
  taskFilePath: string,
  optionsOrAgentPath?: string | ExecuteTaskOptions,
  runId?: string,
): Promise<ExecuteTaskResult> {
  // Support legacy signature: executeTask(path, agentPath?, runId?)
  let options: ExecuteTaskOptions;
  if (typeof optionsOrAgentPath === 'string') {
    options = { agentPath: optionsOrAgentPath, runId };
  } else if (optionsOrAgentPath) {
    options = optionsOrAgentPath;
  } else {
    options = { runId };
  }

  const effectiveRunId = options.runId;

  // --- Dry-run shortcut ---
  if (options.dryRun) {
    const result = await dryRunTask(taskFilePath);
    return {
      success: result.valid,
      error: result.valid ? undefined : 'Dry-run validation failed',
    };
  }

  // --- Concurrency gate (for direct callers like CLI / Task Scheduler) ---
  let ownedRunId: string | undefined;
  if (!effectiveRunId) {
    const tempContent = readFileSync(taskFilePath, 'utf-8');
    const tempParsed = matter(tempContent);
    const taskId = tempParsed.data.id || 'unknown';

    const slotResult = await tryAcquireSlot();
    if (slotResult.acquired) {
      const run = createRun(taskId, 'running');
      ownedRunId = run.runId;
    } else {
      const run = createRun(taskId, 'queued');
      ownedRunId = run.runId;
      console.error(
        `⏳ Concurrency limit reached (${slotResult.runningCount}/${slotResult.maxConcurrency}). ` +
        `Task "${taskId}" queued as ${run.runId}. Waiting for slot...`
      );
      try {
        await waitForSlot(run.runId);
        console.error(`✓ Slot acquired for "${taskId}" (${run.runId})`);
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }

  const finalRunId = effectiveRunId || ownedRunId;

  // Parse task definition
  const task = parseTaskDefinition(taskFilePath);

  // --- Template variable resolution ---
  const config = loadConfig();
  const templateCtx: TemplateContext = {
    taskId: task.id,
    runId: finalRunId,
    attempt: options.attempt || 1,
    agent: task.agent,
    taskVariables: task.variables,
    globalVariables: config.variables,
  };

  const { resolved: resolvedInstructions, warnings: templateWarnings } = resolveVariables(
    task.instructions,
    templateCtx,
  );
  // Replace instructions with resolved version
  task.instructions = resolvedInstructions;

  // Create log
  const log = createLog(task.id);
  addLogStep(log, 'Task execution started', `Task: ${task.id}, Method: ${task.invocation}, Agent: ${task.agent}`);

  if (templateWarnings.length > 0) {
    addLogStep(log, 'Template warnings', templateWarnings.join('; '));
  }

  if (options.chainId) {
    addLogStep(log, 'Chain execution', `Chain: ${options.chainId}, triggered by: ${options.triggeredBy || 'unknown'}`);
  }

  // Check if task is enabled
  if (!task.enabled) {
    addLogStep(log, 'Task skipped - disabled');
    const logPath = finalizeLog(log, false);
    return { success: false, logPath, error: 'Task is disabled' };
  }

  // --- Smart retry with configurable backoff ---
  const retryPolicy: RetryPolicy = resolveRetryPolicy(task.retry);
  let result: ExecutionResult;
  let attempt = 0;

  while (true) {
    attempt++;

    if (attempt > 1) {
      addLogStep(log, `Retry attempt ${attempt}/${retryPolicy.maxRetries + 1}`);
    }

    if (task.invocation === 'cli') {
      result = await executeViaCLI(task, log, options.agentPath);
    } else if (task.invocation === 'api') {
      result = await executeViaAPI(task, log);
    } else {
      addLogStep(log, 'Invalid invocation method', undefined, `Unknown method: ${task.invocation}`);
      const logPath = finalizeLog(log, false);
      return { success: false, logPath, error: `Unknown method: ${task.invocation}` };
    }

    // If successful or non-retryable, break out
    if (result.success || !shouldRetry(result, attempt, retryPolicy)) {
      break;
    }

    // Calculate backoff delay
    const retryDelayMs = getRetryDelay(attempt, retryPolicy);
    addLogStep(
      log,
      `Transient error detected (attempt ${attempt}/${retryPolicy.maxRetries + 1}), retrying in ${Math.round(retryDelayMs / 1000)}s`,
      result.error || 'Unknown transient error'
    );

    // Update run record to show retrying status
    if (finalRunId) {
      updateRun(finalRunId, { attempt });
    }

    await delay(retryDelayMs);
  }

  if (!result!.success && attempt > 1) {
    addLogStep(log, `All ${attempt} attempts failed`);
  } else if (result!.success && attempt > 1) {
    addLogStep(log, `Succeeded on attempt ${attempt}`);
  }

  // Finalize log
  const logPath = finalizeLog(log, result!.success);

  // Update owned run record
  if (ownedRunId) {
    updateRun(ownedRunId, {
      status: result!.success ? 'success' : 'failure',
      finishedAt: new Date().toISOString(),
      logPath,
      error: result!.error,
      attempt,
    });
  }

  // --- Chain triggering: after successful execution, fire eligible dependents ---
  if (result!.success) {
    try {
      const triggered = triggerDependents(task.id, options.chainId);
      if (triggered.length > 0) {
        addLogStep(log, 'Triggered dependents', triggered.map(t => t.taskId).join(', '));

        // Fire-and-forget dependent executions
        for (const dep of triggered) {
          const depFilePath = getTaskFilePath(dep.taskId);
          // Don't await — fire and forget
          executeTask(depFilePath, {
            chainId: dep.chainId,
            triggeredBy: dep.triggeredBy,
          }).catch(err => {
            console.error(`Failed to trigger dependent task ${dep.taskId}:`, err);
          });
        }
      }
    } catch (chainErr) {
      console.error('Error triggering dependents:', chainErr);
    }
  }

  // Send notification if enabled
  if (task.notifications.toast) {
    try {
      await sendNotification(
        `Task ${task.id} ${result!.success ? 'completed' : 'failed'}`,
        result!.success
          ? `Task executed successfully via ${task.agent}${attempt > 1 ? ` (attempt ${attempt})` : ''}`
          : `Task failed after ${attempt} attempt(s): ${result!.error || 'Unknown error'}`,
        logPath,
      );
    } catch (error) {
      console.error('Failed to send notification:', error);
    }
  }

  return {
    success: result!.success,
    logPath,
    error: result!.error,
  };
}

/**
 * Entry point for scheduled task execution
 * Called by Windows Task Scheduler
 */
export async function main() {
  const taskFile = process.argv[2];
  const agentPath = process.argv[3];

  if (!taskFile) {
    console.error('Usage: node executor.js <task-file-path> [agent-cli-path]');
    process.exit(1);
  }

  try {
    await executeTask(taskFile, agentPath ? { agentPath } : undefined);
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
