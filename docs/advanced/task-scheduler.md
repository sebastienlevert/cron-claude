# Windows Task Scheduler Integration

cron-agents uses Windows Task Scheduler as its execution backend, providing reliable, OS-level scheduling that runs whether or not your terminal is open.

## How Tasks Are Registered

When you run `register`, cron-agents:

1. Parses the cron expression into a trigger type (daily/weekly/monthly)
2. Detects the Node.js path and agent CLI path
3. Generates full Task Scheduler XML with proper trigger configuration
4. Registers via `Register-ScheduledTask` PowerShell cmdlet

## Task Naming

All tasks are registered with a consistent naming convention:

**Format:** `cron-agents-{taskId}`

**Example:** Task `morning-greeting` → Scheduler name `cron-agents-morning-greeting`

This prefix ensures cron-agents tasks are easily identifiable and don't conflict with other scheduled tasks.

## Trigger Types

cron-agents converts cron expressions into the appropriate Task Scheduler trigger format.

### Daily

`ScheduleByDay` with `DaysInterval=1`:

```xml
<ScheduleByDay>
  <DaysInterval>1</DaysInterval>
</ScheduleByDay>
```

### Weekly

`ScheduleByWeek` with specific days of the week:

```xml
<ScheduleByWeek>
  <WeeksInterval>1</WeeksInterval>
  <DaysOfWeek>
    <Monday />
    <Wednesday />
    <Friday />
  </DaysOfWeek>
</ScheduleByWeek>
```

### Monthly

`ScheduleByMonth` with specific days and months:

```xml
<ScheduleByMonth>
  <Months><January /><April /><July /><October /></Months>
  <DaysOfMonth><Day>1</Day></DaysOfMonth>
</ScheduleByMonth>
```

## Task Action

The scheduled task executes the following command:

```
node.exe "dist/executor.js" "path/to/task.md" ["agent-path"]
```

- `node.exe` — The Node.js runtime detected at registration time
- `dist/executor.js` — The compiled executor module
- `path/to/task.md` — Full path to the task definition file
- `agent-path` — Optional path to the agent CLI (if not in PATH)

## Task Settings

Registered tasks are configured with the following settings:

| Setting | Value | Description |
|---------|-------|-------------|
| Logon type | `S4U` | Runs whether user is logged in or not |
| Run level | `LeastPrivilege` | No admin elevation required |
| DisallowStartIfOnBatteries | `false` | Runs even on battery power |
| StartWhenAvailable | `true` | Catches up missed runs |
| Hidden | `true` | Doesn't clutter Task Scheduler UI |
| AllowStartOnDemand | `true` | Can be triggered manually |

::: tip
`StartWhenAvailable: true` means if your computer was asleep or off when a task was scheduled, it will run as soon as the system is available again.
:::

## Elevation

If registration fails with an "Access Denied" error, cron-agents automatically attempts elevation via:

```powershell
Start-Process -Verb RunAs
```

This launches an elevated PowerShell process to register the task. You may see a UAC prompt in this case.

## Managing via Windows

You can view and manage cron-agents tasks directly through Windows tools:

### Task Scheduler GUI

Open `taskschd.msc` and look for tasks prefixed with `cron-agents-`:

```
taskschd.msc
```

### PowerShell

```powershell
# List all cron-agents tasks
Get-ScheduledTask -TaskName "cron-agents-*"

# Get detailed info about a specific task
Get-ScheduledTaskInfo -TaskName "cron-agents-morning-greeting"
```

### schtasks

```cmd
schtasks /Query /TN "cron-agents-my-task"
```

## PowerShell Commands Used

The following table shows the PowerShell commands cron-agents uses internally:

| Action | Command |
|--------|---------|
| Register | `Register-ScheduledTask -TaskName ... -Xml ... -Force` |
| Unregister | `Unregister-ScheduledTask -TaskName ... -Confirm:$false` |
| Enable | `schtasks /Change /TN ... /ENABLE` |
| Disable | `schtasks /Change /TN ... /DISABLE` |
| Status | `Get-ScheduledTask` + `Get-ScheduledTaskInfo` |

::: info
The `Register-ScheduledTask` command uses the `-Force` flag, which means re-registering a task will overwrite the existing registration. This is useful when updating a task's schedule.
:::
