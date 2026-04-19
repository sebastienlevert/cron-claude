/**
 * Configuration management for cron-claude
 * Handles secret key generation and storage
 */

import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Config } from './types.js';

const CONFIG_DIR = join(homedir(), '.cron-claude');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

/**
 * Ensure config directory exists
 */
function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Generate a new secret key for HMAC signing
 */
function generateSecretKey(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Load or create configuration
 */
export function loadConfig(): Config {
  ensureConfigDir();

  const defaultTasksDir = join(CONFIG_DIR, 'tasks');
  const defaultLogsDir = join(CONFIG_DIR, 'logs');

  if (existsSync(CONFIG_FILE)) {
    const data = readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(data);

    // Migrate legacy single tasksDir to tasksDirs array
    // Always include the default ~/.cron-claude/tasks directory
    let tasksDirs: string[];
    if (Array.isArray(parsed.tasksDirs) && parsed.tasksDirs.length > 0) {
      tasksDirs = parsed.tasksDirs;
      if (!tasksDirs.includes(defaultTasksDir)) {
        tasksDirs.unshift(defaultTasksDir);
      }
    } else if (parsed.tasksDir) {
      tasksDirs = parsed.tasksDir === defaultTasksDir
        ? [defaultTasksDir]
        : [defaultTasksDir, parsed.tasksDir];
    } else {
      tasksDirs = [defaultTasksDir];
    }

    // Merge with defaults for backward compatibility
    return {
      secretKey: parsed.secretKey || generateSecretKey(),
      version: parsed.version || '0.1.0',
      tasksDirs,
      logsDir: parsed.logsDir || defaultLogsDir,
      maxConcurrency: typeof parsed.maxConcurrency === 'number' && parsed.maxConcurrency >= 1
        ? parsed.maxConcurrency
        : 2,
    };
  }

  // Create new config with generated secret key
  const config: Config = {
    secretKey: generateSecretKey(),
    version: '0.1.0',
    tasksDirs: [defaultTasksDir],
    logsDir: defaultLogsDir,
    maxConcurrency: 2,
  };

  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  console.error('Generated new configuration with secret key for log signing');

  return config;
}

/**
 * Get the secret key for HMAC signing
 */
export function getSecretKey(): string {
  const config = loadConfig();
  return config.secretKey;
}

/**
 * Get config directory path
 */
export function getConfigDir(): string {
  return CONFIG_DIR;
}

/**
 * Update configuration with partial updates
 */
export function updateConfig(updates: Partial<Config>): void {
  const config = loadConfig();
  const updated = { ...config, ...updates };
  writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf-8');
}
