#!/usr/bin/env node

/**
 * Test table formatter with i18n
 */

const { initI18n } = require('../lib/i18n');
const runtimeSwitcher = require('../lib/i18n/runtime-switcher');
const tableFormatter = require('../lib/utils/table-formatter');
const chalk = require('chalk');

// Sample data
const projects = [
  {
    id: 'poppo-01',
    name: 'PoppoBuilder Core',
    status: 'enabled',
    priority: 90,
    path: '/home/user/projects/poppobuilder-core',
    issues: 1234,
    errors: 12,
    lastActivity: new Date('2024-01-15')
  },
  {
    id: 'medama-02',
    name: 'MedamaRepair',
    status: 'disabled',
    priority: 70,
    path: '/home/user/projects/medama-repair',
    issues: 567,
    errors: 3,
    lastActivity: new Date('2024-01-10')
  },
  {
    id: 'mera-03',
    name: 'MeraCleaner',
    status: 'enabled',
    priority: 60,
    path: '/home/user/projects/mera-cleaner-with-very-long-path-name',
    issues: 890,
    errors: 45,
    lastActivity: null
  }
];

async function testTableDisplay(lang) {
  console.log(chalk.blue(`\n=== Testing table display in ${lang.toUpperCase()} ===\n`));
  
  // Switch language
  await runtimeSwitcher.switchLanguage(lang);
  
  // Basic table
  console.log(chalk.yellow('Basic Table:'));
  const basicTable = tableFormatter.formatTable(projects, {
    columns: [
      { key: 'id', labelKey: 'table:columns.id' },
      { key: 'name', labelKey: 'table:columns.name' },
      { key: 'status', labelKey: 'table:columns.status' },
      { key: 'priority', labelKey: 'table:columns.priority', align: 'right' }
    ]
  });
  console.log(basicTable);
  
  // Verbose table with formatting
  console.log(chalk.yellow('\nVerbose Table with Formatting:'));
  const verboseTable = tableFormatter.formatTable(projects, {
    columns: [
      { key: 'id', labelKey: 'table:columns.id', maxWidth: 15 },
      { key: 'name', labelKey: 'table:columns.name', maxWidth: 20 },
      { 
        key: 'status', 
        labelKey: 'table:columns.status',
        formatter: (value) => {
          return value === 'enabled' ? chalk.green('✓ ' + value) : chalk.red('✗ ' + value);
        }
      },
      { key: 'priority', labelKey: 'table:columns.priority', align: 'right' },
      { key: 'path', labelKey: 'table:columns.path', maxWidth: 30 },
      { key: 'issues', labelKey: 'table:columns.issues', align: 'right' },
      { key: 'errors', labelKey: 'table:columns.errors', align: 'right' },
      { 
        key: 'lastActivity', 
        labelKey: 'table:columns.lastActivity',
        formatter: (value) => value ? value.toLocaleDateString() : '-'
      }
    ],
    summary: true
  });
  console.log(verboseTable);
  
  // List display
  console.log(chalk.yellow('\nList Display:'));
  const list = tableFormatter.formatList(
    projects.map(p => `${p.name} (${p.id})`),
    {
      title: chalk.bold('Project List'),
      numbered: true
    }
  );
  console.log(list);
  
  // Key-value display
  console.log(chalk.yellow('\nKey-Value Display:'));
  const details = tableFormatter.formatKeyValue({
    id: projects[0].id,
    name: projects[0].name,
    status: projects[0].status,
    priority: projects[0].priority,
    created: new Date('2023-01-01'),
    tags: ['automation', 'ai', 'github'],
    active: true
  }, {
    title: chalk.bold('Project Details')
  });
  console.log(details);
}

async function main() {
  try {
    // Initialize i18n
    await initI18n();
    
    // Test in both languages
    await testTableDisplay('en');
    await testTableDisplay('ja');
    
    console.log(chalk.green('\n✓ All tests completed!'));
  } catch (error) {
    console.error(chalk.red('Test failed:'), error);
    process.exit(1);
  }
}

main();