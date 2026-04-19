import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentType, AgentConfig } from '../../types.js';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

let agentsModule: typeof import('../../agents.js');
let execSyncMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  delete process.env.CLAUDE_CODE_PATH;
  delete process.env.COPILOT_CLI_PATH;
  const cp = await import('child_process');
  execSyncMock = cp.execSync as unknown as ReturnType<typeof vi.fn>;
  agentsModule = await import('../../agents.js');
});

// ---------------------------------------------------------------------------
// AGENT_REGISTRY completeness
// ---------------------------------------------------------------------------
describe('AGENT_REGISTRY completeness', () => {
  const requiredFields: (keyof AgentConfig)[] = [
    'name',
    'displayName',
    'executables',
    'printArgs',
    'inputMode',
    'pathEnvVar',
    'description',
  ];

  for (const field of requiredFields) {
    it(`every agent has a "${field}" field`, () => {
      for (const key of Object.keys(agentsModule.AGENT_REGISTRY)) {
        const cfg = agentsModule.AGENT_REGISTRY[key as AgentType];
        expect(cfg).toHaveProperty(field);
        expect((cfg as any)[field]).toBeDefined();
      }
    });
  }

  it('every agent has non-empty executables array', () => {
    for (const key of Object.keys(agentsModule.AGENT_REGISTRY)) {
      const cfg = agentsModule.AGENT_REGISTRY[key as AgentType];
      expect(Array.isArray(cfg.executables)).toBe(true);
      expect(cfg.executables.length).toBeGreaterThan(0);
    }
  });

  it('every agent has non-empty printArgs array', () => {
    for (const key of Object.keys(agentsModule.AGENT_REGISTRY)) {
      const cfg = agentsModule.AGENT_REGISTRY[key as AgentType];
      expect(Array.isArray(cfg.printArgs)).toBe(true);
      expect(cfg.printArgs.length).toBeGreaterThan(0);
    }
  });

  it('every executable entry is a non-empty string', () => {
    for (const key of Object.keys(agentsModule.AGENT_REGISTRY)) {
      const cfg = agentsModule.AGENT_REGISTRY[key as AgentType];
      for (const exe of cfg.executables) {
        expect(typeof exe).toBe('string');
        expect(exe.length).toBeGreaterThan(0);
      }
    }
  });

  it('every printArgs entry is a non-empty string', () => {
    for (const key of Object.keys(agentsModule.AGENT_REGISTRY)) {
      const cfg = agentsModule.AGENT_REGISTRY[key as AgentType];
      for (const arg of cfg.printArgs) {
        expect(typeof arg).toBe('string');
        expect(arg.length).toBeGreaterThan(0);
      }
    }
  });

  it('every pathEnvVar is a non-empty string', () => {
    for (const key of Object.keys(agentsModule.AGENT_REGISTRY)) {
      const cfg = agentsModule.AGENT_REGISTRY[key as AgentType];
      expect(typeof cfg.pathEnvVar).toBe('string');
      expect(cfg.pathEnvVar.length).toBeGreaterThan(0);
    }
  });

  it('every inputMode is a valid enum value', () => {
    const validModes = ['file', 'inline', 'file-reference'];
    for (const key of Object.keys(agentsModule.AGENT_REGISTRY)) {
      const cfg = agentsModule.AGENT_REGISTRY[key as AgentType];
      expect(validModes).toContain(cfg.inputMode);
    }
  });
});

