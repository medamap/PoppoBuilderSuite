/**
 * Config Migrate Command
 * Migrates project configurations to global configuration
 */

const ConfigMigration = require('../core/config-migration');
const chalk = require('chalk');
const path = require('path');
const inquirer = require('inquirer');

class ConfigMigrateCommand {
  constructor() {
    this.migration = new ConfigMigration();
  }

  /**
   * Execute the config migrate command
   * @param {string} projectPath - Project path or scan directory
   * @param {Object} options - Command options
   * @returns {Promise<void>}
   */
  async execute(projectPath = '.', options = {}) {
    try {
      console.log(chalk.blue.bold('PoppoBuilder Configuration Migration\n'));
      
      const results = [];
      
      if (options.scan) {
        // Scan for projects
        console.log(chalk.blue('Scanning for projects...'));
        const projects = await this.migration.scanForProjects(
          path.resolve(projectPath),
          {
            recursive: options.recursive,
            maxProjects: options.maxProjects || 50
          }
        );
        
        if (projects.length === 0) {
          console.log(chalk.yellow('No PoppoBuilder projects found.'));
          return;
        }
        
        console.log(chalk.green(`Found ${projects.length} project(s):\n`));
        projects.forEach(project => {
          console.log(chalk.cyan(`  - ${project.name}`), chalk.gray(project.path));
        });
        console.log();
        
        // Confirm migration
        if (!options.yes) {
          const { confirmed } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirmed',
              message: `Migrate ${projects.length} project(s)?`,
              default: true
            }
          ]);
          
          if (!confirmed) {
            console.log(chalk.gray('Migration cancelled.'));
            return;
          }
        }
        
        // Migrate each project
        for (const project of projects) {
          console.log(chalk.blue(`\nMigrating ${project.name}...`));
          try {
            const result = await this.migration.migrateProject(
              project.path,
              { dryRun: options.dryRun }
            );
            results.push(result);
          } catch (error) {
            results.push({
              success: false,
              projectPath: project.path,
              errors: [{ general: error.message }]
            });
          }
        }
      } else {
        // Migrate single project
        const resolvedPath = path.resolve(projectPath);
        console.log(chalk.blue('Migrating project:'), chalk.gray(resolvedPath));
        
        try {
          const result = await this.migration.migrateProject(
            resolvedPath,
            { dryRun: options.dryRun }
          );
          results.push(result);
        } catch (error) {
          console.error(chalk.red('\nMigration failed:'), error.message);
          if (options.verbose) {
            console.error(error.stack);
          }
          process.exit(1);
        }
      }
      
      // Show report
      if (results.length > 0) {
        console.log('\n' + this.migration.createReport(results));
        
        if (options.dryRun) {
          console.log(chalk.yellow('Note: This was a dry run. No changes were made.'));
        }
      }
      
    } catch (error) {
      console.error(chalk.red('Error during migration:'), error.message);
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  }

  /**
   * Get command description
   * @returns {string}
   */
  static getDescription() {
    return 'Migrate project configuration to global configuration';
  }

  /**
   * Get command options
   * @returns {Array}
   */
  static getOptions() {
    return [
      {
        flags: '-s, --scan',
        description: 'Scan directory for projects to migrate'
      },
      {
        flags: '-r, --recursive',
        description: 'Recursively scan subdirectories'
      },
      {
        flags: '-d, --dry-run',
        description: 'Show what would be migrated without making changes'
      },
      {
        flags: '-y, --yes',
        description: 'Skip confirmation prompts'
      },
      {
        flags: '-m, --max-projects <n>',
        description: 'Maximum number of projects to scan (default: 50)'
      },
      {
        flags: '-v, --verbose',
        description: 'Show verbose output'
      }
    ];
  }

  /**
   * Get command examples
   * @returns {Array}
   */
  static getExamples() {
    return [
      {
        description: 'Migrate current project',
        command: 'poppo-builder config migrate'
      },
      {
        description: 'Migrate specific project',
        command: 'poppo-builder config migrate /path/to/project'
      },
      {
        description: 'Scan and migrate all projects in directory',
        command: 'poppo-builder config migrate ~/projects --scan'
      },
      {
        description: 'Recursive scan with dry run',
        command: 'poppo-builder config migrate ~/projects --scan --recursive --dry-run'
      },
      {
        description: 'Migrate without confirmation',
        command: 'poppo-builder config migrate . --scan --yes'
      }
    ];
  }
}

module.exports = ConfigMigrateCommand;