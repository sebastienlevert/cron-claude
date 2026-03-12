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
 * Get the tasks directory from config
 */
function getTasksDir(): string {
  const config = loadConfig();
  return config.tasksDir;
}

/**
 * Ensure tasks directory exists
 */
function ensureTasksDir(): void {
  const tasksDir = getTasksDir();
  if (!existsSync(tasksDir)) {
    mkdirSync(tasksDir, { recursive: true });
  }
}

/**
 * Get file path for a task
 */
export function getTaskFilePath(taskId: string): string {
  return join(getTasksDir(), `${taskId}.md`);
}

/**
 * Convert TaskDefinition to markdown with YAML frontmatter
 */
function taskToMarkdown(task: TaskDefinition): string {
  return `---
id: ${task.id}
schedule: "${task.schedule}"
invocation: ${task.invocation}
agent: ${task.agent}
notifications:
  toast: ${task.notifications.toast}
enabled: ${task.enabled}
---

${task.instructions}
`;
}

/**
 * Parse markdown file to TaskDefinition
 */
function parseTaskFile(filePath: string): TaskDefinition {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = matter(content);

  return {
    id: parsed.data.id || 'unknown',
    schedule: parsed.data.schedule || '0 0 * * *',
    invocation: parsed.data.invocation || 'cli',
    agent: parsed.data.agent || getDefaultAgent(),
    notifications: parsed.data.notifications || { toast: false },
    enabled: parsed.data.enabled !== false,
    instructions: parsed.content,
  };
}

/**
 * Create a new task
 */
export function createTask(task: TaskDefinition): void {
  ensureTasksDir();
  const filePath = getTaskFilePath(task.id);

  if (existsSync(filePath)) {
    throw new Error(`Task "${task.id}" already exists`);
  }

  const markdown = taskToMarkdown(task);
  writeFileSync(filePath, markdown, 'utf-8');
}

/**
 * Get a task by ID
 */
export function getTask(taskId: string): TaskDefinition | null {
  const filePath = getTaskFilePath(taskId);

  if (!existsSync(filePath)) {
    return null;
  }

  return parseTaskFile(filePath);
}

/**
 * Update an existing task
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
 * Delete a task by ID
 */
export function deleteTask(taskId: string): void {
  const filePath = getTaskFilePath(taskId);

  if (!existsSync(filePath)) {
    throw new Error(`Task "${taskId}" not found`);
  }

  unlinkSync(filePath);
}

/**
 * List all tasks (metadata only)
 */
export function listTasks(): TaskMetadata[] {
  ensureTasksDir();

  try {
    const files = readdirSync(getTasksDir()).filter((f) => f.endsWith('.md'));
    const tasks: TaskMetadata[] = [];

    for (const file of files) {
      try {
        const filePath = join(getTasksDir(), file);
        const task = parseTaskFile(filePath);

        tasks.push({
          id: task.id,
          schedule: task.schedule,
          invocation: task.invocation,
          agent: task.agent,
          enabled: task.enabled,
        });
      } catch (error) {
        console.error(`Error parsing task file ${file}:`, error);
      }
    }

    return tasks;
  } catch {
    return [];
  }
}

/**
 * Check if a task exists
 */
export function taskExists(taskId: string): boolean {
  const filePath = getTaskFilePath(taskId);
  return existsSync(filePath);
}