// ---------------------------------------------------------------------------
// getAgentConfig
// ---------------------------------------------------------------------------
describe('getAgentConfig', () => {
  it('returns config for claude', () => {
    const cfg = agentsModule.getAgentConfig('claude');
    expect(cfg.name).toBe('claude');
    expect(cfg.displayName).toBe('Claude Code');
  });

  it('returns config for copilot', () => {
    const cfg = agentsModule.getAgentConfig('copilot');
    expect(cfg.name).toBe('copilot');
    expect(cfg.displayName).toBe('GitHub Copilot CLI');
  });

  it('throws for unknown agent type', () => {
    expect(() => agentsModule.getAgentConfig('gpt' as AgentType)).toThrow('Unknown agent type');
  });

  it('error message contains supported agents list', () => {
    try {
      agentsModule.getAgentConfig('unknown' as AgentType);
      expect.unreachable('should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('claude');
      expect(err.message).toContain('copilot');
    }
  });

  it('error message includes the invalid agent name', () => {
    expect(() => agentsModule.getAgentConfig('foobar' as AgentType)).toThrow('foobar');
  });

  it('returned config is the same reference as the registry entry', () => {
    const cfg = agentsModule.getAgentConfig('claude');
    expect(cfg).toBe(agentsModule.AGENT_REGISTRY.claude);
  });
});

// ---------------------------------------------------------------------------
// getSupportedAgents
// ---------------------------------------------------------------------------
describe('getSupportedAgents', () => {
  it('returns both claude and copilot', () => {
    const agents = agentsModule.getSupportedAgents();
    expect(agents).toContain('claude');
    expect(agents).toContain('copilot');
  });

  it('has exactly 2 agents', () => {
    expect(agentsModule.getSupportedAgents()).toHaveLength(2);
  });

  it('returns an array of strings', () => {
    for (const agent of agentsModule.getSupportedAgents()) {
      expect(typeof agent).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// isValidAgent
// ---------------------------------------------------------------------------
describe('isValidAgent', () => {
  it('"claude" is valid', () => {
    expect(agentsModule.isValidAgent('claude')).toBe(true);
  });

  it('"copilot" is valid', () => {
    expect(agentsModule.isValidAgent('copilot')).toBe(true);
  });

  it('"gpt" is not valid', () => {
    expect(agentsModule.isValidAgent('gpt')).toBe(false);
  });

  it('empty string is not valid', () => {
    expect(agentsModule.isValidAgent('')).toBe(false);
  });

  it('undefined is not valid', () => {
    expect(agentsModule.isValidAgent(undefined as any)).toBe(false);
  });

  it('null is not valid', () => {
    expect(agentsModule.isValidAgent(null as any)).toBe(false);
  });

  it('number 123 is not valid', () => {
    expect(agentsModule.isValidAgent(123 as any)).toBe(false);
  });

  it('object is not valid', () => {
    expect(agentsModule.isValidAgent({} as any)).toBe(false);
  });

  it('boolean true is not valid', () => {
    expect(agentsModule.isValidAgent(true as any)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getDefaultAgent
// ---------------------------------------------------------------------------
describe('getDefaultAgent', () => {
  it('returns "claude"', () => {
    expect(agentsModule.getDefaultAgent()).toBe('claude');
  });

  it('returned value is a valid agent', () => {
    expect(agentsModule.isValidAgent(agentsModule.getDefaultAgent())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Claude vs Copilot differences
// ---------------------------------------------------------------------------
describe('Claude vs Copilot differences', () => {
  it('claude uses "file" inputMode', () => {
    expect(agentsModule.AGENT_REGISTRY.claude.inputMode).toBe('file');
  });

  it('copilot uses "file-reference" inputMode', () => {
    expect(agentsModule.AGENT_REGISTRY.copilot.inputMode).toBe('file-reference');
  });

  it('different pathEnvVars', () => {
    expect(agentsModule.AGENT_REGISTRY.claude.pathEnvVar).toBe('CLAUDE_CODE_PATH');
    expect(agentsModule.AGENT_REGISTRY.copilot.pathEnvVar).toBe('COPILOT_CLI_PATH');
  });

  it('claude has 2 executables, copilot has 1', () => {
    expect(agentsModule.AGENT_REGISTRY.claude.executables).toHaveLength(2);
    expect(agentsModule.AGENT_REGISTRY.copilot.executables).toHaveLength(1);
  });

  it('different printArgs', () => {
    expect(agentsModule.AGENT_REGISTRY.claude.printArgs).not.toEqual(
      agentsModule.AGENT_REGISTRY.copilot.printArgs,
    );
  });

  it('different displayNames', () => {
    expect(agentsModule.AGENT_REGISTRY.claude.displayName).not.toBe(
      agentsModule.AGENT_REGISTRY.copilot.displayName,
    );
  });
});

// ---------------------------------------------------------------------------
// detectAgentPath — env override
// ---------------------------------------------------------------------------
describe('detectAgentPath — env override', () => {
  it('returns CLAUDE_CODE_PATH when set', async () => {
    process.env.CLAUDE_CODE_PATH = '/custom/claude';
    vi.resetModules();
    const mod = await import('../../agents.js');
    expect(mod.detectAgentPath('claude')).toBe('/custom/claude');
  });

  it('skips execSync when env var is set', async () => {
    process.env.CLAUDE_CODE_PATH = '/custom/claude';
    vi.resetModules();
    const cp = await import('child_process');
    const mock = cp.execSync as unknown as ReturnType<typeof vi.fn>;
    const mod = await import('../../agents.js');
    mod.detectAgentPath('claude');
    expect(mock).not.toHaveBeenCalled();
  });

  it('returns COPILOT_CLI_PATH when set', async () => {
    process.env.COPILOT_CLI_PATH = '/custom/copilot';
    vi.resetModules();
    const mod = await import('../../agents.js');
    expect(mod.detectAgentPath('copilot')).toBe('/custom/copilot');
  });

  it('env var can be a relative path', async () => {
    process.env.CLAUDE_CODE_PATH = './bin/claude';
    vi.resetModules();
    const mod = await import('../../agents.js');
    expect(mod.detectAgentPath('claude')).toBe('./bin/claude');
  });
});

// ---------------------------------------------------------------------------
// detectAgentPath — where/which lookup
// ---------------------------------------------------------------------------
describe('detectAgentPath — where/which lookup', () => {
  it('uses "where" on win32', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    execSyncMock.mockReturnValue('/path/to/claude-code\n');
    agentsModule.detectAgentPath('claude');
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('where'),
      expect.any(Object),
    );
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });

  it('uses "which" on linux', async () => {
    vi.resetModules();
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const cp = await import('child_process');
    const mock = cp.execSync as unknown as ReturnType<typeof vi.fn>;
    mock.mockReturnValue('/usr/bin/claude-code\n');
    const mod = await import('../../agents.js');
    mod.detectAgentPath('claude');
    expect(mock).toHaveBeenCalledWith(
      expect.stringContaining('which'),
      expect.any(Object),
    );
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });

  it('returns null when executable not found (throws)', () => {
    execSyncMock.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(agentsModule.detectAgentPath('copilot')).toBeNull();
  });

  it('passes timeout of 2000ms', () => {
    execSyncMock.mockReturnValue('/path/to/claude-code\n');
    agentsModule.detectAgentPath('claude');
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 2000 }),
    );
  });

  it('passes encoding utf-8', () => {
    execSyncMock.mockReturnValue('/path/to/claude-code\n');
    agentsModule.detectAgentPath('claude');
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });
});

// ---------------------------------------------------------------------------
// detectAgentPath — caching
// ---------------------------------------------------------------------------
describe('detectAgentPath — caching', () => {
  it('second call returns cached result without calling execSync again', () => {
    execSyncMock.mockReturnValue('/path/to/claude-code\n');
    const first = agentsModule.detectAgentPath('claude');
    const callCount = execSyncMock.mock.calls.length;
    const second = agentsModule.detectAgentPath('claude');
    expect(second).toBe(first);
    expect(execSyncMock.mock.calls.length).toBe(callCount);
  });

  it('caches null when not found', () => {
    execSyncMock.mockImplementation(() => {
      throw new Error('not found');
    });
    const first = agentsModule.detectAgentPath('copilot');
    expect(first).toBeNull();
    execSyncMock.mockReturnValue('/now/found');
    const second = agentsModule.detectAgentPath('copilot');
    expect(second).toBeNull(); // still cached as null
  });

  it('claude and copilot cached independently', () => {
    execSyncMock
      .mockImplementationOnce(() => '/path/to/claude-code\n')
      .mockImplementationOnce(() => '/path/to/copilot\n');
    const c = agentsModule.detectAgentPath('claude');
    const p = agentsModule.detectAgentPath('copilot');
    expect(c).toBe('claude-code');
    expect(p).toBe('copilot');
  });

  it('fresh module import clears cache', async () => {
    execSyncMock.mockReturnValue('/path\n');
    agentsModule.detectAgentPath('claude');
    vi.resetModules();
    const cp = await import('child_process');
    const newMock = cp.execSync as unknown as ReturnType<typeof vi.fn>;
    newMock.mockImplementation(() => {
      throw new Error('not found');
    });
    const mod = await import('../../agents.js');
    expect(mod.detectAgentPath('claude')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectAgentPath — multiple executables
// ---------------------------------------------------------------------------
describe('detectAgentPath — multiple executables', () => {
  it('returns second executable when first not found', () => {
    execSyncMock
      .mockImplementationOnce(() => {
        throw new Error('not found');
      })
      .mockReturnValueOnce('/path/to/claude\n');
    const result = agentsModule.detectAgentPath('claude');
    expect(result).toBe('claude');
  });

  it('returns first executable when both are found', async () => {
    vi.resetModules();
    const cp = await import('child_process');
    const mock = cp.execSync as unknown as ReturnType<typeof vi.fn>;
    mock.mockReset();
    mock.mockReturnValueOnce('/path/to/claude-code\n')
      .mockReturnValueOnce('/path/to/claude\n');
    const mod = await import('../../agents.js');
    const result = mod.detectAgentPath('claude');
    expect(result).toBe('claude-code');
    // Should only call execSync once since first succeeds
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('returns null when all executables not found', async () => {
    vi.resetModules();
    const cp = await import('child_process');
    const mock = cp.execSync as unknown as ReturnType<typeof vi.fn>;
    mock.mockReset();
    mock.mockImplementation(() => {
      throw new Error('not found');
    });
    const mod = await import('../../agents.js');
    expect(mod.detectAgentPath('claude')).toBeNull();
    // Called twice — once for each executable
    expect(mock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// detectAgentPath — empty result
// ---------------------------------------------------------------------------
describe('detectAgentPath — empty result', () => {
  it('skips executable when execSync returns empty string', () => {
    execSyncMock
      .mockReturnValueOnce('   \n')  // trims to empty
      .mockReturnValueOnce(''); // empty
    expect(agentsModule.detectAgentPath('claude')).toBeNull();
  });

  it('skips executable when execSync returns whitespace only', () => {
    execSyncMock.mockReturnValue('   ');
    expect(agentsModule.detectAgentPath('copilot')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectAgentPath — timeout handling
// ---------------------------------------------------------------------------
describe('detectAgentPath — timeout', () => {
  it('returns null when execSync times out', () => {
    execSyncMock.mockImplementation(() => {
      const err = new Error('TIMEOUT');
      (err as any).killed = true;
      throw err;
    });
    expect(agentsModule.detectAgentPath('claude')).toBeNull();
  });

  it('continues to next executable after timeout on first', () => {
    execSyncMock
      .mockImplementationOnce(() => {
        throw new Error('TIMEOUT');
      })
      .mockReturnValueOnce('/path/to/claude\n');
    expect(agentsModule.detectAgentPath('claude')).toBe('claude');
  });
});
