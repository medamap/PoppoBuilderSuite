#!/usr/bin/env node

/**
 * Setup Wizard Demo
 * Demonstrates the interactive setup wizard functionality
 */

const chalk = require('chalk');
const SetupWizard = require('../lib/commands/setup-wizard');

async function runDemo() {
  console.log(chalk.blue('='.repeat(60)));
  console.log(chalk.blue.bold('PoppoBuilder Setup Wizard Demo'));
  console.log(chalk.blue('='.repeat(60)));
  console.log();
  console.log(chalk.gray('This demo shows how the setup wizard guides users through'));
  console.log(chalk.gray('the initial environment setup for PoppoBuilder.'));
  console.log();

  const wizard = new SetupWizard();
  
  // Run the setup with different options
  console.log(chalk.yellow('Running setup wizard...'));
  console.log();

  const options = {
    skipAutoFix: false  // Allow automatic fixes where possible
  };

  try {
    const success = await wizard.runSetup(options);
    
    if (success) {
      console.log(chalk.green('\n✅ Setup completed successfully!'));
      console.log(chalk.gray('\nYour environment is now ready for PoppoBuilder.'));
      console.log(chalk.gray('You can run "poppobuilder init" to initialize a project.'));
    } else {
      console.log(chalk.red('\n❌ Setup was not completed.'));
      console.log(chalk.yellow('Please complete the missing steps manually.'));
    }
  } catch (error) {
    console.error(chalk.red('\n❌ Setup wizard encountered an error:'), error.message);
  }

  console.log();
  console.log(chalk.blue('='.repeat(60)));
}

// Show available features
function showFeatures() {
  console.log(chalk.cyan('\nSetup Wizard Features:'));
  console.log(chalk.gray('------------------------'));
  console.log('✅ Comprehensive dependency checking:');
  console.log('   - Node.js version compatibility (v14.0.0+)');
  console.log('   - npm/yarn availability check');
  console.log('   - Git version verification (v2.0.0+)');
  console.log('   - Claude CLI detection and setup');
  console.log('✅ Git repository validation and setup');
  console.log('✅ GitHub CLI installation and authentication check');
  console.log('✅ Work branch creation for PoppoBuilder');
  console.log('✅ Automatic fixes where possible');
  console.log('✅ Claude CLI integration for interactive guidance');
  console.log('✅ Installation guides for missing dependencies');
  console.log('✅ Fallback to manual instructions when Claude is unavailable');
  console.log('✅ Step-by-step validation');
  console.log('✅ Retry mechanism for failed steps');
  console.log();
}

// Main execution
(async () => {
  showFeatures();
  
  console.log(chalk.yellow('Press any key to start the demo...'));
  
  // Wait for user input
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.once('data', async () => {
    process.stdin.setRawMode(false);
    console.log();
    
    await runDemo();
    process.exit(0);
  });
})().catch(error => {
  console.error(chalk.red('Demo error:'), error);
  process.exit(1);
});