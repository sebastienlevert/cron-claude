/**
 * Web dashboard for cron-agents.
 * Lightweight HTTP server serving a single-page status UI.
 * Consumes the shared monitoring module for consistent data.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getSystemSnapshot, getQuickStatus } from './monitoring.js';
import { loadConfig } from './config.js';

const DEFAULT_PORT = 7890;

/**
 * Start the dashboard HTTP server.
 * Returns an object with the server instance and a stop function.
 */
export function startDashboard(port: number = DEFAULT_PORT): {
  server: ReturnType<typeof createServer>;
  url: string;
  stop: () => Promise<void>;
} {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    try {
      // CORS for local dev
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      switch (url.pathname) {
        case '/':
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(getDashboardHTML());
          break;

        case '/api/snapshot':
          const snapshot = await getSystemSnapshot({ maxLogs: 50, includeScheduler: true });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(snapshot));
          break;

        case '/api/quick':
          const quick = await getQuickStatus();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(quick));
          break;

        case '/api/config':
          const config = loadConfig();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            tasksDirs: config.tasksDirs,
            logsDir: config.logsDir,
            maxConcurrency: config.maxConcurrency,
            hasSecretKey: !!config.secretKey,
          }));
          break;

        case '/api/log':
          const taskId = url.searchParams.get('taskId');
          const fileName = url.searchParams.get('file');
          if (taskId && fileName) {
            const config2 = loadConfig();
            const logPath = join(config2.logsDir, fileName);
            if (existsSync(logPath) && fileName.startsWith(taskId)) {
              const content = readFileSync(logPath, 'utf-8');
              res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
              res.end(content);
            } else {
              res.writeHead(404);
              res.end('Log not found');
            }
          } else {
            res.writeHead(400);
            res.end('Missing taskId or file parameter');
          }
          break;

        default:
          res.writeHead(404);
          res.end('Not found');
      }
    } catch (err) {
      console.error('Dashboard error:', err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  server.listen(port);
  const serverUrl = `http://localhost:${port}`;

  return {
    server,
    url: serverUrl,
    stop: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
  };
}

/**
 * Returns the full dashboard HTML as a single self-contained page
 */
function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>cron-agents Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 20px; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #21262d; }
  .header h1 { font-size: 24px; color: #58a6ff; }
  .header .status { font-size: 14px; color: #8b949e; }
  .header .status .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .dot.green { background: #3fb950; }
  .dot.yellow { background: #d29922; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 16px; }
  .card .label { font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }
  .card .value { font-size: 28px; font-weight: 600; margin-top: 4px; }
  .card .value.green { color: #3fb950; }
  .card .value.yellow { color: #d29922; }
  .card .value.blue { color: #58a6ff; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 10px 12px; font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #21262d; }
  td { padding: 10px 12px; border-bottom: 1px solid #21262d; font-size: 14px; }
  tr:hover { background: #161b22; }
  .section { margin-bottom: 24px; }
  .section h2 { font-size: 18px; margin-bottom: 12px; color: #e6edf3; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 500; }
  .badge.running { background: #d29922; color: #0d1117; }
  .badge.queued { background: #58a6ff; color: #0d1117; }
  .badge.success { background: #238636; color: #fff; }
  .badge.failure { background: #da3633; color: #fff; }
  .badge.disabled { background: #484f58; color: #8b949e; }
  .badge.enabled { background: #1f6feb; color: #fff; }
  .concurrency-bar { display: flex; gap: 4px; margin-top: 8px; }
  .slot { width: 30px; height: 20px; border-radius: 4px; border: 1px solid #30363d; }
  .slot.used { background: #d29922; border-color: #d29922; }
  .slot.free { background: #21262d; }
  .deps { font-size: 12px; color: #8b949e; }
  .refresh-info { text-align: center; color: #484f58; font-size: 12px; margin-top: 16px; }
  .log-preview { max-height: 200px; overflow-y: auto; background: #161b22; padding: 12px; border-radius: 8px; font-family: monospace; font-size: 12px; white-space: pre-wrap; word-wrap: break-word; border: 1px solid #21262d; }
</style>
</head>
<body>
<div class="header">
  <h1>⏰ cron-agents</h1>
  <div class="status"><span class="dot green" id="statusDot"></span><span id="statusText">Connecting...</span></div>
</div>

<div class="cards" id="cards">
  <div class="card"><div class="label">Tasks</div><div class="value blue" id="totalTasks">-</div></div>
  <div class="card"><div class="label">Running</div><div class="value yellow" id="running">-</div></div>
  <div class="card"><div class="label">Queued</div><div class="value blue" id="queued">-</div></div>
  <div class="card"><div class="label">Max Concurrency</div><div class="value" id="maxConc">-</div></div>
</div>

<div class="section">
  <h2>Tasks</h2>
  <table>
    <thead><tr><th>ID</th><th>Schedule</th><th>Agent</th><th>Enabled</th><th>Last Run</th><th>Status</th><th>Deps</th></tr></thead>
    <tbody id="taskTable"></tbody>
  </table>
</div>

<div class="section">
  <h2>Recent Logs</h2>
  <table>
    <thead><tr><th>Time</th><th>Task</th><th>Status</th><th>File</th></tr></thead>
    <tbody id="logTable"></tbody>
  </table>
</div>

<div class="refresh-info">Auto-refreshes every 5 seconds</div>

<script>
async function refresh() {
  try {
    const res = await fetch('/api/snapshot');
    const data = await res.json();
    render(data);
    document.getElementById('statusDot').className = 'dot green';
    document.getElementById('statusText').textContent = 'Connected • ' + new Date(data.timestamp).toLocaleTimeString();
  } catch (e) {
    document.getElementById('statusDot').className = 'dot yellow';
    document.getElementById('statusText').textContent = 'Error: ' + e.message;
  }
}

function render(snapshot) {
  document.getElementById('totalTasks').textContent = snapshot.tasks.length;
  document.getElementById('running').textContent = snapshot.concurrency.running;
  document.getElementById('queued').textContent = snapshot.concurrency.queued;
  document.getElementById('maxConc').textContent = snapshot.concurrency.maxConcurrency;

  // Tasks table
  const tbody = document.getElementById('taskTable');
  tbody.innerHTML = snapshot.tasks.map(t => {
    const status = t.latestRun ? t.latestRun.status : 'none';
    const elapsed = t.latestRun ? t.latestRun.elapsed + 's' : '-';
    const deps = (t.dependsOn || []).join(', ') || '-';
    return '<tr>' +
      '<td><strong>' + t.id + '</strong></td>' +
      '<td><code>' + t.schedule + '</code></td>' +
      '<td>' + t.agent + '</td>' +
      '<td><span class="badge ' + (t.enabled ? 'enabled' : 'disabled') + '">' + (t.enabled ? 'Yes' : 'No') + '</span></td>' +
      '<td>' + elapsed + '</td>' +
      '<td><span class="badge ' + status + '">' + status + '</span></td>' +
      '<td class="deps">' + deps + '</td>' +
      '</tr>';
  }).join('');

  // Logs table
  const logBody = document.getElementById('logTable');
  logBody.innerHTML = snapshot.recentLogs.slice(0, 20).map(l => {
    const time = l.timestamp ? new Date(l.timestamp).toLocaleString() : '-';
    return '<tr>' +
      '<td>' + time + '</td>' +
      '<td>' + l.taskId + '</td>' +
      '<td><span class="badge ' + l.status + '">' + l.status + '</span></td>' +
      '<td style="font-size:12px;color:#8b949e">' + l.fileName + '</td>' +
      '</tr>';
  }).join('');
}

refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
}
