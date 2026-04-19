# Configuration

cron-agents stores its configuration at `~/.cron-agents/config.json`. The file is **auto-generated on first use** with sensible defaults — you only need to edit it when customizing behavior.

## Config File

```json
{
  "secretKey": "hex-encoded-64-char-hmac-key",
  "version": "0.1.0",
  "tasksDirs": [
    "C:\\Users\\username\\.cron-agents\\tasks",
    "C:\\Users\\username\\OneDrive\\Pensieve\\.pensieve\\tasks"
  ],
  "logsDir": "C:\\Users\\username\\.cron-agents\\logs",
  "maxConcurrency": 2
}
```

## Fields

### `secretKey`

Auto-generated HMAC-SHA256 key (32 random bytes, hex-encoded to 64 characters). Used for cryptographically signing all execution logs. This ensures logs haven't been tampered with after creation.

::: warning
Do not share or commit this key. If you rotate it, existing log signatures will no longer verify.
:::

### `version`

Config schema version string. Used for future migrations when the config format changes. Currently `"0.1.0"`.

### `tasksDirs`

Array of directories to scan for task definition files (`.md`). The **first entry** is the primary directory — this is where new tasks are created via `cron_create_task` or the CLI. All other entries are scanned for existing tasks.

The default directory (`~/.cron-agents/tasks`) is always included. If it's missing from the array, it's automatically prepended.

See [Task Directories](./task-directories) for details on multi-directory support.

### `logsDir`

Directory where signed execution logs are stored. Each log is a markdown file with YAML frontmatter containing the HMAC signature.

Default: `~/.cron-agents/logs`

### `maxConcurrency`

Maximum number of tasks that can execute simultaneously. Default is `2`, minimum is `1`. When all slots are occupied, new executions are queued in FIFO order.

See [Concurrency Control](./concurrency) for details on the queuing and locking system.

## Directory Structure

```
~/.cron-agents/
├── config.json              ← Configuration file
├── tasks/                   ← Primary tasks directory
│   ├── task-a.md
│   └── task-b.md
├── logs/                    ← Signed execution logs
│   └── task-a_2024-02-17T09-00-00_exec-123.md
└── runs/                    ← Temporary run state (JSON)
    └── run-1708123456-abc123.json
```

| Directory | Purpose | Managed by |
|-----------|---------|------------|
| `tasks/` | Task definition markdown files | User + `cron_create_task` |
| `logs/` | HMAC-signed execution logs | Executor (automatic) |
| `runs/` | Transient run state for concurrency control | Executor (automatic) |

::: tip
All paths are configurable. Point `tasksDirs` or `logsDir` to a OneDrive, Dropbox, or Obsidian vault folder for automatic sync and backup.
:::
