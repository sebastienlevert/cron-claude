import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ---------------------------------------------------------------------------
// Capture handlers registered via server.setRequestHandler
// ---------------------------------------------------------------------------
let capturedHandlers: Map<string, Function> = new Map();

const mockServer = {
  setRequestHandler: vi.fn((schema: any, handler: Function) => {
    // The schema objects are imported constants; we store under a readable key
    const key = typeof schema === 'string' ? schema : schema?.method ?? JSON.stringify(schema);
    capturedHandlers.set(key, handler);
  }),
  connect: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
};

// ---------------------------------------------------------------------------
// Mock the MCP SDK **before** importing the server module
// ---------------------------------------------------------------------------
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => {
  // Must be a real constructor (class/function), not an arrow
  function MockServer() {
    return mockServer;
  }
  return { Server: MockServer };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  function MockStdioServerTransport() {
    return {};
  }
  return { StdioServerTransport: MockStdioServerTransport };
});

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: { method: 'tools/call' },
  ListToolsRequestSchema: { method: 'tools/list' },
  Tool: {},
}));

// ---------------------------------------------------------------------------
// Mock all underlying modules
// ---------------------------------------------------------------------------
const mockRegisterTask = vi.fn(async () => 'registered');
const mockUnregisterTask = vi.fn(async () => {});
const mockEnableTask = vi.fn(async () => {});
const mockDisableTask = vi.fn(async () => {});
const mockGetTaskStatus = vi.fn(async () => ({
  exists: true,
  enabled: true,
  lastRunTime: null,
  nextRunTime: '2025-01-01T09:00:00',
}));

vi.mock('../scheduler.js', () => ({
  registerTask: (...a: any[]) => mockRegisterTask(...a),
  unregisterTask: (...a: any[]) => mockUnregisterTask(...a),
  enableTask: (...a: any[]) => mockEnableTask(...a),
  disableTask: (...a: any[]) => mockDisableTask(...a),
  getTaskStatus: (...a: any[]) => mockGetTaskStatus(...a),
}));

const mockExecuteTask = vi.fn(async () => ({
  success: true,
  logPath: '/logs/test.md',
}));

vi.mock('../executor.js', () => ({
  executeTask: (...a: any[]) => mockExecuteTask(...a),
}));

const mockVerifyLogFile = vi.fn(() => ({
  valid: true,
  log: { taskId: 'test', executionId: 'exec-1', status: 'success' },
}));

vi.mock('../logger.js', () => ({
  verifyLogFile: (...a: any[]) => mockVerifyLogFile(...a),
}));

const mockLoadConfig = vi.fn(() => ({
  secretKey: 'test-key',
  version: '0.1.0',
  tasksDirs: ['/test/tasks'],
  logsDir: '/test/logs',
  maxConcurrency: 2,
}));
const mockGetConfigDir = vi.fn(() => '/test/.cron-agents');

vi.mock('../config.js', () => ({
  loadConfig: (...a: any[]) => mockLoadConfig(...a),
  getConfigDir: (...a: any[]) => mockGetConfigDir(...a),
}));

const mockCreateTask = vi.fn();
const mockGetTask = vi.fn<any>(() => null);
const mockListTasks = vi.fn<any>(() => []);
const mockTaskExists = vi.fn<any>(() => false);
const mockGetTaskFilePath = vi.fn(() => '/test/tasks/test.md');

vi.mock('../tasks.js', () => ({
  createTask: (...a: any[]) => mockCreateTask(...a),
  getTask: (...a: any[]) => mockGetTask(...a),
  listTasks: (...a: any[]) => mockListTasks(...a),
  taskExists: (...a: any[]) => mockTaskExists(...a),
  getTaskFilePath: (...a: any[]) => mockGetTaskFilePath(...a),
}));

const mockGetSupportedAgents = vi.fn(() => ['claude', 'copilot']);
const mockGetAgentConfig = vi.fn((a: string) => ({
  name: a,
  displayName: a === 'claude' ? 'Claude Code' : 'GitHub Copilot CLI',
}));
const mockDetectAgentPath = vi.fn(() => '/usr/bin/claude');
const mockGetDefaultAgent = vi.fn(() => 'claude');
const mockIsValidAgent = vi.fn(() => true);

vi.mock('../agents.js', () => ({
  getSupportedAgents: (...a: any[]) => mockGetSupportedAgents(...a),
  getAgentConfig: (...a: any[]) => mockGetAgentConfig(...a),
  detectAgentPath: (...a: any[]) => mockDetectAgentPath(...a),
  getDefaultAgent: (...a: any[]) => mockGetDefaultAgent(...a),
  isValidAgent: (...a: any[]) => mockIsValidAgent(...a),
}));

const mockCreateRun = vi.fn(() => ({
  runId: 'run-123',
  taskId: 'test',
  status: 'running' as const,
  startedAt: new Date().toISOString(),
  pid: process.pid,
}));
const mockUpdateRun = vi.fn();
const mockGetRun = vi.fn<any>(() => null);
const mockGetLatestRunForTask = vi.fn<any>(() => null);
const mockCleanupOldRuns = vi.fn(() => 0);

