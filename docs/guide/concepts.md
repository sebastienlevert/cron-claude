# Core Concepts

This page explains the fundamental building blocks of cron-agents: how tasks are defined, how agents execute them, how scheduling works, and how the system ensures integrity and reliability.

## Tasks

A **task** is a markdown file with YAML frontmatter stored in one of the configured `tasksDirs` directories (default: `~/.cron-agents/tasks/`).

### Task File Structure

```markdown
---
id: weekly-audit
schedule: "0 10 * * 1"
invocation: cli
agent: claude
notifications:
  toast: true
enabled: true
---

# Weekly Dependency Audit

Check all package.json files in the repository for outdated dependencies.
Report any packages more than one major version behind.
```

### Frontmatter Fields

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | `string` | Yes | — | Unique task identifier. Must match the filename (without `.md`). |
| `schedule` | `string` | Yes | — | Cron expression defining when the task runs. |
| `invocation` | `"cli" \| "api"` | No | `"cli"` | How the task is executed — via agent CLI or Anthropic API. |
| `agent` | `"claude" \| "copilot"` | No | `"claude"` | Which coding agent runs the task (CLI mode only). |
| `notifications.toast` | `boolean` | No | `true` | Whether to show a Windows toast notification on completion. |
| `enabled` | `boolean` | No | `true` | Whether the task is active. Disabled tasks won't run on schedule. |

Everything below the frontmatter `---` separator is the **instructions** body — free-form markdown that the coding agent receives as its prompt.

## Agents

cron-agents supports multiple coding agents. Each agent has its own CLI, invocation style, and input mode.

### Supported Agents

| Agent | Display Name | CLI Executables | Input Mode | Env Override |
| --- | --- | --- | --- | --- |
| `claude` | Claude Code | `claude-code`, `claude` | `file` | `CLAUDE_CODE_PATH` |
| `copilot` | GitHub Copilot CLI | `copilot` | `file-reference` | `COPILOT_CLI_PATH` |

### How Agents Receive Tasks

Agents differ in how they receive task instructions:

- **`file`** — The instructions are written to a temporary file. The file path is passed as an argument to the agent CLI.
- **`file-reference`** — The instructions are written to a temporary file, but the agent receives a short prompt that references the file path rather than the file contents directly.

### Agent Detection

When you run a task, cron-agents locates the agent executable in this order:

1. **Environment variable** — Check the agent's `pathEnvVar` (e.g., `CLAUDE_CODE_PATH`)
2. **PATH search** — Search for the agent's executables using `where` (Windows)

The first match wins. Results are cached for the session to avoid repeated lookups.

### Claude Code CLI Flags

When running in CLI mode with Claude Code, cron-agents invokes:

```bash
claude-code --print --dangerously-skip-permissions <task-file>
```

- `--print` — Non-interactive output mode
- `--dangerously-skip-permissions` — Skip interactive permission prompts (required for unattended execution)

### GitHub Copilot CLI Flags

When running with Copilot:

```bash
copilot --yolo -p <prompt-referencing-task-file>
```

- `--yolo` — Skip confirmation prompts
- `-p` — Print mode

## Scheduling

### Cron Expressions

Tasks use standard five-field cron expressions:

```
┌───────────── minute (0–59)
│ ┌───────────── hour (0–23)
│ │ ┌───────────── day of month (1–31)
│ │ │ ┌───────────── month (1–12)
│ │ │ │ ┌───────────── day of week (0–7, where 0 and 7 = Sunday)
│ │ │ │ │
* * * * *
```

### Common Schedules

| Expression | Description |
| --- | --- |
| `0 9 * * *` | Every day at 9:00 AM |
| `0 9 * * 1-5` | Weekdays at 9:00 AM |
| `0 9 * * 1` | Every Monday at 9:00 AM |
| `0 */6 * * *` | Every 6 hours |
| `0 9 1 * *` | First day of every month at 9:00 AM |
| `0 9 1 1,4,7,10 *` | Quarterly on the 1st at 9:00 AM |

### Windows Task Scheduler Mapping

Cron expressions are converted to Windows Task Scheduler triggers during registration. The mapping supports daily, weekly, and monthly schedules. Note that not every cron feature maps 1:1 to Task Scheduler capabilities — complex expressions involving multiple day-of-week or step values may be approximated.

## Invocation Modes

Tasks can be executed in two ways, controlled by the `invocation` field.

### CLI Mode (`invocation: "cli"`)

The default. Launches the selected coding agent CLI with the task instructions.

