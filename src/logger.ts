/**
 * Audit logger with HMAC-SHA256 signing
 * Logs all task executions to local log directory with cryptographic signatures
 */

import { createHmac } from 'crypto';
import { writeFileSync, mkdirSync } from 'fs';
import matter from 'gray-matter';
import { join } from 'path';
import { TaskLog, LogStep } from './types.js';
import { getSecretKey, loadConfig } from './config.js';

/**
 * Create HMAC-SHA256 signature for content
 */
export function signContent(content: string, secretKey?: string): string {
  const key = secretKey || getSecretKey();
  const hmac = createHmac('sha256', key);
  hmac.update(content);
  return hmac.digest('hex');
}

/**
 * Verify HMAC-SHA256 signature
 */
export function verifySignature(
  content: string,
  signature: string,
  secretKey?: string
): boolean {
  const expectedSignature = signContent(content, secretKey);
  return signature === expectedSignature;
}

/**
 * Format task log as markdown with frontmatter
 */
export function formatTaskLog(log: TaskLog): string {
  const content = `# Task Execution Log: ${log.taskId}

**Execution ID:** ${log.executionId}
**Status:** ${log.status}
**Started:** ${log.timestamp}

## Execution Steps

${log.steps
  .map(
    (step, idx) => `### Step ${idx + 1}: ${step.action}
**Time:** ${step.timestamp}
${step.output ? `\n**Output:**\n\`\`\`\n${step.output}\n\`\`\`\n` : ''}
${step.error ? `\n**Error:**\n\`\`\`\n${step.error}\n\`\`\`\n` : ''}`
  )
  .join('\n\n')}

## Summary
Total steps: ${log.steps.length}
Status: ${log.status}
`;

  // Sign the content
  const signature = signContent(content);

  // Create frontmatter
  const frontmatter = {
    category: 'cron-task',
    taskId: log.taskId,
    executionId: log.executionId,
    timestamp: log.timestamp,
    status: log.status,
    signature,
  };

  // Combine frontmatter and content
  return matter.stringify(content, frontmatter);
}

/**
 * Save log to local log directory. Returns the log file path.
 */
export function saveLog(log: TaskLog): string {
  const config = loadConfig();
  const markdown = formatTaskLog(log);

  // Ensure logs directory exists
  mkdirSync(config.logsDir, { recursive: true });

  // Create log filename with timestamp for easy sorting
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${log.taskId}_${timestamp}_${log.executionId}.md`;
  const logPath = join(config.logsDir, filename);

  // Write log file
  writeFileSync(logPath, markdown, 'utf-8');
  console.error(`✓ Logged execution ${log.executionId} to ${logPath}`);

  return logPath;
}

/**
 * Verify a log file's signature
 */
export function verifyLogFile(markdown: string): {
  valid: boolean;
  log?: TaskLog;
  error?: string;
} {
  try {
    const parsed = matter(markdown);
    const { signature, ...frontmatter } = parsed.data;

    if (!signature) {
      return { valid: false, error: 'No signature found in log file' };
    }

    // Verify signature
    const isValid = verifySignature(parsed.content, signature);

    if (isValid) {
      return {
        valid: true,
        log: {
          taskId: frontmatter.taskId,
          executionId: frontmatter.executionId,
          timestamp: frontmatter.timestamp,
          status: frontmatter.status,
          steps: [], // Would need to parse from content
          signature,
        },
      };
    } else {
      return { valid: false, error: 'Signature verification failed' };
    }
  } catch (error) {
    return {
      valid: false,
      error: `Failed to parse log: ${error}`,
    };
  }
}

/**
 * Create a new log entry
 */
export function createLog(taskId: string): TaskLog {
  return {
    taskId,
    executionId: `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    status: 'running',
    steps: [],
  };
}

/**
 * Add a step to the log
 */
export function addLogStep(log: TaskLog, action: string, output?: string, error?: string): void {
  log.steps.push({
    timestamp: new Date().toISOString(),
    action,
    output,
    error,
  });
}

/**
 * Finalize and save log. Returns the log file path.
 */
export function finalizeLog(log: TaskLog, success: boolean): string {
  log.status = success ? 'success' : 'failure';
  return saveLog(log);
}
