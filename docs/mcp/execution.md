# Execution & Monitoring Tools

Tools for running tasks on demand and tracking their execution status and logs.

## `cron_run_task` {#cron-run-task}

Execute a task immediately, independent of its schedule. The tool is **fire-and-forget** — it creates a persistent run record, respects concurrency limits, and returns immediately with a run ID for status tracking.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_id` | `string` | ✓ | Task ID to run |

### Behavior

- If a concurrency slot is available, execution starts immediately with status **running**.
- If no slot is available, the run is **queued** in FIFO order and waits up to 15 minutes for a slot.
- Returns a `run_id` that can be used with [`cron_get_run_status`](#cron-get-run-status) to check progress.
- The task definition file must exist.

### Example

```
cron_run_task(task_id: "daily-summary")
```

**Response:**

```
🚀 Task "daily-summary" started (run_id: run-abc123)

The task is now running in the background.
Check status with: cron_get_run_status(run_id="run-abc123")
```

If queued:

```
🕐 Task "daily-summary" queued (run_id: run-abc123)

All concurrency slots are in use. The task will start when a slot becomes available.
Check status with: cron_get_run_status(run_id="run-abc123")
```

::: tip
Use `cron_get_run_status` to poll for completion, or `cron_view_logs` after the run finishes to review the output.
:::

---

## `cron_get_run_status` {#cron-get-run-status}

Check the status of an async task run. Provide either `run_id` for a specific run, or `task_id` to get the latest run for that task.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `run_id` | `string` | — | The run ID returned by `cron_run_task` |
| `task_id` | `string` | — | Task ID to get the latest run status for (alternative to `run_id`) |

::: warning
At least one of `run_id` or `task_id` must be provided. If both are provided, `run_id` takes precedence.
:::

### Status Icons

| Icon | Status | Description |
|------|--------|-------------|
| 🕐 | `queued` | Waiting for a concurrency slot |
| ⏳ | `running` | Currently executing |
| ✅ | `success` | Completed successfully |
| ❌ | `failure` | Completed with errors |

### Example

```
cron_get_run_status(run_id: "run-abc123")
```

**Response:**

```
Run Status:
  Run ID: run-abc123
  Task: daily-summary
  Status: ✅ success
  Started: 2024-02-17T09:00:00.000Z
  Finished: 2024-02-17T09:02:34.000Z
  Elapsed: 154s
  Log: daily-summary_2024-02-17T09-00-00_run-abc123.md
```

For a running task:

```
Run Status:
  Run ID: run-abc123
  Task: daily-summary
  Status: ⏳ running
  Started: 2024-02-17T09:00:00.000Z
  Elapsed: 42s
```

---

## `cron_view_logs` {#cron-view-logs}

View execution logs for a task. Shows the 10 most recent log entries with filename, execution status, and timestamp.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_id` | `string` | ✓ | Task ID to view logs for |

### Example

```
cron_view_logs(task_id: "daily-summary")
```

**Response:**

```
Logs for task "daily-summary" (showing 10 most recent):

  ✅ daily-summary_2024-02-17T09-00-00_run-abc123.md
     Status: success | 2024-02-17T09:00:00Z

  ✅ daily-summary_2024-02-16T09-00-00_run-def456.md
     Status: success | 2024-02-16T09:00:00Z

  ❌ daily-summary_2024-02-15T09-00-00_run-ghi789.md
     Status: failure | 2024-02-15T09:00:00Z
```

::: tip
To verify that a log file has not been tampered with, use [`cron_verify_log`](./verification#cron-verify-log) with the full log content.
:::
