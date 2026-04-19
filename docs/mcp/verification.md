# Verification & Status Tools

Tools for auditing log integrity and inspecting system configuration.

## `cron_verify_log` {#cron-verify-log}

Verify the HMAC-SHA256 cryptographic signature of a log file. Ensures the log has not been tampered with since it was written by the cron-agents executor.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `log_content` | `string` | ✓ | Full markdown content of the log file including YAML frontmatter |

### How It Works

Every execution log is signed with an HMAC-SHA256 hash using the secret key stored in `~/.cron-agents/config.json`. The signature is embedded in the log's YAML frontmatter. This tool recomputes the hash over the log content (excluding the signature field) and compares it to the stored signature.

### Example

```
cron_verify_log(log_content: "---\ncategory: cron-task\ntaskId: daily-summary\n...")
```

**Valid response:**

```
✅ Log signature is VALID

  Task ID: daily-summary
  Execution ID: run-abc123
  Status: success
  Timestamp: 2024-02-17T09:00:00Z
```

**Invalid response:**

```
❌ Log signature is INVALID — the log may have been tampered with.

  Task ID: daily-summary
  Execution ID: run-abc123
```

::: warning
If verification fails, the log content may have been modified after execution. Investigate the source of the change before relying on the log data.
:::

---

## `cron_status` {#cron-status}

Show system status and configuration overview. Provides a comprehensive snapshot of the cron-agents installation, including version, directories, task count, security configuration, concurrency state, runtime environment, and supported agents with detection status.

### Parameters

None.

### Example

```
cron_status()
```

**Response:**

```
cron-agents Status
══════════════════

Version: 0.5.0
Config dir: C:\Users\you\.cron-agents
Tasks dir: C:\Users\you\.cron-agents\tasks
Logs dir: C:\Users\you\.cron-agents\logs

Tasks: 5 defined
Secret key: ✓ configured

Concurrency:
  Max slots: 2
  Running: 1
  Queued: 0

Runtime:
  Node.js: v20.11.0
  Platform: win32 (x64)

Supported Agents:
  claude: ✓ detected (C:\Users\you\.npm\claude-code)
  copilot: ✗ not found
```

### Fields

| Field | Description |
|-------|-------------|
| **Version** | Installed cron-agents version (from `package.json`) |
| **Config dir** | Location of `config.json` |
| **Tasks dir** | Directory where task definition files are stored |
| **Logs dir** | Directory where execution logs are stored |
| **Tasks** | Number of task definitions found |
| **Secret key** | Whether the HMAC signing key is configured |
| **Concurrency** | Max slots, currently running, and queued runs |
| **Runtime** | Node.js version and OS platform |
| **Supported Agents** | Each agent's detection status and path (if found) |
