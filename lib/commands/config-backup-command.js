/**
 * Config Backup Command
 * Creates backups of global configuration
 */

const { GlobalConfigManager, getInstance } = require('../core/global-config-manager');
const DirectoryManager = require('../core/directory-manager');
const chalk = require('chalk');
const fs = require('fs').promises;
const path = require('path');

class ConfigBackupCommand {
  constructor() {
    this.configManager = getInstance();
    this.directoryManager = new DirectoryManager();
  }

  /**
   * Execute the config backup command
   * @param {string} filename - Optional backup filename
   * @param {Object} options - Command options
   * @returns {Promise<void>}
   */
  async execute(filename = null, options = {}) {
    try {
      // Ensure config is initialized
      await this.configManager.initialize();
      
      // Get current configuration
      const config = this.configManager.getAll();
      
      // Determine backup path
      let backupPath;
      if (filename) {
        // Use provided filename
        if (path.isAbsolute(filename)) {
          backupPath = filename;
        } else {
          // Relative to current directory or backup directory
          if (options.toBackupDir) {
            await this.directoryManager.initialize();
            backupPath = path.join(this.directoryManager.directories.backup, filename);
          } else {
            backupPath = path.resolve(filename);
          }
        }
      } else {
        // Generate filename with timestamp
        await this.directoryManager.initialize();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFileName = `config-backup-${timestamp}.json`;
        backupPath = path.join(this.directoryManager.directories.backup, backupFileName);
      }
      
      // Ensure directory exists
      await fs.mkdir(path.dirname(backupPath), { recursive: true });
      
      // Add metadata to backup
      const backupData = {
        _metadata: {
          version: config.version,
          backupDate: new Date().toISOString(),
          backupTool: 'poppo-builder',
          originalPath: this.configManager.getConfigPath()
        },
        config: config
      };
      
      // Write backup file
      await fs.writeFile(
        backupPath,
        JSON.stringify(backupData, null, 2),
        { mode: 0o600 }
      );
      
      console.log(chalk.green('✓'), 'Configuration backed up to:', chalk.cyan(backupPath));
      
      // Show file size
      const stats = await fs.stat(backupPath);
      console.log(chalk.gray(`  Size: ${this.formatBytes(stats.size)}`));
      
      // List recent backups if requested
      if (options.list) {
        await this.listBackups();
      }
      
      // Show restore command
      console.log('\n' + chalk.gray('To restore from this backup:'));
      console.log(chalk.cyan(`poppo-builder config import ${backupPath}`));
      
    } catch (error) {
      console.error(chalk.red('Error creating backup:'), error.message);
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  }

  /**
   * List existing backups
   * @returns {Promise<void>}
   */
  async listBackups() {
    try {
      await this.directoryManager.initialize();
      const backupDir = this.directoryManager.directories.backup;
      
      const files = await fs.readdir(backupDir);
      const backups = [];
      
      for (const file of files) {
        if (file.startsWith('config-backup-') && file.endsWith('.json')) {
          const filePath = path.join(backupDir, file);
          const stats = await fs.stat(filePath);
          backups.push({
            name: file,
            path: filePath,
            size: stats.size,
            modified: stats.mtime
          });
        }
      }
      
      if (backups.length === 0) {
        console.log(chalk.gray('\nNo existing backups found.'));
        return;
      }
      
      // Sort by date (newest first)
      backups.sort((a, b) => b.modified - a.modified);
      
      console.log('\n' + chalk.yellow('Existing backups:'));
      console.log(chalk.gray('─'.repeat(60)));
      
      for (const backup of backups.slice(0, 10)) {
        const age = this.getRelativeTime(backup.modified);
        console.log(
          chalk.cyan(backup.name.padEnd(40)),
          chalk.gray(this.formatBytes(backup.size).padStart(8)),
          chalk.gray(age)
        );
      }
      
      if (backups.length > 10) {
        console.log(chalk.gray(`... and ${backups.length - 10} more`));
      }
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(chalk.gray('\nNo backup directory found.'));
      } else {
        throw error;
      }
    }
  }

  /**
   * Format bytes to human readable string
   * @param {number} bytes - Number of bytes
   * @returns {string} Formatted string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Get relative time string
   * @param {Date} date - Date to format
   * @returns {string} Relative time string
   */
  getRelativeTime(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' minutes ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + ' hours ago';
    if (seconds < 604800) return Math.floor(seconds / 86400) + ' days ago';
    
    return date.toLocaleDateString();
  }

  /**
   * Get command description
   * @returns {string}
   */
  static getDescription() {
    return 'Create a backup of global configuration';
  }

  /**
   * Get command options
   * @returns {Array}
   */
  static getOptions() {
    return [
      {
        flags: '-l, --list',
        description: 'List existing backups'
      },
      {
        flags: '-d, --to-backup-dir',
        description: 'Save to backup directory (when filename provided)'
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
        description: 'Create backup with auto-generated name',
        command: 'poppo-builder config backup'
      },
      {
        description: 'Create backup with custom name',
        command: 'poppo-builder config backup my-config.json'
      },
      {
        description: 'Create backup in backup directory',
        command: 'poppo-builder config backup my-config.json --to-backup-dir'
      },
      {
        description: 'List existing backups',
        command: 'poppo-builder config backup --list'
      }
    ];
  }
}

module.exports = ConfigBackupCommand;