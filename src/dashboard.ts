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
import { analyzeProductivity } from './analytics.js';

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

        case '/api/analytics': {
          const analyticsDays = parseInt(url.searchParams.get('days') || '30') || 30;
          const analyticsTask = url.searchParams.get('taskId') || undefined;
          const report = analyzeProductivity({ days: analyticsDays, taskId: analyticsTask });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(report));
          break;
        }

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
export function getDashboardHTML(): string {
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
  .dot.red { background: #da3633; }

  /* Tabs */
  .tabs { display: flex; gap: 0; margin-bottom: 24px; border-bottom: 2px solid #21262d; }
  .tab { padding: 10px 20px; font-size: 14px; font-weight: 500; color: #8b949e; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: color 0.2s, border-color 0.2s; }
  .tab:hover { color: #c9d1d9; }
  .tab.active { color: #58a6ff; border-bottom-color: #58a6ff; }
  .tab-content { display: none; }
  .tab-content.active { display: block; }

  /* Cards */
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 16px; }
  .card .label { font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }
  .card .value { font-size: 28px; font-weight: 600; margin-top: 4px; }
  .card .sub { font-size: 12px; color: #8b949e; margin-top: 2px; }
  .card .value.green { color: #3fb950; }
  .card .value.yellow { color: #d29922; }
  .card .value.red { color: #da3633; }
  .card .value.blue { color: #58a6ff; }

  /* Tables */
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
  .badge.critical { background: #da3633; color: #fff; }
  .badge.warning { background: #d29922; color: #0d1117; }
  .badge.info { background: #388bfd; color: #fff; }
  .deps { font-size: 12px; color: #8b949e; }
  .refresh-info { text-align: center; color: #484f58; font-size: 12px; margin-top: 16px; }
  .log-preview { max-height: 200px; overflow-y: auto; background: #161b22; padding: 12px; border-radius: 8px; font-family: monospace; font-size: 12px; white-space: pre-wrap; word-wrap: break-word; border: 1px solid #21262d; }

  /* Analytics specific */
  .analytics-controls { display: flex; gap: 12px; align-items: center; margin-bottom: 20px; }
  .analytics-controls label { font-size: 13px; color: #8b949e; }
  .analytics-controls select, .analytics-controls input {
    background: #161b22; border: 1px solid #30363d; color: #c9d1d9; padding: 6px 10px; border-radius: 6px; font-size: 13px;
  }
  .analytics-controls button {
    background: #238636; color: #fff; border: none; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500;
  }
  .analytics-controls button:hover { background: #2ea043; }

  .insight-row { display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px; border-radius: 8px; margin-bottom: 8px; font-size: 14px; }
  .insight-row.success-type { background: rgba(56, 159, 80, 0.1); border: 1px solid rgba(56, 159, 80, 0.2); }
  .insight-row.warning-type { background: rgba(210, 153, 34, 0.1); border: 1px solid rgba(210, 153, 34, 0.2); }
  .insight-row.info-type { background: rgba(56, 139, 253, 0.1); border: 1px solid rgba(56, 139, 253, 0.2); }
  .insight-icon { font-size: 18px; flex-shrink: 0; }
  .health-rec { font-size: 12px; color: #8b949e; margin-top: 4px; }

  /* Charts */
  .chart-container { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
  .chart-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; color: #e6edf3; }
  .bar-chart { display: flex; align-items: flex-end; gap: 2px; height: 120px; padding-top: 4px; }
  .bar-group { display: flex; flex-direction: column; align-items: center; flex: 1; min-width: 0; }
  .bar { width: 100%; min-width: 4px; border-radius: 2px 2px 0 0; transition: height 0.3s; position: relative; }
  .bar:hover { opacity: 0.8; }
  .bar.success-bar { background: #238636; }
  .bar.failure-bar { background: #da3633; }
  .bar-label { font-size: 9px; color: #484f58; margin-top: 4px; writing-mode: vertical-lr; text-orientation: mixed; max-height: 40px; overflow: hidden; }
  .hour-chart { display: flex; align-items: flex-end; gap: 1px; height: 80px; }
  .hour-bar { flex: 1; border-radius: 2px 2px 0 0; min-width: 0; transition: height 0.3s; }
  .hour-label { font-size: 9px; color: #484f58; text-align: center; margin-top: 2px; }
  .hour-group { display: flex; flex-direction: column; align-items: center; flex: 1; min-width: 0; }

  /* Progress ring */
  .ring-container { display: flex; align-items: center; justify-content: center; }
  .ring-svg { transform: rotate(-90deg); }
  .ring-bg { fill: none; stroke: #21262d; }
  .ring-fg { fill: none; stroke-linecap: round; transition: stroke-dashoffset 0.6s ease; }
  .ring-text { font-size: 22px; font-weight: 700; fill: #c9d1d9; text-anchor: middle; dominant-baseline: central; }
  .ring-label { font-size: 10px; fill: #8b949e; text-anchor: middle; }

  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  @media (max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } }

  .trend-icon { font-size: 14px; }
  .streak-badge { font-size: 12px; padding: 2px 6px; border-radius: 4px; }
  .streak-badge.success-streak { background: rgba(56,159,80,0.2); color: #3fb950; }
  .streak-badge.failure-streak { background: rgba(218,54,51,0.2); color: #f85149; }

  .no-data { text-align: center; padding: 40px; color: #484f58; font-size: 14px; }
</style>
</head>
<body>
<div class="header">
  <h1>⏰ cron-agents</h1>
  <div class="status"><span class="dot green" id="statusDot"></span><span id="statusText">Connecting...</span></div>
</div>

<div class="tabs">
  <div class="tab active" data-tab="overview">Overview</div>
  <div class="tab" data-tab="analytics">📊 Analytics</div>
</div>

<!-- ═══ Overview Tab ═══ -->
<div class="tab-content active" id="tab-overview">
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
</div>

<!-- ═══ Analytics Tab ═══ -->
<div class="tab-content" id="tab-analytics">
  <div class="analytics-controls">
    <label>Period:</label>
    <select id="analyticsDays">
      <option value="7">Last 7 days</option>
      <option value="14">Last 14 days</option>
      <option value="30" selected>Last 30 days</option>
      <option value="60">Last 60 days</option>
      <option value="90">Last 90 days</option>
    </select>
    <label>Task:</label>
    <select id="analyticsTask"><option value="">All tasks</option></select>
    <button onclick="loadAnalytics()">Refresh</button>
  </div>

  <div id="analyticsContent"><div class="no-data">Loading analytics...</div></div>
</div>

<div class="refresh-info">Overview auto-refreshes every 5 seconds</div>

<script>
// ── Tab switching ──
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'analytics' && !analyticsLoaded) loadAnalytics();
  });
});

// ── Overview refresh ──
async function refresh() {
  try {
    const res = await fetch('/api/snapshot');
    const data = await res.json();
    renderOverview(data);
    document.getElementById('statusDot').className = 'dot green';
    document.getElementById('statusText').textContent = 'Connected \\u2022 ' + new Date(data.timestamp).toLocaleTimeString();
    populateTaskFilter(data.tasks);
  } catch (e) {
    document.getElementById('statusDot').className = 'dot yellow';
    document.getElementById('statusText').textContent = 'Error: ' + e.message;
  }
}

function renderOverview(snapshot) {
  document.getElementById('totalTasks').textContent = snapshot.tasks.length;
  document.getElementById('running').textContent = snapshot.concurrency.running;
  document.getElementById('queued').textContent = snapshot.concurrency.queued;
  document.getElementById('maxConc').textContent = snapshot.concurrency.maxConcurrency;

  const tbody = document.getElementById('taskTable');
  tbody.innerHTML = snapshot.tasks.map(t => {
    const status = t.latestRun ? t.latestRun.status : 'none';
    const elapsed = t.latestRun ? t.latestRun.elapsed + 's' : '-';
    const deps = (t.dependsOn || []).join(', ') || '-';
    return '<tr>' +
      '<td><strong>' + esc(t.id) + '</strong></td>' +
      '<td><code>' + esc(t.schedule) + '</code></td>' +
      '<td>' + esc(t.agent) + '</td>' +
      '<td><span class="badge ' + (t.enabled ? 'enabled' : 'disabled') + '">' + (t.enabled ? 'Yes' : 'No') + '</span></td>' +
      '<td>' + elapsed + '</td>' +
      '<td><span class="badge ' + status + '">' + status + '</span></td>' +
      '<td class="deps">' + esc(deps) + '</td></tr>';
  }).join('');

  const logBody = document.getElementById('logTable');
  logBody.innerHTML = snapshot.recentLogs.slice(0, 20).map(l => {
    const time = l.timestamp ? new Date(l.timestamp).toLocaleString() : '-';
    return '<tr>' +
      '<td>' + time + '</td>' +
      '<td>' + esc(l.taskId) + '</td>' +
      '<td><span class="badge ' + l.status + '">' + l.status + '</span></td>' +
      '<td style="font-size:12px;color:#8b949e">' + esc(l.fileName) + '</td></tr>';
  }).join('');
}

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// ── Analytics ──
let analyticsLoaded = false;

function populateTaskFilter(tasks) {
  const sel = document.getElementById('analyticsTask');
  const current = sel.value;
  const opts = '<option value="">All tasks</option>' + tasks.map(t =>
    '<option value="' + esc(t.id) + '"' + (t.id === current ? ' selected' : '') + '>' + esc(t.id) + '</option>'
  ).join('');
  sel.innerHTML = opts;
}

async function loadAnalytics() {
  const days = document.getElementById('analyticsDays').value;
  const taskId = document.getElementById('analyticsTask').value;
  const container = document.getElementById('analyticsContent');
  container.innerHTML = '<div class="no-data">Loading analytics...</div>';

  try {
    const params = new URLSearchParams({ days });
    if (taskId) params.set('taskId', taskId);
    const res = await fetch('/api/analytics?' + params);
    const report = await res.json();
    renderAnalytics(report);
    analyticsLoaded = true;
  } catch (e) {
    container.innerHTML = '<div class="no-data">Failed to load analytics: ' + esc(e.message) + '</div>';
  }
}

function renderAnalytics(r) {
  const container = document.getElementById('analyticsContent');
  const s = r.summary;

  if (s.totalRuns === 0) {
    container.innerHTML = '<div class="no-data">No task executions found in this period.<br>Run some tasks and check back!</div>';
    return;
  }

  const rateColor = s.successRate >= 95 ? 'green' : s.successRate >= 80 ? 'yellow' : 'red';
  const rateStroke = s.successRate >= 95 ? '#3fb950' : s.successRate >= 80 ? '#d29922' : '#da3633';

  let html = '';

  // Summary cards with success ring
  html += '<div class="cards" style="grid-template-columns: 200px repeat(auto-fit, minmax(160px, 1fr));">';

  // Success rate ring
  const circumference = 2 * Math.PI * 45;
  const offset = circumference - (s.successRate / 100) * circumference;
  html += '<div class="card" style="grid-row: span 2; display:flex; flex-direction:column; align-items:center; justify-content:center;">';
  html += '<div class="label" style="margin-bottom:8px">Success Rate</div>';
  html += '<svg class="ring-svg" width="120" height="120" viewBox="0 0 120 120">';
  html += '<circle class="ring-bg" cx="60" cy="60" r="45" stroke-width="10"/>';
  html += '<circle class="ring-fg" cx="60" cy="60" r="45" stroke-width="10" stroke="' + rateStroke + '" stroke-dasharray="' + circumference + '" stroke-dashoffset="' + offset + '"/>';
  html += '<text class="ring-text" x="60" y="55" transform="rotate(90 60 60)">' + s.successRate + '%</text>';
  html += '<text class="ring-label" x="60" y="74" transform="rotate(90 60 60)">' + s.successes + ' / ' + s.totalRuns + '</text>';
  html += '</svg></div>';

  html += '<div class="card"><div class="label">Total Runs</div><div class="value blue">' + s.totalRuns + '</div><div class="sub">' + s.runsPerDay + ' / day</div></div>';
  html += '<div class="card"><div class="label">Unique Tasks</div><div class="value">' + s.uniqueTasks + '</div></div>';
  html += '<div class="card"><div class="label">Failures</div><div class="value ' + (s.failures > 0 ? 'red' : 'green') + '">' + s.failures + '</div></div>';
  html += '<div class="card"><div class="label">Avg Duration</div><div class="value">' + fmtDur(s.avgDurationSec) + '</div><div class="sub">med ' + fmtDur(s.medianDurationSec) + ' · p95 ' + fmtDur(s.p95DurationSec) + '</div></div>';
  html += '<div class="card"><div class="label">Total Exec Time</div><div class="value">' + fmtDur(s.totalDurationSec) + '</div></div>';
  html += '<div class="card"><div class="label">Period</div><div class="value" style="font-size:16px">' + r.period.from.split("T")[0] + '</div><div class="sub">→ ' + r.period.to.split("T")[0] + ' (' + r.period.days + 'd)</div></div>';
  html += '</div>';

  // Charts row
  html += '<div class="grid-2">';

  // Daily activity chart
  html += '<div class="chart-container"><div class="chart-title">Daily Activity</div>';
  if (r.dailyActivity.length > 0) {
    const maxDay = Math.max(...r.dailyActivity.map(d => d.runs), 1);
    html += '<div class="bar-chart">';
    // Show max ~60 bars, thin them out if too many
    const step = r.dailyActivity.length > 60 ? Math.ceil(r.dailyActivity.length / 60) : 1;
    for (let i = 0; i < r.dailyActivity.length; i += step) {
      const d = r.dailyActivity[i];
      const sH = Math.max(1, (d.successes / maxDay) * 110);
      const fH = Math.max(0, (d.failures / maxDay) * 110);
      const showLabel = i % Math.max(1, Math.floor(r.dailyActivity.length / 8)) < step;
      html += '<div class="bar-group" title="' + d.date + ': ' + d.successes + ' ok, ' + d.failures + ' fail">';
      html += '<div style="display:flex;flex-direction:column;align-items:center;height:110px;justify-content:flex-end">';
      if (d.failures > 0) html += '<div class="bar failure-bar" style="height:' + fH + 'px;width:100%"></div>';
      if (d.successes > 0) html += '<div class="bar success-bar" style="height:' + sH + 'px;width:100%"></div>';
      if (d.runs === 0) html += '<div style="height:1px;width:100%;background:#21262d"></div>';
      html += '</div>';
      if (showLabel) html += '<div class="bar-label">' + d.date.slice(5) + '</div>';
      html += '</div>';
    }
    html += '</div>';
  }
  html += '</div>';

  // Peak hours chart
  html += '<div class="chart-container"><div class="chart-title">Activity by Hour</div>';
  const maxH = Math.max(...r.peakHours, 1);
  html += '<div class="hour-chart">';
  for (let h = 0; h < 24; h++) {
    const count = r.peakHours[h];
    const barH = Math.max(0, (count / maxH) * 70);
    const intensity = count / maxH;
    const color = count === 0 ? '#21262d' : intensity > 0.7 ? '#d29922' : intensity > 0.3 ? '#3fb950' : '#238636';
    html += '<div class="hour-group" title="' + String(h).padStart(2,'0') + ':00 — ' + count + ' runs">';
    html += '<div class="hour-bar" style="height:' + Math.max(2, barH) + 'px;background:' + color + '"></div>';
    if (h % 3 === 0) html += '<div class="hour-label">' + String(h).padStart(2,'0') + '</div>';
    html += '</div>';
  }
  html += '</div></div>';
  html += '</div>'; // end grid-2

  // Insights
  if (r.insights.length > 0) {
    html += '<div class="section"><h2>Insights</h2>';
    for (const ins of r.insights) {
      html += '<div class="insight-row ' + ins.type + '-type">';
      html += '<span class="insight-icon">' + ins.icon + '</span>';
      html += '<span>' + esc(ins.message) + '</span>';
      html += '</div>';
    }
    html += '</div>';
  }

  // Health checks
  if (r.healthChecks.length > 0) {
    html += '<div class="section"><h2>Health Checks</h2>';
    html += '<table><thead><tr><th>Severity</th><th>Task</th><th>Issue</th><th>Recommendation</th></tr></thead><tbody>';
    for (const c of r.healthChecks) {
      const icon = c.severity === 'critical' ? '🔴' : c.severity === 'warning' ? '🟡' : '🔵';
      html += '<tr>';
      html += '<td><span class="badge ' + c.severity + '">' + icon + ' ' + c.severity + '</span></td>';
      html += '<td><strong>' + esc(c.taskId) + '</strong></td>';
      html += '<td>' + esc(c.message) + '</td>';
      html += '<td style="font-size:12px;color:#8b949e">' + esc(c.recommendation) + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table></div>';
  }

  // Per-task metrics table
  if (r.taskMetrics.length > 0) {
    html += '<div class="section"><h2>Per-Task Metrics</h2>';
    html += '<table><thead><tr><th>Task</th><th>Runs</th><th>Success Rate</th><th>Avg</th><th>Median</th><th>P95</th><th>Retries</th><th>Streak</th><th>Trend</th></tr></thead><tbody>';
    for (const m of r.taskMetrics) {
      const rc = m.successRate >= 95 ? 'green' : m.successRate >= 80 ? 'yellow' : 'red';
      const trendIcon = m.trend === 'improving' ? '📈' : m.trend === 'declining' ? '📉' : m.trend === 'stable' ? '→' : '—';
      const streakCls = m.currentStreak.type === 'success' ? 'success-streak' : 'failure-streak';
      const streakSym = m.currentStreak.type === 'success' ? '✓' : '✗';
      html += '<tr>';
      html += '<td><strong>' + esc(m.taskId) + '</strong></td>';
      html += '<td>' + m.runs + '</td>';
      html += '<td><span class="badge ' + (m.successRate >= 95 ? 'success' : m.successRate >= 80 ? 'warning' : 'failure') + '">' + m.successRate + '%</span></td>';
      html += '<td>' + fmtDur(m.avgDurationSec) + '</td>';
      html += '<td>' + fmtDur(m.medianDurationSec) + '</td>';
      html += '<td>' + fmtDur(m.p95DurationSec) + '</td>';
      html += '<td>' + (m.retryRate > 0 ? m.retryRate + '%' : '-') + '</td>';
      html += '<td><span class="streak-badge ' + streakCls + '">' + streakSym + ' ' + m.currentStreak.count + '</span></td>';
      html += '<td class="trend-icon">' + trendIcon + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table></div>';
  }

  // Data quality footer
  const dq = r.dataQuality;
  if (dq.corruptOrInvalid > 0) {
    html += '<div style="text-align:center;color:#484f58;font-size:12px;margin-top:12px">Data: ' + dq.parsedSuccessfully + ' logs parsed, ' + dq.corruptOrInvalid + ' excluded (corrupt/invalid)</div>';
  }

  container.innerHTML = html;
}

function fmtDur(sec) {
  if (!sec || sec <= 0) return '0s';
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ' + (sec % 60) + 's';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h + 'h ' + m + 'm';
}

refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
}
