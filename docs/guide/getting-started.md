# Getting Started

## What is cron-agents?

**cron-agents** is an MCP (Model Context Protocol) server and CLI that lets you schedule and automate coding agent tasks on Windows. Define what you want done in plain markdown, pick a cron schedule, and let your preferred coding agent — Claude Code or GitHub Copilot CLI — execute the work automatically via Windows Task Scheduler.

Whether it's a daily status summary, a weekly dependency audit, or an hourly health check, cron-agents handles the scheduling, execution, logging, and notification lifecycle end to end.

## Key Features

| Feature | Description |
| --- | --- |
| **Multi-Agent** | Choose between Claude Code (default) and GitHub Copilot CLI per task |
| **Cron Scheduling** | Standard cron expressions mapped to Windows Task Scheduler triggers |
| **11 MCP Tools** | Create, register, enable, disable, run, list, inspect, log, and verify tasks |
| **Full CLI** | Everything available through MCP is also available from the terminal |
| **Audit Logging** | Every execution produces an HMAC-SHA256 signed markdown log |
| **Toast Notifications** | Windows toast notifications with Obsidian deep-links on completion |
| **Concurrency Control** | File-based locking with configurable max concurrent tasks (default 2) |
| **API Mode** | Optional direct Anthropic API invocation for lightweight tasks |

## How It Works

cron-agents follows a simple four-step lifecycle:

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  1. Define Task  │────▶│  2. Register w/       │────▶│  3. Agent Runs   │────▶│  4. Log & Notify │
│  (Markdown + YAML)│     │     Task Scheduler    │     │     the Task     │     │  (Signed + Toast)│
└─────────────────┘     └──────────────────────┘     └─────────────────┘     └─────────────────┘
```

### Step 1 — Define a Task

Tasks are markdown files with YAML frontmatter. Write your instructions in plain language:

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

Summarize any new GitHub issues opened overnight in the current repository
and post a brief summary as a comment on the team standup issue.
```

### Step 2 — Register with Windows Task Scheduler

Registration converts the cron expression into a native Task Scheduler trigger and creates a scheduled task that runs under your user account.

### Step 3 — Agent Executes the Task

At the scheduled time, Windows Task Scheduler launches the executor. It reads the task file, invokes your chosen coding agent (Claude Code or Copilot CLI), and captures the output.

### Step 4 — Log and Notify

The execution result is written to a signed markdown log file. An HMAC-SHA256 signature ensures tamper detection. A Windows toast notification lets you know it completed — click it to open the log in Obsidian.

## Architecture Overview

cron-agents uses a **file-based architecture** with no external database:

```
~/.cron-agents/
├── config.json          # Secret key, directory paths, concurrency settings
├── tasks/               # Task definitions (markdown + YAML frontmatter)
│   ├── morning-greeting.md
│   └── weekly-audit.md
├── logs/                # Signed execution logs
│   └── morning-greeting_2024-02-17T09-00-00_exec-abc.md
└── runs/                # Active run records (JSON, for concurrency control)
    └── exec-abc.json
```

| Directory | Purpose |
| --- | --- |
| `config.json` | Secret key for HMAC signing, task/log directory paths, max concurrency |
| `tasks/` (configurable via `tasksDirs`) | One `.md` file per task with frontmatter + instructions |
| `logs/` (configurable via `logsDir`) | Signed execution logs, one per run |
| `runs/` | Transient JSON files tracking active/queued executions |

All paths are configurable in `~/.cron-agents/config.json`. You can point `tasksDirs` and `logsDir` to OneDrive, Dropbox, or any synced folder for backup.

## Next Steps

- **[Installation](./installation.md)** — Set up cron-agents and your coding agent CLI
- **[Quick Start](./quick-start.md)** — Create and run your first scheduled task in five minutes
- **[Core Concepts](./concepts.md)** — Understand tasks, agents, scheduling, and audit logging
