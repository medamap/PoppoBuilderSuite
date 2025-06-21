/**
 * Remove Command
 * Remove a PoppoBuilder project from the registry
 */

const { getInstance: getProjectRegistry } = require('../core/project-registry');
const colors = require('colors');
const i18n = require('../i18n');
const readline = require('readline');
const fs = require('fs').promises;
const path = require('path');

class RemoveCommand {
  async execute(projectName, options = {}) {
    try {
      const registry = getProjectRegistry();
      await registry.initialize();

      // Check if project exists
      const project = registry.getProject(projectName);
      if (!project) {
        console.error(colors.red(i18n.t('commands.project.remove.not_found', { name: projectName })));
        process.exit(1);
      }

      // Check for running tasks
      const runningTasks = await this.checkRunningTasks(projectName);
      if (runningTasks && runningTasks.length > 0) {
        console.log(colors.yellow(i18n.t('commands.project.remove.running_tasks', 
          { name: projectName, count: runningTasks.length })));
        console.log(colors.yellow(i18n.t('commands.project.remove.running_tasks_warning')));
        
        // Show running tasks
        console.log('\nRunning tasks:');
        runningTasks.forEach(task => {
          console.log(colors.gray(`  - ${task.type || 'Unknown'} (PID: ${task.pid || 'N/A'})`));
        });
        
        process.exit(1);
      }

      // Confirmation prompt (unless --force is specified)
      if (!options.force) {
        const confirmed = await this.promptConfirmation(
          i18n.t('commands.project.remove.confirm', { name: projectName })
        );

        if (!confirmed) {
          console.log(colors.yellow(i18n.t('commands.project.remove.cancelled')));
          return;
        }
      }

      // Remove from registry
      await registry.unregister(projectName);
      
      console.log(colors.green(i18n.t('commands.project.remove.success', 
        { name: projectName })));
      console.log(colors.gray(`Path: ${project.path}`));

      // Clean up project files if requested
      if (options.clean) {
        await this.cleanProjectFiles(project, options);
      }

    } catch (error) {
      console.error(colors.red(i18n.t('commands.project.remove.error')));
      console.error(colors.red(error.message));
      process.exit(1);
    }
  }

  /**
   * Check if there are running tasks for the project
   * @param {string} projectName Project name/ID
   * @returns {Array} Array of running tasks
   */
  async checkRunningTasks(projectName) {
    try {
      // Try to check running tasks if process manager is available
      const runningTasksPath = path.join(process.cwd(), 'state', 'running-tasks.json');
      try {
        const data = await fs.readFile(runningTasksPath, 'utf8');
        const runningTasks = JSON.parse(data);
        
        // Filter tasks for this project
        return runningTasks.filter(task => task.projectId === projectName);
      } catch (err) {
        // File doesn't exist or can't be read - no running tasks
        return [];
      }
    } catch (error) {
      // Error checking running tasks - not critical
      return [];
    }
  }

  /**
   * Clean up project-related files
   * @param {Object} project Project configuration
   * @param {Object} options Command options
   */
  async cleanProjectFiles(project, options) {
    console.log(colors.yellow(i18n.t('commands.project.remove.cleaning')));

    const projectCleaner = require('../utils/project-cleaner');
    const cleaner = new projectCleaner();

    try {
      const cleanupReport = await cleaner.cleanProject(project, {
        dryRun: false,
        verbose: options.verbose || false
      });

      if (cleanupReport.errors.length > 0) {
        console.log(colors.yellow(i18n.t('commands.project.remove.clean_warnings')));
        cleanupReport.errors.forEach(error => {
          console.log(colors.gray(`  - ${error}`));
        });
      }

      console.log(colors.green(i18n.t('commands.project.remove.clean_success')));
      console.log(colors.gray(i18n.t('commands.project.remove.clean_summary', 
        { files: cleanupReport.filesRemoved, bytes: cleanupReport.bytesFreed })));

    } catch (error) {
      console.error(colors.red(i18n.t('commands.project.remove.clean_error')), error.message);
    }
  }

  /**
   * Prompt for confirmation
   * @param {string} message Confirmation message
   * @returns {Promise<boolean>} User's response
   */
  async promptConfirmation(message) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question(`${message} (y/N) `, (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });
  }
}

module.exports = RemoveCommand;