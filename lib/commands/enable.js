/**
 * Enable Command
 * Enable a PoppoBuilder project
 */

const { getInstance: getProjectRegistry } = require('../core/project-registry');
const colors = require('colors');
const i18n = require('../i18n');

class EnableCommand {
  async execute(projectName, options = {}) {
    try {
      const registry = getProjectRegistry();
      await registry.initialize();

      // Check if project exists
      const project = registry.getProject(projectName);
      if (!project) {
        console.error(colors.red(i18n.t('commands.project.enable.not_found', `Project '${projectName}' not found`)));
        process.exit(1);
      }

      // Check if already enabled
      if (project.enabled) {
        console.log(colors.yellow(i18n.t('commands.project.enable.already_enabled', `Project '${projectName}' is already enabled`)));
        return;
      }

      // Enable the project
      await registry.setEnabled(projectName, true);
      
      console.log(colors.green(i18n.t('commands.project.enable.success', `Project '${projectName}' enabled successfully`)));
      console.log(colors.gray(`Path: ${project.path}`));
      
      // Show warning if there are running tasks
      const runningTasks = await this.checkRunningTasks(projectName);
      if (runningTasks && runningTasks.length > 0) {
        console.log(colors.yellow(i18n.t('commands.project.enable.running_tasks_warning', 
          'Note: There are running tasks that may need to be restarted for changes to take effect')));
      }
    } catch (error) {
      console.error(colors.red(i18n.t('commands.project.enable.error', 'Failed to enable project')));
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

module.exports = EnableCommand;