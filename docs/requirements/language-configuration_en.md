# Language Configuration Feature Requirements

## Created: 2025/6/15
## Status: Requirements Definition

## Overview
Feature to configure PoppoBuilder's response language and ensure consistent language interaction with users.

## Detailed Requirements

### 1. Configuration Management
- **Configuration Location**: Project-specific configuration file (`.poppo/config.json`)
- **Default Language**: Japanese
- **Supported Languages**: Japanese, English (other languages can be added in the future)

### 2. Configuration File Format
```json
{
  "language": {
    "primary": "en",
    "fallback": "ja"
  },
  "systemPrompt": {
    "enforceLanguage": true,
    "customInstructions": ""
  }
}
```

### 3. System Prompt Integration
Automatically add the following to system prompt based on language settings:

```
Important: All responses must be in ${primary_language}.
- When Japanese is set: Write all responses, comments, and explanations in Japanese
- When English is set: Write all responses, comments, and explanations in English
- Code comments and variable names should also follow the specified language
```

### 4. Language-Specific System Prompt Examples

#### When English is Set
```
Important: You are PoppoBuilder's automated execution agent.
All responses, comments, and explanations must be in English.

Follow these rules:
1. The default working branch is 'work/poppo-builder'
2. Write all responses in English
3. Write code comments in English
4. Error messages and logs should be in English
```

#### When Japanese is Set
```
重要: あなたは PoppoBuilder の自動実行エージェントです。
すべての回答、コメント、説明は日本語で行ってください。

以下のルールに従ってください：
1. デフォルトの作業ブランチは 'work/poppo-builder' です
2. 回答はすべて日本語で記述してください
3. コードコメントも日本語で記述してください
4. エラーメッセージやログも日本語で出力してください
```

### 5. Implementation Requirements
- **Configuration File Loading**: Load on startup and respect hot-reload
- **Default Behavior**: Use Japanese when configuration file doesn't exist
- **System Prompt Generation**: Dynamically generate based on language settings
- **Error Handling**: Display appropriate messages for invalid language settings

### 6. Test Cases
1. **Default Behavior Test**: Verify Japanese response without config file
2. **Language Setting Test**: Verify correct language response after setting
3. **Hot-Reload Test**: Verify language change after config file update
4. **Invalid Setting Test**: Verify fallback to default for invalid settings

### 7. Future Extensions
- **Multi-language Support**: Support for Chinese, Korean, etc.
- **Context-Aware Language Switching**: Automatic language detection based on issue content
- **Language-Specific Templates**: Prepare response templates for each language
- **Translation Feature**: Automatic translation between languages

## Benefits
- **International Support**: Support for international projects
- **Team Collaboration**: Consistent communication within teams
- **User Experience**: Interaction in user's preferred language
- **Flexibility**: Easy language switching per project

## Notes
- Language setting is project-specific
- Doesn't affect Claude's code understanding or execution capabilities
- Code quality remains consistent regardless of language setting