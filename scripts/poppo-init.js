#!/usr/bin/env node

/**
 * Legacy poppo-init command redirector
 * Redirects to new unified initialization flow
 */

const chalk = require('chalk');
const { execSync } = require('child_process');

console.log(chalk.yellow('⚠️  poppo-init is deprecated. Redirecting to poppo-builder init...'));
console.log();

try {
  // Redirect to new command
  execSync('poppo-builder init', { stdio: 'inherit' });
} catch (error) {
  // If poppo-builder is not found, show helpful message
  console.error(chalk.red('Error: poppo-builder command not found.'));
  console.error(chalk.yellow('Please ensure PoppoBuilder Suite is installed globally:'));
  console.error(chalk.cyan('  npm install -g poppo-builder-suite'));
  process.exit(1);
}