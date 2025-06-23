# PoppoBuilder Migration Guide

This guide walks you through migrating from PoppoBuilder 2.x (local execution) to PoppoBuilder 3.0 (global daemon architecture).

## Overview

PoppoBuilder 3.0 introduces a significant architectural change:

- **Before (2.x)**: Each project runs independently with its own process
- **After (3.0)**: A single global daemon manages all projects

### Benefits of Migration

- **Centralized Management**: Single point of control for all projects
- **Resource Efficiency**: Shared resources and better utilization
- **Advanced Features**: Priority management, load balancing, monitoring
- **Simplified Operations**: One daemon to start/stop/monitor
- **Cross-Project Analytics**: Unified metrics and reporting

## Prerequisites

### System Requirements

- Node.js 16.0 or higher
- PoppoBuilder 3.0 installed globally: `npm install -g poppobuilder`
- Existing PoppoBuilder 2.x project(s)

### Backup Recommendations

Always create backups before migration:

```bash
# Create full project backup
tar -czf poppo-backup-$(date +%Y%m%d).tar.gz /path/to/project

# Or use the built-in backup during migration
poppobuilder migrate --backup
```

## Migration Scenarios

### Scenario 1: Single Project Migration

**Current State**: One PoppoBuilder project running locally

**Steps**:

1. **Initialize global configuration**:
   ```bash
   poppobuilder init
   ```

2. **Navigate to your project**:
   ```bash
   cd /path/to/your/poppo/project
   ```

3. **Run migration analysis**:
   ```bash
   poppobuilder migrate --dry-run
   ```

4. **Perform migration**:
   ```bash
   poppobuilder migrate
   ```

5. **Start daemon**:
   ```bash
   poppobuilder start
   ```

6. **Verify migration**:
   ```bash
   poppobuilder status
   poppobuilder list
   ```

### Scenario 2: Multiple Projects Migration

**Current State**: Multiple PoppoBuilder projects across different directories

**Steps**:

1. **Initialize global configuration** (once):
   ```bash
   poppobuilder init
   ```

2. **Migrate each project**:
   ```bash
   # Project 1
   cd /path/to/project1
   poppobuilder migrate --name "Project One" --priority 80
   
   # Project 2
   cd /path/to/project2
   poppobuilder migrate --name "Project Two" --priority 50
   
   # Project 3
   cd /path/to/project3
   poppobuilder migrate --name "Project Three" --priority 30
   ```

3. **Start daemon**:
   ```bash
   poppobuilder start
   ```

4. **Verify all projects**:
   ```bash
   poppobuilder list
   poppobuilder status
   ```

### Scenario 3: Development vs Production

**Current State**: Different configurations for dev/prod environments

**Migration Strategy**:

1. **Use templates during registration**:
   ```bash
   # Development environment
   poppobuilder register --template development
   
   # Production environment
   poppobuilder register --template high-priority
   ```

2. **Configure environments separately**:
   ```bash
   # Development: Lower priority, longer polling
   poppobuilder project config dev-project \
     --priority 30 \
     --polling-interval 600000
   
   # Production: High priority, frequent polling
   poppobuilder project config prod-project \
     --priority 90 \
     --polling-interval 60000
   ```

## Migration Process Details

### What Gets Migrated

#### Configuration Files
- `.poppo/config.json` → `~/.poppobuilder/projects/<id>/.poppo/`
- `config.json` → `~/.poppobuilder/projects/<id>/config.json`
- `.env` files → `~/.poppobuilder/projects/<id>/`

#### Data Files
- `state/` directory → `~/.poppobuilder/data/<id>/state/`
- `processed-*.json` → `~/.poppobuilder/data/<id>/`
- `running-tasks.json` → `~/.poppobuilder/data/<id>/`

#### Project Registration
- Project metadata in `~/.poppobuilder/projects.json`
- Unique project ID generated from name/path

### What Doesn't Get Migrated

- `node_modules/` (install dependencies separately)
- `logs/` (new logs go to global location)
- Source code (stays in original location)
- Git history and `.git/` directory

### Migration Validation

The migration tool performs several validation checks:

#### Pre-Migration Checks
- ✅ Valid PoppoBuilder project detected
- ✅ Required files present
- ✅ Configuration files readable
- ✅ Write permissions available

#### Post-Migration Checks
- ✅ Project registered successfully
- ✅ Configuration migrated
- ✅ Data files transferred
- ✅ Daemon recognizes project

## Configuration Mapping

### Project Configuration

**Before (local config.json)**:
```json
{
  "claude": {
    "timeout": 30000,
    "maxRetries": 3
  },
  "github": {
    "pollingInterval": 300000
  }
}
```

**After (global + project config)**:
```json
// ~/.poppobuilder/config.json (global)
{
  "daemon": {
    "maxProcesses": 4,
    "schedulingStrategy": "weighted-round-robin"
  }
}

// ~/.poppobuilder/projects.json (project registry)
{
  "projects": {
    "my-project": {
      "config": {
        "priority": 50,
        "pollingInterval": 300000,
        "enabled": true
      }
    }
  }
}
```

### Environment Variables

**Migration mapping**:
- `POPPO_*` → Continues to work (project-specific)
- New: `POPPO_DAEMON_*` → Daemon-specific settings
- New: `POPPO_CONFIG_DIR` → Global config directory

