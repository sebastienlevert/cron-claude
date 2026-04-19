# CLI Reference

The `cron-agents-cli` binary is installed alongside the MCP server when you install the `@sebastienlevert/cron-agents` package. It provides a full command-line interface for managing scheduled coding agent tasks without needing an MCP client.

## Usage

```bash
cron-agents-cli [options] [command]
```

## Help Output

```
Usage: cron-agents [options] [command]

Manage scheduled coding agent tasks

Commands:
  create [options] <task-id>   Create a new scheduled task
  list                         List all scheduled tasks
  get <task-id>                View a task definition and instructions
  register <task-id>           Register a task with Windows Task Scheduler
  unregister|delete <task-id>  Unregister a task from Windows Task Scheduler
  enable <task-id>             Enable a task
  disable <task-id>            Disable a task
  run [options] <task-id>      Execute a task (foreground or background)
  run-status [options]         Check the status of a task run
  logs [options] <task-id>     View execution logs for a task
  verify <log-file>            Verify the signature of a log file
  status                       Show system status

Options:
  -V, --version                output the version number
  -h, --help                   display help for command
```

## Command Categories

### [Task Management](/cli/task-management)

Create, inspect, and manage the lifecycle of task definitions and their Windows Task Scheduler registrations.

| Command | Description |
| --- | --- |
| `create <task-id>` | Create a new task with default settings |
| `get <task-id>` | View a task's full definition and instructions |
| `list` | List all tasks across configured directories |
| `register <task-id>` | Register a task with Windows Task Scheduler |
| `unregister <task-id>` | Remove a task from Task Scheduler |
| `enable <task-id>` | Enable a registered task |
| `disable <task-id>` | Disable a registered task |

### [Execution](/cli/execution)

Run tasks on demand and monitor background executions.

| Command | Description |
| --- | --- |
| `run <task-id>` | Execute a task in the foreground or background |
| `run-status` | Check the status of a background run |

### [Monitoring](/cli/monitoring)

View execution history, verify audit logs, and check system health.

| Command | Description |
| --- | --- |
| `logs <task-id>` | View recent execution logs for a task |
| `verify <log-file>` | Verify the cryptographic signature of a log file |
| `status` | Show system configuration and agent status |
