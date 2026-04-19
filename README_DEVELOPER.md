# Developer Guide - cron-agents

## Recent Changes

### Storage Abstraction Implementation ✅
**Commit:** `802685d` - feat: add flexible task storage with memory MCP integration

- Implemented pluggable storage system supporting file and memory backends
- Auto-detection with fallback to file storage
- OneDrive sync capability via odsp-memory MCP
- Full backward compatibility maintained

### ESM Compatibility Fixes ✅
**Commit:** `68a4659` - fix: replace CommonJS require() with ESM imports

- Fixed all `require()` calls in ESM modules
- Proper ES module imports throughout codebase
- Resolves "require is not defined" errors

### Development Configuration ✅
**Commit:** `e3f63bf` - chore: configure local development and add testing guide

- Local .mcp.json pointing to development build
- Comprehensive testing documentation
- Ready for local testing after MCP restart

## Quick Start - Local Development

### 1. Install Dependencies
```bash
cd D:\github\cron-agents
npm install
```

### 2. Build Project
```bash
npm run build
```

### 3. Link for Local Testing
```bash
npm link
```

### 4. Configure Claude Code

**Option A: Project-level (Recommended for dev)**

The `.mcp.json` in the project root is already configured for local development:
```json
{
  "mcpServers": {
    "cron-agents": {
      "command": "node",
      "args": ["D:\\github\\cron-agents\\dist\\mcp-server.js"]
    }
  }
}
```

**Option B: Global Configuration**

Add to `~/.claude/config.json`:
```json
{
  "mcpServers": {
    "cron-agents": {
      "command": "node",
      "args": ["D:\\github\\cron-agents\\dist\\mcp-server.js"]
    }
  }
}
```

### 5. Restart Claude Code

**IMPORTANT:** MCP servers are loaded when Claude Code starts. To test new changes:

1. **Save your work**
2. **Exit Claude Code completely**
3. **Restart Claude Code**
4. **Reopen the project**
5. **Run tests** (see FIXES_AND_TESTING.md)

## Development Workflow

### Making Changes

1. Edit source files in `src/`
2. Run build: `npm run build`
3. Test changes: **Must restart Claude Code session**
4. Commit changes: `git commit -m "your message"`

### Testing Changes

Since you can't restart MCP server from inside a session:

**Option 1: Full Restart (Recommended)**
```bash
# Exit Claude Code, then restart
# Changes will be loaded automatically
```

**Option 2: MCP Inspector (Standalone Testing)**
```bash
npm run test
# Opens MCP Inspector for standalone testing
```

**Option 3: Direct Execution (Executor only)**
```bash
node dist/executor.js tasks/your-task.md
```

## Current Status

### ✅ Completed
- Storage abstraction layer implemented
- File storage fully functional
- Memory storage ready (requires odsp-memory)
- All ESM issues fixed
- TypeScript compilation clean
- Local development configured

### ⏳ Requires MCP Restart to Test
- Task execution via `cron_run_task`
- Task registration with Windows Task Scheduler
- Full end-to-end workflow
- Storage type detection in `cron_status`

### 📋 Test Task Ready
Created `morning-greeting` task:
```yaml
id: morning-greeting
schedule: "0 9 * * *"
invocation: cli
enabled: true
```

## File Structure

```
cron-agents/
├── src/
│   ├── storage/           # NEW: Storage abstraction
│   │   ├── interface.ts   # TaskStorage interface
│   │   ├── file-storage.ts
│   │   ├── memory-storage.ts
│   │   ├── factory.ts
│   │   └── index.ts
│   ├── mcp-server.ts      # UPDATED: Uses storage
│   ├── executor.ts        # FIXED: ESM imports
│   ├── logger.ts          # FIXED: ESM imports
│   ├── cli.ts             # FIXED: ESM imports
│   ├── config.ts          # UPDATED: New fields
│   ├── types.ts           # UPDATED: Config interface
│   ├── scheduler.ts
│   └── notifier.ts
├── dist/                  # Compiled output
├── tasks/                 # Task definitions
│   └── morning-greeting.md
├── .mcp.json             # LOCAL DEV: Points to dist/
├── package.json
├── tsconfig.json
├── CLAUDE.md             # Project documentation
├── IMPLEMENTATION_SUMMARY.md  # Storage implementation details
├── FIXES_AND_TESTING.md       # Testing checklist
└── README_DEVELOPER.md        # THIS FILE

```

## Architecture

### Storage Layer
```
TaskStorage Interface
    ├── FileStorage (default)
    │   └── tasks/*.md files
    └── MemoryStorage (when available)
        └── odsp-memory MCP
```

### Detection Flow
```
1. loadConfig()
2. createStorage()
   ├── Check config.storageType
   ├── Test odsp-memory availability
   └── Save preference
3. Initialize MCP server
```

## Common Issues

### "require is not defined"
**Status:** ✅ Fixed
**Solution:** Already resolved - all require() replaced with ES imports

### MCP Server Using Old Code
**Status:** Expected behavior
**Solution:** Restart Claude Code session to reload MCP server

### Task Registration Fails
**Check:**
- Windows Task Scheduler permissions
- Node.js in PATH
- PowerShell execution policy

### Storage Not Detected
**Check:**
- `~/.cron-agents/config.json` for storageType
- odsp-memory availability: `odsp-memory status`

## Git Workflow

### Recent Commits
```
e3f63bf chore: configure local development and add testing guide
68a4659 fix: replace CommonJS require() with ESM imports
802685d feat: add flexible task storage with memory MCP integration
```

### Committing Changes
```bash
git add <files>
git commit -m "type: description

Details...

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

## Publishing

### Pre-publish Checklist
- [ ] All tests passing
- [ ] Version bumped in package.json and .claude-plugin/plugin.json
- [ ] CHANGELOG.md updated
- [ ] Documentation complete
- [ ] Clean build: `npm run build`

### Publish to npm
```bash
npm version patch  # or minor/major
npm publish --access public
```

### Update .mcp.json for Production
Revert .mcp.json to use npx:
```json
{
  "command": "cmd",
  "args": ["/c", "npx", "@sebastienlevert/cron-agents"]
}
```

## Next Steps

1. **Exit and restart Claude Code** to load new MCP server code
2. **Run test checklist** from FIXES_AND_TESTING.md
3. **Register test task** with Windows Task Scheduler
4. **Verify end-to-end** task execution
5. **Test storage detection** (file vs memory)

## Support

- **Issues:** https://github.com/sebastienlevert/cron-agents/issues
- **Documentation:** See CLAUDE.md and README.md
- **Testing Guide:** See FIXES_AND_TESTING.md
