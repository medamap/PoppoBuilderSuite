# Enable/Disable Commands

## Overview

PoppoBuilder provides top-level `enable` and `disable` commands (with `on` and `off` aliases) to quickly toggle project states.

## Usage

### Enable a project

```bash
# Enable a project
poppobuilder enable <projectname>

# Using alias
poppobuilder on <projectname>
```

### Disable a project

```bash
# Disable a project
poppobuilder disable <projectname>

# Using alias
poppobuilder off <projectname>

# Force disable even if there are running tasks
poppobuilder disable <projectname> --force
```

## Features

### Enable Command
- Checks if the project exists before enabling
- Warns if the project is already enabled
- Notifies about any running tasks that may need restart

### Disable Command
- Checks if the project exists before disabling
- Warns if the project is already disabled
- Checks for running tasks and prompts for confirmation
- Use `--force` flag to disable anyway
- Running tasks will continue but no new tasks will start

## Examples

```bash
# Enable a project called "my-project"
poppobuilder enable my-project

# Same as above using alias
poppobuilder on my-project

# Disable a project
poppobuilder disable my-project

# Force disable even with running tasks
poppobuilder disable my-project --force

# Using alias to disable
poppobuilder off my-project
```

## Notes

- These commands modify the project's enabled state in the registry
- Changes are persisted immediately
- Running tasks are not automatically stopped when disabling a project
- Use daemon commands to manage running processes if needed