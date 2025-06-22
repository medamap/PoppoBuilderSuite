#!/usr/bin/env node

/**
 * i18n Translation Coverage Tool
 * Checks translation completeness and generates coverage reports
 */

const fs = require('fs').promises;
const path = require('path');
const glob = require('glob');
const { promisify } = require('util');
const globAsync = promisify(glob);
const chalk = require('chalk');

class TranslationCoverageChecker {
  constructor(options = {}) {
    this.baseLocale = options.baseLocale || 'en';
    this.localesDir = options.localesDir || path.join(__dirname, '../locales');
    this.targetLocales = options.targetLocales || ['ja'];
    this.verbose = options.verbose || false;
  }

  async getAllTranslationKeys() {
    const keys = new Set();
    const baseDir = path.join(this.localesDir, this.baseLocale);
    
    try {
      const files = await globAsync('**/*.json', { cwd: baseDir });
      
      for (const file of files) {
        const filePath = path.join(baseDir, file);
        const content = await fs.readFile(filePath, 'utf8');
        const translations = JSON.parse(content);
        const namespace = path.basename(file, '.json');
        
        this.extractKeys(translations, namespace, keys);
      }
      
      return keys;
    } catch (error) {
      console.error(chalk.red(`Error reading base locale: ${error.message}`));
      return keys;
    }
  }

