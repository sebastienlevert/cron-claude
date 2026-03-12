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

// Timeout for PowerShell commands (15 seconds should be plenty for scheduler operations)
const PS_TIMEOUT_MS = 15_000;

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
  type: 'daily' | 'weekly' | 'monthly' | 'once' | 'startup';
  time?: string; // HH:MM format
  days?: string[]; // For weekly: MON, TUE, etc.
  interval?: number; // For repeating tasks
}

/**
 * Parse cron expression and convert to Task Scheduler trigger
 * Cron format: minute hour day month weekday
 */
export function parseCronExpression(cronExpr: string): ScheduleTrigger {
  // Validate cron expression first
  if (!cron.validate(cronExpr)) {
    throw new Error(`Invalid cron expression: ${cronExpr}`);
  }

  const parts = cronExpr.split(' ');
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression format: ${cronExpr}`);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Determine trigger type and details
  const trigger: ScheduleTrigger = { type: 'daily' };

  // If hour and minute are specified
  if (hour !== '*' && minute !== '*') {
    const hourNum = parseInt(hour);
    const minuteNum = parseInt(minute);
    trigger.time = `${hourNum.toString().padStart(2, '0')}:${minuteNum.toString().padStart(2, '0')}`;
  } else {
    // Default to midnight
    trigger.time = '00:00';
  }

  // Check if it's a weekly schedule (specific day of week)
  if (dayOfWeek !== '*') {
    trigger.type = 'weekly';
    const dayMap: Record<string, string> = {
      '0': 'SUN',
      '1': 'MON',
      '2': 'TUE',
      '3': 'WED',
      '4': 'THU',
      '5': 'FRI',
      '6': 'SAT',
      '7': 'SUN',
    };
    trigger.days = dayOfWeek.split(',').map((d) => dayMap[d.trim()] || 'MON');
  }
  // Check if it's a monthly schedule (specific day of month)
  else if (dayOfMonth !== '*') {
    trigger.type = 'monthly';
  }

  return trigger;
}

/**
 * Generate PowerShell command to create scheduled task
 */
export function generateTaskSchedulerCommand(
  taskId: string,
  taskFilePath: string,
  trigger: ScheduleTrigger,
  projectRoot: string
): string {
  const executorPath = resolve(projectRoot, 'dist', 'executor.js');
  const absoluteTaskPath = resolve(taskFilePath);

  // Build the action command
  const actionCommand = `node "${executorPath}" "${absoluteTaskPath}"`;

  // Build trigger XML based on type
  let triggerXml = '';

  if (trigger.type === 'daily') {
    triggerXml = `
      <CalendarTrigger>
        <StartBoundary>2026-01-01T${trigger.time}:00</StartBoundary>
        <Enabled>true</Enabled>
        <ScheduleByDay>
          <DaysInterval>1</DaysInterval>
        </ScheduleByDay>
      </CalendarTrigger>`;
  } else if (trigger.type === 'weekly' && trigger.days) {
    const daysOfWeek = trigger.days.join('');
    triggerXml = `
      <CalendarTrigger>
        <StartBoundary>2026-01-01T${trigger.time}:00</StartBoundary>
        <Enabled>true</Enabled>
        <ScheduleByWeek>
          <WeeksInterval>1</WeeksInterval>
          <DaysOfWeek>
            ${trigger.days.map((day) => `<${day} />`).join('\n            ')}
          </DaysOfWeek>
        </ScheduleByWeek>
      </CalendarTrigger>`;
  } else if (trigger.type === 'monthly') {
    triggerXml = `
      <CalendarTrigger>
        <StartBoundary>2026-01-01T${trigger.time}:00</StartBoundary>
        <Enabled>true</Enabled>
        <ScheduleByMonth>
          <DaysOfMonth>
            <Day>1</Day>
          </DaysOfMonth>
          <Months>
            <January /><February /><March /><April /><May /><June />
            <July /><August /><September /><October /><November /><December />
          </Months>
        </ScheduleByMonth>
      </CalendarTrigger>`;
  }

  // Generate PowerShell script
  const psScript = `
$taskName = "CronClaude_${taskId}"
$action = New-ScheduledTaskAction -Execute "node" -Argument '"${executorPath}" "${absoluteTaskPath}"'
$trigger = New-ScheduledTaskTrigger -Daily -At "${trigger.time || '00:00'}"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERNAME" -LogonType Interactive

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
Write-Host "Task registered: $taskName"
`.trim();

  return psScript;
}

/**
 * Register a task in Windows Task Scheduler
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

    // Build PowerShell registration script
    const psScript = `
$ErrorActionPreference = 'Stop'
$action = New-ScheduledTaskAction -Execute "${nodePath}" -Argument '${executorArgs}'
$trigger = New-ScheduledTaskTrigger -Daily -At "${trigger.time || '00:00'}"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
Register-ScheduledTask -TaskName "CronClaude_${taskId}" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
Write-Host "Task registered successfully"
`.trim();

    const psCommand = `powershell.exe -NoProfile -NonInteractive -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`;

    try {
      await execAsync(psCommand, {
        timeout: PS_TIMEOUT_MS,
        encoding: 'utf-8',
      });
      console.error(`✓ Task "${taskId}" registered successfully`);
    } catch (normalError: any) {
      // Check if it's an access denied error
      const errorText = (normalError.message || '') + (normalError.stderr || '');
      const isAccessDenied =
        errorText.includes('Access is denied') ||
        errorText.includes('0x80070005') ||
        errorText.includes('PermissionDenied');

      if (isAccessDenied) {
        // Write script to temp file and attempt elevation
        console.error('Administrator privileges required. Requesting elevation...');
        const tempScript = join(tmpdir(), `cron-claude-register-${taskId}-${Date.now()}.ps1`);
        writeFileSync(tempScript, psScript, 'utf-8');

        try {
          const elevatedCommand = `powershell.exe -NoProfile -NonInteractive -Command "Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '${tempScript}' -Verb RunAs -Wait"`;

          await execAsync(elevatedCommand, {
            timeout: PS_TIMEOUT_MS,
            encoding: 'utf-8',
          });

          // Verify the task was created
          const verifyCommand = `powershell.exe -NoProfile -NonInteractive -Command "Get-ScheduledTask -TaskName 'CronClaude_${taskId}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty TaskName"`;
          const { stdout } = await execAsync(verifyCommand, {
            timeout: PS_TIMEOUT_MS,
            encoding: 'utf-8',
          });

          if (stdout.trim() === `CronClaude_${taskId}`) {
            console.error(`✓ Task "${taskId}" registered successfully with elevated privileges`);
          } else {
            throw new Error('Task registration was cancelled or failed');
          }
        } finally {
          try {
            unlinkSync(tempScript);
          } catch {}
        }
      } else {
        throw normalError;
      }
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
    const taskName = `CronClaude_${taskId}`;
    const psCommand = `powershell.exe -NoProfile -NonInteractive -Command "Unregister-ScheduledTask -TaskName '${taskName}' -Confirm:\\$false"`;

    await execAsync(psCommand, {
      timeout: PS_TIMEOUT_MS,
      encoding: 'utf-8',
    });

    console.error(`✓ Task "${taskId}" unregistered successfully`);
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
    const taskName = `CronClaude_${taskId}`;
    const psCommand = `powershell.exe -NoProfile -NonInteractive -Command "Enable-ScheduledTask -TaskName '${taskName}'"`;

    await execAsync(psCommand, {
      timeout: PS_TIMEOUT_MS,
      encoding: 'utf-8',
    });

    console.error(`✓ Task "${taskId}" enabled`);
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
    const taskName = `CronClaude_${taskId}`;
    const psCommand = `powershell.exe -NoProfile -NonInteractive -Command "Disable-ScheduledTask -TaskName '${taskName}'"`;

    await execAsync(psCommand, {
      timeout: PS_TIMEOUT_MS,
      encoding: 'utf-8',
    });

    console.error(`✓ Task "${taskId}" disabled`);
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
    const taskName = `CronClaude_${taskId}`;
    const psCommand = `powershell.exe -NoProfile -NonInteractive -Command "Get-ScheduledTask -TaskName '${taskName}' | Select-Object State, @{Name='LastRunTime';Expression={(Get-ScheduledTaskInfo -TaskName '${taskName}').LastRunTime}}, @{Name='NextRunTime';Expression={(Get-ScheduledTaskInfo -TaskName '${taskName}').NextRunTime}} | ConvertTo-Json"`;

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