**Pros:**
- Full agent environment with all tools (file I/O, shell, git, etc.)
- Agent can use MCP tools, browse the web, run commands
- Best for complex, multi-step tasks

**Cons:**
- Requires the agent CLI to be installed
- Heavier resource usage

### API Mode (`invocation: "api"`)

Sends the task instructions directly to the Anthropic API without a full agent environment.

**Pros:**
- Lightweight, no CLI installation needed
- Faster for simple text-generation tasks

**Cons:**
- No tool use — the model can only generate text
- Requires `ANTHROPIC_API_KEY` environment variable
- Incurs API usage costs

## Runs

Every task execution creates a **run record** — a JSON file in the `runs/` directory that tracks the execution lifecycle.

### Run Lifecycle

```
queued → running → success
                 → failure
```

| Status | Description |
| --- | --- |
| `queued` | Task is waiting for a concurrency slot |
| `running` | Agent is actively executing the task |
| `success` | Execution completed without errors |
| `failure` | Execution encountered an error |

### Run Record Fields

```json
{
  "runId": "exec-a1b2c3d4",
  "taskId": "morning-greeting",
  "startedAt": "2024-02-17T09:00:00.000Z",
  "finishedAt": "2024-02-17T09:02:30.000Z",
  "status": "success",
  "pid": 12345,
  "logPath": "~/.cron-agents/logs/morning-greeting_2024-02-17T09-00-00_exec-a1b2c3d4.md"
}
```

The `pid` field is used for liveness checks — if a run is marked as `running` but the process is no longer alive, the system considers it failed.

## Concurrency

cron-agents uses file-based concurrency control to prevent too many tasks from running simultaneously.

### How It Works

1. **Max concurrency** — Configurable in `config.json` (default: `2`). Only this many tasks can be `running` at once.
2. **Queue** — When a task is triggered and the concurrency limit is reached, it enters a `queued` state with FIFO ordering.
3. **Timeout** — Queued tasks that wait longer than **15 minutes** are abandoned.
4. **Liveness checks** — The system checks the `pid` of running tasks. If a process has died, its run record is cleaned up and the slot is freed.

### Configuration

Set the concurrency limit in `~/.cron-agents/config.json`:

```json
{
  "maxConcurrency": 2
}
```

## Audit Logging

Every task execution produces a **signed markdown log** stored in the configured `logsDir` (default: `~/.cron-agents/logs/`).

### Log File Naming

```
{taskId}_{timestamp}_{executionId}.md
```

Example: `morning-greeting_2024-02-17T09-00-00_exec-a1b2c3d4.md`

### Log Structure

```markdown
---
category: cron-task
taskId: morning-greeting
executionId: exec-a1b2c3d4
timestamp: 2024-02-17T09:00:00Z
status: success
signature: 3f2a8b...c9d1e0
---

# Task Execution Log: morning-greeting

**Execution ID:** exec-a1b2c3d4
**Status:** success
**Started:** 2024-02-17T09:00:00Z

## Execution Steps

1. [09:00:01] Loaded task definition
2. [09:00:02] Invoked Claude Code CLI
3. [09:02:30] Agent completed successfully

## Output

(Agent output here)
```

### HMAC-SHA256 Signatures

Each log is signed using a secret key stored in `~/.cron-agents/config.json`:

1. The log content (excluding the `signature` field) is serialized
2. An HMAC-SHA256 hash is computed using the secret key
3. The hex-encoded signature is stored in the log's frontmatter

This ensures that any modification to the log — even a single character — will invalidate the signature.

### Verifying Logs

**CLI:**

```bash
cron-agents-cli verify <log-content>
```

**MCP:**

Use the `cron_verify_log` tool with the full markdown content of the log file (including frontmatter).

A successful verification confirms the log hasn't been tampered with since creation.

## Notifications

cron-agents sends Windows toast notifications when tasks complete.

### How It Works

- Uses the `node-notifier` package to display native Windows toast notifications
- Notifications include the task name, status (success/failure), and a clickable action
- Clicking the notification opens the execution log in **Obsidian** via a deep-link (`obsidian://open?vault=...&file=...`)
- Notifications are configurable per task via the `notifications.toast` frontmatter field

### Configuration

Enable or disable toast notifications in the task frontmatter:

```yaml
notifications:
  toast: true   # Show notification on completion
```

Set `toast: false` to silence notifications for a specific task.

::: tip
Make sure Windows notification settings allow notifications from Node.js. If you use Focus Assist, you may need to add an exception or temporarily disable it.
:::
