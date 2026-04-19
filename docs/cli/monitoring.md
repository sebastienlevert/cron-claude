# Monitoring Commands

Commands for viewing execution history, verifying audit logs, and checking system health.

## `logs <task-id>`

View recent execution logs for a task. Logs are read from the configured logs directory.

### Options

| Option | Description | Default |
| --- | --- | --- |
| `-n, --count <number>` | Number of recent logs to display | `10` |

### Examples

View the last 10 logs (default):

```bash
cron-agents-cli logs morning-summary
```

```
Execution logs for task: morning-summary

Total executions: 23

Recent logs:

📄 morning-summary_2025-06-15T09-00-00_exec-abc123.md
   Status: success
   Time: 2025-06-15T09:00:00Z

📄 morning-summary_2025-06-14T09-00-00_exec-xyz789.md
   Status: success
   Time: 2025-06-14T09:00:00Z

📄 morning-summary_2025-06-13T09-00-00_exec-def456.md
   Status: failure
   Time: 2025-06-13T09:00:00Z

Log directory: C:\Users\you\.cron-agents\logs
```

View only the last 3 logs:

```bash
cron-agents-cli logs morning-summary --count 3
```

## `verify <log-file>`

Verify the HMAC-SHA256 cryptographic signature of a log file to confirm it has not been tampered with. Takes the path to the log file as an argument.

### Valid Signature

```bash
cron-agents-cli verify C:\Users\you\.cron-agents\logs\morning-summary_2025-06-15T09-00-00_exec-abc123.md
```

```
✓ Signature is valid - log has not been tampered with

Task: morning-summary
Execution: exec-abc123
Status: success
```

### Invalid Signature

If the log file has been modified after creation, verification fails:

```bash
cron-agents-cli verify C:\Users\you\.cron-agents\logs\tampered-log.md
```

```
✗ Signature verification failed!
  HMAC signature does not match log content
```

The command exits with code `1` on verification failure, making it suitable for use in scripts.

## `status`

Displays a comprehensive system overview including configuration, agent detection, and concurrency status.

```bash
cron-agents-cli status
```

### Example Output

```
cron-agents System Status

Version: 0.3.0
Config directory: C:\Users\you\.cron-agents
Task directories:
  (primary) C:\Users\you\.cron-agents\tasks
            D:\projects\shared-tasks
Logs directory: C:\Users\you\.cron-agents\logs
Total tasks: 5
Secret key: ✓ Configured

Concurrency:
  Max concurrent tasks: 3
  Currently running: 1 (actively executing)
  Currently queued: 0 (waiting for a slot)

Node version: v20.11.0
Platform: win32

Supported Agents:
  - Claude Code (claude): ✓ Found at C:\Users\you\AppData\Roaming\npm\claude.cmd
  - GitHub Copilot CLI (copilot): ✓ Found at C:\Users\you\AppData\Local\Programs\copilot\copilot.exe
```

### Fields

| Field | Description |
| --- | --- |
| **Version** | Installed cron-agents version |
| **Config directory** | Location of `config.json` (`~/.cron-agents`) |
| **Task directories** | All directories searched for task files; the first is the primary (used by `create`) |
| **Logs directory** | Where execution logs are stored |
| **Total tasks** | Number of tasks found across all task directories |
| **Secret key** | Whether the HMAC signing key is configured |
| **Concurrency** | Maximum slots, actively running tasks, and queued tasks |
| **Node version** | Node.js runtime version |
| **Platform** | Operating system platform |
| **Supported Agents** | Each supported coding agent with its detection status and path |
