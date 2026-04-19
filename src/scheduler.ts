/**
 * Windows Task Scheduler integration
 * Converts cron expressions to Task Scheduler triggers and manages scheduled tasks
 */

import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { resolve, join } from 'path';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import cron from 'node-cron';
import { AgentType } from './types.js';
import { detectAgentPath, getAgentConfig, getDefaultAgent } from './agents.js';

const execAsync = promisify(exec);

// Timeout for PowerShell commands (30 seconds to accommodate slow Get-ScheduledTaskInfo calls)
const PS_TIMEOUT_MS = 30_000;

/**
 * Derive a human-friendly recurrence label from a cron expression.
 * Returns: Hourly, Daily, Weekly, Monthly, or Quarterly
 */
export function getRecurrenceLabel(cronExpr: string): string {
  const parts = cronExpr.split(' ');
  if (parts.length !== 5) return 'Daily';

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Hourly: hour contains a range (e.g., 7-17) or step (*/2)
  if (hour.includes('-') || hour.includes('/') || hour === '*') {
    return 'Hourly';
  }

  // Quarterly: monthly trigger with exactly 4 quarter months
  if (dayOfMonth !== '*' && month !== '*') {
    const months = expandCronField(month, 1, 12);
    if (months.length <= 4) return 'Quarterly';
    return 'Monthly';
  }

  // Monthly: specific day(s) of month
  if (dayOfMonth !== '*') return 'Monthly';

  // Weekly: specific day(s) of week
  if (dayOfWeek !== '*') return 'Weekly';

  return 'Daily';
}

/**
 * Build the Windows Task Scheduler task name.
 * Format: cron-agents-<taskId>
 */
export function buildScheduledTaskName(taskId: string, cronExpr?: string): string {
  return `cron-agents-${taskId}`;
}

/**
 * Find the actual scheduled task name for a given taskId (handles recurrence prefix).
 * Returns the full task name or null if not found.
 */
async function findScheduledTaskName(taskId: string): Promise<string | null> {
  try {
    const psCommand = `powershell.exe -NoProfile -NonInteractive -Command "Get-ScheduledTask | Where-Object { $_.TaskName -eq 'cron-agents-${taskId}' -or $_.TaskName -match '^CronAgents_.*_${taskId}$' -or $_.TaskName -eq 'CronAgents_${taskId}' } | Select-Object -ExpandProperty TaskName -First 1"`;
    const { stdout } = await execAsync(psCommand, { timeout: PS_TIMEOUT_MS, encoding: 'utf-8' });
    const name = stdout.trim();
    return name || null;
  } catch {
    return null;
  }
}

/**
 * Detect the path to node executable
 */
function detectNodePath(): string {
  try {
    const command = process.platform === 'win32' ? 'where node' : 'which node';
    const result = execSync(command, { encoding: 'utf-8', stdio: 'pipe' }).trim();
    const paths = result.split('\n');
    return paths[0].trim();
  } catch (error) {
    // Fallback to process.execPath if detection fails
    return process.execPath;
  }
}


interface ScheduleTrigger {
  type: 'daily' | 'weekly' | 'monthly';
  time: string; // HH:MM format
  daysOfWeek?: string[]; // For weekly: Sunday, Monday, etc.
  daysOfMonth?: number[]; // For monthly: 1-31
  monthNames?: string[]; // For monthly: January, February, etc.
}

const WEEKDAY_XML_NAMES: Record<string, string> = {
  '0': 'Sunday', '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday',
  '4': 'Thursday', '5': 'Friday', '6': 'Saturday', '7': 'Sunday',
};

const MONTH_XML_NAMES: Record<number, string> = {
  1: 'January', 2: 'February', 3: 'March', 4: 'April',
  5: 'May', 6: 'June', 7: 'July', 8: 'August',
  9: 'September', 10: 'October', 11: 'November', 12: 'December',
};

/**
 * Expand a cron field (e.g. "1,4,7,10" or "1-5" or "*") into individual numbers
 */
