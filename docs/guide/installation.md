# Installation

## Prerequisites

Before installing cron-agents, make sure you have:

| Requirement | Details |
| --- | --- |
| **Operating System** | Windows 10 or Windows 11 |
| **Node.js** | Version 18.0.0 or later |
| **Coding Agent** | At least one of: Claude Code CLI, GitHub Copilot CLI |

::: tip
You can check your Node.js version with `node --version`. If you need to install or update Node.js, visit [nodejs.org](https://nodejs.org/).
:::

## Via Claude Code Plugin (Recommended)

The simplest way to install cron-agents is as a Claude Code plugin:

```bash
claude plugin add @sebastienlevert/cron-agents
```

This automatically:
- Installs the package
- Registers the MCP server with Claude Code
- Makes the CLI available
- Adds slash commands (`/cron-status`, `/cron-list`, `/cron-run`)

## Via npm

Install the package globally:

```bash
npm install -g @sebastienlevert/cron-agents
```

Then register the MCP server with Claude Code by adding to `~/.claude/config.json`:

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

## Via Manual Configuration

If you prefer not to install globally, you can run cron-agents directly via `npx`. Add the following MCP server configuration to your editor's config file:

**Claude Code** (`~/.claude/config.json`):

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

**Project-level** (`.mcp.json` in your repository root):

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

## Verify Installation

After installation, verify everything is working:

```bash
cron-agents-cli status
```

You should see output similar to:

```
cron-agents v0.1.5

Configuration:
  Config file:     C:\Users\you\.cron-agents\config.json
  Tasks dirs:      C:\Users\you\.cron-agents\tasks
  Logs dir:        C:\Users\you\.cron-agents\logs
  Max concurrency: 2

Agents:
  claude (Claude Code):       ✓ Detected
  copilot (GitHub Copilot CLI): ✓ Detected
```

## Agent Setup

cron-agents supports two coding agents. You need at least one installed.

### Claude Code CLI

Install the Claude Code CLI from [Anthropic](https://docs.anthropic.com/en/docs/claude-code):

```bash
npm install -g @anthropic-ai/claude-code
```

Verify it's available:

```bash
claude --version
```

**Override the path** if the CLI is installed in a non-standard location:

```bash
set CLAUDE_CODE_PATH=C:\path\to\claude-code.exe
```

### GitHub Copilot CLI

Install the GitHub Copilot CLI from [GitHub](https://docs.github.com/en/copilot/github-copilot-in-the-cli):

```bash
npm install -g @githubnext/github-copilot-cli
```

Verify it's available:

```bash
copilot --version
```

**Override the path** if the CLI is installed in a non-standard location:

```bash
set COPILOT_CLI_PATH=C:\path\to\copilot.exe
```

### Agent Detection

cron-agents automatically detects installed agents by searching your `PATH` for the following executables:

| Agent | Executables Searched | Env Override |
| --- | --- | --- |
| `claude` | `claude-code`, `claude` | `CLAUDE_CODE_PATH` |
| `copilot` | `copilot` | `COPILOT_CLI_PATH` |

Environment variable overrides always take priority over PATH detection.

## API Mode Setup

For tasks that use the `api` invocation mode (direct Anthropic API calls without a full agent environment), set your API key:

```bash
set ANTHROPIC_API_KEY=sk-ant-...
```

To persist the variable, add it to your system or user environment variables via **Settings → System → Advanced system settings → Environment Variables**.

::: warning
API mode incurs usage costs against your Anthropic API account. Use CLI mode for complex tasks that benefit from the full agent toolset.
:::

## Next Steps

- **[Quick Start](./quick-start.md)** — Create and run your first task
- **[Core Concepts](./concepts.md)** — Learn about tasks, agents, and scheduling
