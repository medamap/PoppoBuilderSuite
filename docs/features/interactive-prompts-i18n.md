# Interactive Prompts Internationalization

PoppoBuilder Suite provides fully internationalized interactive prompts for CLI commands, ensuring a seamless user experience in multiple languages.

## Overview

The interactive prompts system (`lib/utils/interactive-prompts.js`) provides a unified interface for all user interactions with automatic language support.

## Features

### 1. Question Types

#### Basic Ask
```javascript
const name = await prompts.ask('prompts:init.projectName', {
  default: 'my-project'
});
```

#### Yes/No Confirmation
```javascript
const confirmed = await prompts.confirm('prompts:remove.confirmRemove', {
  context: { name: projectName },
  default: false
});
```

#### Selection from List
```javascript
const choice = await prompts.select('prompts:template.selectTemplate', templates, {
  default: 'default'
});
```

#### Password Input
```javascript
const apiKey = await prompts.password('prompts:init.claudeApiKey');
```

### 2. Visual Feedback

#### Spinner
```javascript
const spinner = prompts.spinner('prompts:common.processing');
// ... do work
spinner.stop('prompts:common.done');
```

#### Progress Bar
```javascript
const progress = prompts.progressBar('prompts:common.loading', totalSteps);
for (let i = 0; i < totalSteps; i++) {
  // ... do work
  progress.increment();
}
```

## Language Support

### Automatic Detection

Prompts automatically use the current language setting:

```bash
# English prompts
poppobuilder --lang en init

# Japanese prompts
poppobuilder --lang ja init
```

### Localized Responses

The system recognizes language-specific yes/no responses:

**English:**
- Yes: `y`, `yes`, `yeah`, `yep`, `sure`, `ok`, `okay`
- No: `n`, `no`, `nope`, `nah`

**Japanese:**
- Yes: `y`, `yes`, `はい`, `h`, `hai`
- No: `n`, `no`, `いいえ`, `i`, `iie`

## Usage in Commands

### Init Command Example

```javascript
const prompts = require('../utils/interactive-prompts');
const { t } = require('../i18n');

// Get project name with default
config.project.name = await prompts.ask('prompts:init.projectName', {
  default: projectInfo.name
});

// Confirm action
if (await prompts.confirm('prompts:init.enableClaude', { default: true })) {
  config.claude.enabled = true;
}

// Select from options
const template = await prompts.select('prompts:template.selectTemplate', [
  { nameKey: 'templates:default.name', value: 'default' },
  { nameKey: 'templates:minimal.name', value: 'minimal' },
  { nameKey: 'templates:advanced.name', value: 'advanced' }
]);
```

## Translation Files

Prompt translations are stored in `locales/<lang>/prompts.json`:

```json
{
  "init": {
    "projectName": "Project name",
    "enableClaude": "Enable Claude API integration?",
    "hasGithubToken": "Do you have a GitHub token?"
  },
  "common": {
    "continue": "Continue?",
    "processing": "Processing...",
    "done": "Done!"
  }
}
```

## Best Practices

### 1. Always Use Translation Keys

```javascript
// ❌ Bad
const name = await prompts.ask('Enter project name:');

// ✅ Good
const name = await prompts.ask('prompts:init.projectName');
```

### 2. Provide Context for Translations

```javascript
// Pass context for dynamic content
await prompts.confirm('prompts:remove.confirmRemove', {
  context: { name: projectName }
});
```

### 3. Set Appropriate Defaults

```javascript
// Use sensible defaults for better UX
await prompts.confirm('prompts:init.enableAgents', { 
  default: false  // Opt-in for advanced features
});
```

### 4. Clean Up Resources

```javascript
try {
  // ... use prompts
} finally {
  prompts.close();  // Always close readline interface
}
```

## Adding New Prompts

1. Add translations to `locales/en/prompts.json` and `locales/ja/prompts.json`
2. Use the appropriate prompt method
3. Test in both languages

```javascript
// 1. Add to prompts.json
{
  "myFeature": {
    "confirmAction": "Are you sure you want to {{action}}?"
  }
}

// 2. Use in code
const confirmed = await prompts.confirm('prompts:myFeature.confirmAction', {
  context: { action: 'delete all data' }
});
```

## Testing

Run the interactive prompts test:

```bash
node test/test-interactive-prompts.js
```

This will test all prompt types in both English and Japanese.

## Troubleshooting

### Prompts Not Showing

Ensure the readline interface is properly initialized:
```javascript
// The prompts module handles this automatically
// But ensure you're not interfering with stdin/stdout
```

### Wrong Language

Check the current language setting:
```javascript
const currentLang = runtimeSwitcher.getCurrentLanguage();
```

### Missing Translations

If you see translation keys instead of text:
1. Check the key exists in the appropriate prompts.json
2. Ensure i18n is initialized before using prompts
3. Verify the translation file is loaded correctly

## Future Enhancements

- Support for more languages
- Autocomplete for selections
- Multi-select prompts
- File/directory picker
- Date/time picker
- Custom validation rules