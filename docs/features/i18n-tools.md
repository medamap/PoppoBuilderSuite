# Translation Test and Coverage Tools

PoppoBuilder Suite provides comprehensive tools for validating and monitoring translation quality and completeness.

## Overview

The i18n tools help ensure:
- Complete translation coverage across all languages
- Consistent terminology usage
- Proper placeholder handling
- Translation quality standards
- Key naming conventions

## Coverage Tool

### Usage

```bash
# Basic coverage check
npm run i18n:coverage

# Show all missing keys
npm run i18n:missing

# Generate JSON report
npm run i18n:coverage -- --json

# Check for unused keys
npm run i18n:coverage -- --check-unused
```

### Features

1. **Coverage Calculation**
   - Compares target locales against base locale (English)
   - Shows percentage of translated keys
   - Lists missing translations

2. **Missing Key Detection**
   - Identifies untranslated keys
   - Groups by namespace
   - Shows first 10 by default (use --verbose for all)

3. **Unused Key Detection**
   - Scans source code for translation key usage
   - Identifies potentially obsolete translations
   - Helps keep translation files clean

### Example Output

```
Translation Coverage Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Base locale: en
Total translation keys: 523

Checking locale: ja
────────────────────────────────────────
Coverage: 95.2% (498/523 keys)
Missing: 25 keys

Missing Keys:
  - commands:advanced.description
  - errors:E010.message
  - github:templates.pr.checklist
  ...

Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Average coverage: 95.2%
```

## Validation Tool

### Usage

```bash
# Basic validation
npm run i18n:validate

# Show detailed issues
npm run i18n:consistency

# Generate JSON report
npm run i18n:validate -- --json
```

### Validation Checks

1. **Placeholder Consistency**
   - Ensures {{variable}} placeholders match between languages
   - Detects missing or extra placeholders
   - Verifies placeholder names are identical

2. **Terminology Consistency**
   - Checks predefined terminology mappings
   - Detects inconsistent translations of key terms
   - Example: "project" should always be "プロジェクト" in Japanese

3. **Translation Quality**
   - Empty translations
   - Leading/trailing whitespace
   - Excessive punctuation (!!!, ???)
   - TODO/FIXME comments
   - Unescaped quotes
   - Potentially untranslated text

4. **Key Format Validation**
   - Validates naming conventions
   - Checks for invalid characters
   - Ensures proper namespace format
   - Detects double separators

### Example Output

```
Checking placeholder consistency...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Checking ja...
✓ All placeholders are consistent!

Checking terminology consistency...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Checking en...
Checking ja...

Found terminology inconsistencies:

project (ja):
  Expected: "プロジェクト"
  Found variations:
    - "プロジェクト" (45 occurrences)
    - "プロジェクト" (2 occurrences)

Validation Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Found 3 total issues:
  - Placeholder issues: 0
  - Terminology issues: 1
  - Quality issues: 2
  - Format issues: 0
```

## NPM Scripts

```json
{
  "scripts": {
    // Check translation coverage
    "i18n:coverage": "node scripts/i18n-coverage.js",
    
    // Show all missing translations
    "i18n:missing": "node scripts/i18n-coverage.js --verbose",
    
    // Validate translation quality
    "i18n:validate": "node scripts/i18n-validator.js",
    
    // Check terminology consistency
    "i18n:consistency": "node scripts/i18n-validator.js --verbose",
    
    // Generate full reports
    "i18n:report": "npm run i18n:coverage -- --json && npm run i18n:validate -- --json",
    
    // Run i18n tests
    "i18n:test": "mocha test/i18n/*.test.js --timeout 10000",
    
    // Run all checks
    "i18n:check": "npm run i18n:coverage && npm run i18n:validate"
  }
}
```

## Configuring Terminology

Edit the terminology mappings in `scripts/i18n-validator.js`:

```javascript
this.terminology = {
  en: {
    'project': 'project',
    'issue': 'issue',
    'task': 'task',
    // Add more terms...
  },
  ja: {
    'project': 'プロジェクト',
    'issue': 'イシュー', 
    'task': 'タスク',
    // Add more terms...
  }
};
```

## CI Integration

Add to your CI pipeline:

```yaml
# .github/workflows/i18n.yml
name: i18n Validation

on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run i18n:check
      - run: npm run i18n:test
      
      # Upload reports
      - run: npm run i18n:report
      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: i18n-reports
          path: |
            i18n-coverage-report.json
            i18n-validation-report.json
```

## Best Practices

1. **Maintain High Coverage**
   - Aim for >95% translation coverage
   - Address missing translations promptly
   - Remove unused translations regularly

2. **Consistent Terminology**
   - Define key terms in terminology mapping
   - Use consistent translations across the app
   - Document special terminology decisions

3. **Quality Standards**
   - No empty translations
   - Proper placeholder usage
   - Clean, professional language
   - Appropriate punctuation

4. **Regular Validation**
   - Run checks before releases
   - Include in CI/CD pipeline
   - Monitor coverage trends
   - Address issues promptly

## Extending the Tools

### Adding New Locales

```bash
# Check coverage for multiple locales
node scripts/i18n-coverage.js --locales=ja,es,fr

# Validate multiple locales
node scripts/i18n-validator.js --locales=en,ja,es,fr
```

### Custom Validation Rules

Add custom checks in `scripts/i18n-validator.js`:

```javascript
// Check for custom patterns
if (value.match(/your-pattern/)) {
  issues.push('Custom validation failed');
}
```

### Integration with Translation Services

The JSON reports can be used to:
- Generate translation tasks
- Track translation progress
- Integrate with translation management systems
- Automate translation workflows

## Troubleshooting

### High Number of Missing Keys

1. Check if new namespace was added
2. Verify locale directory exists
3. Ensure JSON files are valid
4. Check for typos in key names

### False Positive Unused Keys

Some keys might be:
- Used dynamically
- Referenced in templates
- Used in external configurations

Add exceptions or improve detection patterns as needed.

### Validation Errors

1. Review reported issues
2. Fix critical issues first (placeholders, empty)
3. Address quality issues
4. Update terminology mappings as needed