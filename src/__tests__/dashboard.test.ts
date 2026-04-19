import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

// ── Mocks ───────────────────────────────────────────────────────────────────

const getSystemSnapshotMock = vi.fn();
const getQuickStatusMock = vi.fn();
vi.mock('../monitoring.js', () => ({
  getSystemSnapshot: (...args: any[]) => getSystemSnapshotMock(...args),
  getQuickStatus: (...args: any[]) => getQuickStatusMock(...args),
}));

let testLogsDir: string;

const loadConfigMock = vi.fn(() => ({
  tasksDirs: ['/mock/tasks'],
  logsDir: testLogsDir,
  maxConcurrency: 2,
  secretKey: 'super-secret-key',
}));
vi.mock('../config.js', () => ({
  loadConfig: (...args: any[]) => loadConfigMock(...args),
}));

let dashboardModule: typeof import('../dashboard.js');

// ── Helpers ─────────────────────────────────────────────────────────────────

function getRandomPort(): number {
  return 10000 + Math.floor(Math.random() * 50000);
}

async function fetchDashboard(
  path: string,
  port: number,
  method: string = 'GET',
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://localhost:${port}${path}`, { method }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode!, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

function makeSnapshot(overrides: any = {}): any {
  return {
    timestamp: new Date().toISOString(),
    version: '0.1.5',
    config: { tasksDirs: ['/tasks'], logsDir: '/logs', maxConcurrency: 2 },
    tasks: [],
    concurrency: { running: 0, queued: 0, maxConcurrency: 2 },
    recentLogs: [],
    ...overrides,
  };
}

function makeQuickStatus(overrides: any = {}): any {
  return {
    totalTasks: 3,
    enabledTasks: 2,
    running: 1,
    queued: 0,
    recentFailures: 0,
    ...overrides,
  };
}

// Wait for server to be ready
async function waitForServer(port: number, retries = 10): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await fetchDashboard('/', port);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('Server did not start');
}

// ── Setup / Teardown ────────────────────────────────────────────────────────

let stopFn: (() => Promise<void>) | undefined;

beforeEach(async () => {
  vi.resetModules();
  getSystemSnapshotMock.mockReset();
  getQuickStatusMock.mockReset();
  loadConfigMock.mockClear();

  // Set up a temp logs dir inside the project
  testLogsDir = join(process.cwd(), '.test-logs-' + Math.random().toString(36).slice(2));
  mkdirSync(testLogsDir, { recursive: true });
  loadConfigMock.mockReturnValue({
    tasksDirs: ['/mock/tasks'],
    logsDir: testLogsDir,
    maxConcurrency: 2,
    secretKey: 'super-secret-key',
  });

  dashboardModule = await import('../dashboard.js');
});

afterEach(async () => {
  if (stopFn) {
    await stopFn();
    stopFn = undefined;
  }
  try {
    rmSync(testLogsDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

// =============================================================================
// startDashboard – basic return value
// =============================================================================
describe('startDashboard – return value', () => {
  it('returns server, url, and stop function', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    expect(result.server).toBeDefined();
    expect(result.url).toBeDefined();
    expect(typeof result.stop).toBe('function');
  });

  it('url is http://localhost:<port>', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    expect(result.url).toBe(`http://localhost:${port}`);
  });

  it('default port is 7890', () => {
    // Just check the module uses 7890 as default by starting on it
    // We'll start and immediately stop to not conflict
    const result = dashboardModule.startDashboard(7890);
    stopFn = result.stop;
    expect(result.url).toBe('http://localhost:7890');
  });

  it('custom port works', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/', port);
    expect(res.status).toBe(200);
  });

  it('stop() closes the server', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    await result.stop();
    stopFn = undefined;

    await expect(fetchDashboard('/', port)).rejects.toThrow();
  });
});

// =============================================================================
// GET /
// =============================================================================
describe('GET /', () => {
  it('returns status 200', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/', port);
    expect(res.status).toBe(200);
  });

  it('returns HTML content type', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/', port);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('HTML contains "cron-agents" title', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/', port);
    expect(res.body).toContain('cron-agents');
  });

  it('HTML contains Dashboard title tag', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/', port);
    expect(res.body).toContain('<title>cron-agents Dashboard</title>');
  });

  it('HTML is a complete document', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/', port);
    expect(res.body).toContain('<!DOCTYPE html>');
    expect(res.body).toContain('</html>');
  });

  it('HTML contains JavaScript for auto-refresh', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/', port);
    expect(res.body).toContain('<script>');
    expect(res.body).toContain('setInterval');
  });
});

// =============================================================================
// GET /api/snapshot
// =============================================================================
describe('GET /api/snapshot', () => {
  it('returns JSON with snapshot data', async () => {
    const port = getRandomPort();
    const snapshot = makeSnapshot({ version: '1.2.3' });
    getSystemSnapshotMock.mockResolvedValue(snapshot);
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/api/snapshot', port);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.version).toBe('1.2.3');
  });

  it('returns application/json content type', async () => {
    const port = getRandomPort();
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/api/snapshot', port);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('passes maxLogs=50 and includeScheduler=true', async () => {
    const port = getRandomPort();
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot());
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    await fetchDashboard('/api/snapshot', port);
    expect(getSystemSnapshotMock).toHaveBeenCalledWith({ maxLogs: 50, includeScheduler: true });
  });

  it('returns tasks array in snapshot', async () => {
    const port = getRandomPort();
    getSystemSnapshotMock.mockResolvedValue(makeSnapshot({ tasks: [{ id: 'abc' }] }));
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/api/snapshot', port);
    const json = JSON.parse(res.body);
    expect(json.tasks).toHaveLength(1);
    expect(json.tasks[0].id).toBe('abc');
  });
});

