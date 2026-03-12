/**
 * Agent registry for supported coding agent CLIs
 * Defines detection, invocation, and configuration for each agent
 */

import { execSync } from 'child_process';
import { AgentType, AgentConfig } from './types.js';

/**
 * Registry of supported coding agents
 */
export const AGENT_REGISTRY: Record<AgentType, AgentConfig> = {
  claude: {
    name: 'claude',
    displayName: 'Claude Code',
    executables: ['claude-code', 'claude'],
    printArgs: ['--print', '--dangerously-skip-permissions'],
    pathEnvVar: 'CLAUDE_CODE_PATH',
    description: 'Anthropic Claude Code CLI',
  },
  copilot: {
    name: 'copilot',
    displayName: 'GitHub Copilot CLI',
    executables: ['copilot'],
    printArgs: [],
    pathEnvVar: 'COPILOT_CLI_PATH',
    description: 'GitHub Copilot CLI',
  },
};

/**
 * Get all supported agent types
 */
export function getSupportedAgents(): AgentType[] {
  return Object.keys(AGENT_REGISTRY) as AgentType[];
}

/**
 * Get agent configuration by type
 */
export function getAgentConfig(agent: AgentType): AgentConfig {
  const config = AGENT_REGISTRY[agent];
  if (!config) {
    throw new Error(`Unknown agent type: ${agent}. Supported agents: ${getSupportedAgents().join(', ')}`);
  }
  return config;
}

/**
 * Detect the path to an agent's executable
 */
export function detectAgentPath(agent: AgentType): string | null {
  const config = getAgentConfig(agent);

  // Check environment variable override first
  const envPath = process.env[config.pathEnvVar];
  if (envPath) {
    return envPath;
  }

  // Search for executables in PATH
  for (const executable of config.executables) {
    try {
      const command = process.platform === 'win32'
        ? `where ${executable}`
        : `which ${executable}`;

      const result = execSync(command, { encoding: 'utf-8', stdio: 'pipe' }).trim();
      const paths = result.split('\n');
      const path = paths[0].trim();
      if (path) {
        return path;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Get the default agent type
 */
export function getDefaultAgent(): AgentType {
  return 'claude';
}

/**
 * Validate an agent type string
 */
export function isValidAgent(agent: string): agent is AgentType {
  return agent in AGENT_REGISTRY;
}
