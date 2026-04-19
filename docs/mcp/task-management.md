# Task Management Tools

Tools for creating, configuring, and managing task definitions and their Windows Task Scheduler registrations.

## `cron_create_task` {#cron-create-task}

Create a new scheduled task from a template or custom definition. The task is saved as a markdown file with YAML frontmatter in the configured tasks directory.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `task_id` | `string` | ✓ | — | Unique identifier for the task |
| `instructions` | `string` | ✓ | — | Task instructions in markdown format |
| `schedule` | `string` | — | `"0 9 * * *"` | Cron expression (e.g., `"0 9 * * *"` for 9 AM daily) |
| `invocation` | `"cli"` \| `"api"` | — | `"cli"` | Execution method: `cli` (coding agent CLI) or `api` (Anthropic API) |
| `agent` | `"claude"` \| `"copilot"` | — | `"claude"` | Coding agent to use for CLI execution |
| `enabled` | `boolean` | — | `true` | Enable the task immediately |
| `toast_notifications` | `boolean` | — | `true` | Enable Windows toast notifications |

### Example

```
cron_create_task(
  task_id: "daily-summary",
  schedule: "0 9 * * 1-5",
  instructions: "Summarize all open PRs in the repo and post a comment.",
  agent: "claude",
  invocation: "cli"
)
```

**Response:**

```
✓ Task created successfully: daily-summary

Location: C:\Users\you\.cron-agents\tasks\daily-summary.md

Next step: Register it with:
cron_register_task(task_id="daily-summary")
```

::: tip
After creating a task, register it with [`cron_register_task`](#cron-register-task) to activate it in Windows Task Scheduler.
:::

---

## `cron_get_task` {#cron-get-task}

Get the full definition of a specific task. Returns the schedule, invocation method, agent, enabled state, notification settings, Windows Task Scheduler registration status, and the full markdown instructions.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_id` | `string` | ✓ | Task ID to retrieve |

### Example

```
cron_get_task(task_id: "daily-summary")
```

**Response:**

```
Task: daily-summary

Schedule: 0 9 * * 1-5
Method: cli
Agent: claude
Enabled: ✓
Notifications: toast ✓
Registered: ✓ (Enabled)
Last run: 2024-02-17 09:00:12
Next run: 2024-02-18 09:00:00

--- Definition ---
Summarize all open PRs in the repo and post a comment.
```

---

## `cron_register_task` {#cron-register-task}

Register a task with Windows Task Scheduler. Converts the cron expression into a Task Scheduler trigger, detects the configured agent's CLI path, and creates a scheduled task entry named `CronAgents_<task_id>`.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_id` | `string` | ✓ | Task ID to register |

### Behavior

- The task must already exist (created via `cron_create_task`).
- The task must have a `schedule` defined.
- Uses PowerShell's `Register-ScheduledTask` under the hood.
- The scheduled task runs under the current user's context.

### Example

```
cron_register_task(task_id: "daily-summary")
```

**Response:**

```
✓ Task "daily-summary" registered successfully with Windows Task Scheduler

Schedule: 0 9 * * 1-5
Next run will occur according to the schedule.
```

---

## `cron_unregister_task` {#cron-unregister-task}

Remove a task from Windows Task Scheduler. This does **not** delete the task definition file — only the scheduled trigger is removed. The task can be re-registered later with `cron_register_task`.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_id` | `string` | ✓ | Task ID to unregister |

### Example

```
cron_unregister_task(task_id: "daily-summary")
```

**Response:**

```
✓ Task "daily-summary" unregistered successfully
```

---

## `cron_enable_task` {#cron-enable-task}

Enable a task in Windows Task Scheduler. The task must already be registered.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_id` | `string` | ✓ | Task ID to enable |

### Example

```
cron_enable_task(task_id: "daily-summary")
```

**Response:**

```
✓ Task "daily-summary" enabled
```

---

## `cron_disable_task` {#cron-disable-task}

Disable a task in Windows Task Scheduler. The task remains registered but will not run on schedule until re-enabled.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_id` | `string` | ✓ | Task ID to disable |

### Example

```
cron_disable_task(task_id: "daily-summary")
```

**Response:**

```
✓ Task "daily-summary" disabled
```

---

## `cron_list_tasks` {#cron-list-tasks}

List all tasks across all configured task directories. Shows each task's schedule, invocation method, agent, enabled state, active run status, Task Scheduler registration, and last/next run times.

### Parameters

None.

### Example

```
cron_list_tasks()
```

**Response:**

```
Scheduled Tasks:

📋 daily-summary
   Schedule: 0 9 * * 1-5
   Method: cli
   Agent: claude
   Enabled (file): ✓
   Registered: ✓
   Status: Enabled
   Last run: 2/17/2024 9:00:12 AM
   Next run: 2/18/2024 9:00:00 AM

📋 health-check
   Schedule: */30 * * * *
   Method: api
   Agent: claude
   Enabled (file): ✓
   Run: ⏳ Running (42s, run_id=run-abc123)
   Registered: ✓
   Status: Enabled
   Next run: 2/17/2024 10:30:00 AM

📋 weekly-report
   Schedule: 0 17 * * 5
   Method: cli
   Agent: copilot
   Enabled (file): ✗
   Registered: ✗ (use cron_register_task)
```

::: info
Active runs show their status as 🕐 **Queued** or ⏳ **Running** with elapsed time and run ID.
:::
