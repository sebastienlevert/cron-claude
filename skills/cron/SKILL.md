# Cron-Claude Skill

Automated task scheduling and execution for AI coding agents via Windows Task Scheduler.

## Overview

Cron-Claude enables you to schedule coding agent tasks (Claude Code, GitHub Copilot CLI, or API) to perform tasks automatically on recurring schedules. Tasks are defined in markdown files and executed via Windows Task Scheduler.

## Features

- 🕐 Schedule tasks with cron expressions
- 🤖 Multi-agent support (Claude Code, GitHub Copilot CLI)
- 🔐 Cryptographic audit logging with HMAC signatures
- 💾 Logs stored via memory integration
- 🔔 Optional Windows toast notifications
- 🎯 CLI or API execution modes
- 🛡️ Native Windows Task Scheduler integration

## Quick Start

### Create a Task

```
Create a cron task called "daily-report" that runs every day at 9 AM.
The task should generate a daily summary.
```

### Register with Scheduler

```
Register my daily-report task with Windows Task Scheduler
```

### View Tasks

```
Show me all my scheduled cron tasks
```

### Run Immediately

```
Run my daily-report task right now for testing
```

## Task Definition

Tasks are markdown files with YAML frontmatter:

```markdown
---
id: my-task
schedule: "0 9 * * *"  # Daily at 9 AM
invocation: cli         # 'cli' or 'api'
agent: claude           # 'claude' or 'copilot'
notifications:
  toast: true
enabled: true
---

# Task Instructions

Your instructions for the coding agent in markdown format.
```

## Supported Agents

| Agent | Value | CLI Command | Description |
|-------|-------|-------------|-------------|
| Claude Code | `claude` | `claude-code` | Anthropic Claude Code CLI (default) |
| GitHub Copilot CLI | `copilot` | `copilot` | GitHub Copilot CLI |

## Cron Schedule Format

```
 ┌─── minute (0-59)
 │ ┌─── hour (0-23)
 │ │ ┌─── day of month (1-31)
 │ │ │ ┌─── month (1-12)
 │ │ │ │ ┌─── day of week (0-6, Sunday=0)
 * * * * *
```

### Common Examples

- `0 9 * * *` - Every day at 9 AM
- `0 */2 * * *` - Every 2 hours
- `30 8 * * 1-5` - 8:30 AM on weekdays
- `0 0 * * 0` - Midnight every Sunday
- `*/15 * * * *` - Every 15 minutes

## Invocation Methods

**CLI Mode** (`invocation: cli`)
- Executes via a coding agent CLI
- Choose agent with `agent` field: `claude` (default) or `copilot`
- Best for complex, interactive tasks
- Requires selected agent CLI installed

**API Mode** (`invocation: api`)
- Direct Anthropic API calls
- More reliable for simple tasks
- Requires `ANTHROPIC_API_KEY` environment variable
- May incur API costs

## Available MCP Tools

- **cron_create_task** - Create a new scheduled task
- **cron_register_task** - Register with Task Scheduler
- **cron_unregister_task** - Remove from scheduler
- **cron_enable_task** - Enable a task
- **cron_disable_task** - Disable a task
- **cron_run_task** - Execute immediately
- **cron_list_tasks** - Show all tasks
- **cron_get_task** - Get task definition
- **cron_view_logs** - View execution logs
- **cron_verify_log** - Verify log signatures
- **cron_status** - System status

## Audit Logging

Every task execution is automatically logged with:
- ✅ All actions and steps taken
- ✅ Outputs and errors
- ✅ Timestamps
- ✅ HMAC-SHA256 signature for verification

Logs are stored via the memory integration and can be verified for authenticity.

## Requirements

- Windows 10/11
- Node.js >= 18.0.0
- Claude Code with MCP support
- Claude CLI (for Claude agent mode)
- GitHub Copilot CLI (for Copilot agent mode)
- Anthropic API Key (for API mode)

## Troubleshooting

### Task Not Executing

Check task status:
```
Check the status of my [task-id] task
```

Verify it's:
- Registered with Task Scheduler
- Enabled in both file and scheduler
- Has a valid schedule

### No Notifications

- Check `notifications.toast: true` in task file
- Verify Windows notification settings
- Disable Focus Assist temporarily

### Logs Not Appearing

- Verify memory integration is working
- Check fallback `./logs/` directory

## Examples

### Daily Summary Task

```
Create a task that runs every morning at 8 AM to:
1. Check my calendar for today's events
2. Generate a summary report
3. Send a notification when complete
```

### Weekly Backup Task

```
Create a task that runs every Sunday at midnight to:
1. Archive important project files
2. Store metadata about the backup
3. Verify the backup completed successfully
```

### Hourly Monitor Task

```
Create a task that runs every hour to:
1. Check system health
2. Log any issues
3. Alert if problems detected
```

## See Also

- `/cron-status` - Check system status
- `/cron-list` - List all tasks
- `/cron-run` - Run a task immediately
