#!/usr/bin/env node

/**
 * i18n Translation Validator
 * Validates translation consistency, terminology, and quality
 */

const fs = require('fs').promises;
const path = require('path');
const glob = require('glob');
const { promisify } = require('util');
const globAsync = promisify(glob);
const chalk = require('chalk');

class TranslationValidator {
  constructor(options = {}) {
    this.localesDir = options.localesDir || path.join(__dirname, '../locales');
    this.locales = options.locales || ['en', 'ja'];
    this.verbose = options.verbose || false;
    
    // Common terminology mappings
    this.terminology = {
      en: {
        'project': 'project',
        'issue': 'issue',
        'task': 'task',
        'agent': 'agent',
        'process': 'process',
        'error': 'error',
        'warning': 'warning',
        'success': 'success',
        'failed': 'failed',
        'completed': 'completed'
      },
      ja: {
        'project': 'プロジェクト',
        'issue': 'イシュー',
        'task': 'タスク',
        'agent': 'エージェント',
        'process': 'プロセス',
        'error': 'エラー',
        'warning': '警告',
        'success': '成功',
        'failed': '失敗',
        'completed': '完了'
      }
    };
    
    // Placeholder patterns
    this.placeholderPattern = /\{\{([^}]+)\}\}/g;
  }

  async loadTranslations(locale) {
    const translations = {};
    const localeDir = path.join(this.localesDir, locale);
    
    try {
      const files = await globAsync('**/*.json', { cwd: localeDir });
      
      for (const file of files) {
        const filePath = path.join(localeDir, file);
        const content = await fs.readFile(filePath, 'utf8');
        const data = JSON.parse(content);
        const namespace = path.basename(file, '.json');
        translations[namespace] = data;
      }
      
      return translations;
    } catch (error) {
      console.error(chalk.red(`Error loading locale ${locale}: ${error.message}`));
      return {};
    }
  }

  flattenTranslations(obj, prefix = '', result = {}) {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        this.flattenTranslations(value, fullKey, result);
      } else {
        result[fullKey] = value;
      }
    }
    
    return result;
  }

  async checkPlaceholderConsistency() {
    console.log(chalk.blue.bold('\nChecking placeholder consistency...'));
    console.log(chalk.blue('━'.repeat(50)));
    
    const issues = [];
    const baseTranslations = await this.loadTranslations(this.locales[0]);
    const baseFlat = {};
    
    // Flatten base translations
    for (const [namespace, data] of Object.entries(baseTranslations)) {
      this.flattenTranslations(data, namespace, baseFlat);
    }
    
    // Check each locale
    for (let i = 1; i < this.locales.length; i++) {
      const locale = this.locales[i];
      console.log(chalk.yellow(`\nChecking ${locale}...`));
      
      const translations = await this.loadTranslations(locale);
      const flatTranslations = {};
      
      for (const [namespace, data] of Object.entries(translations)) {
        this.flattenTranslations(data, namespace, flatTranslations);
      }
      
      // Compare placeholders
      for (const [key, baseValue] of Object.entries(baseFlat)) {
        if (typeof baseValue !== 'string') continue;
        
        const targetValue = flatTranslations[key];
        if (!targetValue || typeof targetValue !== 'string') continue;
        
        const basePlaceholders = [...baseValue.matchAll(this.placeholderPattern)]
          .map(m => m[1])
          .sort();
        const targetPlaceholders = [...targetValue.matchAll(this.placeholderPattern)]
          .map(m => m[1])
          .sort();
        
        if (JSON.stringify(basePlaceholders) !== JSON.stringify(targetPlaceholders)) {
          issues.push({
            key,
            locale,
            basePlaceholders,
            targetPlaceholders,
            baseValue,
            targetValue
          });
        }
      }
    }
    
    if (issues.length > 0) {
      console.log(chalk.red(`\nFound ${issues.length} placeholder inconsistencies:`));
      issues.forEach(issue => {
        console.log(chalk.gray(`\n${issue.key} (${issue.locale}):`));
        console.log(chalk.gray(`  Base: ${issue.basePlaceholders.join(', ') || '(none)'}`));
        console.log(chalk.gray(`  Target: ${issue.targetPlaceholders.join(', ') || '(none)'}`));
        if (this.verbose) {
          console.log(chalk.gray(`  Base value: "${issue.baseValue}"`));
          console.log(chalk.gray(`  Target value: "${issue.targetValue}"`));
        }
      });
    } else {
      console.log(chalk.green('✓ All placeholders are consistent!'));
    }
    
    return issues;
  }

  async checkTerminologyConsistency() {
    console.log(chalk.blue.bold('\n\nChecking terminology consistency...'));
    console.log(chalk.blue('━'.repeat(50)));
    
    const inconsistencies = {};
    
    for (const locale of this.locales) {
      if (!this.terminology[locale]) continue;
      
      console.log(chalk.yellow(`\nChecking ${locale}...`));
      const translations = await this.loadTranslations(locale);
      const flatTranslations = {};
      
      for (const [namespace, data] of Object.entries(translations)) {
        this.flattenTranslations(data, namespace, flatTranslations);
      }
      
      // Check each term
      for (const [term, expectedTranslation] of Object.entries(this.terminology[locale])) {
        const variations = new Map();
        
        // Search for term usage
        for (const [key, value] of Object.entries(flatTranslations)) {
          if (typeof value !== 'string') continue;
          
          // Create regex for term (case insensitive, word boundary)
          const regex = new RegExp(`\\b${term}\\b`, 'gi');
          const matches = value.match(regex);
          
          if (matches) {
            matches.forEach(match => {
              const count = variations.get(match) || 0;
              variations.set(match, count + 1);
            });
          }
        }
        
        // Check if there are inconsistencies
        if (variations.size > 1) {
          inconsistencies[`${locale}.${term}`] = {
            locale,
            term,
            expected: expectedTranslation,
            variations: Array.from(variations.entries())
          };
        }
      }
    }
    
    if (Object.keys(inconsistencies).length > 0) {
      console.log(chalk.red(`\nFound terminology inconsistencies:`));
      for (const inconsistency of Object.values(inconsistencies)) {
        console.log(chalk.gray(`\n${inconsistency.term} (${inconsistency.locale}):`));
        console.log(chalk.gray(`  Expected: "${inconsistency.expected}"`));
        console.log(chalk.gray(`  Found variations:`));
        inconsistency.variations.forEach(([variation, count]) => {
          console.log(chalk.gray(`    - "${variation}" (${count} occurrences)`));
        });
      }
    } else {
      console.log(chalk.green('✓ All terminology is consistent!'));
    }
    
    return inconsistencies;
  }

  async checkTranslationQuality() {
    console.log(chalk.blue.bold('\n\nChecking translation quality...'));
    console.log(chalk.blue('━'.repeat(50)));
    
    const qualityIssues = [];
    
    for (const locale of this.locales) {
      console.log(chalk.yellow(`\nChecking ${locale}...`));
      const translations = await this.loadTranslations(locale);
      const flatTranslations = {};
      
      for (const [namespace, data] of Object.entries(translations)) {
        this.flattenTranslations(data, namespace, flatTranslations);
      }
      
      for (const [key, value] of Object.entries(flatTranslations)) {
        if (typeof value !== 'string') continue;
        
        const issues = [];
        
        // Check for empty translations
        if (!value.trim()) {
          issues.push('Empty translation');
        }
        
        // Check for untranslated text (same as key for non-English)
        if (locale !== 'en' && value === key.split('.').pop()) {
          issues.push('Possibly untranslated (same as key)');
        }
        
        // Check for excessive punctuation
        if (value.match(/[!?]{2,}/)) {
          issues.push('Excessive punctuation');
        }
        
        // Check for unescaped quotes
        if (value.match(/(?<!\\)["']/) && !value.match(/["'].*["']/)) {
          issues.push('Unescaped quote');
        }
        
        // Check for leading/trailing whitespace
        if (value !== value.trim()) {
          issues.push('Leading/trailing whitespace');
        }
        
        // Check for TODO/FIXME comments
        if (value.match(/\b(TODO|FIXME|XXX)\b/i)) {
          issues.push('Contains TODO/FIXME');
        }
        
        if (issues.length > 0) {
          qualityIssues.push({
            key,
            locale,
            value,
            issues
          });
        }
      }
    }
    
    if (qualityIssues.length > 0) {
      console.log(chalk.red(`\nFound ${qualityIssues.length} quality issues:`));
      qualityIssues.forEach(issue => {
        console.log(chalk.gray(`\n${issue.key} (${issue.locale}):`));
        issue.issues.forEach(i => {
          console.log(chalk.gray(`  - ${i}`));
        });
        if (this.verbose) {
          console.log(chalk.gray(`  Value: "${issue.value}"`));
        }
      });
    } else {
      console.log(chalk.green('✓ All translations pass quality checks!'));
    }
    
    return qualityIssues;
  }

  async checkKeyFormat() {
    console.log(chalk.blue.bold('\n\nChecking translation key format...'));
    console.log(chalk.blue('━'.repeat(50)));
    
    const formatIssues = [];
    
    for (const locale of this.locales) {
      const translations = await this.loadTranslations(locale);
      const flatTranslations = {};
      
      for (const [namespace, data] of Object.entries(translations)) {
        this.flattenTranslations(data, namespace, flatTranslations);
      }
      
      for (const key of Object.keys(flatTranslations)) {
        const issues = [];
        
        // Check for uppercase in keys (should be camelCase or lowercase)
        if (key.match(/[A-Z]/) && !key.match(/^[a-z]+:[A-Z]/)) {
          // Allow uppercase after namespace separator
          const parts = key.split(':');
          if (parts.length > 1 && parts[1].match(/^[A-Z]/)) {
            // This is OK (e.g., errors:E001)
          } else if (!key.match(/^[a-z]+:[a-z]+[A-Z]/)) {
            issues.push('Contains uppercase (should be camelCase after namespace)');
          }
        }
        
        // Check for special characters
        if (key.match(/[^a-zA-Z0-9:._-]/)) {
          issues.push('Contains invalid characters');
        }
        
        // Check for double separators
        if (key.match(/[:._]{2,}/)) {
          issues.push('Contains double separators');
        }
        
        // Check for starting/ending with separator
        if (key.match(/^[:._]|[:._]$/)) {
          issues.push('Starts or ends with separator');
        }
        
        if (issues.length > 0) {
          formatIssues.push({
            key,
            locale,
            issues
          });
        }
      }
    }
    
    // Deduplicate by key
    const uniqueIssues = Array.from(
      new Map(formatIssues.map(item => [item.key, item])).values()
    );
    
    if (uniqueIssues.length > 0) {
      console.log(chalk.red(`\nFound ${uniqueIssues.length} key format issues:`));
      uniqueIssues.forEach(issue => {
        console.log(chalk.gray(`\n${issue.key}:`));
        issue.issues.forEach(i => {
          console.log(chalk.gray(`  - ${i}`));
        });
      });
    } else {
      console.log(chalk.green('✓ All translation keys are properly formatted!'));
    }
    
    return uniqueIssues;
  }

  async generateReport() {
    const results = {
      placeholderIssues: await this.checkPlaceholderConsistency(),
      terminologyIssues: await this.checkTerminologyConsistency(),
      qualityIssues: await this.checkTranslationQuality(),
      formatIssues: await this.checkKeyFormat()
    };
    
    // Summary
    console.log(chalk.blue.bold('\n\nValidation Summary'));
    console.log(chalk.blue('━'.repeat(50)));
    
    const totalIssues = 
      results.placeholderIssues.length +
      Object.keys(results.terminologyIssues).length +
      results.qualityIssues.length +
      results.formatIssues.length;
    
    if (totalIssues === 0) {
      console.log(chalk.green.bold('✓ All validations passed! No issues found.'));
    } else {
      console.log(chalk.red.bold(`Found ${totalIssues} total issues:`));
      console.log(chalk.gray(`  - Placeholder issues: ${results.placeholderIssues.length}`));
      console.log(chalk.gray(`  - Terminology issues: ${Object.keys(results.terminologyIssues).length}`));
      console.log(chalk.gray(`  - Quality issues: ${results.qualityIssues.length}`));
      console.log(chalk.gray(`  - Format issues: ${results.formatIssues.length}`));
    }
    
    // Generate JSON report if requested
    if (process.argv.includes('--json')) {
      const reportPath = path.join(process.cwd(), 'i18n-validation-report.json');
      await fs.writeFile(reportPath, JSON.stringify({
        locales: this.locales,
        results,
        summary: {
          totalIssues,
          placeholderIssues: results.placeholderIssues.length,
          terminologyIssues: Object.keys(results.terminologyIssues).length,
          qualityIssues: results.qualityIssues.length,
          formatIssues: results.formatIssues.length
        },
        timestamp: new Date().toISOString()
      }, null, 2));
      console.log(chalk.gray(`\nJSON report saved to: ${reportPath}`));
    }
    
    return results;
  }
}

async function main() {
  const options = {
    verbose: process.argv.includes('--verbose') || process.argv.includes('-v'),
    locales: process.argv.find(arg => arg.startsWith('--locales='))?.split('=')[1]?.split(',') || ['en', 'ja']
  };
  
  const validator = new TranslationValidator(options);
  
  try {
    await validator.generateReport();
    console.log(chalk.green('\n✓ Validation completed!'));
  } catch (error) {
    console.error(chalk.red(`\nError: ${error.message}`));
    process.exit(1);
  }
}

// Show help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Translation Validator

Usage: node i18n-validator.js [options]

Options:
  --locales=<list>    Comma-separated list of locales to validate (default: en,ja)
  --verbose, -v       Show detailed information
  --json              Generate JSON report
  --help, -h          Show this help message

Checks:
  - Placeholder consistency ({{variable}} matching)
  - Terminology consistency
  - Translation quality (empty, untranslated, formatting)
  - Key format validation

Examples:
  node i18n-validator.js
  node i18n-validator.js --verbose
  node i18n-validator.js --locales=en,ja,es --json
`);
  process.exit(0);
}

main();