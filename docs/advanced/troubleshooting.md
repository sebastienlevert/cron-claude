# Troubleshooting

Common issues and their solutions when working with cron-agents.

## Task Not Executing

- **Check registration:** Run `cron-agents-cli list` — is the task registered? (Look for `Registered: ✓`)
- **Check enabled:** Both the task file (`enabled: true`) and the scheduler status (`Status: Enabled`) must be active
- **Check Task Scheduler:** Open `taskschd.msc`, find `cron-agents-{id}`, and check the **Last Run Result** column
- **Check Event Viewer:** Windows Logs → System → look for Task Scheduler errors
- **Check agent:** Run `cron-agents-cli status` — is the configured agent detected? (Look for `✓ Found`)

## Task Queued But Never Runs

- **Concurrency full:** Other tasks may be occupying all execution slots. Check `cron-agents-cli status` for the current running count.
- **Increase concurrency:** Edit `~/.cron-agents/config.json` and set `maxConcurrency` to a higher value.
- **Queue timeout:** Tasks time out after 15 minutes in the queue. Check logs for timeout errors.
- **Stale runs:** Runs from crashed processes may block execution slots. They are auto-cleaned after 4 hours, or you can restart the MCP server to clear them immediately.

## Logs Not Appearing

- **Check logs directory:** `cron-agents-cli status` shows the configured logs directory
- **Check permissions:** Ensure your user has write access to the logs directory
- **Check disk space:** Ensure the drive has available space for new log files

## Toast Notifications Not Showing

- **Windows settings:** Go to Settings → System → Notifications and ensure notifications are enabled
- **Focus Assist:** Temporarily disable Do Not Disturb / Focus Assist mode
- **Task config:** Verify `notifications.toast: true` is set in the task definition file
- **Antivirus:** Some antivirus software blocks SnoreToast (the notification backend). Add an exception if needed.

## Obsidian Deep-Link Not Working

- **Obsidian installed?** The `obsidian://` protocol requires Obsidian to be installed and registered as a protocol handler
- **Log file exists?** The notification links to the actual log file path — ensure it hasn't been moved or deleted
- **Path encoding:** Check that the log path doesn't contain characters that break URI encoding (unusual characters in the task ID, for example)

## Agent Not Found

- **Install the agent:** Ensure [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) or [GitHub Copilot CLI](https://docs.github.com/en/copilot) is installed
- **Check PATH:** Run `where claude` or `where copilot` in your terminal to verify the agent is accessible
- **Environment variable:** Set `CLAUDE_CODE_PATH` or `COPILOT_CLI_PATH` to the full path of the agent executable
- **Restart terminal:** PATH changes require a new terminal session to take effect

## Signature Verification Fails

- **Modified log:** The log file may have been edited after creation. HMAC verification detects any change, no matter how small.
- **Wrong key:** If `secretKey` in `config.json` was regenerated, old logs signed with the previous key can no longer be verified. Back up your secret key before regenerating.
- **Encoding:** Ensure the log file is saved as UTF-8. Other encodings will produce a different hash.

## API Mode Errors

- **Missing API key:** Set the `ANTHROPIC_API_KEY` environment variable before running API-mode tasks
- **Rate limits:** Reduce the number of concurrent API tasks or add delays between executions
- **Model unavailable:** Check the [Anthropic API status page](https://status.anthropic.com/) for outages

## Build / Installation Issues

- **Node version:** cron-agents requires Node.js >= 18.0.0. Check your version with `node --version`.
- **Windows only:** Task Scheduler integration requires Windows 10 or Windows 11. macOS and Linux are not supported for scheduling.
- **npm permissions:** If installation fails, try running `npm install -g @sebastienlevert/cron-agents` from an administrator terminal.

## Getting Help

- **GitHub Issues:** [sebastienlevert/cron-claude](https://github.com/sebastienlevert/cron-claude/issues) — search existing issues or open a new one
- **Status check:** Run `cron-agents-cli status` for a full diagnostic overview of your installation, configuration, and agent availability