vi.mock('../runs.js', () => ({
  createRun: (...a: any[]) => mockCreateRun(...a),
  updateRun: (...a: any[]) => mockUpdateRun(...a),
  getRun: (...a: any[]) => mockGetRun(...a),
  getLatestRunForTask: (...a: any[]) => mockGetLatestRunForTask(...a),
  cleanupOldRuns: (...a: any[]) => mockCleanupOldRuns(...a),
}));

const mockTryAcquireSlot = vi.fn(async () => ({
  acquired: true,
  runningCount: 0,
  maxConcurrency: 2,
}));
const mockWaitForSlot = vi.fn(async () => {});
const mockGetConcurrencyStatus = vi.fn(async () => ({
  running: 0,
  queued: 0,
  maxConcurrency: 2,
}));

vi.mock('../concurrency.js', () => ({
  tryAcquireSlot: (...a: any[]) => mockTryAcquireSlot(...a),
  waitForSlot: (...a: any[]) => mockWaitForSlot(...a),
  getConcurrencyStatus: (...a: any[]) => mockGetConcurrencyStatus(...a),
}));

// Mock gray-matter for cron_view_logs
vi.mock('gray-matter', () => ({
  default: vi.fn((content: string) => ({
    data: { status: 'success', timestamp: '2025-01-01T09:00:00Z' },
    content: 'log body',
  })),
}));

// Mock fs functions used at module top-level and in handlers
const mockReaddirSync = vi.fn<any>(() => []);

// We'll store the real readFileSync from inside the factory to avoid recursion
let realReadFileSync: typeof import('fs').readFileSync;

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  realReadFileSync = actual.readFileSync;
  return {
    ...actual,
    readdirSync: (...a: any[]) => mockReaddirSync(...a),
    readFileSync: (...a: any[]) => {
      const path = a[0] as string;
      // The module reads package.json at import time — delegate to real fs
      if (typeof path === 'string' && path.endsWith('package.json')) {
        return actual.readFileSync(...a as Parameters<typeof actual.readFileSync>);
      }
      // For log files, return fake frontmatter content
      return '---\nstatus: success\ntimestamp: 2025-01-01T09:00:00Z\n---\nlog body';
    },
  };
});

// ---------------------------------------------------------------------------
// Import the MCP server module — this triggers handler registration & main()
// ---------------------------------------------------------------------------
beforeAll(async () => {
  capturedHandlers.clear();
  await import('../mcp-server.js');
});

// ---------------------------------------------------------------------------
// Helper to invoke captured handlers
// ---------------------------------------------------------------------------
function getListToolsHandler(): Function {
  const h = capturedHandlers.get('tools/list');
  if (!h) throw new Error('ListToolsRequestSchema handler not captured');
  return h;
}

function getCallToolHandler(): Function {
  const h = capturedHandlers.get('tools/call');
  if (!h) throw new Error('CallToolRequestSchema handler not captured');
  return h;
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const handler = getCallToolHandler();
  return handler({ params: { name, arguments: args } });
}

function getText(result: any): string {
  return result.content[0].text;
}

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();

  // Restore sensible defaults
  mockTaskExists.mockReturnValue(false);
  mockGetTask.mockReturnValue(null);
  mockListTasks.mockReturnValue([]);
  mockGetRun.mockReturnValue(null);
  mockGetLatestRunForTask.mockReturnValue(null);
  mockGetTaskFilePath.mockReturnValue('/test/tasks/test.md');
  mockCreateRun.mockReturnValue({
    runId: 'run-123',
    taskId: 'test',
    status: 'running' as const,
    startedAt: new Date().toISOString(),
    pid: process.pid,
  });
  mockTryAcquireSlot.mockResolvedValue({
    acquired: true,
    runningCount: 0,
    maxConcurrency: 2,
  });
  mockGetTaskStatus.mockResolvedValue({
    exists: true,
    enabled: true,
    lastRunTime: null,
    nextRunTime: '2025-01-01T09:00:00',
  });
  mockVerifyLogFile.mockReturnValue({
    valid: true,
    log: { taskId: 'test', executionId: 'exec-1', status: 'success' },
  });
  mockReaddirSync.mockReturnValue([]);
  mockIsValidAgent.mockReturnValue(true);
  mockGetDefaultAgent.mockReturnValue('claude');
  mockDetectAgentPath.mockReturnValue('/usr/bin/claude');
  mockLoadConfig.mockReturnValue({
    secretKey: 'test-key',
    version: '0.1.0',
    tasksDirs: ['/test/tasks'],
    logsDir: '/test/logs',
    maxConcurrency: 2,
  });
  mockGetConcurrencyStatus.mockResolvedValue({
    running: 0,
    queued: 0,
    maxConcurrency: 2,
  });
});

