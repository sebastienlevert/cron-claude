# Task Directories

cron-agents supports scanning multiple directories for task definitions. This lets you organize tasks across different locations — synced folders, Obsidian vaults, or shared team directories.

## How It Works

The `tasksDirs` array in `~/.cron-agents/config.json` lists all directories to scan:

```json
{
  "tasksDirs": [
    "C:\\Users\\me\\.cron-agents\\tasks",
    "C:\\Users\\me\\Documents\\Obsidian\\MyVault\\tasks"
  ]
}
```

### Primary Directory

The **first entry** in `tasksDirs` is the primary directory. This is where:

- New tasks created via `cron_create_task` or the CLI are written
- It's the only directory cron-agents writes to

All other directories are scanned in order but treated as **read-only** from cron-agents' perspective. You manage files in those directories yourself (or through other tools like Obsidian).

### Default Directory

The default directory `~/.cron-agents/tasks` is **always included**. If it's missing from your `tasksDirs` array, it's automatically prepended. This ensures tasks created before multi-directory support still work.

### Deduplication

When the same task ID exists in multiple directories, the **first directory wins**. Directories are scanned in the order they appear in `tasksDirs`, and the first match for a given ID is used. Duplicates in later directories are silently ignored.

## Use Cases

### OneDrive / Dropbox Sync

Keep tasks synced across machines by pointing to a cloud-synced folder:

```json
{
  "tasksDirs": [
    "C:\\Users\\me\\.cron-agents\\tasks",
    "C:\\Users\\me\\OneDrive\\cron-agents\\tasks"
  ]
}
```

### Obsidian Vault Integration

Store tasks alongside your notes in an Obsidian vault. Tasks are standard markdown files with YAML frontmatter — Obsidian renders them natively:

```json
{
  "tasksDirs": [
    "C:\\Users\\me\\.cron-agents\\tasks",
    "C:\\Users\\me\\Documents\\Obsidian\\MyVault\\tasks"
  ]
}
```

### Team Shared Tasks

Point to a shared network drive or Git-synced directory for team-wide task definitions:

```json
{
  "tasksDirs": [
    "C:\\Users\\me\\.cron-agents\\tasks",
    "\\\\server\\shared\\cron-agents\\tasks"
  ]
}
```

## Legacy Migration

If your config uses the old singular `tasksDir` field:

```json
{
  "tasksDir": "C:\\Users\\me\\.cron-agents\\tasks"
}
```

It's **automatically migrated** to the new `tasksDirs` array format on next load:

```json
{
  "tasksDirs": [
    "C:\\Users\\me\\.cron-agents\\tasks"
  ]
}
```

No manual action is required. The old `tasksDir` field is removed after migration.
