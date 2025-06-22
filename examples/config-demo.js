#!/usr/bin/env node

/**
 * Demo script for PoppoBuilder config command
 * Shows how configuration can be updated dynamically
 */

const { spawn } = require('child_process');
const path = require('path');

// Path to poppobuilder CLI
const cliPath = path.join(__dirname, '..', 'bin', 'poppobuilder');

async function runCommand(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [cliPath, ...args], {
      stdio: 'inherit'
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });
  });
}

async function demo() {
  console.log('PoppoBuilder Config Command Demo\n');
  console.log('=================================\n');

  try {
    // Show current configuration
    console.log('1. Current configuration:');
    console.log('------------------------');
    await runCommand(['config', '--list']);
    console.log('\n');

    // Set max processes
    console.log('2. Setting max processes to 3:');
    console.log('------------------------------');
    await runCommand(['config', '--max-processes', '3']);
    console.log('\n');

    // Set scheduling strategy
    console.log('3. Setting scheduling strategy to weighted:');
    console.log('-------------------------------------------');
    await runCommand(['config', '--strategy', 'weighted']);
    console.log('\n');

    // Get specific value
    console.log('4. Getting daemon.maxProcesses value:');
    console.log('-------------------------------------');
    await runCommand(['config', 'get', 'daemon.maxProcesses']);
    console.log('\n');

    // Set logging level
    console.log('5. Setting logging level to debug:');
    console.log('----------------------------------');
    await runCommand(['config', 'set', 'logging.level', 'debug']);
    console.log('\n');

    // Show final configuration
    console.log('6. Final configuration:');
    console.log('-----------------------');
    await runCommand(['config', '--list']);
    console.log('\n');

    console.log('Demo completed successfully!');
    console.log('\nNote: If the daemon is running, some changes will be applied immediately,');
    console.log('while others may require a daemon restart.');

  } catch (error) {
    console.error('Demo failed:', error.message);
    process.exit(1);
  }
}

// Run demo
demo();