# Execution Commands

Commands for running tasks on demand and monitoring their execution.

## `run <task-id>`

Executes a task immediately. Supports two modes: **foreground** (default) and **background**.

### Options

| Option | Description | Default |
| --- | --- | --- |
| `-b, --background` | Run in background and return immediately | foreground |

### Foreground Mode (default)

Runs the task synchronously, blocking the terminal until execution completes.

```bash
cron-agents-cli run morning-summary
```

```
Executing task: morning-summary...

✓ Task execution completed
Log: C:\Users\you\.cron-agents\logs\morning-summary_2025-06-15T09-00-00_exec-abc123.md
```

If the task fails:

```
Executing task: morning-summary...

✗ Task execution failed: Agent process exited with code 1
```

### Background Mode

Returns immediately with a run ID. The task continues executing in the background.

```bash
cron-agents-cli run morning-summary --background
```

```
✓ Task "morning-summary" started in background

Run ID: exec-abc123
Check status: cron-agents run-status --run-id exec-abc123
```

Use [`run-status`](#run-status) to check the outcome.

### Concurrency Behavior

cron-agents enforces a configurable limit on how many tasks can execute simultaneously. When all slots are occupied:

- The task enters a **queued** state instead of running immediately
- Queued tasks automatically start once a slot becomes available
- The CLI reports the queue status:

```bash
cron-agents-cli run health-check --background
```

```
⏳ Task "health-check" queued (3/3 slots in use)

Run ID: exec-def456
Check status: cron-agents run-status --run-id exec-def456
```

In foreground mode, the CLI waits for a slot before starting execution — there is no visible queuing message since the process blocks until the task completes.

See [Concurrency Configuration](/configuration/concurrency) for details on adjusting slot limits.

## `run-status`

Check the status of a task run. You must provide exactly one of the two options:

### Options

| Option | Description |
| --- | --- |
| `-r, --run-id <id>` | Check a specific run by its ID |
| `-t, --task-id <id>` | Check the latest run for a task |

### Examples

Check by run ID:

```bash
cron-agents-cli run-status --run-id exec-abc123
```

Check latest run for a task:

```bash
cron-agents-cli run-status --task-id morning-summary
```

### Output by Status

**🕐 Queued** — waiting for a concurrency slot:

```
Run: exec-def456
Task: health-check
Status: 🕐 queued
Started: 2025-06-15T14:30:00.000Z
Elapsed: 12s (queued)
```

**⏳ Running** — actively executing:

```
Run: exec-abc123
Task: morning-summary
Status: ⏳ running
Started: 2025-06-15T09:00:00.000Z
Elapsed: 45s (running)
```

**✅ Success** — completed successfully:

```
Run: exec-abc123
Task: morning-summary
Status: ✅ success
Started: 2025-06-15T09:00:00.000Z
Finished: 2025-06-15T09:02:30.000Z
Elapsed: 150s
Log: C:\Users\you\.cron-agents\logs\morning-summary_2025-06-15T09-00-00_exec-abc123.md
```

**❌ Failure** — execution failed:

```
Run: exec-def456
Task: health-check
Status: ❌ failure
Started: 2025-06-15T14:30:00.000Z
Finished: 2025-06-15T14:30:15.000Z
Elapsed: 15s
Log: C:\Users\you\.cron-agents\logs\health-check_2025-06-15T14-30-00_exec-def456.md
Error: Agent process exited with code 1
```
