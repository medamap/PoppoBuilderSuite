#!/usr/bin/env node

/**
 * Test script for runtime language switching functionality
 */

const { spawn } = require('child_process');
const path = require('path');
const chalk = require('chalk');

const cliPath = path.join(__dirname, '../bin/poppobuilder.js');

console.log(chalk.blue('Testing runtime language switching...\n'));

// Test cases
const tests = [
  {
    name: 'Default language (English)',
    args: ['--help'],
    expectedPatterns: ['AI-powered autonomous GitHub issue processor', 'Options:', 'Examples:']
  },
  {
    name: 'Japanese language via --lang',
    args: ['--lang', 'ja', '--help'],
    expectedPatterns: ['Claude APIを使用したAI駆動の自律GitHubイシュープロセッサ', 'オプション:', '例:']
  },
  {
    name: 'English language explicitly',
    args: ['--lang', 'en', '--help'],
    expectedPatterns: ['AI-powered autonomous GitHub issue processor', 'Options:', 'Examples:']
  },
  {
    name: 'Japanese via environment variable',
    env: { POPPOBUILDER_LANG: 'ja' },
    args: ['--help'],
    expectedPatterns: ['Claude APIを使用したAI駆動の自律GitHubイシュープロセッサ', 'オプション:', '例:']
  }
];

let passed = 0;
let failed = 0;

async function runTest(test, index) {
  console.log(chalk.yellow(`Test ${index + 1}: ${test.name}`));
  
  return new Promise((resolve) => {
    const env = { ...process.env, ...test.env };
    const child = spawn('node', [cliPath, ...test.args], { env });
    
    let output = '';
    let errorOutput = '';
    
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    child.on('close', (code) => {
      const fullOutput = output + errorOutput;
      let success = true;
      
      for (const pattern of test.expectedPatterns) {
        if (!fullOutput.includes(pattern)) {
          console.log(chalk.red(`  ✗ Expected pattern not found: "${pattern}"`));
          success = false;
        } else {
          console.log(chalk.green(`  ✓ Found pattern: "${pattern}"`));
        }
      }
      
      if (success) {
        console.log(chalk.green(`  Test passed!\n`));
        passed++;
      } else {
        console.log(chalk.red(`  Test failed!\n`));
        console.log(chalk.gray('  Output preview:'));
        console.log(chalk.gray('  ' + fullOutput.split('\n').slice(0, 5).join('\n  ')));
        console.log();
        failed++;
      }
      
      resolve();
    });
  });
}

async function runAllTests() {
  for (let i = 0; i < tests.length; i++) {
    await runTest(tests[i], i);
  }
  
  console.log(chalk.blue('\nTest Summary:'));
  console.log(chalk.green(`  Passed: ${passed}`));
  if (failed > 0) {
    console.log(chalk.red(`  Failed: ${failed}`));
  }
  console.log(chalk.blue(`  Total: ${tests.length}`));
  
  process.exit(failed > 0 ? 1 : 0);
}

runAllTests().catch(console.error);