## Rollback Strategy

If you need to rollback after migration:

### Option 1: Use Backup

```bash
# Restore from backup
tar -xzf poppo-backup-YYYYMMDD.tar.gz

# Stop daemon
poppobuilder stop

# Remove global configuration
rm -rf ~/.poppobuilder

# Run original local script
cd /path/to/project
npm run start:original  # Created during migration
```

### Option 2: Manual Rollback

```bash
# Stop daemon
poppobuilder stop

# Unregister project
poppobuilder unregister my-project

# Restore package.json scripts (if modified)
# Edit package.json to restore original start script

# Run locally
npm start
```

## Troubleshooting

### Common Issues

#### Migration Fails with "Project not detected"

**Cause**: Migration tool can't identify PoppoBuilder project

**Solution**:
```bash
# Check for PoppoBuilder indicators
ls -la src/minimal-poppo.js minimal-poppo.js .poppo/

# Force migration if you're sure it's a PoppoBuilder project
poppobuilder migrate --force
```

#### "Project already exists" Error

**Cause**: Project ID conflicts with existing registration

**Solution**:
```bash
# Use custom ID
poppobuilder migrate --id "unique-project-id"

# Or unregister existing project first
poppobuilder unregister existing-project
```

#### Daemon Won't Start After Migration

**Cause**: Configuration issues or port conflicts

**Solution**:
```bash
# Check configuration
poppobuilder init --force

# Use different port
poppobuilder start --port 3004

# Check logs
tail -f ~/.poppobuilder/logs/daemon.error.log
```

#### Project Not Processing Issues

**Cause**: Project disabled or configuration issues

**Solution**:
```bash
# Check project status
poppobuilder project info my-project

# Enable if disabled
poppobuilder project enable my-project

# Validate configuration
poppobuilder project validate my-project

# Check project logs
poppobuilder project logs my-project --level error
```

### Performance Issues

#### High Memory Usage

**Symptoms**: Daemon consuming too much memory

**Solutions**:
```bash
# Reduce max processes
poppobuilder project config my-project --max-processes 2

# Disable resource-intensive projects temporarily
poppobuilder project disable heavy-project

# Restart daemon
poppobuilder restart
```

#### Slow Issue Processing

**Symptoms**: Issues not being processed quickly

**Solutions**:
```bash
# Increase project priority
poppobuilder project config my-project --priority 80

# Reduce polling interval (carefully - may hit rate limits)
poppobuilder project config my-project --polling-interval 60000

# Check for bottlenecks
poppobuilder status --watch
```

## Best Practices

### Project Organization

1. **Use descriptive project IDs**:
   ```bash
   poppobuilder register --id "main-app-prod" --name "Main App (Production)"
   ```

2. **Set appropriate priorities**:
   - Production: 80-100
   - Staging: 50-79
   - Development: 20-49
   - Experimental: 1-19

3. **Configure polling intervals wisely**:
   - Critical projects: 1-5 minutes
   - Normal projects: 5-15 minutes
   - Low priority: 15+ minutes

### Monitoring

1. **Regular status checks**:
   ```bash
   # Add to cron for automated monitoring
   0 */6 * * * poppobuilder status --json > /tmp/poppo-status.json
   ```

2. **Log monitoring**:
   ```bash
   # Monitor for errors across all projects
   poppobuilder project logs --level error
   ```

### Maintenance

1. **Regular cleanup**:
   ```bash
   # Clean old logs (manual - add to maintenance script)
   find ~/.poppobuilder/logs -name "*.log" -mtime +30 -delete
   ```

2. **Configuration backups**:
   ```bash
   # Backup global configuration
   tar -czf poppo-config-backup-$(date +%Y%m%d).tar.gz ~/.poppobuilder
   ```

## Migration Checklist

### Pre-Migration
- [ ] Backup existing project
- [ ] Install PoppoBuilder 3.0 globally
- [ ] Stop any running PoppoBuilder processes
- [ ] Document current configuration

### Migration
- [ ] Run `poppobuilder init`
- [ ] Run `poppobuilder migrate --dry-run`
- [ ] Review migration plan
- [ ] Execute migration: `poppobuilder migrate`
- [ ] Start daemon: `poppobuilder start`

### Post-Migration
- [ ] Verify project registration: `poppobuilder list`
- [ ] Check daemon status: `poppobuilder status`
- [ ] Test issue processing
- [ ] Monitor logs for errors
- [ ] Update deployment scripts
- [ ] Update documentation

### Cleanup (After Verification)
- [ ] Remove backup files (if no longer needed)
- [ ] Update CI/CD pipelines
- [ ] Train team on new CLI commands
- [ ] Update monitoring/alerting

## Getting Help

If you encounter issues during migration:

1. **Check documentation**: [CLI Documentation](cli/README.md)
2. **Run diagnostics**: `poppobuilder project validate <project-id>`
3. **Check logs**: `poppobuilder project logs <project-id> --level error`
4. **Create issue**: [GitHub Issues](https://github.com/medamap/PoppoBuilderSuite/issues)

Include this information when reporting issues:
- Migration command used
- Error messages
- Project structure (`ls -la`)
- Global config (`cat ~/.poppobuilder/config.json`)
- Daemon logs (`tail -50 ~/.poppobuilder/logs/daemon.error.log`)