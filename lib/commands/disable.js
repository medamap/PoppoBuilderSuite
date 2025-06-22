/**
 * Disable Command
 * Disable a PoppoBuilder project
 */

const { getInstance: getProjectRegistry } = require('../core/project-registry');
const colors = require('colors');
const i18n = require('../i18n');

class DisableCommand {
  async execute(projectName, options = {}) {
    try {
      const registry = getProjectRegistry();
      await registry.initialize();

      // Check if project exists
      const project = registry.getProject(projectName);
      if (!project) {
        console.error(colors.red(i18n.t('commands.project.disable.not_found', { name: projectName })));
        process.exit(1);
      }

      // Check if already disabled
      if (!project.enabled) {
        console.log(colors.yellow(i18n.t('commands.project.disable.already_disabled', { name: projectName })));
        return;
      }

      // Check for running tasks
      const runningTasks = await this.checkRunningTasks(projectName);
      if (runningTasks && runningTasks.length > 0 && !options.force) {
        console.log(colors.yellow(i18n.t('commands.project.disable.running_tasks', 
          { name: projectName, count: runningTasks.length })));
        console.log(colors.yellow(i18n.t('commands.project.disable.running_tasks_warning')));
        console.log(colors.yellow(i18n.t('commands.project.disable.force_hint')));
        
        // Show running tasks
        console.log('\nRunning tasks:');
        runningTasks.forEach(task => {
          console.log(colors.gray(`  - ${task.type || 'Unknown'} (PID: ${task.pid || 'N/A'})`));
        });
        
        if (!options.force) {
          return;
        }
      }

      // Disable the project
      await registry.setEnabled(projectName, false);
      
      console.log(colors.green(i18n.t('commands.project.disable.success', { name: projectName })));
      console.log(colors.gray(`Path: ${project.path}`));
      
      if (runningTasks && runningTasks.length > 0) {
        console.log(colors.yellow(i18n.t('commands.project.disable.tasks_note')));
      }
    } catch (error) {
      console.error(colors.red(i18n.t('commands.project.disable.error')));
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
      const fs = require('fs').promises;
      const path = require('path');
      
      // Check if running tasks file exists
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
}

module.exports = DisableCommand;