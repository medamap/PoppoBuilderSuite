# Runtime Language Switching

PoppoBuilder Suite supports dynamic language switching at runtime, allowing users to change the interface language without modifying configuration files or restarting the application.

## Supported Languages

- **English** (`en`) - Default
- **Japanese** (`ja`)

## Language Selection Priority

The system determines the interface language using the following priority order:

1. **Command Line Option** (`--lang`)
2. **Environment Variable** (`POPPOBUILDER_LANG`)
3. **Session Language** (if set programmatically)
4. **Project Configuration** (`.poppo/config.json`)
5. **System Default** (English)

## Usage Examples

### Command Line Option

```bash
# Use Japanese interface
poppobuilder --lang ja status

# Use English interface explicitly
poppobuilder --lang en list

# Short form also supported
poppobuilder -l ja init
```

### Environment Variable

```bash
# Set default language for session
export POPPOBUILDER_LANG=ja

# All commands will use Japanese
poppobuilder status
poppobuilder list
```

### Project Configuration

Add to `.poppo/config.json`:

```json
{
  "language": {
    "primary": "ja"
  }
}
```

## Features

### CLI Help in Multiple Languages

```bash
# English help
poppobuilder --lang en --help

# Japanese help
poppobuilder --lang ja --help
```

### Dynamic Switching in Interactive Mode

When using interactive commands, the language can be switched on the fly:

```javascript
const runtimeSwitcher = require('./lib/i18n/runtime-switcher');

// Switch to Japanese
await runtimeSwitcher.switchLanguage('ja');

// Switch back to English
await runtimeSwitcher.switchLanguage('en');
```

### Language Detection

The system can detect appropriate language from:
- User's system locale
- GitHub issue/PR content
- Previous user interactions

## Integration with Other Features

### Error Messages

Error messages are automatically displayed in the selected language:

```bash
# English error
$ poppobuilder --lang en invalid-command
Error: Unknown command 'invalid-command'

# Japanese error
$ poppobuilder --lang ja invalid-command
エラー: 不明なコマンド 'invalid-command'
```

### Log Output

Log messages use the selected language:

```javascript
logger.info(t('messages:taskStarted', { task: 'build' }));
// English: "Task started: build"
// Japanese: "タスクを開始しました: build"
```

### GitHub Comments

While GitHub outputs (commits, PRs, issues) always use English for global compatibility, user-facing messages respect the language setting.

## Implementation Details

### RuntimeLanguageSwitcher

The core component that manages language switching:

```javascript
const runtimeSwitcher = require('./lib/i18n/runtime-switcher');

// Get current language
const currentLang = runtimeSwitcher.getCurrentLanguage();

// Get supported languages
const languages = runtimeSwitcher.getSupportedLanguages(); // ['en', 'ja']

// Get language display name
const displayName = runtimeSwitcher.getLanguageDisplayName('ja', 'en'); // 'Japanese'
```

### Commander.js Integration

The CLI uses a custom help formatter to support internationalization:

```javascript
program.configureHelp({
  formatHelp: (cmd, helper) => {
    // Custom formatting with i18n support
  }
});
```

## Adding New Languages

To add support for a new language:

1. Create translation files in `locales/<language-code>/`
2. Update `lib/i18n/i18n-manager.js` to include the new language
3. Add language display names to `runtime-switcher.js`
4. Test all commands with the new language

## Best Practices

1. **Consistency**: Use the same language throughout a session
2. **Defaults**: Set appropriate defaults for your team/region
3. **Documentation**: Document the primary language for your project
4. **Testing**: Test critical workflows in all supported languages

## Troubleshooting

### Language Not Changing

1. Check the language code is correct (`en` or `ja`)
2. Verify environment variables are set correctly
3. Ensure translation files exist

### Missing Translations

If you see translation keys instead of text:
- The translation might be missing
- The language files might not be loaded
- Check the console for i18n initialization errors

### Performance

Language switching is instant and has no performance impact. Translations are loaded once at startup and cached in memory.

## Related Documentation

- [Internationalization Overview](../i18n.md)
- [Error Messages](../errors.md)
- [GitHub Integration](../github-integration.md)