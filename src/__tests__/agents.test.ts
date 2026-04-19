import { describe, it, expect } from 'vitest';
import {
  AGENT_REGISTRY,
  getSupportedAgents,
  getAgentConfig,
  getDefaultAgent,
  isValidAgent,
} from '../agents.js';

// ---------------------------------------------------------------------------
// getSupportedAgents
// ---------------------------------------------------------------------------
describe('getSupportedAgents', () => {
  it('returns an array', () => {
    expect(Array.isArray(getSupportedAgents())).toBe(true);
  });

  it('returns a non-empty array', () => {
    expect(getSupportedAgents().length).toBeGreaterThan(0);
  });

  it('contains "claude"', () => {
    expect(getSupportedAgents()).toContain('claude');
  });

  it('contains "copilot"', () => {
    expect(getSupportedAgents()).toContain('copilot');
  });

  it('has exactly 2 elements', () => {
    expect(getSupportedAgents()).toHaveLength(2);
  });

  it('every element is a string', () => {
    for (const agent of getSupportedAgents()) {
      expect(typeof agent).toBe('string');
    }
  });

  it('contains no duplicates', () => {
    const agents = getSupportedAgents();
    expect(new Set(agents).size).toBe(agents.length);
  });

  it('returns a new array each call (not the same reference)', () => {
    const a = getSupportedAgents();
    const b = getSupportedAgents();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// getAgentConfig – Claude
// ---------------------------------------------------------------------------
describe('getAgentConfig – claude', () => {
  it('returns an object for "claude"', () => {
    expect(typeof getAgentConfig('claude')).toBe('object');
  });

  it('has name "claude"', () => {
    expect(getAgentConfig('claude').name).toBe('claude');
  });

  it('has displayName "Claude Code"', () => {
    expect(getAgentConfig('claude').displayName).toBe('Claude Code');
  });

  it('executables includes "claude-code"', () => {
    expect(getAgentConfig('claude').executables).toContain('claude-code');
  });

  it('executables includes "claude"', () => {
    expect(getAgentConfig('claude').executables).toContain('claude');
  });

  it('executables has length 2', () => {
    expect(getAgentConfig('claude').executables).toHaveLength(2);
  });

  it('printArgs includes "--print"', () => {
    expect(getAgentConfig('claude').printArgs).toContain('--print');
  });

  it('printArgs includes "--dangerously-skip-permissions"', () => {
    expect(getAgentConfig('claude').printArgs).toContain('--dangerously-skip-permissions');
  });

  it('inputMode is "file"', () => {
    expect(getAgentConfig('claude').inputMode).toBe('file');
  });

  it('pathEnvVar is "CLAUDE_CODE_PATH"', () => {
    expect(getAgentConfig('claude').pathEnvVar).toBe('CLAUDE_CODE_PATH');
  });

  it('description contains "Claude"', () => {
    expect(getAgentConfig('claude').description).toContain('Claude');
  });
});

// ---------------------------------------------------------------------------
// getAgentConfig – Copilot
// ---------------------------------------------------------------------------
describe('getAgentConfig – copilot', () => {
  it('returns an object for "copilot"', () => {
    expect(typeof getAgentConfig('copilot')).toBe('object');
  });

  it('has name "copilot"', () => {
    expect(getAgentConfig('copilot').name).toBe('copilot');
  });

  it('has displayName "GitHub Copilot CLI"', () => {
    expect(getAgentConfig('copilot').displayName).toBe('GitHub Copilot CLI');
  });

  it('executables includes "copilot"', () => {
    expect(getAgentConfig('copilot').executables).toContain('copilot');
  });

  it('executables has length 1', () => {
    expect(getAgentConfig('copilot').executables).toHaveLength(1);
  });

  it('printArgs includes "--yolo"', () => {
    expect(getAgentConfig('copilot').printArgs).toContain('--yolo');
  });

  it('printArgs includes "-p"', () => {
    expect(getAgentConfig('copilot').printArgs).toContain('-p');
  });

  it('inputMode is "file-reference"', () => {
    expect(getAgentConfig('copilot').inputMode).toBe('file-reference');
  });

  it('pathEnvVar is "COPILOT_CLI_PATH"', () => {
    expect(getAgentConfig('copilot').pathEnvVar).toBe('COPILOT_CLI_PATH');
  });

  it('description contains "Copilot"', () => {
    expect(getAgentConfig('copilot').description).toContain('Copilot');
  });
});

// ---------------------------------------------------------------------------
// getAgentConfig – error cases
// ---------------------------------------------------------------------------
describe('getAgentConfig – errors', () => {
  it('throws for unknown agent "gpt"', () => {
    expect(() => getAgentConfig('gpt' as any)).toThrow();
  });

  it('throws for empty string', () => {
    expect(() => getAgentConfig('' as any)).toThrow();
  });

  it('error message contains the invalid agent name', () => {
    expect(() => getAgentConfig('gpt' as any)).toThrow(/gpt/);
  });

  it('error message lists supported agents', () => {
    try {
      getAgentConfig('unknown-agent' as any);
      expect.unreachable('should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('claude');
      expect(err.message).toContain('copilot');
    }
  });
});

// ---------------------------------------------------------------------------
// getDefaultAgent
// ---------------------------------------------------------------------------
describe('getDefaultAgent', () => {
  it('returns "claude"', () => {
    expect(getDefaultAgent()).toBe('claude');
  });

  it('return value passes isValidAgent', () => {
    expect(isValidAgent(getDefaultAgent())).toBe(true);
  });

  it('return value is included in getSupportedAgents()', () => {
    expect(getSupportedAgents()).toContain(getDefaultAgent());
  });
});

// ---------------------------------------------------------------------------
// isValidAgent
// ---------------------------------------------------------------------------
describe('isValidAgent', () => {
  it('"claude" → true', () => {
    expect(isValidAgent('claude')).toBe(true);
  });

  it('"copilot" → true', () => {
    expect(isValidAgent('copilot')).toBe(true);
  });

  it('"gpt" → false', () => {
    expect(isValidAgent('gpt')).toBe(false);
  });

  it('empty string → false', () => {
    expect(isValidAgent('')).toBe(false);
  });

  it('"Claude" → false (case-sensitive)', () => {
    expect(isValidAgent('Claude')).toBe(false);
  });

  it('"CLAUDE" → false (case-sensitive)', () => {
    expect(isValidAgent('CLAUDE')).toBe(false);
  });

  it('"claude-code" → false', () => {
    expect(isValidAgent('claude-code')).toBe(false);
  });

  it('"copilot-cli" → false', () => {
    expect(isValidAgent('copilot-cli')).toBe(false);
  });

  it('"undefined" as string → false', () => {
    expect(isValidAgent('undefined')).toBe(false);
  });

  it('"null" → false', () => {
    expect(isValidAgent('null')).toBe(false);
  });

  it('" claude" (leading space) → false', () => {
    expect(isValidAgent(' claude')).toBe(false);
  });

  it('"claude " (trailing space) → false', () => {
    expect(isValidAgent('claude ')).toBe(false);
  });
});
