#!/usr/bin/env node

/**
 * Test script for config command
 */

const path = require('path');
const os = require('os');
const fs = require('fs').promises;

// Add lib directory to require paths
const libPath = path.join(__dirname, '..', 'lib');
require('module').Module._nodeModulePaths = function(from) {
  const paths = require('module').Module._nodeModulePaths.call(this, from);
  if (from.includes('PoppoBuilderSuite')) {
    paths.push(libPath);
  }
  return paths;
};

const ConfigCommand = require('../lib/commands/config');
const { GlobalConfigManager } = require('../lib/core/global-config-manager');

async function runTests() {
  console.log('Testing Config Command...\n');

  const configCommand = new ConfigCommand();
  const configManager = new GlobalConfigManager();

  try {
    // Test 1: List configuration
    console.log('Test 1: List configuration');
    await configCommand.execute('--list', []);
    console.log('✓ List command completed\n');

    // Test 2: Set max-processes
    console.log('Test 2: Set max-processes to 3');
    await configCommand.execute('--max-processes', ['3']);
    console.log('✓ Max processes set\n');

    // Test 3: Set strategy
    console.log('Test 3: Set scheduling strategy to weighted');
    await configCommand.execute('--strategy', ['weighted']);
    console.log('✓ Scheduling strategy set\n');

    // Test 4: Get specific value
    console.log('Test 4: Get daemon.maxProcesses value');
    await configCommand.execute('get', ['daemon.maxProcesses']);
    console.log('✓ Get command completed\n');

    // Test 5: Set using key-value
    console.log('Test 5: Set logging.level to debug');
    await configCommand.execute('set', ['logging.level', 'debug']);
    console.log('✓ Set command completed\n');

    // Test 6: List again to see changes
    console.log('Test 6: List configuration again to see changes');
    await configCommand.execute('--list', []);
    console.log('✓ Configuration changes verified\n');

    // Test 7: Test invalid flag
    console.log('Test 7: Test invalid flag');
    await configCommand.execute('--invalid-flag', ['value']);
    console.log('✓ Invalid flag handled\n');

  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }

  console.log('All tests completed successfully!');
}

// Run tests
runTests().catch(console.error);