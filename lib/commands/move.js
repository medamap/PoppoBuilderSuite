/**
 * Move Command
 * Move a PoppoBuilder project to a new location and update registry
 */

const { getInstance: getProjectRegistry } = require('../core/project-registry');
const colors = require('colors');
const { t } = require('../i18n');
const prompts = require('../utils/interactive-prompts');
const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

class MoveCommand {
  async execute(projectIdOrPath, newPath, options = {}) {
    try {
      const registry = getProjectRegistry();
      await registry.initialize();

      // Find the project
      let project, projectId;
      
      // First try as project ID
      project = registry.getProject(projectIdOrPath);
      if (project) {
        projectId = projectIdOrPath;
      } else {
        // Try as path
        const projectInfo = registry.getProjectByPath(projectIdOrPath);
        if (projectInfo) {
          projectId = projectInfo.id;
          project = projectInfo;
        }
      }

      if (!project) {
        console.error(colors.red(t('commands:move.projectNotFound', { identifier: projectIdOrPath })));
        
        // Suggest similar projects
        const allProjects = registry.getAllProjects();
        const suggestions = this.findSimilarProjects(projectIdOrPath, allProjects);
        if (suggestions.length > 0) {
          console.log(colors.yellow('\nDid you mean one of these?'));
          suggestions.forEach(s => {
            console.log(colors.gray(`  - ${s.id} (${s.project.config.name || 'Unnamed'})`));
          });
        }
        
        process.exit(1);
      }

      // Normalize paths
      const oldPath = path.resolve(project.path);
      const targetPath = path.resolve(newPath);

      // Validation
      await this.validateMove(oldPath, targetPath, project, options);

      // Show move summary
      console.log(colors.blue(`📦 Moving project: ${project.config.name || projectId}`));
      console.log(colors.gray(`From: ${oldPath}`));
      console.log(colors.gray(`To:   ${targetPath}`));
      console.log();

      // Confirmation (unless --force)
      if (!options.force) {
        const confirmed = await prompts.confirm('prompts:move.confirmMove', {
          default: false
        });

        if (!confirmed) {
          console.log(colors.yellow(t('prompts:move.moveCancelled')));
          prompts.close();
          return;
        }
      }

      // Perform the move
      await this.performMove(projectId, project, oldPath, targetPath, options);

      console.log(colors.green(`✓ ${t('commands:move.success')}`));
      console.log(colors.gray(`Project ${projectId} is now at: ${targetPath}`));

      // Post-move instructions
      if (project.config.github) {
        console.log();
        console.log(colors.yellow('Note: If you have any Git hooks or CI/CD configurations'));
        console.log(colors.yellow('that reference the old path, please update them manually.'));
      }

      prompts.close();
    } catch (error) {
      console.error(colors.red(t('commands:move.error')));
      console.error(colors.red(error.message));
      if (options.verbose) {
        console.error(error.stack);
      }
      prompts.close();
      process.exit(1);
    }
  }

