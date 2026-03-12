#!/usr/bin/env node
/**
 * Swaps .mcp.json between local dev and published npm versions.
 *
 * Usage:
 *   node scripts/swap-mcp-config.js dev    → points to local dist/mcp-server.js
 *   node scripts/swap-mcp-config.js publish → points to npx @patrick-rodgers/cron-claude@latest
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mcpPath = join(__dirname, '..', '.mcp.json');

const configs = {
  dev: {
    mcpServers: {
      'cron-claude': {
        command: 'node',
        args: ['dist/mcp-server.js'],
      },
    },
  },
  publish: {
    mcpServers: {
      'cron-claude': {
        command: 'npx',
        args: ['@patrick-rodgers/cron-claude@latest'],
      },
    },
  },
};

const mode = process.argv[2];

if (!mode || !configs[mode]) {
  console.error('Usage: node scripts/swap-mcp-config.js <dev|publish>');
  process.exit(1);
}

writeFileSync(mcpPath, JSON.stringify(configs[mode], null, 2) + '\n', 'utf-8');
console.log(`✓ .mcp.json switched to "${mode}" mode`);
