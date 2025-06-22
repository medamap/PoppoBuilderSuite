#!/usr/bin/env node

/**
 * Test the i18n coverage and validation tools
 */

const { spawn } = require('child_process');
const path = require('path');
const chalk = require('chalk');

async function runCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    console.log(chalk.blue(`\nRunning: ${command} ${args.join(' ')}`));
    console.log(chalk.blue('─'.repeat(50)));
    
    const proc = spawn('node', [command, ...args], {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });
    
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

async function main() {
  console.log(chalk.green.bold('Testing i18n Tools'));
  console.log(chalk.green('═'.repeat(50)));
  
  try {
    // Test coverage tool
    console.log(chalk.yellow('\n1. Testing Coverage Tool'));
    await runCommand('scripts/i18n-coverage.js');
    
    // Test coverage with verbose output
    console.log(chalk.yellow('\n2. Testing Coverage Tool (Verbose)'));
    await runCommand('scripts/i18n-coverage.js', ['--verbose']);
    
    // Test unused keys check
    console.log(chalk.yellow('\n3. Testing Unused Keys Check'));
    await runCommand('scripts/i18n-coverage.js', ['--check-unused']);
    
    // Test validator
    console.log(chalk.yellow('\n4. Testing Validator'));
    await runCommand('scripts/i18n-validator.js');
    
    // Test validator with verbose
    console.log(chalk.yellow('\n5. Testing Validator (Verbose)'));
    await runCommand('scripts/i18n-validator.js', ['--verbose']);
    
    // Generate reports
    console.log(chalk.yellow('\n6. Generating JSON Reports'));
    await runCommand('scripts/i18n-coverage.js', ['--json']);
    await runCommand('scripts/i18n-validator.js', ['--json']);
    
    console.log(chalk.green.bold('\n✓ All i18n tools tested successfully!'));
    console.log(chalk.gray('\nReports generated:'));
    console.log(chalk.gray('  - i18n-coverage-report.json'));
    console.log(chalk.gray('  - i18n-validation-report.json'));
    
  } catch (error) {
    console.error(chalk.red(`\nError: ${error.message}`));
    process.exit(1);
  }
}

main();