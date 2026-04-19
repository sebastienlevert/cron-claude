# MCP Tools Reference

The **cron-agents** MCP server exposes 12 tools for complete task lifecycle management via the [Model Context Protocol](https://modelcontextprotocol.io). Any MCP-compatible client — Claude Code, Cursor, Windsurf, and others — can use these tools to create, schedule, execute, and monitor recurring coding agent tasks.

## Server Configuration

Add the cron-agents MCP server to your client configuration:

```json
{
  "mcpServers": {
    "cron-agents": {
      "command": "npx",
      "args": ["@sebastienlevert/cron-agents"]
    }
  }
}
```

The server binary is `cron-agents` and communicates over **stdio transport**.

## Tools Overview

### Task Management

Tools for creating, configuring, and managing task definitions and their Task Scheduler registrations.

| Tool | Description |
|------|-------------|
| [`cron_create_task`](./task-management#cron-create-task) | Create a new scheduled task from a template or custom definition |
| [`cron_get_task`](./task-management#cron-get-task) | Get the full definition of a specific task |
| [`cron_register_task`](./task-management#cron-register-task) | Register a task with Windows Task Scheduler |
| [`cron_unregister_task`](./task-management#cron-unregister-task) | Unregister a task from Windows Task Scheduler |
| [`cron_enable_task`](./task-management#cron-enable-task) | Enable a task in Windows Task Scheduler |
| [`cron_disable_task`](./task-management#cron-disable-task) | Disable a task in Windows Task Scheduler |
| [`cron_list_tasks`](./task-management#cron-list-tasks) | List all scheduled tasks with their status |

### Execution & Monitoring

Tools for running tasks on demand and tracking their execution.

| Tool | Description |
|------|-------------|
| [`cron_run_task`](./execution#cron-run-task) | Execute a task immediately (does not wait for schedule) |
| [`cron_get_run_status`](./execution#cron-get-run-status) | Check the status of an async task run |
| [`cron_view_logs`](./execution#cron-view-logs) | View execution logs for a task |

### Verification & Status

Tools for auditing log integrity and inspecting system configuration.

| Tool | Description |
|------|-------------|
| [`cron_verify_log`](./verification#cron-verify-log) | Verify the cryptographic signature of a log file |
| [`cron_status`](./verification#cron-status) | Show system status and configuration |

## Typical Workflow

```
cron_create_task → cron_register_task → (scheduled runs or cron_run_task)
                                         ↓
                              cron_get_run_status → cron_view_logs
```

1. **Create** a task with `cron_create_task` — defines the schedule, agent, and instructions.
2. **Register** the task with `cron_register_task` — adds it to Windows Task Scheduler.
3. **Run** on demand with `cron_run_task`, or let the scheduler trigger it automatically.
4. **Monitor** with `cron_get_run_status` and `cron_view_logs`.
5. **Verify** log integrity anytime with `cron_verify_log`.