function expandCronField(field: string, min: number, max: number): number[] {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '*') {
      for (let i = min; i <= max; i++) values.add(i);
    } else if (trimmed.includes('/')) {
      const [range, stepStr] = trimmed.split('/');
      const step = parseInt(stepStr);
      const start = range === '*' ? min : parseInt(range);
      for (let i = start; i <= max; i += step) values.add(i);
    } else if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      for (let i = parseInt(startStr); i <= parseInt(endStr); i++) values.add(i);
    } else {
      values.add(parseInt(trimmed));
    }
  }
  return [...values].sort((a, b) => a - b);
}

/**
 * Parse cron expression and convert to Task Scheduler trigger
 * Cron format: minute hour day-of-month month day-of-week
 */
export function parseCronExpression(cronExpr: string): ScheduleTrigger {
  if (!cron.validate(cronExpr)) {
    throw new Error(`Invalid cron expression: ${cronExpr}`);
  }

  const parts = cronExpr.split(' ');
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression format: ${cronExpr}`);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Parse time
  let time = '00:00';
  if (hour !== '*' && minute !== '*') {
    const h = parseInt(hour).toString().padStart(2, '0');
    const m = parseInt(minute).toString().padStart(2, '0');
    time = `${h}:${m}`;
  }

  // Weekly: specific day(s) of week, any day-of-month, any month
  if (dayOfWeek !== '*' && dayOfMonth === '*') {
    const dayNums = expandCronField(dayOfWeek, 0, 7);
    const dayNames = dayNums.map((d) => WEEKDAY_XML_NAMES[d.toString()] || 'Monday');
    // Deduplicate (0 and 7 both map to Sunday)
    const unique = [...new Set(dayNames)];
    return { type: 'weekly', time, daysOfWeek: unique };
  }

  // Monthly: specific day(s) of month
  if (dayOfMonth !== '*') {
    const days = expandCronField(dayOfMonth, 1, 31);
    const months = month !== '*'
      ? expandCronField(month, 1, 12).map((m) => MONTH_XML_NAMES[m])
      : Object.values(MONTH_XML_NAMES);
    return { type: 'monthly', time, daysOfMonth: days, monthNames: months };
  }

  // Default: daily
  return { type: 'daily', time };
}

/**
 * Generate the trigger XML fragment for Task Scheduler
 */
function buildTriggerXml(trigger: ScheduleTrigger): string {
  const startBoundary = `2026-01-01T${trigger.time}:00`;

  if (trigger.type === 'weekly' && trigger.daysOfWeek) {
    return `
      <CalendarTrigger>
        <StartBoundary>${startBoundary}</StartBoundary>
        <Enabled>true</Enabled>
        <ScheduleByWeek>
          <WeeksInterval>1</WeeksInterval>
          <DaysOfWeek>
            ${trigger.daysOfWeek.map((d) => `<${d} />`).join('\n            ')}
          </DaysOfWeek>
        </ScheduleByWeek>
      </CalendarTrigger>`;
  }

  if (trigger.type === 'monthly' && trigger.daysOfMonth && trigger.monthNames) {
    return `
      <CalendarTrigger>
        <StartBoundary>${startBoundary}</StartBoundary>
        <Enabled>true</Enabled>
        <ScheduleByMonth>
          <Months>
            ${trigger.monthNames.map((m) => `<${m} />`).join('\n            ')}
          </Months>
          <DaysOfMonth>
            ${trigger.daysOfMonth.map((d) => `<Day>${d}</Day>`).join('\n            ')}
          </DaysOfMonth>
        </ScheduleByMonth>
      </CalendarTrigger>`;
  }

  // Daily (default)
  return `
      <CalendarTrigger>
        <StartBoundary>${startBoundary}</StartBoundary>
        <Enabled>true</Enabled>
        <ScheduleByDay>
          <DaysInterval>1</DaysInterval>
        </ScheduleByDay>
      </CalendarTrigger>`;
}

/**
 * Generate full Task Scheduler XML for a task
 */
function buildFullTaskXml(
  nodePath: string,
  executorArgs: string,
  trigger: ScheduleTrigger
): string {
  const triggerXml = buildTriggerXml(trigger);

  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>${triggerXml}
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>S4U</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <Hidden>true</Hidden>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${nodePath}</Command>
      <Arguments>${executorArgs}</Arguments>
    </Exec>
  </Actions>
</Task>`;
}

