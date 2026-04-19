/**
 * Template variable resolution for task instructions.
 * Resolves {{variable}} placeholders with runtime values.
 *
 * Security: Environment variables require an allowlist prefix (CRON_AGENTS_)
 * or explicit opt-in via task/config variables to prevent secret leakage.
 */

import { execSync } from 'child_process';

/** Safe prefix for environment variables accessible via {{env.*}} */
const SAFE_ENV_PREFIX = 'CRON_AGENTS_';

/** Regex to match template variables: {{variable.path}} */
const TEMPLATE_REGEX = /\{\{([a-zA-Z_][a-zA-Z0-9_.]*)\}\}/g;

export interface TemplateContext {
  taskId: string;
  runId?: string;
  attempt?: number;
  agent?: string;
  /** Custom variables from task definition */
  taskVariables?: Record<string, string>;
  /** Global variables from config */
  globalVariables?: Record<string, string>;
}

/**
 * Resolve all template variables in text.
 * Unknown variables are left as-is and returned in the warnings array.
 */
export function resolveVariables(
  text: string,
  context: TemplateContext,
): { resolved: string; warnings: string[] } {
  const warnings: string[] = [];

  const resolved = text.replace(TEMPLATE_REGEX, (match, varName: string) => {
    const value = resolveVariable(varName, context);
    if (value === undefined) {
      warnings.push(`Unresolved variable: {{${varName}}}`);
      return match; // Leave as-is
    }
    return value;
  });

  return { resolved, warnings };
}

/**
 * Resolve a single variable name to its value.
 * Returns undefined if the variable is not recognized.
 */
function resolveVariable(name: string, context: TemplateContext): string | undefined {
  // Built-in date/time variables
  const now = new Date();

  switch (name) {
    case 'date':
      return now.toISOString().split('T')[0]; // YYYY-MM-DD
    case 'time':
      return now.toTimeString().split(' ')[0].slice(0, 5); // HH:mm
    case 'datetime':
      return now.toISOString();
    case 'timestamp':
      return String(now.getTime());
    case 'weekday':
      return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
    case 'month':
      return ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'][now.getMonth()];
    case 'year':
      return String(now.getFullYear());

    // Task context
    case 'taskId':
      return context.taskId;
    case 'runId':
      return context.runId || 'none';
    case 'attempt':
      return String(context.attempt || 1);
    case 'agent':
      return context.agent || 'unknown';

    default:
      break;
  }

  // Environment variables: {{env.VAR_NAME}}
  if (name.startsWith('env.')) {
    const envName = name.slice(4);
    return resolveEnvVariable(envName);
  }

  // Git variables: {{git.branch}}, {{git.lastCommit}}, {{git.shortHash}}
  if (name.startsWith('git.')) {
    return resolveGitVariable(name.slice(4));
  }

  // Check task-level custom variables
  if (context.taskVariables && name in context.taskVariables) {
    return context.taskVariables[name];
  }

  // Check global config variables
  if (context.globalVariables && name in context.globalVariables) {
    return context.globalVariables[name];
  }

  return undefined;
}

/**
 * Resolve an environment variable with safety checks.
 * Only allows variables with CRON_AGENTS_ prefix by default.
 */
function resolveEnvVariable(envName: string): string | undefined {
  const value = process.env[envName];
  if (value === undefined) return undefined;

  // Allow vars with safe prefix
  if (envName.startsWith(SAFE_ENV_PREFIX)) {
    return value;
  }

  // Allow common non-sensitive vars
  const SAFE_VARS = new Set([
    'HOME', 'USERPROFILE', 'USERNAME', 'USER',
    'COMPUTERNAME', 'HOSTNAME',
    'OS', 'PROCESSOR_ARCHITECTURE',
    'NODE_ENV', 'TZ',
    'LANG', 'LANGUAGE', 'LC_ALL',
  ]);

  if (SAFE_VARS.has(envName)) {
    return value;
  }

  // Block potentially sensitive vars
  return `[REDACTED: env.${envName} — use CRON_AGENTS_ prefix for safe access]`;
}

/**
 * Resolve git-related variables
 */
function resolveGitVariable(name: string): string | undefined {
  try {
    switch (name) {
      case 'branch':
        return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8', timeout: 5000 }).trim();
      case 'lastCommit':
        return execSync('git log -1 --pretty=%s', { encoding: 'utf-8', timeout: 5000 }).trim();
      case 'shortHash':
        return execSync('git rev-parse --short HEAD', { encoding: 'utf-8', timeout: 5000 }).trim();
      case 'hash':
        return execSync('git rev-parse HEAD', { encoding: 'utf-8', timeout: 5000 }).trim();
      case 'author':
        return execSync('git log -1 --pretty=%an', { encoding: 'utf-8', timeout: 5000 }).trim();
      case 'repoName':
        return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8', timeout: 5000 }).trim().split(/[\\/]/).pop() || 'unknown';
      default:
        return undefined;
    }
  } catch {
    return `[git error: ${name}]`;
  }
}

/**
 * Redact resolved text for safe display in logs/UI.
 * Replaces environment variable values with [REDACTED].
 */
export function redactForDisplay(text: string): string {
  // Redact anything that looks like it was resolved from a sensitive env var
  return text.replace(
    /\[REDACTED: env\.[^\]]+\]/g,
    '[REDACTED]'
  );
}

/**
 * List all variables found in a template string
 */
export function listVariables(text: string): string[] {
  const vars: string[] = [];
  let match;
  const regex = new RegExp(TEMPLATE_REGEX.source, 'g');
  while ((match = regex.exec(text)) !== null) {
    if (!vars.includes(match[1])) {
      vars.push(match[1]);
    }
  }
  return vars;
}

/**
 * Get all available built-in variable names (for docs/help)
 */
export function getBuiltinVariables(): string[] {
  return [
    'date', 'time', 'datetime', 'timestamp', 'weekday', 'month', 'year',
    'taskId', 'runId', 'attempt', 'agent',
    'env.<VAR_NAME>', 'git.branch', 'git.lastCommit', 'git.shortHash',
    'git.hash', 'git.author', 'git.repoName',
  ];
}
