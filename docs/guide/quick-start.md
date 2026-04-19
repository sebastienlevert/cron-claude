# Quick Start

This guide walks you through creating, scheduling, and running your first cron-agents task in about five minutes.

## 1. Create a Task

Use the CLI to scaffold a new task:

```bash
cron-agents-cli create morning-greeting --schedule "0 9 * * *" --agent claude
```

This creates a task file at `~/.cron-agents/tasks/morning-greeting.md` with the following structure:

```markdown
---
id: morning-greeting
schedule: "0 9 * * *"
invocation: cli
agent: claude
notifications:
  toast: true
enabled: true
---

# Task Instructions

Add your task instructions here...
```

::: tip MCP Equivalent
If you're working inside Claude Code, you can use the MCP tool instead:
```
Use cron_create_task with:
  task_id: "morning-greeting"
  schedule: "0 9 * * *"
  agent: "claude"
  instructions: "Your instructions here..."
```
:::

## 2. Edit the Task Instructions

Open the task file and replace the placeholder instructions with what you want the agent to do:

```markdown
---
id: morning-greeting
schedule: "0 9 * * *"
invocation: cli
agent: claude
notifications:
  toast: true
enabled: true
---

# Morning Greeting

Check the current repository for any GitHub issues opened in the last 24 hours.
Summarize each issue in one sentence. If there are no new issues, say so.

Output the summary in this format:

## New Issues (last 24h)

- **#123** — Brief description of the issue
- **#124** — Brief description of the issue

If none: "No new issues in the last 24 hours. 🎉"
```

## 3. Register with Windows Task Scheduler

Register the task so it runs automatically on schedule:

```bash
cron-agents-cli register morning-greeting
```

You should see:

```
✓ Task "morning-greeting" registered with Windows Task Scheduler
  Schedule: 0 9 * * * (daily at 9:00 AM)
  Next run: 2024-02-18T09:00:00
```

::: tip MCP Equivalent
```
Use cron_register_task with:
  task_id: "morning-greeting"
```
:::

## 4. Verify the Task

List all tasks to confirm registration:

```bash
cron-agents-cli list
```

Expected output:

```
Tasks:
  morning-greeting
    Schedule:  0 9 * * * (daily at 9:00 AM)
    Agent:     claude
    Enabled:   true
    Scheduler: registered
```

::: tip MCP Equivalent
```
Use cron_list_tasks (no parameters needed)
```
:::

## 5. Test Run

Don't wait for the schedule — run the task immediately to test it:

```bash
cron-agents-cli run morning-greeting
```

The CLI will execute the task using your chosen agent and display the result:

```
▶ Running task "morning-greeting" with Claude Code...
✓ Task completed successfully
  Run ID:  exec-a1b2c3d4
  Log:     ~/.cron-agents/logs/morning-greeting_2024-02-17T15-30-00_exec-a1b2c3d4.md
```

::: tip MCP Equivalent
```
Use cron_run_task with:
  task_id: "morning-greeting"
```
:::

## 6. Check the Logs

View the execution log for your task:

```bash
cron-agents-cli logs morning-greeting
```

This shows recent execution logs, including:
- Timestamps and execution IDs
- Success or failure status
- Agent output
- HMAC-SHA256 signature for verification

::: tip MCP Equivalent
```
Use cron_view_logs with:
  task_id: "morning-greeting"
```
:::

## Full CLI ↔ MCP Reference

| Step | CLI Command | MCP Tool |
| --- | --- | --- |
| Create task | `cron-agents-cli create <id> [options]` | `cron_create_task` |
| Register | `cron-agents-cli register <id>` | `cron_register_task` |
| List tasks | `cron-agents-cli list` | `cron_list_tasks` |
| Run task | `cron-agents-cli run <id>` | `cron_run_task` |
| View logs | `cron-agents-cli logs <id>` | `cron_view_logs` |
| Get task details | `cron-agents-cli get <id>` | `cron_get_task` |
| Enable task | `cron-agents-cli enable <id>` | `cron_enable_task` |
| Disable task | `cron-agents-cli disable <id>` | `cron_disable_task` |
| Unregister | `cron-agents-cli unregister <id>` | `cron_unregister_task` |
| Verify log | `cron-agents-cli verify <log-content>` | `cron_verify_log` |
| System status | `cron-agents-cli status` | `cron_status` |

## Next Steps

- **[Core Concepts](./concepts.md)** — Understand tasks, agents, scheduling, concurrency, and audit logging
- **[CLI Reference](/cli/)** — Full CLI command documentation
- **[MCP Tools](/mcp/)** — Detailed MCP tool reference