/**
 * Generate PowerShell command to create scheduled task (via XML for proper trigger support)
 */
export function generateTaskSchedulerCommand(
  taskId: string,
  taskFilePath: string,
  trigger: ScheduleTrigger,
  projectRoot: string
): string {
  const executorPath = resolve(projectRoot, 'dist', 'executor.js');
  const absoluteTaskPath = resolve(taskFilePath);
  const nodePath = detectNodePath();
  const executorArgs = `"${executorPath}" "${absoluteTaskPath}"`;

  const taskXml = buildFullTaskXml(nodePath, executorArgs, trigger);

  // Use XML-based registration for accurate trigger types
  const psScript = `
$taskName = "cron-agents-${taskId}"
$taskXml = @'
${taskXml}
'@
Register-ScheduledTask -TaskName $taskName -Xml $taskXml -Force
Write-Host "Task registered: $taskName (${trigger.type} at ${trigger.time})"
`.trim();

  return psScript;
}

/**
 * Register a task in Windows Task Scheduler (using XML for proper trigger support)
 */
export async function registerTask(
  taskId: string,
  taskFilePath: string,
  cronExpr: string,
  projectRoot: string,
  agent: AgentType = getDefaultAgent()
): Promise<void> {
  try {
    const agentConfig = getAgentConfig(agent);
    console.error(`Registering task: ${taskId}`);
    console.error(`Cron expression: ${cronExpr}`);
    console.error(`Agent: ${agentConfig.displayName}`);

    const trigger = parseCronExpression(cronExpr);
    console.error(`Trigger type: ${trigger.type}, time: ${trigger.time}`);

    const executorPath = resolve(projectRoot, 'dist', 'executor.js');
    const absoluteTaskPath = resolve(taskFilePath);

    // Detect agent CLI path
    const agentPath = detectAgentPath(agent);

    if (agentPath) {
      console.error(`Detected ${agentConfig.displayName} at: ${agentPath}`);
    } else {
      console.error(`Warning: ${agentConfig.displayName} not found in PATH - CLI tasks may fail`);
    }

    // Detect node path for Task Scheduler (needs full path)
    const nodePath = detectNodePath();
    console.error(`Using node at: ${nodePath}`);

    // Build arguments: executor.js taskPath [agentPath]
    const executorArgs = agentPath
      ? `"${executorPath}" "${absoluteTaskPath}" "${agentPath}"`
      : `"${executorPath}" "${absoluteTaskPath}"`;

    // Generate full task XML with correct trigger type
    const taskXml = buildFullTaskXml(nodePath, executorArgs, trigger);

    // Write a PowerShell script with embedded XML to avoid encoding issues
    const scheduledTaskName = buildScheduledTaskName(taskId, cronExpr);
    const tempScript = join(tmpdir(), `cron-agents-register-${taskId}-${Date.now()}.ps1`);
    const psScript = `$ErrorActionPreference = 'Stop'
$taskXml = @"
${taskXml}
"@
Register-ScheduledTask -TaskName "${scheduledTaskName}" -Xml $taskXml -Force
Write-Host "Task registered successfully (${trigger.type} at ${trigger.time})"
`;
    writeFileSync(tempScript, psScript, 'utf-8');

    const psCommand = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tempScript}"`;

    try {
      await execAsync(psCommand, {
        timeout: PS_TIMEOUT_MS,
        encoding: 'utf-8',
      });
      console.error(`✓ Task "${scheduledTaskName}" registered successfully (${trigger.type} at ${trigger.time})`);
    } catch (normalError: any) {
      // Check if it's an access denied error
      const errorText = (normalError.message || '') + (normalError.stderr || '');
      const isAccessDenied =
        errorText.includes('Access is denied') ||
        errorText.includes('0x80070005') ||
        errorText.includes('PermissionDenied');

      if (isAccessDenied) {
        console.error('Administrator privileges required. Requesting elevation...');

        try {
          const elevatedCommand = `powershell.exe -NoProfile -NonInteractive -Command "Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '${tempScript}' -Verb RunAs -Wait"`;

          await execAsync(elevatedCommand, {
            timeout: PS_TIMEOUT_MS,
            encoding: 'utf-8',
          });

          // Verify the task was created
          const verifyCommand = `powershell.exe -NoProfile -NonInteractive -Command "Get-ScheduledTask -TaskName '${scheduledTaskName}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty TaskName"`;
          const { stdout } = await execAsync(verifyCommand, {
            timeout: PS_TIMEOUT_MS,
            encoding: 'utf-8',
          });

          if (stdout.trim() === scheduledTaskName) {
            console.error(`✓ Task "${scheduledTaskName}" registered successfully with elevated privileges`);
          } else {
            throw new Error('Task registration was cancelled or failed');
          }
        } catch (elevatedError) {
          throw elevatedError;
        }
      } else {
        throw normalError;
      }
    } finally {
      try { unlinkSync(tempScript); } catch {}
    }
  } catch (error) {
    console.error(`Failed to register task "${taskId}":`, error);
    throw error;
  }
}

