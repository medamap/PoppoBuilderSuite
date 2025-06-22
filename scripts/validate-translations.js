#!/usr/bin/env node

const TranslationValidator = require('../lib/i18n/translation-validator');
const chalk = require('chalk');
const path = require('path');

async function main() {
  console.log(chalk.blue.bold('PoppoBuilder Translation Validator'));
  console.log(chalk.blue('='.repeat(50)));
  console.log();

  const validator = new TranslationValidator();
  
  try {
    console.log(chalk.yellow('Validating translation files...'));
    const results = await validator.validateAll();
    
    // 結果を表示
    console.log();
    if (results.valid) {
      console.log(chalk.green.bold('✅ All translations are valid!'));
    } else {
      console.log(chalk.red.bold('❌ Translation validation failed!'));
    }
    
    console.log();
    console.log(chalk.cyan('Summary:'));
    console.log(`  Total keys: ${chalk.white(results.summary.totalKeys)}`);
    console.log(`  Missing keys: ${results.summary.missingKeys > 0 ? chalk.red(results.summary.missingKeys) : chalk.green(0)}`);
    console.log(`  Extra keys: ${results.summary.extraKeys > 0 ? chalk.yellow(results.summary.extraKeys) : chalk.green(0)}`);
    console.log(`  Invalid interpolations: ${results.summary.invalidInterpolations > 0 ? chalk.red(results.summary.invalidInterpolations) : chalk.green(0)}`);
    console.log(`  Empty values: ${results.summary.emptyValues > 0 ? chalk.yellow(results.summary.emptyValues) : chalk.green(0)}`);
    
    // エラーを表示
    if (results.errors.length > 0) {
      console.log();
      console.log(chalk.red.bold(`Errors (${results.errors.length}):`));
      results.errors.forEach((error, index) => {
        console.log(chalk.red(`  ${index + 1}. [${error.type}] ${error.message}`));
        if (error.locale) console.log(chalk.gray(`     Locale: ${error.locale}`));
        if (error.key) console.log(chalk.gray(`     Key: ${error.key}`));
      });
    }
    
    // 警告を表示
    if (results.warnings.length > 0) {
      console.log();
      console.log(chalk.yellow.bold(`Warnings (${results.warnings.length}):`));
      const warningLimit = 10;
      const warnings = results.warnings.slice(0, warningLimit);
      
      warnings.forEach((warning, index) => {
        console.log(chalk.yellow(`  ${index + 1}. [${warning.type}] ${warning.message}`));
        if (warning.locale) console.log(chalk.gray(`     Locale: ${warning.locale}`));
        if (warning.key) console.log(chalk.gray(`     Key: ${warning.key}`));
      });
      
      if (results.warnings.length > warningLimit) {
        console.log(chalk.gray(`  ... and ${results.warnings.length - warningLimit} more warnings`));
      }
    }
    
    // 修正提案を生成
    if (!results.valid || results.warnings.length > 0) {
      console.log();
      console.log(chalk.cyan('Suggestions:'));
      const fixes = validator.generateFixes(results);
      
      fixes.suggestions.forEach((suggestion, index) => {
        console.log(chalk.cyan(`  ${index + 1}. ${suggestion}`));
      });
      
      // 欠落キーの詳細
      if (Object.keys(fixes.missingKeys).length > 0) {
        console.log();
        console.log(chalk.yellow('Missing keys by locale:'));
        for (const [locale, namespaces] of Object.entries(fixes.missingKeys)) {
          console.log(chalk.yellow(`  ${locale}:`));
          for (const [namespace, keys] of Object.entries(namespaces)) {
            console.log(chalk.gray(`    ${namespace}: ${keys.join(', ')}`));
          }
        }
      }
    }
    
    // 詳細レポートの保存オプション
    if (process.argv.includes('--save-report')) {
      const reportPath = path.join(process.cwd(), 'translation-validation-report.txt');
      const report = validator.formatReport(results);
      const fs = require('fs').promises;
      await fs.writeFile(reportPath, report);
      console.log();
      console.log(chalk.green(`Report saved to: ${reportPath}`));
    }
    
    // 終了コード
    process.exit(results.valid ? 0 : 1);
    
  } catch (error) {
    console.error(chalk.red('Error during validation:'), error.message);
    console.error(error.stack);
    process.exit(2);
  }
}

// ヘルプ表示
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Usage: node scripts/validate-translations.js [options]

Options:
  --save-report    Save detailed report to translation-validation-report.txt
  --help, -h       Show this help message

This script validates all translation files in the locales directory.
It checks for:
  - Missing translation keys
  - Extra translation keys
  - Invalid interpolation variables
  - Empty translation values
  - URL format consistency
`);
  process.exit(0);
}

main().catch(error => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(2);
});