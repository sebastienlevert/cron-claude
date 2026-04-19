# Concurrency Control

cron-agents limits how many tasks can run simultaneously to prevent resource exhaustion. The system uses file-based locking and a FIFO queue to manage execution slots.

## Configuration

Set `maxConcurrency` in `~/.cron-agents/config.json`:

```json
{
  "maxConcurrency": 2
}
```

- **Default:** `2`
- **Minimum:** `1`

Increase this value if your machine has resources to spare and tasks don't conflict:

```json
{
  "maxConcurrency": 4
}
```

## How It Works

```
Task requested
     │
     ▼
Acquire file lock (O_CREAT|O_EXCL)
     │
     ▼
Count running tasks vs maxConcurrency
     │
     ├── Slot available → status = 'running' → execute
     │
     └── No slot → status = 'queued' → poll every 15s
                                            │
                                            ▼
                                    Slot opens → first-in-queue
                                    transitions to 'running'
                                            │
                                            ▼
                                       On completion → update
                                       record, release slot
```

### Step by Step

1. **Task execution requested** — via CLI (`cron-agents run`) or MCP tool (`cron_run_task`)
2. **Acquire lock** — atomic file creation with `O_CREAT|O_EXCL` flags prevents race conditions
3. **Check capacity** — count run records with `status: 'running'` against `maxConcurrency`
4. **If slot available** — set `status: 'running'`, release lock, execute the task
5. **If no slot** — set `status: 'queued'`, release lock, poll every 15 seconds for an opening
6. **When slot opens** — first-in-queue (FIFO order by timestamp) transitions to `'running'`
7. **On completion** — update run record to `'success'` or `'failure'`, slot is released

## Run Records

Run state is tracked as JSON files in `~/.cron-agents/runs/`:

```
~/.cron-agents/runs/
└── run-1708123456-abc123.json
```

Each record tracks the execution lifecycle:

| Field | Description |
|-------|-------------|
| `status` | `queued` → `running` → `success` \| `failure` |
| `taskId` | Which task is executing |
| `pid` | Process ID of the executing agent |
| `queuedAt` | When the run was first requested |
| `startedAt` | When execution began |
| `completedAt` | When execution finished |

## Timeouts and Cleanup

### Queue Timeout

If a queued task doesn't get a slot within **15 minutes**, it's removed from the queue and marked as failed. This prevents indefinite backlog buildup.

### Stale Run Detection

A run is considered **stale** if:

- It has been in `'running'` status for more than **4 hours**, AND
- The recorded PID is no longer alive (process liveness check)

Stale runs are automatically cleaned up to free slots that were locked by crashed or killed processes.

### Completed Run Cleanup

Run records with `'success'` or `'failure'` status are automatically removed **24 hours** after completion. This keeps the `runs/` directory from growing indefinitely.

## File-Based Locking

The locking mechanism uses atomic file operations (`O_CREAT|O_EXCL`) rather than OS-level advisory locks. This approach:

- Works reliably on Windows (NTFS)
- Survives process crashes (stale detection handles orphaned locks)
- Requires no external dependencies
- Is compatible with network drives (though not recommended for high-contention scenarios)