/**
 * Unregister a task from Windows Task Scheduler
 */
export async function unregisterTask(taskId: string): Promise<void> {
  try {
    const taskName = await findScheduledTaskName(taskId) || `CronAgents_${taskId}`;
    const psCommand = `powershell.exe -NoProfile -NonInteractive -Command "Unregister-ScheduledTask -TaskName '${taskName}' -Confirm:\\$false"`;

    await execAsync(psCommand, {
      timeout: PS_TIMEOUT_MS,
      encoding: 'utf-8',
    });

    console.error(`✓ Task "${taskName}" unregistered successfully`);
  } catch (error) {
    console.error(`Failed to unregister task "${taskId}":`, error);
    throw error;
  }
}

/**
 * Enable a task in Windows Task Scheduler
 */
export async function enableTask(taskId: string): Promise<void> {
  try {
    const taskName = await findScheduledTaskName(taskId) || `CronAgents_${taskId}`;
    const command = `schtasks /Change /TN "${taskName}" /ENABLE`;

    await execAsync(command, {
      timeout: PS_TIMEOUT_MS,
      encoding: 'utf-8',
    });

    console.error(`✓ Task "${taskName}" enabled`);
  } catch (error) {
    console.error(`Failed to enable task "${taskId}":`, error);
    throw error;
  }
}

/**
 * Disable a task in Windows Task Scheduler
 */
export async function disableTask(taskId: string): Promise<void> {
  try {
    const taskName = await findScheduledTaskName(taskId) || `CronAgents_${taskId}`;
    const command = `schtasks /Change /TN "${taskName}" /DISABLE`;

    await execAsync(command, {
      timeout: PS_TIMEOUT_MS,
      encoding: 'utf-8',
    });

    console.error(`✓ Task "${taskName}" disabled`);
  } catch (error) {
    console.error(`Failed to disable task "${taskId}":`, error);
    throw error;
  }
}

/**
 * Get task status from Windows Task Scheduler
 */
export async function getTaskStatus(taskId: string): Promise<{
  exists: boolean;
  enabled?: boolean;
  lastRunTime?: string;
  nextRunTime?: string;
}> {
  try {
    const taskName = await findScheduledTaskName(taskId) || `CronAgents_${taskId}`;
    const psCommand = `powershell.exe -NoProfile -NonInteractive -Command "Get-ScheduledTask -TaskName '${taskName}' | Select-Object @{Name='State';Expression={$_.State.ToString()}}, @{Name='LastRunTime';Expression={(Get-ScheduledTaskInfo -TaskName '${taskName}').LastRunTime}}, @{Name='NextRunTime';Expression={(Get-ScheduledTaskInfo -TaskName '${taskName}').NextRunTime}} | ConvertTo-Json"`;

    const { stdout } = await execAsync(psCommand, {
      timeout: PS_TIMEOUT_MS,
      encoding: 'utf-8',
    });

    const data = JSON.parse(stdout);

    return {
      exists: true,
      enabled: data.State === 'Ready',
      lastRunTime: data.LastRunTime,
      nextRunTime: data.NextRunTime,
    };
  } catch (error) {
    return { exists: false };
  }
}
