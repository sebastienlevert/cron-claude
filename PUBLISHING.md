# Publishing Guide

This guide explains how to publish `cron-agents` to npm.

## 🚀 Quick Publish

When you're ready to publish, just run:

```bash
npm publish --access public
```

That's it! All pre-publish steps are **automated** via npm scripts.

## 🔄 What Happens Automatically

When you run `npm publish`, the following scripts run automatically in order:

### 1. **prepublishOnly** (runs first)
```bash
npm run build && npm run validate
```

This ensures:
- ✅ TypeScript compiles successfully
- ✅ All validation checks pass

### 2. **validate** (runs during prepublishOnly)
```bash
node scripts/validate.js
```

Checks 23 things including:
- ✅ Version format (semver)
- ✅ Package name correct
- ✅ Description exists
- ✅ License is MIT
- ✅ Repository URL exists
- ✅ All required files in `files` array
- ✅ Binary entry point configured
- ✅ Main entry point correct
- ✅ Module type is ESM
- ✅ `.claude-plugin/plugin.json` exists
- ✅ Version sync between package.json and plugin.json
- ✅ Plugin name correct
- ✅ MCP permissions configured
- ✅ `dist/` directory built
- ✅ `commands/` directory exists
- ✅ `hooks/` directory exists
- ✅ `skills/` directory exists
- ✅ `tasks/` directory exists
- ✅ README.md has content
- ✅ README has installation section
- ✅ LICENSE exists
- ✅ `.mcp.json` exists

### 3. **prepare** (runs after validation)
```bash
npm run build
```

Final build before packaging (ensures dist/ is up-to-date).

### 4. **Package Creation**
npm creates the tarball with all files from the `files` array.

## 📦 What Gets Published

The published package includes:

```
@sebastienlevert/cron-agents@0.1.0
├── dist/                          # Compiled JavaScript
├── .claude-plugin/plugin.json     # Plugin manifest
├── .mcp.json                      # MCP server config
├── CLAUDE.md                      # Project documentation
├── commands/                      # Slash commands
│   ├── cron-status.md
│   ├── cron-list.md
│   └── cron-run.md
├── hooks/                         # Session hooks
│   ├── hooks.json
│   └── session-start.sh
├── skills/                        # Skill documentation
│   └── cron/SKILL.md
├── tasks/                         # Example tasks
│   ├── example-daily-summary.md
│   └── example-weekly-backup.md
├── README.md                      # User documentation
├── LICENSE                        # MIT license
└── package.json                   # Package metadata
```

## 🔢 Version Bumping

To increment version and publish:

### Patch Version (0.1.0 → 0.1.1)
```bash
npm version patch
npm publish --access public
```

### Minor Version (0.1.0 → 0.2.0)
```bash
npm version minor
npm publish --access public
```

### Major Version (0.1.0 → 1.0.0)
```bash
npm version major
npm publish --access public
```

**Note:** The `preversion` script automatically builds before version bump, and `postversion` pushes tags to git.

## 📋 Pre-Publish Checklist (Manual)

Before running `npm publish`, verify:

1. **Code is committed**
   ```bash
   git status  # Should be clean
   ```

2. **Tests pass**
   ```bash
   npm run validate  # Should show all ✓
   ```

3. **Version is correct**
   - Check `package.json` version
   - Check `.claude-plugin/plugin.json` version matches

4. **CHANGELOG updated** (if you have one)
   - Document changes for this version

5. **README is up-to-date**
   - Installation instructions correct
   - Examples reflect current API

6. **You're logged into npm**
   ```bash
   npm whoami  # Should show your username
   ```

## 🧪 Dry Run (Recommended First Time)

Test the publish process without actually publishing:

```bash
npm publish --dry-run --access public
```

This shows:
- What will be published
- Package size
- All files included
- Any warnings or errors

## 🔐 Authentication

Make sure you're logged into npm:

```bash
npm login
```

Or if you're already logged in:

```bash
npm whoami
```

## 📝 Post-Publish

After publishing:

1. **Verify on npm**
   - Visit https://www.npmjs.com/package/@sebastienlevert/cron-agents
   - Check version is updated
   - Verify README renders correctly

2. **Test installation**
   ```bash
   npx @sebastienlevert/cron-agents@latest
   ```

3. **Test plugin installation**
   ```bash
   claude plugin add @sebastienlevert/cron-agents
   ```

4. **Create GitHub release** (optional)
   ```bash
   gh release create v0.1.0 --generate-notes
   ```

## 🐛 Troubleshooting

### "Version already published"
```bash
# Bump version first
npm version patch
npm publish --access public
```

### "You must verify your email"
- Check your npm account email
- Click verification link

### "You do not have permission to publish"
- Make sure package name includes your scope: `@your-username/package`
- Use `--access public` flag for scoped packages

### "Validation failed"
```bash
# See what failed
npm run validate

# Fix errors and try again
npm publish --access public
```

### "prepublishOnly script failed"
```bash
# Run manually to see error
npm run prepublishOnly

# Usually means build or validation failed
npm run build
npm run validate
```

## 🔄 Automated Publishing (CI/CD)

For automated publishing via GitHub Actions, create `.github/workflows/publish.yml`:

```yaml
name: Publish to npm

on:
  release:
    types: [created]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Then create releases via GitHub, and publishing happens automatically.

## 📚 Additional Commands

### Check what will be packaged
```bash
npm pack --dry-run
```

### Create tarball locally (for testing)
```bash
npm pack
# Creates: sebastienlevert-cron-agents-0.1.0.tgz
```

### Test local tarball installation
```bash
npm install -g ./sebastienlevert-cron-agents-0.1.0.tgz
cron-agents  # Test binary works
```

### Unpublish (within 72 hours)
```bash
npm unpublish @sebastienlevert/cron-agents@0.1.0
```

**⚠️ Warning:** Unpublishing is permanent and can break dependent projects!

## ✅ Summary

**To publish:**
```bash
# 1. Make sure everything is committed
git status

# 2. Run dry-run to verify
npm publish --dry-run --access public

# 3. Publish for real
npm publish --access public
```

All validation and building happens automatically! 🚀