  extractKeys(obj, prefix, keys, currentPath = '') {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = currentPath ? `${currentPath}.${key}` : `${prefix}:${key}`;
      
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        this.extractKeys(value, prefix, keys, fullKey);
      } else {
        keys.add(fullKey);
      }
    }
  }

  async checkLocaleTranslations(locale, allKeys) {
    const missingKeys = new Set();
    const existingKeys = new Set();
    const localeDir = path.join(this.localesDir, locale);
    
    try {
      const files = await globAsync('**/*.json', { cwd: localeDir });
      
      for (const file of files) {
        const filePath = path.join(localeDir, file);
        const content = await fs.readFile(filePath, 'utf8');
        const translations = JSON.parse(content);
        const namespace = path.basename(file, '.json');
        
        this.extractKeys(translations, namespace, existingKeys);
      }
      
      // Find missing keys
      for (const key of allKeys) {
        if (!existingKeys.has(key)) {
          missingKeys.add(key);
        }
      }
      
      return {
        total: allKeys.size,
        translated: existingKeys.size,
        missing: missingKeys.size,
        missingKeys: Array.from(missingKeys),
        coverage: ((existingKeys.size / allKeys.size) * 100).toFixed(1)
      };
    } catch (error) {
      console.error(chalk.red(`Error checking locale ${locale}: ${error.message}`));
      return {
        total: allKeys.size,
        translated: 0,
        missing: allKeys.size,
        missingKeys: Array.from(allKeys),
        coverage: '0.0'
      };
    }
  }

  async generateReport() {
    console.log(chalk.blue.bold('\nTranslation Coverage Report'));
    console.log(chalk.blue('━'.repeat(50)));
    
    // Get all keys from base locale
    const allKeys = await this.getAllTranslationKeys();
    console.log(chalk.gray(`\nBase locale: ${this.baseLocale}`));
    console.log(chalk.gray(`Total translation keys: ${allKeys.size}`));
    
    const results = {};
    
    // Check each target locale
    for (const locale of this.targetLocales) {
      console.log(chalk.yellow(`\n\nChecking locale: ${locale}`));
      console.log(chalk.gray('─'.repeat(40)));
      
      const result = await this.checkLocaleTranslations(locale, allKeys);
      results[locale] = result;
      
      // Display results
      console.log(`Coverage: ${result.coverage}% (${result.translated}/${result.total} keys)`);
      
      if (result.missing > 0) {
        console.log(chalk.red(`Missing: ${result.missing} keys`));
        
        if (this.verbose || result.missing <= 20) {
          console.log(chalk.red('\nMissing Keys:'));
          result.missingKeys.forEach(key => {
            console.log(chalk.gray(`  - ${key}`));
          });
        } else {
          console.log(chalk.gray(`  (Use --verbose to see all ${result.missing} missing keys)`));
          // Show first 10
          console.log(chalk.red('\nFirst 10 missing keys:'));
          result.missingKeys.slice(0, 10).forEach(key => {
            console.log(chalk.gray(`  - ${key}`));
          });
        }
      } else {
        console.log(chalk.green('✓ All keys translated!'));
      }
    }
    
    // Summary
    console.log(chalk.blue.bold('\n\nSummary'));
    console.log(chalk.blue('━'.repeat(50)));
    
    const avgCoverage = Object.values(results)
      .reduce((sum, r) => sum + parseFloat(r.coverage), 0) / this.targetLocales.length;
    
    console.log(`Average coverage: ${avgCoverage.toFixed(1)}%`);
    
    // Generate JSON report if requested
    if (process.argv.includes('--json')) {
      const reportPath = path.join(process.cwd(), 'i18n-coverage-report.json');
      await fs.writeFile(reportPath, JSON.stringify({
        baseLocale: this.baseLocale,
        totalKeys: allKeys.size,
        results,
        timestamp: new Date().toISOString()
      }, null, 2));
      console.log(chalk.gray(`\nJSON report saved to: ${reportPath}`));
    }
    
    return results;
  }

  async findUnusedKeys() {
    console.log(chalk.blue.bold('\n\nChecking for unused translation keys...'));
    console.log(chalk.blue('━'.repeat(50)));
    
    const allKeys = await this.getAllTranslationKeys();
    const usedKeys = new Set();
    
    // Search for key usage in source files
    const sourcePatterns = [
      'lib/**/*.js',
      'bin/**/*.js',
      'agents/**/*.js',
      'src/**/*.js'
    ];
    
    for (const pattern of sourcePatterns) {
      const files = await globAsync(pattern, { cwd: path.join(__dirname, '..') });
      
      for (const file of files) {
        const content = await fs.readFile(path.join(__dirname, '..', file), 'utf8');
        
        // Look for t() and i18n.t() calls
        const tMatches = content.matchAll(/(?:t|i18n\.t)\(['"`]([^'"`]+)['"`]/g);
        for (const match of tMatches) {
          usedKeys.add(match[1]);
        }
        
        // Look for key references in objects
        const keyMatches = content.matchAll(/(?:labelKey|titleKey|descriptionKey|messageKey):\s*['"`]([^'"`]+)['"`]/g);
        for (const match of keyMatches) {
          usedKeys.add(match[1]);
        }
      }
    }
    
    // Find unused keys
    const unusedKeys = [];
    for (const key of allKeys) {
      if (!usedKeys.has(key)) {
        unusedKeys.push(key);
      }
    }
    
    if (unusedKeys.length > 0) {
      console.log(chalk.yellow(`Found ${unusedKeys.length} potentially unused keys:`));
      unusedKeys.forEach(key => {
        console.log(chalk.gray(`  - ${key}`));
      });
    } else {
      console.log(chalk.green('✓ All translation keys are in use!'));
    }
    
    return unusedKeys;
  }
}

async function main() {
  const options = {
    verbose: process.argv.includes('--verbose') || process.argv.includes('-v'),
    baseLocale: process.argv.find(arg => arg.startsWith('--base='))?.split('=')[1] || 'en',
    targetLocales: process.argv.find(arg => arg.startsWith('--locales='))?.split('=')[1]?.split(',') || ['ja']
  };
  
  const checker = new TranslationCoverageChecker(options);
  
  try {
    await checker.generateReport();
    
    if (process.argv.includes('--check-unused')) {
      await checker.findUnusedKeys();
    }
    
    console.log(chalk.green('\n✓ Coverage check completed!'));
  } catch (error) {
    console.error(chalk.red(`\nError: ${error.message}`));
    process.exit(1);
  }
}

// Show help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Translation Coverage Checker

Usage: node i18n-coverage.js [options]

Options:
  --base=<locale>     Base locale to compare against (default: en)
  --locales=<list>    Comma-separated list of target locales (default: ja)
  --verbose, -v       Show all missing keys
  --json              Generate JSON report
  --check-unused      Check for unused translation keys
  --help, -h          Show this help message

Examples:
  node i18n-coverage.js
  node i18n-coverage.js --verbose
  node i18n-coverage.js --locales=ja,es,fr --json
  node i18n-coverage.js --check-unused
`);
  process.exit(0);
}

main();