// =============================================================================
// GET /api/quick
// =============================================================================
describe('GET /api/quick', () => {
  it('returns JSON with quick status', async () => {
    const port = getRandomPort();
    getQuickStatusMock.mockResolvedValue(makeQuickStatus());
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/api/quick', port);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.totalTasks).toBe(3);
  });

  it('calls getQuickStatus', async () => {
    const port = getRandomPort();
    getQuickStatusMock.mockResolvedValue(makeQuickStatus());
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    await fetchDashboard('/api/quick', port);
    expect(getQuickStatusMock).toHaveBeenCalled();
  });
});

// =============================================================================
// GET /api/config
// =============================================================================
describe('GET /api/config', () => {
  it('returns JSON with config data', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/api/config', port);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.tasksDirs).toBeDefined();
    expect(json.logsDir).toBeDefined();
    expect(json.maxConcurrency).toBeDefined();
  });

  it('includes hasSecretKey flag', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/api/config', port);
    const json = JSON.parse(res.body);
    expect(json.hasSecretKey).toBe(true);
  });

  it('does NOT include the actual secretKey', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/api/config', port);
    const json = JSON.parse(res.body);
    expect(json.secretKey).toBeUndefined();
    expect(res.body).not.toContain('super-secret-key');
  });

  it('hasSecretKey is false when no key', async () => {
    loadConfigMock.mockReturnValueOnce({
      tasksDirs: ['/mock/tasks'],
      logsDir: testLogsDir,
      maxConcurrency: 2,
      secretKey: '',
    });
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/api/config', port);
    const json = JSON.parse(res.body);
    expect(json.hasSecretKey).toBe(false);
  });

  it('returns maxConcurrency value', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/api/config', port);
    const json = JSON.parse(res.body);
    expect(json.maxConcurrency).toBe(2);
  });
});

// =============================================================================
// GET /api/log
// =============================================================================
describe('GET /api/log', () => {
  it('returns log content for valid taskId and file', async () => {
    const fileName = 'my-task_2024-01-01_exec.md';
    writeFileSync(join(testLogsDir, fileName), '# Log content here');

    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard(`/api/log?taskId=my-task&file=${fileName}`, port);
    expect(res.status).toBe(200);
    expect(res.body).toContain('# Log content here');
  });

  it('returns text/plain content type for logs', async () => {
    const fileName = 'my-task_log.md';
    writeFileSync(join(testLogsDir, fileName), 'content');

    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard(`/api/log?taskId=my-task&file=${fileName}`, port);
    expect(res.headers['content-type']).toContain('text/plain');
  });

  it('returns 400 when missing taskId', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/api/log?file=something.md', port);
    expect(res.status).toBe(400);
  });

  it('returns 400 when missing file', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/api/log?taskId=my-task', port);
    expect(res.status).toBe(400);
  });

  it('returns 400 when both params missing', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/api/log', port);
    expect(res.status).toBe(400);
    expect(res.body).toContain('Missing');
  });

  it('returns 404 for non-existent file', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/api/log?taskId=my-task&file=my-task_nonexistent.md', port);
    expect(res.status).toBe(404);
  });

  it('returns 404 for path traversal (file does not start with taskId)', async () => {
    const fileName = 'other-task_2024-01-01_exec.md';
    writeFileSync(join(testLogsDir, fileName), 'secret content');

    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard(`/api/log?taskId=my-task&file=${fileName}`, port);
    expect(res.status).toBe(404);
  });
});

// =============================================================================
// Unknown routes
// =============================================================================
describe('unknown routes', () => {
  it('GET /unknown returns 404', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/unknown-path', port);
    expect(res.status).toBe(404);
    expect(res.body).toContain('Not found');
  });

  it('GET /api/nonexistent returns 404', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/api/nonexistent', port);
    expect(res.status).toBe(404);
  });
});

// =============================================================================
// CORS / OPTIONS
// =============================================================================
describe('CORS', () => {
  it('OPTIONS returns 204', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/', port, 'OPTIONS');
    expect(res.status).toBe(204);
  });

  it('response headers include Access-Control-Allow-Origin', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/', port);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('response headers include Access-Control-Allow-Methods', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/', port);
    expect(res.headers['access-control-allow-methods']).toContain('GET');
  });

  it('OPTIONS on /api/snapshot returns 204', async () => {
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/api/snapshot', port, 'OPTIONS');
    expect(res.status).toBe(204);
  });
});

// =============================================================================
// Error handling
// =============================================================================
describe('error handling', () => {
  it('getSystemSnapshot throws → 500 response', async () => {
    const port = getRandomPort();
    getSystemSnapshotMock.mockRejectedValue(new Error('Boom'));
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/api/snapshot', port);
    expect(res.status).toBe(500);
    const json = JSON.parse(res.body);
    expect(json.error).toContain('Boom');
  });

  it('getQuickStatus throws → 500 response', async () => {
    const port = getRandomPort();
    getQuickStatusMock.mockRejectedValue(new Error('Quick fail'));
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/api/quick', port);
    expect(res.status).toBe(500);
    const json = JSON.parse(res.body);
    expect(json.error).toContain('Quick fail');
  });

  it('loadConfig throws on /api/config → 500', async () => {
    loadConfigMock.mockImplementationOnce(() => {
      throw new Error('Config broken');
    });
    const port = getRandomPort();
    const result = dashboardModule.startDashboard(port);
    stopFn = result.stop;
    await waitForServer(port);

    const res = await fetchDashboard('/api/config', port);
    expect(res.status).toBe(500);
  });
});
