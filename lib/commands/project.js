/**
 * Project Registry CLI Commands
 */

const { Command } = require('commander');
const path = require('path');
const fs = require('fs').promises;
const colors = require('colors');
const { getInstance: getProjectRegistry } = require('../core/project-registry');
const i18n = require('../i18n');

/**
 * Create project management commands
 */
function createProjectCommand() {
  const cmd = new Command('project');
  cmd.description(i18n.t('commands.project.description', 'Manage PoppoBuilder projects'));

  // Register project command
  cmd
    .command('register <path>')
    .description(i18n.t('commands.project.register.description', 'Register a new project'))
    .option('-n, --name <name>', i18n.t('commands.project.register.name', 'Project name'))
    .option('-d, --description <desc>', i18n.t('commands.project.register.description_text', 'Project description'))
    .option('--owner <owner>', i18n.t('commands.project.register.owner', 'GitHub repository owner'))
    .option('--repo <repo>', i18n.t('commands.project.register.repo', 'GitHub repository name'))
    .option('--priority <priority>', i18n.t('commands.project.register.priority', 'Project priority (0-100)'), parseInt)
    .option('--disabled', i18n.t('commands.project.register.disabled', 'Register project as disabled'))
    .action(async (projectPath, options) => {
      try {
        const registry = getProjectRegistry();
        await registry.initialize();

        // Build configuration
        const config = {};
        if (options.name) config.name = options.name;
        if (options.description) config.description = options.description;
        if (options.owner || options.repo) {
          config.github = {};
          if (options.owner) config.github.owner = options.owner;
          if (options.repo) config.github.repo = options.repo;
        }
        if (options.priority !== undefined) config.priority = options.priority;

        const projectId = await registry.register(projectPath, {
          enabled: !options.disabled,
          config
        });

        console.log(colors.green(i18n.t('commands.project.register.success', 'Project registered successfully')));
        console.log(`${i18n.t('commands.project.register.id', 'Project ID')}: ${colors.cyan(projectId)}`);
        console.log(`${i18n.t('commands.project.register.path', 'Path')}: ${colors.gray(path.resolve(projectPath))}`);
        
        if (options.name) {
          console.log(`${i18n.t('commands.project.register.name', 'Name')}: ${options.name}`);
        }
      } catch (error) {
        console.error(colors.red(i18n.t('commands.project.register.error', 'Failed to register project')));
        console.error(colors.red(error.message));
        process.exit(1);
      }
    });

  // Unregister project command
  cmd
    .command('unregister <project-id>')
    .description(i18n.t('commands.project.unregister.description', 'Unregister a project'))
    .option('--force', i18n.t('commands.project.unregister.force', 'Skip confirmation'))
    .action(async (projectId, options) => {
      try {
        const registry = getProjectRegistry();
        await registry.initialize();

        const project = registry.getProject(projectId);
        if (!project) {
          console.error(colors.red(i18n.t('commands.project.unregister.not_found', 'Project not found')));
          process.exit(1);
        }

        if (!options.force) {
          console.log(`${i18n.t('commands.project.unregister.confirm', 'Are you sure you want to unregister')}:`);
          console.log(`  ${i18n.t('commands.project.register.id', 'Project ID')}: ${colors.cyan(projectId)}`);
          console.log(`  ${i18n.t('commands.project.register.path', 'Path')}: ${project.path}`);
          console.log(`\n${i18n.t('commands.project.unregister.warning', 'This will remove all project configuration and statistics.')}`);
          console.log(colors.yellow(i18n.t('commands.project.unregister.confirm_prompt', 'Use --force flag to confirm')));
          return;
        }

        await registry.unregister(projectId);
        console.log(colors.green(i18n.t('commands.project.unregister.success', 'Project unregistered successfully')));
      } catch (error) {
        console.error(colors.red(i18n.t('commands.project.unregister.error', 'Failed to unregister project')));
        console.error(colors.red(error.message));
        process.exit(1);
      }
    });

  // List projects command
  cmd
    .command('list')
    .description(i18n.t('commands.project.list.description', 'List all registered projects'))
    .option('--enabled-only', i18n.t('commands.project.list.enabled_only', 'Show only enabled projects'))
    .option('--json', i18n.t('commands.project.list.json', 'Output as JSON'))
    .action(async (options) => {
      try {
        const registry = getProjectRegistry();
        await registry.initialize();

        const projects = options.enabledOnly ? 
          registry.getEnabledProjects() : 
          registry.getAllProjects();

        if (options.json) {
          console.log(JSON.stringify(projects, null, 2));
          return;
        }

        const projectIds = Object.keys(projects);
        if (projectIds.length === 0) {
          console.log(colors.yellow(i18n.t('commands.project.list.no_projects', 'No projects registered')));
          return;
        }

        console.log(colors.bold(i18n.t('commands.project.list.header', 'Registered Projects')));
        console.log('');

        projectIds.forEach(id => {
          const project = projects[id];
          const status = project.enabled ? 
            colors.green('✓ enabled') : 
            colors.red('✗ disabled');
          
          console.log(`${colors.cyan(id)} ${status}`);
          console.log(`  ${i18n.t('commands.project.register.path', 'Path')}: ${project.path}`);
          
          if (project.config.name) {
            console.log(`  ${i18n.t('commands.project.register.name', 'Name')}: ${project.config.name}`);
          }
          
          if (project.config.github) {
            const { owner, repo } = project.config.github;
            if (owner && repo) {
              console.log(`  GitHub: ${owner}/${repo}`);
            }
          }
          
          if (project.stats.totalIssuesProcessed > 0) {
            console.log(`  ${i18n.t('commands.project.list.stats', 'Stats')}: ${project.stats.totalIssuesProcessed} issues, ${project.stats.totalErrors} errors`);
          }
          
          console.log('');
        });

        const metadata = registry.getMetadata();
        console.log(colors.gray(`${i18n.t('commands.project.list.total', 'Total')}: ${metadata.totalProjects} ${i18n.t('commands.project.list.projects', 'projects')}`));
      } catch (error) {
        console.error(colors.red(i18n.t('commands.project.list.error', 'Failed to list projects')));
        console.error(colors.red(error.message));
        process.exit(1);
      }
    });

  // Enable/disable project commands
  cmd
    .command('enable <project-id>')
    .description(i18n.t('commands.project.enable.description', 'Enable a project'))
    .action(async (projectId) => {
      try {
        const registry = getProjectRegistry();
        await registry.initialize();

        await registry.setEnabled(projectId, true);
        console.log(colors.green(i18n.t('commands.project.enable.success', 'Project enabled successfully')));
      } catch (error) {
        console.error(colors.red(i18n.t('commands.project.enable.error', 'Failed to enable project')));
        console.error(colors.red(error.message));
        process.exit(1);
      }
    });

  cmd
    .command('disable <project-id>')
    .description(i18n.t('commands.project.disable.description', 'Disable a project'))
    .action(async (projectId) => {
      try {
        const registry = getProjectRegistry();
        await registry.initialize();

        await registry.setEnabled(projectId, false);
        console.log(colors.green(i18n.t('commands.project.disable.success', 'Project disabled successfully')));
      } catch (error) {
        console.error(colors.red(i18n.t('commands.project.disable.error', 'Failed to disable project')));
        console.error(colors.red(error.message));
        process.exit(1);
      }
    });

  // Show project details command
  cmd
    .command('show <project-id>')
    .description(i18n.t('commands.project.show.description', 'Show project details'))
    .option('--json', i18n.t('commands.project.show.json', 'Output as JSON'))
    .action(async (projectId, options) => {
      try {
        const registry = getProjectRegistry();
        await registry.initialize();

        const project = registry.getProject(projectId);
        if (!project) {
          console.error(colors.red(i18n.t('commands.project.show.not_found', 'Project not found')));
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(project, null, 2));
          return;
        }

        console.log(colors.bold(`${i18n.t('commands.project.show.details', 'Project Details')}: ${colors.cyan(projectId)}`));
        console.log('');
        console.log(`${i18n.t('commands.project.register.path', 'Path')}: ${project.path}`);
        console.log(`${i18n.t('commands.project.show.status', 'Status')}: ${project.enabled ? colors.green('enabled') : colors.red('disabled')}`);
        console.log(`${i18n.t('commands.project.show.created', 'Created')}: ${new Date(project.createdAt).toLocaleString()}`);
        console.log(`${i18n.t('commands.project.show.updated', 'Updated')}: ${new Date(project.updatedAt).toLocaleString()}`);
        
        if (project.config.name) {
          console.log(`${i18n.t('commands.project.register.name', 'Name')}: ${project.config.name}`);
        }
        
        if (project.config.description) {
          console.log(`${i18n.t('commands.project.register.description_text', 'Description')}: ${project.config.description}`);
        }
        
        if (project.config.github) {
          console.log('');
          console.log(colors.bold('GitHub:'));
          if (project.config.github.owner) console.log(`  Owner: ${project.config.github.owner}`);
          if (project.config.github.repo) console.log(`  Repository: ${project.config.github.repo}`);
        }
        
        if (project.config.priority !== undefined) {
          console.log(`${i18n.t('commands.project.register.priority', 'Priority')}: ${project.config.priority}`);
        }
        
        console.log('');
        console.log(colors.bold(i18n.t('commands.project.show.statistics', 'Statistics')));
        console.log(`${i18n.t('commands.project.show.issues_processed', 'Issues Processed')}: ${project.stats.totalIssuesProcessed}`);
        console.log(`${i18n.t('commands.project.show.errors', 'Errors')}: ${project.stats.totalErrors}`);
        console.log(`${i18n.t('commands.project.show.avg_time', 'Average Processing Time')}: ${project.stats.averageProcessingTime}ms`);
        
        if (project.stats.lastActivityAt) {
          console.log(`${i18n.t('commands.project.show.last_activity', 'Last Activity')}: ${new Date(project.stats.lastActivityAt).toLocaleString()}`);
        }
      } catch (error) {
        console.error(colors.red(i18n.t('commands.project.show.error', 'Failed to show project')));
        console.error(colors.red(error.message));
        process.exit(1);
      }
    });

  // Update project command
  cmd
    .command('update <project-id>')
    .description(i18n.t('commands.project.update.description', 'Update project configuration'))
    .option('-n, --name <name>', i18n.t('commands.project.update.name', 'Update project name'))
    .option('-d, --description <desc>', i18n.t('commands.project.update.description_text', 'Update project description'))
    .option('--owner <owner>', i18n.t('commands.project.update.owner', 'Update GitHub repository owner'))
    .option('--repo <repo>', i18n.t('commands.project.update.repo', 'Update GitHub repository name'))
    .option('--priority <priority>', i18n.t('commands.project.update.priority', 'Update project priority (0-100)'), parseInt)
    .action(async (projectId, options) => {
      try {
        const registry = getProjectRegistry();
        await registry.initialize();

        const project = registry.getProject(projectId);
        if (!project) {
          console.error(colors.red(i18n.t('commands.project.update.not_found', 'Project not found')));
          process.exit(1);
        }

        // Build updates
        const updates = { config: {} };
        if (options.name !== undefined) updates.config.name = options.name;
        if (options.description !== undefined) updates.config.description = options.description;
        if (options.priority !== undefined) updates.config.priority = options.priority;
        
        if (options.owner !== undefined || options.repo !== undefined) {
          updates.config.github = { ...project.config.github };
          if (options.owner !== undefined) updates.config.github.owner = options.owner;
          if (options.repo !== undefined) updates.config.github.repo = options.repo;
        }

        await registry.updateProject(projectId, updates);
        console.log(colors.green(i18n.t('commands.project.update.success', 'Project updated successfully')));
      } catch (error) {
        console.error(colors.red(i18n.t('commands.project.update.error', 'Failed to update project')));
        console.error(colors.red(error.message));
        process.exit(1);
      }
    });

  // Export/import commands
  cmd
    .command('export <file>')
    .description(i18n.t('commands.project.export.description', 'Export project registry'))
    .action(async (filePath) => {
      try {
        const registry = getProjectRegistry();
        await registry.initialize();

        await registry.export(filePath);
        console.log(colors.green(i18n.t('commands.project.export.success', 'Registry exported successfully')));
        console.log(`${i18n.t('commands.project.export.file', 'File')}: ${path.resolve(filePath)}`);
      } catch (error) {
        console.error(colors.red(i18n.t('commands.project.export.error', 'Failed to export registry')));
        console.error(colors.red(error.message));
        process.exit(1);
      }
    });

  cmd
    .command('import <file>')
    .description(i18n.t('commands.project.import.description', 'Import project registry'))
    .option('--force', i18n.t('commands.project.import.force', 'Overwrite existing registry'))
    .action(async (filePath, options) => {
      try {
        const registry = getProjectRegistry();
        await registry.initialize();

        if (!options.force) {
          const metadata = registry.getMetadata();
          if (metadata.totalProjects > 0) {
            console.log(colors.yellow(i18n.t('commands.project.import.warning', 'This will overwrite the existing registry with')));
            console.log(colors.yellow(`${metadata.totalProjects} ${i18n.t('commands.project.import.existing_projects', 'existing projects')}.`)));
            console.log(colors.yellow(i18n.t('commands.project.import.force_prompt', 'Use --force flag to confirm')));
            return;
          }
        }

        await registry.import(filePath);
        console.log(colors.green(i18n.t('commands.project.import.success', 'Registry imported successfully')));
      } catch (error) {
        console.error(colors.red(i18n.t('commands.project.import.error', 'Failed to import registry')));
        console.error(colors.red(error.message));
        process.exit(1);
      }
    });

  return cmd;
}

module.exports = createProjectCommand;