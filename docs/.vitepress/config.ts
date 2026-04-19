import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'cron-agents',
  description: 'Scheduled coding agent tasks — MCP server & CLI for automating recurring tasks',
  base: '/cron-claude/',
  head: [['link', { rel: 'icon', href: '/cron-claude/favicon.ico' }]],
  themeConfig: {
    logo: '/logo.png',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'CLI', link: '/cli/' },
      { text: 'MCP Tools', link: '/mcp/' },
      { text: 'Config', link: '/configuration/' },
      {
        text: 'GitHub',
        link: 'https://github.com/sebastienlevert/cron-claude',
      },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Installation', link: '/guide/installation' },
          { text: 'Quick Start', link: '/guide/quick-start' },
          { text: 'Concepts', link: '/guide/concepts' },
        ],
      },
      {
        text: 'Task Authoring',
        items: [
          { text: 'Task Definitions', link: '/tasks/definitions' },
          { text: 'Scheduling', link: '/tasks/scheduling' },
          { text: 'Agents', link: '/tasks/agents' },
          { text: 'Invocation Modes', link: '/tasks/invocation' },
        ],
      },
      {
        text: 'CLI Reference',
        items: [
          { text: 'Overview', link: '/cli/' },
          { text: 'Task Management', link: '/cli/task-management' },
          { text: 'Execution', link: '/cli/execution' },
          { text: 'Monitoring', link: '/cli/monitoring' },
        ],
      },
      {
        text: 'MCP Tools Reference',
        items: [
          { text: 'Overview', link: '/mcp/' },
          { text: 'Task Management', link: '/mcp/task-management' },
          { text: 'Execution & Monitoring', link: '/mcp/execution' },
          { text: 'Verification & Status', link: '/mcp/verification' },
        ],
      },
      {
        text: 'Configuration',
        items: [
          { text: 'Overview', link: '/configuration/' },
          { text: 'Task Directories', link: '/configuration/task-directories' },
          { text: 'Concurrency', link: '/configuration/concurrency' },
          { text: 'Notifications', link: '/configuration/notifications' },
        ],
      },
      {
        text: 'Advanced',
        items: [
          { text: 'Audit Logging', link: '/advanced/audit-logging' },
          { text: 'Windows Task Scheduler', link: '/advanced/task-scheduler' },
          { text: 'Troubleshooting', link: '/advanced/troubleshooting' },
        ],
      },
    ],
    socialLinks: [
      {
        icon: 'github',
        link: 'https://github.com/sebastienlevert/cron-claude',
      },
    ],
    search: {
      provider: 'local',
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-present',
    },
  },
});