  async validateMove(oldPath, targetPath, project, options) {
    // Check if source exists
    try {
      const stat = await fs.stat(oldPath);
      if (!stat.isDirectory()) {
        throw new Error('Source path is not a directory');
      }
    } catch (error) {
      throw new Error(`Source path not found or inaccessible: ${oldPath}`);
    }

    // Check if paths are the same
    if (oldPath === targetPath) {
      throw new Error('Source and destination paths are the same');
    }

    // Check if target exists
    try {
      await fs.access(targetPath);
      // Target exists
      if (!options.merge) {
        throw new Error(`Target path already exists: ${targetPath}\nUse --merge to move into existing directory`);
      }
      
      // If merging, check if it's a directory
      const targetStat = await fs.stat(targetPath);
      if (!targetStat.isDirectory()) {
        throw new Error('Target exists but is not a directory');
      }

      // Check if PoppoBuilder config already exists in target
      const targetConfigPath = path.join(targetPath, '.poppobuilder', 'config.json');
      try {
        await fs.access(targetConfigPath);
        throw new Error('Target directory already contains a PoppoBuilder project');
      } catch {
        // Good, no config exists
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // Target doesn't exist, which is fine
    }

    // Check if target parent directory exists
    const parentDir = path.dirname(targetPath);
    try {
      await fs.access(parentDir);
    } catch {
      if (!options.parents) {
        throw new Error(`Parent directory does not exist: ${parentDir}\nUse --parents to create it`);
      }
    }

    // Check for running tasks
    const runningTasks = await this.checkRunningTasks(project);
    if (runningTasks && runningTasks.length > 0) {
      throw new Error(`Cannot move project with ${runningTasks.length} running tasks.\nPlease stop all tasks first.`);
    }

    // Check if it's a git repository and has uncommitted changes
    if (await this.isGitRepository(oldPath)) {
      const gitStatus = await this.checkGitStatus(oldPath);
      if (gitStatus.hasChanges && !options.force) {
        console.log(colors.yellow('Warning: Git repository has uncommitted changes'));
        console.log(colors.gray('Use --force to move anyway, or commit your changes first'));
        
        const proceed = await prompts.confirm('prompts:move.uncommittedChanges', {
          default: false
        });
        
        if (!proceed) {
          throw new Error('Move cancelled due to uncommitted changes');
        }
      }
    }
  }

  async performMove(projectId, project, oldPath, targetPath, options) {
    const steps = [];
    const registry = getProjectRegistry();
    
    try {
      // Step 1: Create parent directories if needed
      if (options.parents) {
        steps.push('Creating parent directories');
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
      }

      // Step 2: Move the directory
      steps.push('Moving project files');
      
      // For cross-device moves, we need to copy then delete
      try {
        await fs.rename(oldPath, targetPath);
      } catch (error) {
        if (error.code === 'EXDEV') {
          // Cross-device move, use copy instead
          console.log(colors.gray('Cross-device move detected, copying files...'));
          await this.copyDirectory(oldPath, targetPath);
          await this.removeDirectory(oldPath);
        } else {
          throw error;
        }
      }

      // Step 3: Update registry
      steps.push('Updating project registry');
      await registry.updateProject(projectId, {
        path: targetPath
      });

      // Step 4: Update Git remote paths if it's a submodule
      if (await this.isGitSubmodule(targetPath)) {
        steps.push('Updating Git submodule paths');
        await this.updateGitSubmodulePaths(targetPath);
      }

      // Step 5: Create symlink if requested
      if (options.symlink) {
        steps.push('Creating symlink at old location');
        try {
          await fs.symlink(targetPath, oldPath, 'dir');
          console.log(colors.gray(`Created symlink: ${oldPath} → ${targetPath}`));
        } catch (error) {
          console.log(colors.yellow(`Warning: Could not create symlink: ${error.message}`));
        }
      }

      // Step 6: Update any project-specific paths in config
      steps.push('Updating configuration paths');
      await this.updateProjectPaths(targetPath, oldPath);

    } catch (error) {
      // Rollback if possible
      console.error(colors.red(`\nError during step: ${steps[steps.length - 1]}`));
      
      if (await this.pathExists(targetPath) && !await this.pathExists(oldPath)) {
        console.log(colors.yellow('Attempting to rollback...'));
        try {
          await fs.rename(targetPath, oldPath);
          console.log(colors.green('✓ Rollback successful'));
        } catch (rollbackError) {
          console.error(colors.red('✗ Rollback failed:', rollbackError.message));
          console.error(colors.red('Project may be in an inconsistent state!'));
        }
      }
      
      throw error;
    }
  }

  async copyDirectory(source, target) {
    const { execSync } = require('child_process');
    
    // Use native commands for efficiency
    if (process.platform === 'win32') {
      execSync(`xcopy "${source}" "${target}" /E /I /H /Y`, { stdio: 'inherit' });
    } else {
      execSync(`cp -r "${source}" "${target}"`, { stdio: 'inherit' });
    }
  }

  async removeDirectory(dirPath) {
    const { execSync } = require('child_process');
    
    if (process.platform === 'win32') {
      execSync(`rmdir "${dirPath}" /S /Q`, { stdio: 'inherit' });
    } else {
      execSync(`rm -rf "${dirPath}"`, { stdio: 'inherit' });
    }
  }

  async updateProjectPaths(newPath, oldPath) {
    // Update paths in PoppoBuilder config if they contain absolute paths
    const configPath = path.join(newPath, '.poppobuilder', 'config.json');
    
    try {
      const configData = await fs.readFile(configPath, 'utf8');
      let config = JSON.parse(configData);
      
      // Update any absolute paths in config
      const updatePaths = (obj) => {
        for (const key in obj) {
          if (typeof obj[key] === 'string' && obj[key].includes(oldPath)) {
            obj[key] = obj[key].replace(oldPath, newPath);
          } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            updatePaths(obj[key]);
          }
        }
      };
      
      updatePaths(config);
      
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      // Config update failed, not critical
      console.log(colors.gray('Note: Could not update config paths:', error.message));
    }
  }

  async checkRunningTasks(project) {
    // Implementation would check for running tasks
    // Similar to remove.js
    return [];
  }

  async isGitRepository(dirPath) {
    try {
      await fs.access(path.join(dirPath, '.git'));
      return true;
    } catch {
      return false;
    }
  }

  async isGitSubmodule(dirPath) {
    try {
      const gitFile = await fs.readFile(path.join(dirPath, '.git'), 'utf8');
      return gitFile.startsWith('gitdir:');
    } catch {
      return false;
    }
  }

  async updateGitSubmodulePaths(dirPath) {
    try {
      const gitFile = await fs.readFile(path.join(dirPath, '.git'), 'utf8');
      if (gitFile.startsWith('gitdir:')) {
        // This is a submodule, might need path updates
        console.log(colors.gray('Detected Git submodule, paths may need manual update'));
      }
    } catch {
      // Not a submodule
    }
  }

  async checkGitStatus(dirPath) {
    try {
      const status = execSync('git status --porcelain', {
        cwd: dirPath,
        encoding: 'utf8'
      }).trim();
      
      return {
        hasChanges: status.length > 0,
        changes: status.split('\n').filter(l => l.length > 0)
      };
    } catch {
      return { hasChanges: false, changes: [] };
    }
  }

  async pathExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  findSimilarProjects(search, allProjects) {
    const searchLower = search.toLowerCase();
    const suggestions = [];
    
    for (const [id, project] of Object.entries(allProjects)) {
      const name = (project.config.name || '').toLowerCase();
      const pathName = path.basename(project.path).toLowerCase();
      
      if (id.includes(searchLower) || 
          name.includes(searchLower) || 
          pathName.includes(searchLower)) {
        suggestions.push({ id, project });
      }
    }
    
    return suggestions.slice(0, 5);
  }
}

module.exports = MoveCommand;