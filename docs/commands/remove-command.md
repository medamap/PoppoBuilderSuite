# Remove Command Documentation

## Overview
The `remove` command allows you to remove a PoppoBuilder project from the registry. It supports safe removal with running task checks and optional cleanup of project-related files.

## Usage

```bash
poppobuilder remove <projectname> [options]
```

### Aliases
- `rm`
- `del`

### Options
- `--force` - Skip the confirmation prompt
- `--clean` - Remove project-related files (logs, state, cache)

## Examples

### Basic removal with confirmation
```bash
poppobuilder remove my-project
# Will prompt: Are you sure you want to remove project 'my-project'? (y/N)
```

### Force removal without confirmation
```bash
poppobuilder remove my-project --force
```

### Remove project and clean up related files
```bash
poppobuilder remove my-project --clean
# or
poppobuilder remove my-project --force --clean
```

## Safety Features

### Running Tasks Check
The command will check for any running tasks associated with the project. If tasks are found, the removal will be blocked and you'll need to stop them first.

### Confirmation Prompt
Unless `--force` is specified, the command will ask for confirmation before removing the project.

### File Cleanup
When using `--clean`, the following files and directories will be removed:
- Logs: `logs/**/*{projectId}*`
- State files: `state/*{projectId}*`
- Cache: `.poppo/cache/{projectId}/**/*`
- Data: `data/{projectId}/**/*`
- Temporary files: `/tmp/poppobuilder/{projectId}`
- Project-local cache and state files

## Implementation Details

### Files Created
- `/lib/commands/remove.js` - Main remove command implementation
- `/lib/utils/project-cleaner.js` - Utility for cleaning project files

### i18n Support
The command supports internationalization with messages in:
- English: `/lib/i18n/locales/en/cli.json`
- Japanese: `/lib/i18n/locales/ja/cli.json`

### Integration
The command is registered in `/bin/poppobuilder.js` and uses the project registry to safely remove projects.