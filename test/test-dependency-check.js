#!/usr/bin/env node

/**
 * Test script for dependency check functionality
 */

const chalk = require('chalk');
const SetupWizard = require('../lib/commands/setup-wizard');

async function testDependencyCheck() {
  console.log(chalk.blue('Testing Dependency Check Functionality\n'));
  
  const wizard = new SetupWizard();
  
  // Test system dependency check
  console.log(chalk.cyan('Running system dependency check...'));
  const depCheck = await wizard.checkSystemDependencies();
  
  console.log('\n' + chalk.yellow('Results:'));
  console.log('All dependencies passed:', depCheck.allPassed ? chalk.green('Yes') : chalk.red('No'));
  
  console.log('\n' + chalk.yellow('Dependency Details:'));
  depCheck.results.forEach(dep => {
    const status = dep.installed 
      ? (dep.isValid ? chalk.green('✓') : chalk.yellow('⚠'))
      : chalk.red('✗');
    
    console.log(`${status} ${dep.name}: ${dep.version || 'Not installed'} ${dep.isValid ? '' : `(min: ${dep.minVersion})`}`);
  });
  
  // Test version comparison
  console.log('\n' + chalk.cyan('Testing version comparison...'));
  const testCases = [
    ['14.0.0', '14.0.0', 0],
    ['16.0.0', '14.0.0', 1],
    ['12.0.0', '14.0.0', -1],
    ['14.1.0', '14.0.0', 1],
    ['14.0.1', '14.0.0', 1],
  ];
  
  testCases.forEach(([v1, v2, expected]) => {
    const result = wizard.compareVersions(v1, v2);
    const passed = result === expected;
    console.log(`${passed ? chalk.green('✓') : chalk.red('✗')} compareVersions('${v1}', '${v2}') = ${result} (expected: ${expected})`);
  });
  
  // Test validateDependencies
  console.log('\n' + chalk.cyan('Testing validateDependencies...'));
  const isValid = await wizard.validateDependencies();
  console.log('Dependencies valid:', isValid ? chalk.green('Yes') : chalk.red('No'));
}

// Run the test
testDependencyCheck().catch(error => {
  console.error(chalk.red('Test failed:'), error);
  process.exit(1);
});