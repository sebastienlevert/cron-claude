# Audit Logging

Every task execution in cron-agents is cryptographically logged, creating a tamper-proof audit trail. Logs are stored as markdown files with YAML frontmatter, making them human-readable and easy to integrate with tools like Obsidian.

## How It Works

Every task execution is logged as a markdown file with YAML frontmatter in the configured `logsDir` (default: `~/.cron-agents/logs/`).

**Filename format:** `{taskId}_{timestamp}_{executionId}.md`

Example: `morning-greeting_2024-02-17T09-00-00-000Z_exec-1708123456-abc123.md`

Files are sorted chronologically by default, making it easy to find the most recent execution.

## Log Structure

Each log file contains frontmatter metadata and a detailed execution report:

```markdown
---
category: cron-task
taskId: morning-greeting
executionId: exec-1708123456-abc123
timestamp: '2024-02-17T09:00:00.000Z'
status: success
signature: a1b2c3d4e5f6...  (64-char hex HMAC-SHA256)
---

# Task Execution Log: morning-greeting

**Execution ID:** exec-1708123456-abc123
**Status:** success
**Started:** 2024-02-17T09:00:00.000Z

## Execution Steps

### Step 1: Task execution started
**Time:** 2024-02-17T09:00:00.100Z
**Output:**
```
Task: morning-greeting, Method: cli, Agent: claude
```

### Step 2: Starting Claude Code CLI session
**Time:** 2024-02-17T09:00:00.200Z
...

## Summary
Total steps: 5
Status: success
```

## HMAC-SHA256 Signing

All logs are cryptographically signed to detect tampering.

- The log body content (below the frontmatter) is signed with HMAC-SHA256
- The secret key is stored in `~/.cron-agents/config.json` (`secretKey` field)
- Auto-generated on first use (32 random bytes → 64 hex chars)
- The signature is included in the frontmatter `signature` field

::: warning
If you regenerate the `secretKey`, all previously signed logs will fail verification. Back up the old key if you need to verify historical logs.
:::

## Verifying Logs

### CLI

```bash
cron-agents-cli verify path/to/log.md
```

### MCP

Use the `cron_verify_log` tool, passing the full file content:

```
cron_verify_log(log_content="---\ncategory: cron-task\n...")
```

### What Verification Checks

1. Extracts the `signature` from frontmatter
2. Recomputes the HMAC-SHA256 of the body content using the stored secret key
3. Compares the two — a match means the log is untampered

If verification fails, it means either the log content was modified after creation or the secret key has changed.

## Execution Steps Logged

Each execution captures detailed steps throughout the lifecycle:

| Step | Description |
|------|-------------|
| Task execution start | Task ID, invocation method, agent type |
| Temp file creation | Temporary instruction file path |
| Agent CLI launch | Full command with arguments |
| Agent output | stdout content (truncated to 10KB) |
| Agent stderr | stderr content (truncated to 5KB) |
| Completion status | Exit code and success/failure |
| Retry attempts | Details if transient errors triggered retries |
| Temp file cleanup | Confirmation of temp file removal |
| Notification sent | Toast notification dispatch status |

## Viewing Logs

There are several ways to browse execution logs:

### CLI

```bash
cron-agents-cli logs <task-id> -n 20
```

### MCP

```
cron_view_logs(task_id="my-task")
```

### Direct File Access

Browse `~/.cron-agents/logs/` directly — files are plain markdown, viewable in any text editor, VS Code, or Obsidian.

::: tip
Since logs are standard markdown with YAML frontmatter, they work seamlessly with Obsidian. You can add the logs directory as an Obsidian vault for a rich browsing experience.
:::
