# Notifications

cron-agents sends Windows toast notifications when tasks complete, so you know results without checking logs.

## Setup

Notifications use [node-notifier](https://github.com/mikaelbr/node-notifier) with the SnoreToast backend on Windows. No additional installation is required — it's bundled with cron-agents.

## Per-Task Configuration

Enable toast notifications in a task's YAML frontmatter:

```yaml
---
id: daily-report
schedule: "0 9 * * *"
notifications:
  toast: true
---
```

By default, `toast` is `false`. You must explicitly opt in for each task.

## Notification Content

### On Success

- **Title:** `Task {id} completed`
- **Body:** Success message with the agent name that executed the task
- **Icon:** Bundled cron-agents icon

### On Failure

- **Title:** `Task {id} failed`
- **Body:** Error details from the execution
- **Icon:** Bundled cron-agents icon

## Obsidian Deep-Link

When you click a notification, it opens the execution log file directly in **Obsidian** using the `obsidian://` protocol:

```
obsidian://open?path=C:\Users\me\.cron-agents\logs\daily-report_2024-02-17T09-00-00_exec-123.md
```

This requires Obsidian to be installed on your machine — it registers the `obsidian://` protocol handler during installation. If Obsidian isn't installed, the click action is a no-op.

::: tip
Point your `logsDir` to a folder inside your Obsidian vault to browse execution logs alongside your notes.
:::

## Troubleshooting

### Notifications not appearing

1. **Check Windows notification settings**
   - Go to **Settings → System → Notifications**
   - Ensure notifications are enabled globally
   - Check that SnoreToast (or Node.js) isn't in the blocked apps list

2. **Disable Focus Assist / Do Not Disturb**
   - Focus Assist suppresses toast notifications
   - Temporarily disable it to test, then add exceptions as needed

3. **Verify task configuration**
   - Confirm `toast: true` is set under `notifications` in the task frontmatter
   - Run the task manually with `cron_run_task` to trigger a notification

4. **Antivirus interference**
   - Some antivirus software blocks SnoreToast (the underlying notification binary)
   - Add an exception for the `node_modules/node-notifier/vendor/snoreToast/` directory
