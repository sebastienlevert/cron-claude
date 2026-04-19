#!/usr/bin/env node
/**
 * Pre-publish validation script
 * Ensures package is ready for publishing
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

let errors = 0;

function check(name, condition, message) {
  if (condition) {
    console.log(`✓ ${name}`);
  } else {
    console.error(`✗ ${name}: ${message}`);
    errors++;
  }
}

console.log('🔍 Validating package before publish...\n');

// 1. Check package.json exists
const pkgPath = join(ROOT, 'package.json');
check('package.json exists', existsSync(pkgPath), 'Missing package.json');

if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

  // 2. Check version format
  check('Version format', /^\d+\.\d+\.\d+/.test(pkg.version), `Invalid version: ${pkg.version}`);

  // 3. Check required fields
  check('Name field', pkg.name === '@sebastienlevert/cron-agents', 'Incorrect package name');
  check('Description', pkg.description && pkg.description.length > 10, 'Missing or short description');
  check('License', pkg.license === 'MIT', 'Missing or incorrect license');
  check('Repository', pkg.repository && pkg.repository.url, 'Missing repository URL');

  // 4. Check files array
  const requiredFiles = ['dist', '.claude-plugin', '.mcp.json', 'CLAUDE.md', 'commands', 'hooks', 'skills'];
  const hasAllFiles = requiredFiles.every(f => pkg.files.includes(f));
  check('Required files', hasAllFiles, `Missing required files in package.json`);

  // 5. Check bin field
  check('Binary entry point', pkg.bin && pkg.bin['cron-agents'], 'Missing binary entry point');

  // 6. Check main field
  check('Main entry point', pkg.main === 'dist/mcp-server.js', 'Incorrect main entry point');

  // 7. Check type is module
  check('Module type', pkg.type === 'module', 'Package should be type: module');
}

// 8. Check plugin.json exists and matches version
const pluginPath = join(ROOT, '.claude-plugin', 'plugin.json');
check('plugin.json exists', existsSync(pluginPath), 'Missing .claude-plugin/plugin.json');

if (existsSync(pluginPath)) {
  const plugin = JSON.parse(readFileSync(pluginPath, 'utf-8'));
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

  check('Version sync', plugin.version === pkg.version,
    `Version mismatch: package.json=${pkg.version}, plugin.json=${plugin.version}`);

  check('Plugin name', plugin.name === 'cron-agents', 'Incorrect plugin name');

  check('MCP permissions', plugin.permissions && plugin.permissions.mcp, 'Missing MCP permissions');
}

// 9. Check dist directory exists
check('dist/ built', existsSync(join(ROOT, 'dist', 'mcp-server.js')), 'Missing dist/mcp-server.js - run npm run build');

// 10. Check required plugin files
check('commands/ exists', existsSync(join(ROOT, 'commands')), 'Missing commands directory');
check('hooks/ exists', existsSync(join(ROOT, 'hooks')), 'Missing hooks directory');
check('skills/ exists', existsSync(join(ROOT, 'skills')), 'Missing skills directory');
check('tasks/ exists', existsSync(join(ROOT, 'tasks')), 'Missing tasks directory');

// 11. Check README exists and has content
const readmePath = join(ROOT, 'README.md');
if (existsSync(readmePath)) {
  const readme = readFileSync(readmePath, 'utf-8');
  check('README.md content', readme.length > 1000, 'README.md is too short');
  check('README has installation', readme.includes('Installation'), 'README missing installation section');
} else {
  check('README.md exists', false, 'Missing README.md');
}

// 12. Check LICENSE exists
check('LICENSE exists', existsSync(join(ROOT, 'LICENSE')), 'Missing LICENSE file');

// 13. Check .mcp.json exists
check('.mcp.json exists', existsSync(join(ROOT, '.mcp.json')), 'Missing .mcp.json');

console.log('\n' + '='.repeat(50));

if (errors === 0) {
  console.log('✅ All validations passed! Ready to publish.');
  process.exit(0);
} else {
  console.error(`❌ ${errors} validation error(s) found. Fix them before publishing.`);
  process.exit(1);
}
