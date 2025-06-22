# PoppoBuilder Project Management

PoppoBuilder provides comprehensive project management capabilities to handle multiple projects efficiently.

## Project Registry

All PoppoBuilder projects are registered in a global registry located at `~/.poppobuilder/projects.json`. This allows you to manage projects from anywhere in your system.

## Commands

### Listing Projects

```bash
# List all registered projects
poppobuilder list
poppobuilder ls

# Show as table
poppobuilder list --table

# Filter by status
poppobuilder list --enabled
poppobuilder list --disabled

# Filter by tag
poppobuilder list --tag automation

# Show with runtime status
poppobuilder list --status

# Output as JSON
poppobuilder list --json
```

### Moving Projects

The `move` command allows you to relocate a project to a new directory without losing configuration or history.

```bash
# Move project by ID
poppobuilder move project-id /new/path

# Move project by current path
poppobuilder move /old/path /new/path

# Command aliases
poppobuilder mv project-id /new/path
```

#### Options

- `--force` - Force move even with uncommitted Git changes
- `--parents` - Create parent directories if they don't exist
- `--merge` - Merge into existing directory (if target exists)
- `--symlink` - Create a symbolic link at the old location

#### Examples

```bash
# Simple move
poppobuilder move my-project ~/projects/new-location

# Create parent directories
poppobuilder move my-project ~/new/projects/location --parents

# Move with symlink (useful for CI/CD compatibility)
poppobuilder move my-project /new/location --symlink

# Force move with uncommitted changes
poppobuilder move my-project /new/location --force
```

#### What happens during move:

1. **Validation**
   - Checks if source project exists
   - Verifies no running tasks
   - Warns about uncommitted Git changes
   - Ensures target doesn't already have a PoppoBuilder project

2. **Move Operation**
   - Moves all project files to new location
   - Updates project registry with new path
   - Handles cross-device moves (copy + delete)

3. **Post-Move Updates**
   - Updates any absolute paths in configuration
   - Handles Git submodule paths if applicable
   - Creates symlink if requested

4. **Rollback**
   - Attempts automatic rollback on failure
   - Preserves original project if move fails

### Removing Projects

```bash
# Remove project from registry only
poppobuilder remove project-id

# Remove with all project files
poppobuilder remove project-id --clean

# Skip confirmation
poppobuilder remove project-id --force
```

### Enabling/Disabling Projects

```bash
# Enable a project
poppobuilder enable project-id
poppobuilder on project-id

# Disable a project
poppobuilder disable project-id
poppobuilder off project-id

# Force disable (even with running tasks)
poppobuilder disable project-id --force
```

## Project Path Management

### Repository Root Detection

PoppoBuilder performs checks during initialization to ensure projects are set up correctly:

- Detects if the current directory is a Git repository
- Warns if initializing in a subdirectory (not repository root)
- Automatically extracts GitHub owner/repo from Git remote

### Zombie Project Detection

Projects whose directories have been deleted become "zombie" projects. PoppoBuilder can detect and clean these up:

```bash
# Check system health (includes zombie detection)
poppobuilder doctor

# Clean up zombie projects
poppobuilder doctor --fix
```

The `list --status` command also shows path status:
- ✓ exists - Project directory exists
- ✗ not found - Project directory missing (zombie)

## Best Practices

1. **Initialize at Repository Root**
   - Always run `poppobuilder init` at the root of your Git repository
   - This ensures proper Issue processing and Git operations

2. **Use Move Command**
   - Use `poppobuilder move` instead of manually moving directories
   - This preserves all configuration and history

3. **Regular Cleanup**
   - Run `poppobuilder doctor` periodically
   - Remove zombie projects to keep registry clean

4. **Symlink for Compatibility**
   - Use `--symlink` option when moving if other tools reference the old path
   - Useful for CI/CD pipelines that expect specific paths

5. **Check Before Moving**
   - Ensure no tasks are running
   - Commit or stash Git changes
   - Verify target location is appropriate

## Troubleshooting

### Project Not Found After Move

If you manually moved a project directory:
1. The old project ID still points to the old path
2. Run `poppobuilder list --status` to see the broken reference
3. Remove the old project: `poppobuilder remove old-project-id`
4. Re-initialize in the new location: `cd /new/path && poppobuilder init`

### Permission Errors During Move

- Ensure you have write permissions for both source and target
- Use `sudo` if necessary (not recommended)
- Check parent directory permissions with `--parents` option

### Cross-Device Move Issues

- PoppoBuilder handles cross-device moves automatically
- Large projects may take time to copy
- Ensure sufficient disk space on target device
- Original is preserved until copy completes