/**
 * Task management functions
 * Simple file-based operations for task definitions
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import { TaskDefinition } from './types.js';
import { loadConfig } from './config.js';
import { getDefaultAgent } from './agents.js';

export interface TaskMetadata {
  id: string;
  schedule: string;
  invocation: 'cli' | 'api';
  agent: string;
  enabled: boolean;
}

/**
 * Get the primary tasks directory (first in list, used for creating new tasks)
 */
function getPrimaryTasksDir(): string {
  const config = loadConfig();
  return config.tasksDirs[0];
}

/**
 * Get all task directories from config
 */
function getAllTasksDirs(): string[] {
  const config = loadConfig();
  return config.tasksDirs;
}

/**
 * Ensure the primary tasks directory exists
 */
function ensurePrimaryTasksDir(): void {
  const dir = getPrimaryTasksDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get file path for a task, searching all directories.
 * Returns the path in the first directory where the task exists,
 * or a path in the primary directory if not found (for creation).
 */
export function getTaskFilePath(taskId: string): string {
  const filename = `${taskId}.md`;
  for (const dir of getAllTasksDirs()) {
    const candidate = join(dir, filename);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return join(getPrimaryTasksDir(), filename);
}

/**
 * Convert TaskDefinition to markdown with YAML frontmatter
 */
function taskToMarkdown(task: TaskDefinition): string {
  let yaml = `---
id: ${task.id}
schedule: "${task.schedule}"
invocation: ${task.invocation}
agent: ${task.agent}
notifications:
  toast: ${task.notifications.toast}
enabled: ${task.enabled}`;

  // Optional: dependsOn
  if (task.dependsOn && task.dependsOn.length > 0) {
    yaml += `\ndependsOn:\n${task.dependsOn.map(d => `  - ${d}`).join('\n')}`;
  }

  // Optional: retry policy
  if (task.retry) {
    yaml += `\nretry:`;
    if (task.retry.maxRetries !== undefined) yaml += `\n  maxRetries: ${task.retry.maxRetries}`;
    if (task.retry.backoff) yaml += `\n  backoff: ${task.retry.backoff}`;
    if (task.retry.initialDelay !== undefined) yaml += `\n  initialDelay: ${task.retry.initialDelay}`;
    if (task.retry.maxDelay !== undefined) yaml += `\n  maxDelay: ${task.retry.maxDelay}`;
  }

  // Optional: variables
  if (task.variables && Object.keys(task.variables).length > 0) {
    yaml += `\nvariables:`;
    for (const [key, value] of Object.entries(task.variables)) {
      yaml += `\n  ${key}: "${value}"`;
    }
  }

  yaml += `\n---

${task.instructions}
`;
  return yaml;
}

/**
 * Parse markdown file to TaskDefinition
 */
function parseTaskFile(filePath: string): TaskDefinition {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = matter(content);

  const task: TaskDefinition = {
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
    task.dependsOn = parsed.data.dependsOn.filter((d: unknown) => typeof d === 'string' && d.trim());
  }

  if (parsed.data.retry && typeof parsed.data.retry === 'object') {
    task.retry = {};
    const r = parsed.data.retry;
    if (typeof r.maxRetries === 'number') task.retry.maxRetries = r.maxRetries;
    if (typeof r.backoff === 'string') task.retry.backoff = r.backoff;
    if (typeof r.initialDelay === 'number') task.retry.initialDelay = r.initialDelay;
    if (typeof r.maxDelay === 'number') task.retry.maxDelay = r.maxDelay;
  }

  if (parsed.data.variables && typeof parsed.data.variables === 'object' && !Array.isArray(parsed.data.variables)) {
    task.variables = {};
    for (const [k, v] of Object.entries(parsed.data.variables)) {
      task.variables[k] = String(v);
    }
  }

  return task;
}

/**
 * Create a new task (always in the primary directory)
 */
export function createTask(task: TaskDefinition): void {
  ensurePrimaryTasksDir();
  const filePath = join(getPrimaryTasksDir(), `${task.id}.md`);

  if (taskExists(task.id)) {
    throw new Error(`Task "${task.id}" already exists`);
  }

  const markdown = taskToMarkdown(task);
  writeFileSync(filePath, markdown, 'utf-8');
}

/**
 * Get a task by ID (searches all directories)
 */
export function getTask(taskId: string): TaskDefinition | null {
  const filePath = getTaskFilePath(taskId);

  if (!existsSync(filePath)) {
    return null;
  }

  return parseTaskFile(filePath);
}

/**
 * Update an existing task (in whichever directory it lives)
 */
export function updateTask(taskId: string, task: TaskDefinition): void {
  const filePath = getTaskFilePath(taskId);

  if (!existsSync(filePath)) {
    throw new Error(`Task "${taskId}" not found`);
  }

  const markdown = taskToMarkdown(task);
  writeFileSync(filePath, markdown, 'utf-8');
}

/**
 * Delete a task by ID (from whichever directory it lives)
 */
export function deleteTask(taskId: string): void {
  const filePath = getTaskFilePath(taskId);

  if (!existsSync(filePath)) {
    throw new Error(`Task "${taskId}" not found`);
  }

  unlinkSync(filePath);
}

/**
 * List all tasks across all directories (deduplicated by id)
 */
export function listTasks(): TaskMetadata[] {
  const seen = new Set<string>();
  const tasks: TaskMetadata[] = [];

  for (const dir of getAllTasksDirs()) {
    if (!existsSync(dir)) continue;

    try {
      const files = readdirSync(dir).filter((f) => f.endsWith('.md'));

      for (const file of files) {
        try {
          const filePath = join(dir, file);
          const task = parseTaskFile(filePath);

          if (!seen.has(task.id)) {
            seen.add(task.id);
            tasks.push({
              id: task.id,
              schedule: task.schedule,
              invocation: task.invocation,
              agent: task.agent,
              enabled: task.enabled,
            });
          }
        } catch (error) {
          console.error(`Error parsing task file ${file}:`, error);
        }
      }
    } catch {
      // Directory unreadable, skip
    }
  }

  return tasks;
}

/**
 * Check if a task exists in any directory
 */
export function taskExists(taskId: string): boolean {
  const filename = `${taskId}.md`;
  return getAllTasksDirs().some((dir) => existsSync(join(dir, filename)));
}
