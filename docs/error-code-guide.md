# Error Code Guide / エラーコードガイド

This guide explains how to use the PoppoBuilder Suite error code system.

## Overview / 概要

The error code system provides structured error handling with i18n support. Each error has a unique code (e.g., E001) with associated messages, descriptions, and solutions in multiple languages.

## Error Code Structure / エラーコードの構造

Error codes follow the pattern: `EXXX` where:
- E = Error prefix
- XXX = 3-digit number indicating category and specific error

### Categories / カテゴリ

- **E0XX**: Authentication errors / 認証エラー
- **E1XX**: Claude API errors / Claude APIエラー
- **E2XX**: Configuration errors / 設定エラー
- **E3XX**: File system errors / ファイルシステムエラー
- **E4XX**: System/Process errors / システム/プロセスエラー
- **E5XX**: Network errors / ネットワークエラー
- **E6XX**: Validation errors / バリデーションエラー
- **E7XX**: Agent errors / エージェントエラー
- **E9XX**: General errors / 一般エラー

## Using the Error System / エラーシステムの使用方法

### Basic Usage / 基本的な使い方

```javascript
const { createError, formatError } = require('./lib/errors');

// Create an error with code
try {
  // ... some operation
} catch (err) {
  throw createError('E301', { path: '/path/to/file.txt' });
}

// Format error for console
console.error(formatError('E001'));
```

### With Context / コンテキスト付き

```javascript
// Create error with interpolated values
const error = createError('E002', { 
  name: 'my-project' 
}, { 
  locale: 'ja' 
});

// Error message will be: "プロジェクトが見つかりません: my-project"
```

### GitHub Comments / GitHubコメント

```javascript
const { formatForGitHub } = require('./lib/errors');

// Format error for GitHub issue comment
const comment = formatForGitHub('E103', {
  locale: 'en',
  includeDetails: true
});

await github.createComment(issueNumber, comment);
```

## Common Error Codes / よく使用されるエラーコード

### Authentication / 認証

- **E001**: GitHub authentication failed / GitHub認証に失敗しました
- **E101**: Claude API authentication failed / Claude API認証に失敗しました

### API Errors / APIエラー

- **E002**: Project not found / プロジェクトが見つかりません
- **E003**: Rate limit exceeded / レート制限に達しました
- **E102**: Claude API request failed / Claude APIリクエストが失敗しました
- **E103**: Token limit exceeded / トークン制限を超過しました

### Configuration / 設定

- **E201**: Configuration file not found / 設定ファイルが見つかりません
- **E202**: Failed to parse configuration / 設定ファイルの解析に失敗しました
- **E203**: Missing required field / 必須設定項目が不足しています

### File Operations / ファイル操作

- **E301**: Failed to read file / ファイルの読み取りに失敗しました
- **E302**: Failed to write file / ファイルの書き込みに失敗しました
- **E303**: Failed to create directory / ディレクトリの作成に失敗しました

### System / システム

- **E401**: Failed to start process / プロセスの起動に失敗しました
- **E402**: Process timed out / プロセスがタイムアウトしました
- **E403**: Out of memory / メモリ不足エラー

## Adding New Error Codes / 新しいエラーコードの追加

To add a new error code:

1. Add to `locales/ja/error-codes.json`:
```json
{
  "E504": {
    "message": "新しいエラーメッセージ",
    "description": "詳細な説明",
    "solution": "解決方法",
    "category": "network"
  }
}
```

2. Add to `locales/en/error-codes.json`:
```json
{
  "E504": {
    "message": "New error message",
    "description": "Detailed description",
    "solution": "How to resolve",
    "category": "network"
  }
}
```

3. Use in code:
```javascript
throw createError('E504', { /* context */ });
```

## Best Practices / ベストプラクティス

1. **Always use error codes** for system errors that users might encounter
2. **Provide context** with interpolated values when creating errors
3. **Include solutions** in error definitions to help users resolve issues
4. **Use appropriate locale** based on user preferences
5. **Log errors** with both code and message for debugging

## Error Recovery / エラー回復

Some errors are recoverable. Check the error definition:

```javascript
const error = errorCatalog.getError('E003', 'en');
if (error.solution) {
  console.log('Suggested solution:', error.solution);
}
```

## Integration with Logging / ロギングとの統合

The error system integrates with i18n logging:

```javascript
const I18nLogger = require('./lib/utils/i18n-logger');
const logger = I18nLogger.wrap(new Logger());

// Log error with code
logger.error('messages:errors.E001', { 
  code: 'E001',
  context: { /* error context */ }
});
```