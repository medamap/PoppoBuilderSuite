# English Output Guidelines

## Overview

To ensure global reach and maintainability, all GitHub outputs from PoppoBuilder Suite must be in English.

## Scope

### Must be in English
1. **Git Commits**
   - Use conventional commit format
   - Examples:
     - `feat: Add user authentication`
     - `fix: Resolve memory leak in task processor`
     - `docs: Update API documentation`
     - `refactor: Simplify error handling logic`
     - `test: Add unit tests for language detector`

2. **GitHub Issues**
   - Title: Clear, descriptive English
   - Body: Detailed description in English
   - Labels: Use English labels (see below)

3. **Pull Requests**
   - Title: Follow conventional format in English
   - Description: Use the template with English sections
   - Comments: Technical discussions in English

4. **Error Reports in Comments**
   - Error messages
   - Stack traces
   - Technical details

### Remains Multilingual
1. **User Interactions**
   - Detect user's preferred language from issue content
   - Respond in the user's language
   - Welcome messages adapt to user language

2. **Documentation**
   - README files can have multilingual versions
   - User guides in multiple languages

## Implementation Details

### Commit Message Format
```
<type>(<scope>): <subject>

<body>

<footer>
```

Types:
- feat: New feature
- fix: Bug fix
- docs: Documentation changes
- style: Code style changes
- refactor: Code refactoring
- test: Test additions/changes
- chore: Build/tool changes

### Issue Template
```markdown
## Description
[Clear description of the issue]

## Steps to Reproduce
1. [First step]
2. [Second step]
3. [...]

## Expected Behavior
[What should happen]

## Actual Behavior
[What actually happens]

## Environment
- OS: [e.g., macOS 14.0]
- Node.js: [e.g., 18.x]
- PoppoBuilder Version: [e.g., 3.0.0]
```

### PR Template
```markdown
## Summary
[Brief description of changes]

## Changes Made
- [Change 1]
- [Change 2]
- [...]

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Related Issues
Fixes #[issue number]
```

## Standard Labels (English)

### Priority
- `priority:critical`
- `priority:high`
- `priority:medium`
- `priority:low`

### Type
- `type:bug`
- `type:feature`
- `type:documentation`
- `type:question`
- `type:enhancement`

### Status
- `status:in-progress`
- `status:blocked`
- `status:needs-review`
- `status:ready`

### Task Categories
- `task:dogfooding`
- `task:bug`
- `task:feature`
- `task:docs`
- `task:quality`

## Examples

### Good Commit Message
```
feat: Add language detection for GitHub comments

- Implemented LanguageDetector class
- Added support for Japanese/English detection
- Integrated with comment templates

Closes #173
```

### Good Issue Title
```
Bug: Process manager fails to recover from crash
Feature: Add support for custom error codes
Docs: Update installation guide for Windows
```

### Good PR Title
```
fix: Resolve memory leak in task queue processing
feat: Implement GitHub comment internationalization
refactor: Simplify error handling in CCLA agent
```

## Automated Enforcement

The system automatically:
1. Validates commit message format
2. Suggests English translations for non-English inputs
3. Provides templates for consistent formatting
4. Uses English for all automated outputs

## Migration Guide

For existing Japanese content:
1. Keep historical commits as-is
2. New commits must follow English guidelines
3. Update active PR titles to English
4. Gradually translate issue titles when updating

## Benefits

1. **Global Collaboration**: Easier for international contributors
2. **Tool Compatibility**: Better integration with GitHub features
3. **Search Optimization**: English keywords improve discoverability
4. **Consistency**: Unified language for technical content
5. **Professional Standard**: Aligns with open-source best practices