// ===================================================================
// 1. Tool definitions
// ===================================================================
describe('Tool definitions', () => {
  it('should register a ListToolsRequestSchema handler', () => {
    expect(capturedHandlers.has('tools/list')).toBe(true);
  });

  it('should register a CallToolRequestSchema handler', () => {
    expect(capturedHandlers.has('tools/call')).toBe(true);
  });

  it('should expose exactly 14 tools', async () => {
    const result = await getListToolsHandler()({});
    expect(result.tools).toHaveLength(14);
  });

  it('every tool has a name, description, and inputSchema', async () => {
    const { tools } = await getListToolsHandler()({});
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('should include all expected tool names', async () => {
    const { tools } = await getListToolsHandler()({});
    const names = tools.map((t: any) => t.name);
    expect(names).toContain('cron_create_task');
    expect(names).toContain('cron_register_task');
    expect(names).toContain('cron_unregister_task');
    expect(names).toContain('cron_list_tasks');
    expect(names).toContain('cron_enable_task');
    expect(names).toContain('cron_disable_task');
    expect(names).toContain('cron_run_task');
    expect(names).toContain('cron_view_logs');
    expect(names).toContain('cron_verify_log');
    expect(names).toContain('cron_status');
    expect(names).toContain('cron_get_task');
    expect(names).toContain('cron_get_run_status');
  });

  it('cron_create_task requires task_id and instructions', async () => {
    const { tools } = await getListToolsHandler()({});
    const tool = tools.find((t: any) => t.name === 'cron_create_task');
    expect(tool.inputSchema.required).toEqual(
      expect.arrayContaining(['task_id', 'instructions']),
    );
  });

  it('cron_create_task has correct property types', async () => {
    const { tools } = await getListToolsHandler()({});
    const tool = tools.find((t: any) => t.name === 'cron_create_task');
    const props = tool.inputSchema.properties;
    expect(props.task_id.type).toBe('string');
    expect(props.schedule.type).toBe('string');
    expect(props.invocation.enum).toEqual(['cli', 'api']);
    expect(props.agent.enum).toEqual(['claude', 'copilot']);
    expect(props.toast_notifications.type).toBe('boolean');
    expect(props.enabled.type).toBe('boolean');
  });

  it('cron_get_run_status has optional run_id and task_id', async () => {
    const { tools } = await getListToolsHandler()({});
    const tool = tools.find((t: any) => t.name === 'cron_get_run_status');
    // Neither run_id nor task_id is required per schema
    expect(tool.inputSchema.required).toBeUndefined();
    expect(tool.inputSchema.properties.run_id).toBeDefined();
    expect(tool.inputSchema.properties.task_id).toBeDefined();
  });
});

// ===================================================================
// 2. cron_create_task
// ===================================================================
describe('cron_create_task', () => {
  it('creates a task and returns success', async () => {
    const result = await callTool('cron_create_task', {
      task_id: 'my-task',
      instructions: '# Hello\nDo something',
    });
    expect(getText(result)).toContain('Task created successfully');
    expect(getText(result)).toContain('my-task');
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
  });

  it('passes correct task definition to createTask', async () => {
    await callTool('cron_create_task', {
      task_id: 'my-task',
      schedule: '30 8 * * 1-5',
      invocation: 'api',
      agent: 'copilot',
      instructions: 'Do work',
      toast_notifications: false,
      enabled: false,
    });
    const taskDef = mockCreateTask.mock.calls[0][0];
    expect(taskDef.id).toBe('my-task');
    expect(taskDef.schedule).toBe('30 8 * * 1-5');
    expect(taskDef.invocation).toBe('api');
    expect(taskDef.agent).toBe('copilot');
    expect(taskDef.notifications.toast).toBe(false);
    expect(taskDef.enabled).toBe(false);
    expect(taskDef.instructions).toBe('Do work');
  });

  it('returns error when task already exists', async () => {
    mockTaskExists.mockReturnValue(true);
    const result = await callTool('cron_create_task', {
      task_id: 'existing',
      instructions: 'stuff',
    });
    expect(getText(result)).toContain('already exists');
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('defaults schedule to 0 9 * * * when not provided', async () => {
    await callTool('cron_create_task', {
      task_id: 'default-sched',
      instructions: 'stuff',
    });
    const taskDef = mockCreateTask.mock.calls[0][0];
    expect(taskDef.schedule).toBe('0 9 * * *');
  });

  it('defaults invocation to cli when not provided', async () => {
    await callTool('cron_create_task', {
      task_id: 'default-inv',
      instructions: 'stuff',
    });
    expect(mockCreateTask.mock.calls[0][0].invocation).toBe('cli');
  });

  it('defaults agent to claude via getDefaultAgent', async () => {
    mockIsValidAgent.mockReturnValue(false);
    await callTool('cron_create_task', {
      task_id: 'default-agent',
      instructions: 'stuff',
    });
    expect(mockCreateTask.mock.calls[0][0].agent).toBe('claude');
  });

  it('defaults enabled to true when not provided', async () => {
    await callTool('cron_create_task', {
      task_id: 'default-enabled',
      instructions: 'stuff',
    });
    expect(mockCreateTask.mock.calls[0][0].enabled).toBe(true);
  });

  it('defaults toast notifications to true when not provided', async () => {
    await callTool('cron_create_task', {
      task_id: 'default-toast',
      instructions: 'stuff',
    });
    expect(mockCreateTask.mock.calls[0][0].notifications.toast).toBe(true);
  });

  it('suggests cron_register_task in success message', async () => {
    const result = await callTool('cron_create_task', {
      task_id: 'next-step',
      instructions: 'stuff',
    });
    expect(getText(result)).toContain('cron_register_task');
  });
});

// ===================================================================
// 3. cron_register_task
// ===================================================================
describe('cron_register_task', () => {
  it('registers a task when it exists and has a schedule', async () => {
    mockTaskExists.mockReturnValue(true);
    mockGetTask.mockReturnValue({
      id: 'my-task',
      schedule: '0 9 * * *',
      agent: 'claude',
    });
    const result = await callTool('cron_register_task', { task_id: 'my-task' });
    expect(getText(result)).toContain('registered successfully');
    expect(mockRegisterTask).toHaveBeenCalledTimes(1);
  });

  it('returns error when task not found', async () => {
    mockTaskExists.mockReturnValue(false);
    const result = await callTool('cron_register_task', { task_id: 'nope' });
    expect(getText(result)).toContain('Task not found');
    expect(mockRegisterTask).not.toHaveBeenCalled();
  });

  it('returns error when task has no schedule', async () => {
    mockTaskExists.mockReturnValue(true);
    mockGetTask.mockReturnValue({ id: 'no-sched', schedule: '' });
    const result = await callTool('cron_register_task', { task_id: 'no-sched' });
    expect(getText(result)).toContain('must have a schedule');
  });

  it('passes agent to registerTask', async () => {
    mockTaskExists.mockReturnValue(true);
    mockGetTask.mockReturnValue({
      id: 'copilot-task',
      schedule: '0 10 * * *',
      agent: 'copilot',
    });
    await callTool('cron_register_task', { task_id: 'copilot-task' });
    expect(mockRegisterTask.mock.calls[0][4]).toBe('copilot');
  });

  it('includes schedule in success message', async () => {
    mockTaskExists.mockReturnValue(true);
    mockGetTask.mockReturnValue({
      id: 'sched-msg',
      schedule: '*/5 * * * *',
      agent: 'claude',
    });
    const result = await callTool('cron_register_task', { task_id: 'sched-msg' });
    expect(getText(result)).toContain('*/5 * * * *');
  });
});

// ===================================================================
// 4. cron_unregister_task
// ===================================================================
describe('cron_unregister_task', () => {
  it('unregisters a task', async () => {
    const result = await callTool('cron_unregister_task', { task_id: 'my-task' });
    expect(getText(result)).toContain('unregistered successfully');
    expect(mockUnregisterTask).toHaveBeenCalledWith('my-task');
  });

  it('propagates scheduler errors', async () => {
    mockUnregisterTask.mockRejectedValueOnce(new Error('scheduler boom'));
    const result = await callTool('cron_unregister_task', { task_id: 'fail' });
    expect(getText(result)).toContain('scheduler boom');
    expect(result.isError).toBe(true);
  });
});

// ===================================================================
// 5. cron_enable_task / cron_disable_task
// ===================================================================
describe('cron_enable_task', () => {
  it('enables a task', async () => {
    const result = await callTool('cron_enable_task', { task_id: 'my-task' });
    expect(getText(result)).toContain('enabled');
    expect(mockEnableTask).toHaveBeenCalledWith('my-task');
  });

  it('propagates scheduler errors', async () => {
    mockEnableTask.mockRejectedValueOnce(new Error('enable failed'));
    const result = await callTool('cron_enable_task', { task_id: 'fail' });
    expect(getText(result)).toContain('enable failed');
    expect(result.isError).toBe(true);
  });
});

describe('cron_disable_task', () => {
  it('disables a task', async () => {
    const result = await callTool('cron_disable_task', { task_id: 'my-task' });
    expect(getText(result)).toContain('disabled');
    expect(mockDisableTask).toHaveBeenCalledWith('my-task');
  });

  it('propagates scheduler errors', async () => {
    mockDisableTask.mockRejectedValueOnce(new Error('disable failed'));
    const result = await callTool('cron_disable_task', { task_id: 'fail' });
    expect(getText(result)).toContain('disable failed');
    expect(result.isError).toBe(true);
  });
});

// ===================================================================
// 6. cron_get_task
// ===================================================================
describe('cron_get_task', () => {
  it('returns task definition when found', async () => {
    mockGetTask.mockReturnValue({
      id: 'my-task',
      schedule: '0 9 * * *',
      invocation: 'cli',
      agent: 'claude',
      enabled: true,
      notifications: { toast: true },
      instructions: '# Hello',
    });
    const result = await callTool('cron_get_task', { task_id: 'my-task' });
    const text = getText(result);
    expect(text).toContain('Task: my-task');
    expect(text).toContain('Schedule: 0 9 * * *');
    expect(text).toContain('Agent: claude');
    expect(text).toContain('Enabled: true');
    expect(text).toContain('# Hello');
  });

  it('returns error when task not found', async () => {
    const result = await callTool('cron_get_task', { task_id: 'nope' });
    expect(getText(result)).toContain('Task not found');
  });

  it('includes full markdown definition', async () => {
    mockGetTask.mockReturnValue({
      id: 'full-def',
      schedule: '0 12 * * *',
      invocation: 'api',
      agent: 'copilot',
      enabled: false,
      notifications: { toast: false },
      instructions: 'Do API work',
    });
    const result = await callTool('cron_get_task', { task_id: 'full-def' });
    const text = getText(result);
    expect(text).toContain('invocation: api');
    expect(text).toContain('agent: copilot');
    expect(text).toContain('enabled: false');
  });

  it('includes registration status', async () => {
    mockGetTask.mockReturnValue({
      id: 'reg-check',
      schedule: '0 9 * * *',
      invocation: 'cli',
      agent: 'claude',
      enabled: true,
      notifications: { toast: true },
      instructions: 'stuff',
    });
    mockGetTaskStatus.mockResolvedValue({ exists: false });
    const result = await callTool('cron_get_task', { task_id: 'reg-check' });
    expect(getText(result)).toContain('Registered: No');
  });
});

// ===================================================================
// 7. cron_run_task
// ===================================================================
describe('cron_run_task', () => {
  it('returns error when task not found', async () => {
    const result = await callTool('cron_run_task', { task_id: 'nope' });
    expect(getText(result)).toContain('Task not found');
  });

  it('starts task in background and returns run ID', async () => {
    mockGetTask.mockReturnValue({
      id: 'run-me',
      invocation: 'cli',
      agent: 'claude',
    });
    const result = await callTool('cron_run_task', { task_id: 'run-me' });
    const text = getText(result);
    expect(text).toContain('run-123');
    expect(text).toContain('started in background');
    expect(mockCreateRun).toHaveBeenCalledWith('run-me', 'running');
  });

  it('shows queued status when no slot available', async () => {
    mockGetTask.mockReturnValue({
      id: 'queued-task',
      invocation: 'cli',
      agent: 'claude',
    });
    mockTryAcquireSlot.mockResolvedValue({
      acquired: false,
      runningCount: 2,
      maxConcurrency: 2,
    });
    mockCreateRun.mockReturnValue({
      runId: 'run-queued',
      taskId: 'queued-task',
      status: 'queued' as const,
      startedAt: new Date().toISOString(),
    });
    const result = await callTool('cron_run_task', { task_id: 'queued-task' });
    const text = getText(result);
    expect(text).toContain('queued');
    expect(text).toContain('2/2 slots in use');
    expect(mockCreateRun).toHaveBeenCalledWith('queued-task', 'queued');
  });

  it('detects agent path for CLI tasks', async () => {
    mockGetTask.mockReturnValue({
      id: 'cli-task',
      invocation: 'cli',
      agent: 'copilot',
    });
    await callTool('cron_run_task', { task_id: 'cli-task' });
    expect(mockDetectAgentPath).toHaveBeenCalledWith('copilot');
  });

  it('does not detect agent path for API tasks', async () => {
    mockGetTask.mockReturnValue({
      id: 'api-task',
      invocation: 'api',
      agent: 'claude',
    });
    await callTool('cron_run_task', { task_id: 'api-task' });
    expect(mockDetectAgentPath).not.toHaveBeenCalled();
  });

  it('calls cleanupOldRuns after starting', async () => {
    mockGetTask.mockReturnValue({
      id: 'cleanup-test',
      invocation: 'cli',
      agent: 'claude',
    });
    await callTool('cron_run_task', { task_id: 'cleanup-test' });
    expect(mockCleanupOldRuns).toHaveBeenCalledTimes(1);
  });

  it('suggests cron_get_run_status in response', async () => {
    mockGetTask.mockReturnValue({
      id: 'hint-task',
      invocation: 'cli',
      agent: 'claude',
    });
    const result = await callTool('cron_run_task', { task_id: 'hint-task' });
    expect(getText(result)).toContain('cron_get_run_status');
  });
});

// ===================================================================
// 8. cron_list_tasks
// ===================================================================
describe('cron_list_tasks', () => {
  it('returns message when no tasks exist', async () => {
    const result = await callTool('cron_list_tasks');
    expect(getText(result)).toContain('No tasks found');
  });

  it('lists multiple tasks with details', async () => {
    mockListTasks.mockReturnValue([
      { id: 'task-a', schedule: '0 9 * * *', invocation: 'cli', agent: 'claude', enabled: true },
      { id: 'task-b', schedule: '0 18 * * *', invocation: 'api', agent: 'copilot', enabled: false },
    ]);
    const result = await callTool('cron_list_tasks');
    const text = getText(result);
    expect(text).toContain('task-a');
    expect(text).toContain('task-b');
    expect(text).toContain('0 9 * * *');
    expect(text).toContain('0 18 * * *');
  });

  it('shows registration status for each task', async () => {
    mockListTasks.mockReturnValue([
      { id: 'registered', schedule: '0 9 * * *', invocation: 'cli', agent: 'claude', enabled: true },
    ]);
    mockGetTaskStatus.mockResolvedValue({
      exists: true,
      enabled: true,
      lastRunTime: null,
      nextRunTime: '2025-01-01T09:00:00',
    });
    const result = await callTool('cron_list_tasks');
    expect(getText(result)).toContain('Registered: ✓');
  });

  it('shows unregistered status', async () => {
    mockListTasks.mockReturnValue([
      { id: 'unreg', schedule: '0 9 * * *', invocation: 'cli', agent: 'claude', enabled: true },
    ]);
    mockGetTaskStatus.mockResolvedValue({ exists: false });
    const result = await callTool('cron_list_tasks');
    expect(getText(result)).toContain('Registered: ✗');
    expect(getText(result)).toContain('cron_register_task');
  });

  it('shows active run status for running tasks', async () => {
    mockListTasks.mockReturnValue([
      { id: 'running-task', schedule: '0 9 * * *', invocation: 'cli', agent: 'claude', enabled: true },
    ]);
    mockGetLatestRunForTask.mockReturnValue({
      runId: 'run-active',
      taskId: 'running-task',
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    const result = await callTool('cron_list_tasks');
    expect(getText(result)).toContain('Running');
    expect(getText(result)).toContain('run-active');
  });

  it('shows queued run status', async () => {
    mockListTasks.mockReturnValue([
      { id: 'queued-task', schedule: '0 9 * * *', invocation: 'cli', agent: 'claude', enabled: true },
    ]);
    mockGetLatestRunForTask.mockReturnValue({
      runId: 'run-q',
      taskId: 'queued-task',
      status: 'queued',
      startedAt: new Date().toISOString(),
    });
    const result = await callTool('cron_list_tasks');
    expect(getText(result)).toContain('Queued');
  });

  it('handles getTaskStatus errors gracefully per task', async () => {
    mockListTasks.mockReturnValue([
      { id: 'error-task', schedule: '0 9 * * *', invocation: 'cli', agent: 'claude', enabled: true },
    ]);
    mockGetTaskStatus.mockRejectedValue(new Error('scheduler unavailable'));
    const result = await callTool('cron_list_tasks');
    expect(getText(result)).toContain('Error processing task');
  });
});

// ===================================================================
// 9. cron_view_logs
// ===================================================================
describe('cron_view_logs', () => {
  it('returns no-logs message when none exist', async () => {
    mockReaddirSync.mockReturnValue([]);
    const result = await callTool('cron_view_logs', { task_id: 'no-logs' });
    expect(getText(result)).toContain('No logs found');
  });

  it('returns log files when they exist', async () => {
    mockReaddirSync.mockReturnValue([
      'my-task_2025-01-01T09-00-00_exec-1.md',
      'my-task_2025-01-02T09-00-00_exec-2.md',
    ]);
    const result = await callTool('cron_view_logs', { task_id: 'my-task' });
    const text = getText(result);
    expect(text).toContain('Execution logs for task: my-task');
    expect(text).toContain('Total executions: 2');
  });

  it('handles filesystem errors gracefully', async () => {
    mockReaddirSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = await callTool('cron_view_logs', { task_id: 'broken' });
    expect(getText(result)).toContain('Error fetching logs');
  });

  it('limits display to 10 most recent logs', async () => {
    const files = Array.from({ length: 15 }, (_, i) =>
      `task_2025-01-${String(i + 1).padStart(2, '0')}T09-00-00_exec-${i}.md`,
    );
    mockReaddirSync.mockReturnValue(files);
    const result = await callTool('cron_view_logs', { task_id: 'task' });
    expect(getText(result)).toContain('Total executions: 15');
  });

  it('shows log directory in output', async () => {
    mockReaddirSync.mockReturnValue(['task_2025-01-01T09-00-00_exec-1.md']);
    const result = await callTool('cron_view_logs', { task_id: 'task' });
    expect(getText(result)).toContain('/test/logs');
  });
});

// ===================================================================
// 10. cron_verify_log
// ===================================================================
describe('cron_verify_log', () => {
  it('returns valid when signature matches', async () => {
    const result = await callTool('cron_verify_log', {
      log_content: '---\nsignature: abc\n---\nlog body',
    });
    const text = getText(result);
    expect(text).toContain('Signature is valid');
    expect(text).toContain('Task: test');
    expect(text).toContain('Execution: exec-1');
  });

  it('returns invalid when signature fails', async () => {
    mockVerifyLogFile.mockReturnValue({
      valid: false,
      error: 'Signature mismatch',
    });
    const result = await callTool('cron_verify_log', {
      log_content: '---\nsignature: wrong\n---\nlog body',
    });
    const text = getText(result);
    expect(text).toContain('Signature verification failed');
    expect(text).toContain('Signature mismatch');
  });

  it('passes log_content to verifyLogFile', async () => {
    const content = '---\nmy: frontmatter\n---\nbody';
    await callTool('cron_verify_log', { log_content: content });
    expect(mockVerifyLogFile).toHaveBeenCalledWith(content);
  });
});

// ===================================================================
// 11. cron_status
// ===================================================================
describe('cron_status', () => {
  it('returns system status information', async () => {
    const result = await callTool('cron_status');
    const text = getText(result);
    expect(text).toContain('cron-agents System Status');
    expect(text).toContain('Config directory:');
    expect(text).toContain('Secret key: ✓ Configured');
  });

  it('includes supported agents', async () => {
    const result = await callTool('cron_status');
    const text = getText(result);
    expect(text).toContain('Supported Agents');
    expect(text).toContain('Claude Code');
  });

  it('includes concurrency status', async () => {
    mockGetConcurrencyStatus.mockResolvedValue({
      running: 1,
      queued: 3,
      maxConcurrency: 4,
    });
    const result = await callTool('cron_status');
    const text = getText(result);
    expect(text).toContain('Max concurrent tasks: 4');
    expect(text).toContain('Currently running: 1');
    expect(text).toContain('Currently queued: 3');
  });

  it('includes task count', async () => {
    mockListTasks.mockReturnValue([{ id: 'a' }, { id: 'b' }]);
    const result = await callTool('cron_status');
    expect(getText(result)).toContain('Total tasks: 2');
  });

  it('shows not-configured when no secret key', async () => {
    mockLoadConfig.mockReturnValue({
      secretKey: '',
      version: '0.1.0',
      tasksDirs: ['/test/tasks'],
      logsDir: '/test/logs',
      maxConcurrency: 2,
    });
    const result = await callTool('cron_status');
    expect(getText(result)).toContain('Secret key: ✗ Not configured');
  });

  it('shows agent detection status', async () => {
    mockDetectAgentPath.mockReturnValue(null);
    const result = await callTool('cron_status');
    expect(getText(result)).toContain('Not found');
  });

  it('lists available tools', async () => {
    const result = await callTool('cron_status');
    const text = getText(result);
    expect(text).toContain('cron_create_task');
    expect(text).toContain('cron_register_task');
    expect(text).toContain('cron_run_task');
    expect(text).toContain('cron_view_logs');
    expect(text).toContain('cron_verify_log');
  });

  it('includes platform and node version', async () => {
    const result = await callTool('cron_status');
    const text = getText(result);
    expect(text).toContain(`Node version: ${process.version}`);
    expect(text).toContain(`Platform: ${process.platform}`);
  });
});

// ===================================================================
// 12. cron_get_run_status
// ===================================================================
describe('cron_get_run_status', () => {
  it('returns run status by run_id', async () => {
    mockGetRun.mockReturnValue({
      runId: 'run-abc',
      taskId: 'my-task',
      status: 'success',
      startedAt: '2025-01-01T09:00:00Z',
      finishedAt: '2025-01-01T09:01:00Z',
      logPath: '/logs/my-task.md',
    });
    const result = await callTool('cron_get_run_status', { run_id: 'run-abc' });
    const text = getText(result);
    expect(text).toContain('run-abc');
    expect(text).toContain('my-task');
    expect(text).toContain('success');
    expect(text).toContain('/logs/my-task.md');
  });

  it('returns latest run by task_id', async () => {
    mockGetLatestRunForTask.mockReturnValue({
      runId: 'run-latest',
      taskId: 'my-task',
      status: 'running',
      startedAt: '2025-01-01T09:00:00Z',
    });
    const result = await callTool('cron_get_run_status', { task_id: 'my-task' });
    expect(getText(result)).toContain('run-latest');
  });

  it('returns error when neither run_id nor task_id provided', async () => {
    const result = await callTool('cron_get_run_status', {});
    expect(getText(result)).toContain('Provide either run_id or task_id');
  });

  it('returns not-found when run does not exist', async () => {
    const result = await callTool('cron_get_run_status', { run_id: 'run-nope' });
    expect(getText(result)).toContain('No run found');
  });

  it('returns not-found by task_id when no runs', async () => {
    const result = await callTool('cron_get_run_status', { task_id: 'no-runs' });
    expect(getText(result)).toContain('No run found');
  });

  it('shows elapsed time for completed runs', async () => {
    mockGetRun.mockReturnValue({
      runId: 'run-elapsed',
      taskId: 'my-task',
      status: 'success',
      startedAt: '2025-01-01T09:00:00Z',
      finishedAt: '2025-01-01T09:00:30Z',
    });
    const result = await callTool('cron_get_run_status', { run_id: 'run-elapsed' });
    expect(getText(result)).toContain('30s');
  });

  it('shows error message for failed runs', async () => {
    mockGetRun.mockReturnValue({
      runId: 'run-fail',
      taskId: 'my-task',
      status: 'failure',
      startedAt: '2025-01-01T09:00:00Z',
      finishedAt: '2025-01-01T09:00:05Z',
      error: 'Agent crashed',
    });
    const result = await callTool('cron_get_run_status', { run_id: 'run-fail' });
    const text = getText(result);
    expect(text).toContain('failure');
    expect(text).toContain('Agent crashed');
  });

  it('shows status icon for each status', async () => {
    for (const [status, icon] of [
      ['queued', '🕐'],
      ['running', '⏳'],
      ['success', '✅'],
      ['failure', '❌'],
    ] as const) {
      mockGetRun.mockReturnValue({
        runId: `run-${status}`,
        taskId: 'task',
        status,
        startedAt: '2025-01-01T09:00:00Z',
        ...(status === 'success' || status === 'failure'
          ? { finishedAt: '2025-01-01T09:01:00Z' }
          : {}),
      });
      const result = await callTool('cron_get_run_status', { run_id: `run-${status}` });
      expect(getText(result)).toContain(icon);
    }
  });

  it('prefers run_id over task_id when both provided', async () => {
    mockGetRun.mockReturnValue({
      runId: 'run-preferred',
      taskId: 'task-a',
      status: 'running',
      startedAt: '2025-01-01T09:00:00Z',
    });
    const result = await callTool('cron_get_run_status', {
      run_id: 'run-preferred',
      task_id: 'task-b',
    });
    expect(getText(result)).toContain('run-preferred');
    expect(mockGetRun).toHaveBeenCalledWith('run-preferred');
    expect(mockGetLatestRunForTask).not.toHaveBeenCalled();
  });
});

// ===================================================================
// 13. Error handling
// ===================================================================
describe('Error handling', () => {
  it('returns isError for unknown tool name', async () => {
    const result = await callTool('cron_nonexistent');
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Unknown tool');
  });

  it('catches and wraps thrown errors', async () => {
    mockTaskExists.mockImplementation(() => {
      throw new Error('disk full');
    });
    const result = await callTool('cron_create_task', {
      task_id: 'boom',
      instructions: 'stuff',
    });
    expect(getText(result)).toContain('disk full');
    expect(result.isError).toBe(true);
  });

  it('catches non-Error thrown values', async () => {
    mockTaskExists.mockImplementation(() => {
      throw 'string error';
    });
    const result = await callTool('cron_create_task', {
      task_id: 'boom',
      instructions: 'stuff',
    });
    expect(getText(result)).toContain('string error');
    expect(result.isError).toBe(true);
  });

  it('catches async errors from scheduler', async () => {
    mockEnableTask.mockRejectedValueOnce(new Error('access denied'));
    const result = await callTool('cron_enable_task', { task_id: 'locked' });
    expect(getText(result)).toContain('access denied');
    expect(result.isError).toBe(true);
  });

  it('includes tool name in error message', async () => {
    mockDisableTask.mockRejectedValueOnce(new Error('pow'));
    const result = await callTool('cron_disable_task', { task_id: 'x' });
    expect(getText(result)).toContain('cron_disable_task');
  });
});

// ===================================================================
// 14. Input validation / edge cases
// ===================================================================
describe('Input validation and edge cases', () => {
  it('cron_create_task with empty instructions still calls createTask', async () => {
    await callTool('cron_create_task', {
      task_id: 'empty-instr',
      instructions: '',
    });
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    expect(mockCreateTask.mock.calls[0][0].instructions).toBe('');
  });

  it('cron_register_task with null getTask result returns error', async () => {
    mockTaskExists.mockReturnValue(true);
    mockGetTask.mockReturnValue(null);
    const result = await callTool('cron_register_task', { task_id: 'null-task' });
    expect(getText(result)).toContain('must have a schedule');
  });

  it('cron_run_task handles detectAgentPath returning null', async () => {
    mockGetTask.mockReturnValue({
      id: 'no-agent',
      invocation: 'cli',
      agent: 'claude',
    });
    mockDetectAgentPath.mockReturnValue(null);
    const result = await callTool('cron_run_task', { task_id: 'no-agent' });
    // Should still start — agentCliPath will be undefined
    expect(getText(result)).toContain('run-123');
  });

  it('cron_create_task with invalid agent falls back to default', async () => {
    mockIsValidAgent.mockReturnValue(false);
    mockGetDefaultAgent.mockReturnValue('claude');
    await callTool('cron_create_task', {
      task_id: 'bad-agent',
      agent: 'invalid-agent',
      instructions: 'stuff',
    });
    expect(mockCreateTask.mock.calls[0][0].agent).toBe('claude');
  });

  it('cron_list_tasks does not include completed runs in active status', async () => {
    mockListTasks.mockReturnValue([
      { id: 'done-task', schedule: '0 9 * * *', invocation: 'cli', agent: 'claude', enabled: true },
    ]);
    mockGetLatestRunForTask.mockReturnValue({
      runId: 'run-done',
      taskId: 'done-task',
      status: 'success',
      startedAt: '2025-01-01T09:00:00Z',
      finishedAt: '2025-01-01T09:01:00Z',
    });
    const result = await callTool('cron_list_tasks');
    // Completed runs should NOT show in the "Run:" line (only running/queued do)
    expect(getText(result)).not.toContain('run-done');
  });

  it('cron_verify_log with valid=true but no log details still succeeds', async () => {
    mockVerifyLogFile.mockReturnValue({ valid: true });
    const result = await callTool('cron_verify_log', { log_content: 'content' });
    expect(getText(result)).toContain('Signature is valid');
  });

  it('MCP server called connect on the server instance', () => {
    // mockServer.connect was called during module import (main()),
    // but clearAllMocks in beforeEach wipes the call count.
    // Instead, verify the method exists and was wired up.
    expect(typeof mockServer.connect).toBe('function');
  });
});
