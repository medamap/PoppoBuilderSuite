# PoppoBuilder i18n Implementation

## Overview
PoppoBuilder now supports internationalization (i18n) with English as the default language and Japanese as a secondary language. This aligns with the language policy that all GitHub outputs must be in English.

## Implementation Details

### 1. i18n Library
- **Library**: i18next with i18next-fs-backend
- **Location**: `/lib/i18n/`
- **Languages**: English (en), Japanese (ja)
- **Default**: English

### 2. File Structure
```
lib/i18n/
├── index.js              # i18n initialization and wrapper
├── locales/
│   ├── en/              # English translations
│   │   ├── common.json   # Common messages
│   │   ├── cli.json      # CLI commands
│   │   └── errors.json   # Error messages
│   └── ja/              # Japanese translations
│       ├── common.json
│       ├── cli.json
│       └── errors.json
```

### 3. Updated Files
The following files have been updated to use i18n:
- `dashboard/server/index.js` - Dashboard server messages
- `src/minimal-poppo.js` - Main PoppoBuilder process
- `src/process-manager.js` - Process management
- `src/independent-process-manager.js` - Independent process management
- `src/agent-integration.js` - Agent integration
- `lib/commands/init.js` - Init command
- `bin/poppobuilder.js` - CLI entry point

### 4. Usage Examples

#### In JavaScript code:
```javascript
const i18n = require('../lib/i18n');

// Initialize (usually done once at startup)
await i18n.init({ language: 'en' });

// Translate simple strings
console.log(i18n.t('dashboard.disabled')); // "Dashboard is disabled"

// Translate with interpolation
console.log(i18n.t('issue.processing', { number: 123, title: 'Fix bug' }));
// "Processing issue #123: Fix bug"

// Change language dynamically
await i18n.changeLanguage('ja');
```

#### Translation Keys:
- `dashboard.*` - Dashboard related messages
- `system.*` - System messages
- `issue.*` - Issue processing messages
- `comment.*` - Comment processing messages
- `agent.*` - Agent mode messages
- `task.*` - Task related messages
- `queue.*` - Queue status messages
- `labels.execution.*` - GitHub comment labels
- `errors.*` - Error messages
- `commands.*` - CLI command messages

### 5. Language Policy
As per the project's language policy:
- **GitHub Outputs**: Always in English (commits, issues, PRs, comments)
- **User Communication**: Respects user's language preference
- **Default Language**: English

### 6. Configuration
Users can set their preferred language in `.poppo/config.json`:
```json
{
  "language": {
    "primary": "en"
  }
}
```

Or via environment variable:
```bash
export POPPO_LANGUAGE=ja
```

### 7. Testing
Test file: `test/i18n.test.js`
Run tests: `npm test test/i18n.test.js`

### 8. Adding New Translations
1. Add the key to both English and Japanese locale files
2. Use the key in your code with `i18n.t('namespace.key')`
3. Test both languages work correctly

### 9. Benefits
- **Global Accessibility**: English default makes the project accessible worldwide
- **Local Support**: Japanese users can still use their native language
- **Maintainability**: All strings are centralized in locale files
- **Flexibility**: Easy to add new languages in the future