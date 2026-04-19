# Task Management Commands

Commands for creating, inspecting, and managing the lifecycle of scheduled tasks.

## `create <task-id>`

Creates a new task definition file in the primary tasks directory.

### Options

| Option | Description | Default |
| --- | --- | --- |
| `-s, --schedule <cron>` | Cron schedule expression | `"0 9 * * *"` |
| `-a, --agent <agent>` | Coding agent: `claude` or `copilot` | `claude` |
| `-m, --method <method>` | Invocation method: `cli` or `api` | `cli` |
| `--no-toast` | Disable toast notifications | enabled |

### Examples

Create a task with default settings (daily at 9 AM, Claude, CLI mode):

```bash
cron-agents-cli create morning-summary
```

```
✓ Task "morning-summary" created
  Location: C:\Users\you\.cron-agents\tasks\morning-summary.md
  Agent: claude
  Schedule: 0 9 * * *

Next steps:
  1. Edit the task file to add your instructions
  2. Run: cron-agents register morning-summary
```

Create a task with custom options:

```bash
cron-agents-cli create health-check --schedule "*/30 * * * *" --agent copilot --no-toast
```

```
✓ Task "health-check" created
  Location: C:\Users\you\.cron-agents\tasks\health-check.md
  Agent: copilot
  Schedule: */30 * * * *

Next steps:
  1. Edit the task file to add your instructions
  2. Run: cron-agents register health-check
```

::: tip
The created task file contains a placeholder for instructions. Open the file and replace the placeholder with your actual task instructions in markdown format before registering.
:::

## `get <task-id>`

Displays the full task definition including its configuration, registration status, and instructions.

### Example

```bash
cron-agents-cli get morning-summary
```

```
Task: morning-summary

Schedule: 0 9 * * *
Method: cli
Agent: claude
Enabled: ✓
Notifications: Toast
Registered: ✓
File: C:\Users\you\.cron-agents\tasks\morning-summary.md

--- Instructions ---

# Morning Summary

Summarize the latest Git commits and open pull requests
for the current repository. Post a brief status update.
```

## `register <task-id>`

Registers a task with Windows Task Scheduler so it runs automatically on its configured schedule.

```bash
cron-agents-cli register morning-summary
```

The command:

- Reads the task definition to determine the agent and schedule
- Detects the agent CLI path automatically (e.g., `claude` or `copilot` in PATH)
- Creates a scheduled task named `CronAgents_<task-id>` in Windows Task Scheduler
- Passes the agent from the task definition to the executor

::: warning
Registration may require elevated (administrator) privileges depending on your Windows Task Scheduler configuration. If the command fails with a permissions error, try running your terminal as Administrator.
:::

## `unregister <task-id>`

Removes the task from Windows Task Scheduler. This command has the alias `delete`.

```bash
cron-agents-cli unregister morning-summary
# or equivalently:
cron-agents-cli delete morning-summary
```

::: info
This only removes the Task Scheduler registration. The task definition file is **not** deleted and can be re-registered at any time with `register`.
:::

## `enable <task-id>`

Enables a previously disabled task in Windows Task Scheduler.

```bash
cron-agents-cli enable morning-summary
```

## `disable <task-id>`

Disables a task in Windows Task Scheduler. The task remains registered but will not run on its schedule until re-enabled.

```bash
cron-agents-cli disable morning-summary
```

## `list`

Lists all tasks from all configured task directories. Shows each task's configuration, active run status, and Task Scheduler registration details.

```bash
cron-agents-cli list
```

### Example Output

```
Scheduled Tasks:

📋 morning-summary
   Schedule: 0 9 * * *
   Method: cli
   Agent: claude
   Enabled (file): ✓
   Registered: ✓
   Status: Enabled
   Last run: 6/15/2025 9:00:00 AM
   Next run: 6/16/2025 9:00:00 AM

📋 health-check
   Schedule: */30 * * * *
   Method: cli
   Agent: copilot
   Enabled (file): ✓
   Run: ⏳ Running (45s, run_id=exec-abc123)
   Registered: ✓
   Status: Enabled
   Last run: 6/15/2025 2:30:00 PM
   Next run: 6/15/2025 3:00:00 PM

📋 weekly-report
   Schedule: 0 18 * * 5
   Method: api
   Agent: claude
   Enabled (file): ✗
   Registered: ✗ (run 'cron-agents register weekly-report')
```

Active runs are shown with their current state:

- **⏳ Running** — Task is actively executing, with elapsed time and run ID
- **🕐 Queued** — Task is waiting for a concurrency slot, with elapsed time and run ID
