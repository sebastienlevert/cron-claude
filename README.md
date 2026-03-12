# Cron-Claude

[![npm](https://img.shields.io/npm/v/@patrick-rodgers/cron-claude)](https://www.npmjs.com/package/@patrick-rodgers/cron-claude)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Automated task scheduling for AI coding agents via Windows Task Scheduler.** This MCP server enables Claude, GitHub Copilot CLI, and other coding agents to execute tasks automatically on recurring schedules—perfect for daily reports, backups, monitoring, and more.

## 🚀 Installation

### Claude Code (Recommended)

**One command to install:**

```bash
claude plugin add @patrick-rodgers/cron-claude
```

**That's it!** The plugin installs automatically with:
- ✅ Session hooks (shows available commands on startup)
- ✅ Slash commands (`/cron-status`, `/cron-list`, `/cron-run`)
- ✅ All 11 task management tools
- ✅ No configuration needed

### Claude Desktop

**Add to your MCP configuration:**

```json
{
  "mcpServers": {
    "cron-claude": {
      "command": "npx",
      "args": ["@patrick-rodgers/cron-claude"]
    }
  }
}
```

**Config file location:**
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Restart Claude Desktop after adding the configuration.

### Prerequisites

- **Windows 10/11** - Uses Windows Task Scheduler
- **Node.js 18+** ([Download](https://nodejs.org/))
- **Claude CLI** (optional) - For Claude CLI invocation mode
- **GitHub Copilot CLI** (optional) - For Copilot CLI invocation mode
- **Anthropic API Key** (optional) - For API invocation mode

## ✨ Features

- 🕐 **Cron Scheduling** - Use familiar cron expressions for flexible scheduling
- 🛡️ **Windows Task Scheduler** - Reliable, native scheduling that survives reboots
- 🔐 **Audit Logging** - HMAC-SHA256 signatures for tamper-proof logs
- 💾 **Simple File Storage** - Tasks and logs stored as markdown files (easy to backup)
- 🔔 **Toast Notifications** - Optional Windows notifications on completion
- 🎯 **Flexible Execution** - Run via Claude CLI, GitHub Copilot CLI, or Anthropic API
- 🤖 **Multi-Agent Support** - Choose your preferred coding agent (Claude Code, GitHub Copilot CLI)
- 🔌 **Full MCP Integration** - Works seamlessly in all Claude Code sessions
- 📁 **Configurable Directories** - Store tasks and logs wherever you want

## 📚 How It Works

### Task Definition

Tasks are defined in markdown files with YAML frontmatter:

```markdown
---
id: daily-summary
schedule: "0 9 * * *"  # Every day at 9 AM
invocation: cli         # 'cli' or 'api'
agent: claude           # 'claude' or 'copilot'
notifications:
  toast: true
enabled: true
---

# Daily Summary Task

Generate a summary of:
1. Today's calendar events
2. Open tasks and priorities
3. Recent updates

Format as a concise report and save to memory.
```

### Storage

**Default locations** (configurable via `~/.cron-claude/config.json`):

```
~/.cron-claude/
├── config.json              # Configuration
├── tasks/                   # Task definitions
│   ├── daily-summary.md
│   ├── weekly-backup.md
│   └── hourly-monitor.md
└── logs/                    # Execution logs (HMAC signed)
    ├── daily-summary_2024-02-17T09-00-00_exec-123.md
    └── weekly-backup_2024-02-17T18-00-00_exec-456.md
```

**Why file-based?**
- ✅ Simple and reliable - no external dependencies
- ✅ Easy to backup (point directories to OneDrive/Dropbox)
- ✅ Version control friendly (Git)
- ✅ Easy to inspect and debug
- ✅ Works offline

### Execution Flow

1. **Schedule** → Windows Task Scheduler triggers at scheduled time
2. **Execute** → Task runs via Claude CLI or Anthropic API
3. **Log** → Execution results written to `~/.cron-claude/logs/` with HMAC signature
4. **Notify** → Optional toast notification on completion

## 🛠️ Available Tools

### Task Management (6 tools)

| Tool | Description |
|------|-------------|
| `cron_create_task` | Create a new scheduled task |
| `cron_register_task` | Register task with Windows Task Scheduler |
| `cron_unregister_task` | Remove task from scheduler |
| `cron_enable_task` | Enable a task |
| `cron_disable_task` | Disable a task |
| `cron_get_task` | Get full task definition |

### Execution & Monitoring (3 tools)

| Tool | Description |
|------|-------------|
| `cron_run_task` | Execute a task immediately (testing) |
| `cron_list_tasks` | List all tasks with status |
| `cron_view_logs` | View execution logs for a task |

### Verification & Status (2 tools)

| Tool | Description |
|------|-------------|
| `cron_verify_log` | Verify log cryptographic signature |
| `cron_status` | Check system status and configuration |

## 💡 Usage Examples

### Create and Schedule a Task

**You:**
```
Create a cron task that runs every Monday at 9 AM to generate a weekly report.
Use the CLI invocation method and enable toast notifications.
```

**Claude will:**
1. Use `cron_create_task` to create the task file
2. Ask you to review the task definition
3. Use `cron_register_task` to schedule it with Task Scheduler

### Check Task Status

**You:**
```
What cron tasks do I have and when will they run next?
```

**Claude will:**
1. Use `cron_list_tasks` to show all tasks
2. Display schedule, status, and next run times

### Run a Task Immediately

**You:**
```
Run my daily-summary task right now for testing
```

**Claude will:**
1. Use `cron_run_task` to execute immediately
2. Use `cron_view_logs` to show the results

### Verify Logs

**You:**
```
Verify the integrity of the logs for my backup task
```

**Claude will:**
1. Use `cron_view_logs` to retrieve logs
2. Use `cron_verify_log` to check HMAC signatures
3. Report if logs are authentic and unmodified

## 📋 Cron Schedule Format

```
 ┌─── minute (0-59)
 │ ┌─── hour (0-23)
 │ │ ┌─── day of month (1-31)
 │ │ │ ┌─── month (1-12)
 │ │ │ │ ┌─── day of week (0-6, Sunday=0)
 * * * * *
```

**Common Examples:**
- `0 9 * * *` - Every day at 9 AM
- `0 */2 * * *` - Every 2 hours
- `30 8 * * 1-5` - 8:30 AM on weekdays (Monday-Friday)
- `0 0 * * 0` - Midnight every Sunday
- `*/15 * * * *` - Every 15 minutes
- `0 12 1 * *` - Noon on the 1st of every month

## 🎯 Invocation Methods

### CLI Mode (`invocation: cli`)

CLI mode executes tasks using a coding agent CLI. You can choose which agent to use with the `agent` field.

#### Claude Code (`agent: claude`) - Default

- Uses local `claude-code` command
- Full Claude environment with all tools
- Best for complex, interactive tasks
- Requires Claude CLI installed
- Override path with `CLAUDE_CODE_PATH` env var

**Example use cases:**
- Tasks requiring file operations
- Tasks using other MCP tools
- Complex multi-step workflows

#### GitHub Copilot CLI (`agent: copilot`)

- Uses `copilot` command
- GitHub Copilot-powered task execution
- Override path with `COPILOT_CLI_PATH` env var

**Example use cases:**
- Tasks leveraging GitHub ecosystem
- Copilot-specific workflows

### API Mode (`invocation: api`)

- Direct Anthropic API calls
- More reliable for simple tasks
- Requires `ANTHROPIC_API_KEY` environment variable
- May incur API costs

**Example use cases:**
- Simple status checks
- Notifications and alerts
- Lightweight monitoring tasks

## 🔒 Audit Logging & Security

### Automatic Logging

Every task execution is automatically logged with:
- ✅ All actions and steps taken
- ✅ Outputs and errors
- ✅ Timestamps for each operation
- ✅ HMAC-SHA256 cryptographic signature

**Logs are stored as markdown files** in `~/.cron-claude/logs/` with filenames like:
```
{task-id}_{timestamp}_{execution-id}.md
```

This makes them:
- Easy to search and review
- Simple to backup (copy directory to OneDrive/Dropbox)
- Compatible with version control
- Verifiable against tampering

### Log Verification

Ask Claude to verify any log:
```
Verify the logs for task [task-id] haven't been tampered with
```

Claude will check the HMAC signature to ensure authenticity.

### Secret Key

On first use, Cron-Claude generates a secret key:
- Stored in: `~/.cron-claude/config.json`
- Used for: Signing all log entries with HMAC-SHA256
- Keep secure: Treat like a password

### Configurable Storage

You can configure where tasks and logs are stored:

```json
{
  "secretKey": "auto-generated",
  "tasksDir": "C:\\Users\\you\\OneDrive\\cron-tasks",
  "logsDir": "C:\\Users\\you\\OneDrive\\cron-logs"
}
```

This allows you to:
- Backup tasks and logs to cloud storage
- Share task definitions across machines
- Use version control (Git) for task definitions
- Organize logs however you prefer

## 🎨 Claude Code Plugin Features

When used with Claude Code, this plugin includes:

### 🪝 Session Hooks
- **Session Start** - Automatically displays available commands when you start a new session
- Shows quick reference for common operations

### ⌨️ Slash Commands
- `/cron-status` - Check system status
- `/cron-list` - List all scheduled tasks
- `/cron-run <task-id>` - Run a task immediately

### 📖 Skills
- Rich documentation via skills system
- Type `/cron` to access full cron skill documentation

## 📦 Example Tasks

### Daily Summary

```markdown
---
id: daily-summary
schedule: "0 9 * * *"
invocation: cli
agent: claude
notifications:
  toast: true
enabled: true
---

# Daily Summary Task

Generate a morning summary including:
1. Today's calendar events
2. Priority tasks and deadlines
3. Recent notifications

Format as a concise report.
```

### Weekly Backup

```markdown
---
id: weekly-backup
schedule: "0 0 * * 0"
invocation: cli
agent: copilot
notifications:
  toast: true
enabled: true
---

# Weekly Backup Task

Perform weekly backup:
1. Archive important project files
2. Store metadata about backup
3. Verify backup completed successfully
4. Log results to memory
```

### Hourly Monitor

```markdown
---
id: hourly-monitor
schedule: "0 * * * *"
invocation: api
notifications:
  toast: false
enabled: true
---

# Hourly System Monitor

Check system health:
1. Monitor key metrics
2. Check for alerts or issues
3. Log status to memory
4. Notify if problems detected
```

## 🐛 Troubleshooting

### MCP Server Not Available

1. Check if registered:
   ```bash
   cat ~/.claude/config.json
   ```

2. Look for `cron-claude` in `mcpServers`

3. Reinstall plugin:
   ```bash
   claude plugin add @patrick-rodgers/cron-claude
   ```

4. Restart Claude Code

### Task Not Executing on Schedule

Ask Claude:
```
Check the status of my [task-id] cron task
```

Claude will:
1. Check if task is registered
2. Verify it's enabled
3. Show next scheduled run time

You can also check Windows Task Scheduler manually:
- Open Task Scheduler
- Look for tasks named `CronClaude_[task-id]`

### No Toast Notifications

- Verify `notifications.toast: true` in task file
- Check Windows notification settings
- Disable "Focus Assist" temporarily

### Logs Not Appearing

- Check configured log directory in `~/.cron-claude/config.json`
- Verify directory has write permissions
- Check disk space availability
- Look in default location: `~/.cron-claude/logs/`

## 🔧 Development

### Build

```bash
npm install
npm run build
```

### Test with MCP Inspector

```bash
npm test
```

This launches the MCP Inspector where you can manually invoke tools and see responses.

### Local Development

1. Clone the repository:
```bash
git clone https://github.com/patrick-rodgers/cron-claude.git
cd cron-claude
```

2. Install and build:
```bash
npm install
npm run build
```

3. Link locally for testing:
```bash
npm link
claude plugin add <path-to-cron-claude>
```

## 📄 License

MIT

## ⚠️ Warranty Disclaimer

This software is provided "AS IS", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and noninfringement. In no event shall the authors or copyright holders be liable for any claim, damages, or other liability, whether in an action of contract, tort, or otherwise, arising from, out of, or in connection with the software or the use or other dealings in the software.

## 🙏 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📦 Related

- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- [Claude Desktop](https://claude.ai/download)
- [Claude Code CLI](https://github.com/anthropics/claude-code)
- [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli)

---

**Built with ❤️ for automating Claude workflows**
