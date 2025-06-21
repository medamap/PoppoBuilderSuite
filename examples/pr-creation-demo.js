#!/usr/bin/env node

/**
 * PR Creation Demo
 * Demonstrates the PoppoBuilder PR creation command
 */

const { execSync } = require('child_process');
const chalk = require('chalk');
const path = require('path');

console.log(chalk.blue('🔀 PoppoBuilder PR Creation Demo\n'));

console.log('This demo will show you how to use the PoppoBuilder PR creation command.\n');

console.log(chalk.yellow('Available commands:'));
console.log('  poppobuilder pr              # Interactive PR creation');
console.log('  poppobuilder pr --draft      # Create as draft PR');
console.log('  poppobuilder pr --base main  # Target specific branch');
console.log('  poppobuilder pr --no-claude  # Skip Claude assistance\n');

console.log(chalk.gray('Prerequisites:'));
console.log('  ✓ Git repository initialized');
console.log('  ✓ GitHub CLI (gh) installed and authenticated');
console.log('  ✓ Claude CLI (optional, for AI assistance)\n');

console.log(chalk.green('Example workflow:'));
console.log('1. Make some changes to your code');
console.log('2. Run: poppobuilder pr');
console.log('3. Follow the interactive prompts to:');
console.log('   - Commit or stash uncommitted changes');
console.log('   - Select target branch');
console.log('   - Enter PR title and description');
console.log('   - Optionally use Claude to improve PR description');
console.log('4. PR will be created and opened in browser\n');

console.log(chalk.blue('Try it now:'));
console.log('  cd /path/to/your/project');
console.log('  poppobuilder pr\n');

// If running directly, show the help
if (require.main === module) {
  try {
    console.log(chalk.gray('Running: poppobuilder pr --help\n'));
    execSync('node ' + path.join(__dirname, '..', 'bin', 'poppobuilder.js') + ' pr --help', {
      stdio: 'inherit'
    });
  } catch (error) {
    console.error(chalk.red('Error:'), error.message);
  }
}