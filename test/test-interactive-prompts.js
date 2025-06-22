#!/usr/bin/env node

/**
 * Test interactive prompts with i18n
 */

const { initI18n } = require('../lib/i18n');
const runtimeSwitcher = require('../lib/i18n/runtime-switcher');
const prompts = require('../lib/utils/interactive-prompts');
const chalk = require('chalk');

async function testPrompts(lang) {
  console.log(chalk.blue(`\n=== Testing prompts in ${lang.toUpperCase()} ===\n`));
  
  // Switch language
  await runtimeSwitcher.switchLanguage(lang);
  
  try {
    // Test basic ask
    const name = await prompts.ask('prompts:init.projectName', {
      default: 'my-project'
    });
    console.log(`Project name: ${name}`);
    
    // Test confirmation
    const confirmed = await prompts.confirm('prompts:remove.confirmRemove', {
      context: { name: 'test-project' },
      default: false
    });
    console.log(`Confirmed: ${confirmed}`);
    
    // Test selection
    const languages = [
      { name: 'English', value: 'en', nameKey: 'language:english' },
      { name: 'Japanese', value: 'ja', nameKey: 'language:japanese' }
    ];
    const selected = await prompts.select('prompts:init.primaryLanguage', languages, {
      default: 'en'
    });
    console.log(`Selected language: ${selected}`);
    
    // Test spinner
    const spinner = prompts.spinner('prompts:common.processing');
    setTimeout(() => {
      spinner.stop('prompts:common.done');
    }, 2000);
    
    // Wait for spinner to complete
    await new Promise(resolve => setTimeout(resolve, 2100));
    
    // Test progress bar
    const progress = prompts.progressBar('prompts:common.loading', 10);
    for (let i = 1; i <= 10; i++) {
      progress.update(i);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    prompts.close();
  }
}

async function main() {
  try {
    // Initialize i18n
    await initI18n();
    
    // Test in both languages
    await testPrompts('en');
    await testPrompts('ja');
    
    console.log(chalk.green('\n✓ All tests completed!'));
    process.exit(0);
  } catch (error) {
    console.error(chalk.red('Test failed:'), error);
    process.exit(1);
  }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  prompts.close();
  process.exit(0);
});

main();