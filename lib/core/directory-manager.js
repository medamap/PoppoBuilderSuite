/**
 * Directory Manager for PoppoBuilder Global Configuration
 * Handles creation and management of ~/.poppobuilder directory structure
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class DirectoryManager {
  constructor() {
    this.homeDir = os.homedir();
    this.rootDir = path.join(this.homeDir, '.poppobuilder');
    
    // Define directory structure
    this.directories = {
      root: this.rootDir,
      logs: path.join(this.rootDir, 'logs'),
      queue: path.join(this.rootDir, 'queue'),
      data: path.join(this.rootDir, 'data'),
      backup: path.join(this.rootDir, 'backup'),
      temp: path.join(this.rootDir, 'temp')
    };
    
    // Define file paths
    this.files = {
      config: path.join(this.rootDir, 'config.json'),
      projects: path.join(this.rootDir, 'projects.json'),
      daemonPid: path.join(this.rootDir, 'daemon.pid'),
      daemonLog: path.join(this.directories.logs, 'daemon.log'),
      apiLog: path.join(this.directories.logs, 'api.log'),
      statistics: path.join(this.directories.data, 'statistics.json'),
      health: path.join(this.directories.data, 'health.json')
    };
  }

  /**
   * Initialize the complete directory structure
   * @returns {Promise<Object>} Creation results
   */
  async initialize() {
    const results = {
      created: [],
      existing: [],
      errors: []
    };

    try {
      // Create all directories
      for (const [name, dirPath] of Object.entries(this.directories)) {
        try {
          const created = await this.createDirectory(dirPath);
          if (created) {
            results.created.push(dirPath);
          } else {
            results.existing.push(dirPath);
          }
        } catch (error) {
          results.errors.push({ path: dirPath, error: error.message });
        }
      }

      // Set proper permissions on root directory (700 - owner only)
      try {
        await fs.chmod(this.rootDir, 0o700);
      } catch (error) {
        results.errors.push({ 
          path: this.rootDir, 
          error: `Failed to set permissions: ${error.message}` 
        });
      }

      // Create initial empty files if they don't exist
      const initialFiles = [
        { path: this.files.projects, content: '{"projects": {}}' },
        { path: this.files.statistics, content: '{"totalTasks": 0, "successfulTasks": 0, "failedTasks": 0}' },
        { path: this.files.health, content: '{"status": "healthy", "lastCheck": null}' }
      ];

      for (const file of initialFiles) {
        try {
          await this.createFileIfNotExists(file.path, file.content);
        } catch (error) {
          results.errors.push({ path: file.path, error: error.message });
        }
      }

      return results;
    } catch (error) {
      throw new Error(`Failed to initialize directory structure: ${error.message}`);
    }
  }

  /**
   * Create a directory if it doesn't exist
   * @param {string} dirPath - Directory path to create
   * @returns {Promise<boolean>} True if created, false if already exists
   */
  async createDirectory(dirPath) {
    try {
      await fs.mkdir(dirPath, { recursive: true, mode: 0o755 });
      return true;
    } catch (error) {
      if (error.code === 'EEXIST') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Create a file with content if it doesn't exist
   * @param {string} filePath - File path
   * @param {string} content - Initial content
   */
  async createFileIfNotExists(filePath, content) {
    try {
      await fs.access(filePath);
      // File exists, do nothing
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, create it
        await fs.writeFile(filePath, content, { mode: 0o644 });
      } else {
        throw error;
      }
    }
  }

  /**
   * Verify directory structure integrity
   * @returns {Promise<Object>} Verification results
   */
  async verify() {
    const results = {
      valid: true,
      missing: [],
      permissions: []
    };

    // Check all directories exist
    for (const [name, dirPath] of Object.entries(this.directories)) {
      try {
        const stats = await fs.stat(dirPath);
        if (!stats.isDirectory()) {
          results.valid = false;
          results.missing.push(dirPath);
        }
      } catch (error) {
        results.valid = false;
        results.missing.push(dirPath);
      }
    }

    // Check root directory permissions
    try {
      const stats = await fs.stat(this.rootDir);
      const mode = stats.mode & parseInt('777', 8);
      if (mode !== 0o700) {
        results.valid = false;
        results.permissions.push({
          path: this.rootDir,
          expected: '700',
          actual: mode.toString(8)
        });
      }
    } catch (error) {
      results.valid = false;
      results.permissions.push({
        path: this.rootDir,
        error: error.message
      });
    }

    return results;
  }

  /**
   * Clean temporary files
   * @param {number} olderThanMs - Remove files older than this many milliseconds
   */
  async cleanTemp(olderThanMs = 24 * 60 * 60 * 1000) {
    try {
      const files = await fs.readdir(this.directories.temp);
      const now = Date.now();
      let removed = 0;

      for (const file of files) {
        const filePath = path.join(this.directories.temp, file);
        const stats = await fs.stat(filePath);
        
        if (now - stats.mtimeMs > olderThanMs) {
          await fs.unlink(filePath);
          removed++;
        }
      }

      return { removed, total: files.length };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { removed: 0, total: 0 };
      }
      throw error;
    }
  }

  /**
   * Get directory sizes
   * @returns {Promise<Object>} Size information for each directory
   */
  async getDirectorySizes() {
    const sizes = {};

    for (const [name, dirPath] of Object.entries(this.directories)) {
      try {
        sizes[name] = await this.getDirectorySize(dirPath);
      } catch (error) {
        sizes[name] = { error: error.message };
      }
    }

    return sizes;
  }

  /**
   * Calculate directory size recursively
   * @param {string} dirPath - Directory path
   * @returns {Promise<Object>} Size information
   */
  async getDirectorySize(dirPath) {
    let totalSize = 0;
    let fileCount = 0;

    async function calculateSize(currentPath) {
      const items = await fs.readdir(currentPath);
      
      for (const item of items) {
        const itemPath = path.join(currentPath, item);
        const stats = await fs.stat(itemPath);
        
        if (stats.isDirectory()) {
          await calculateSize(itemPath);
        } else {
          totalSize += stats.size;
          fileCount++;
        }
      }
    }

    try {
      await calculateSize(dirPath);
      return {
        bytes: totalSize,
        humanReadable: this.formatBytes(totalSize),
        fileCount
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { bytes: 0, humanReadable: '0 B', fileCount: 0 };
      }
      throw error;
    }
  }

  /**
   * Format bytes to human readable string
   * @param {number} bytes - Number of bytes
   * @returns {string} Formatted string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + units[i];
  }

  /**
   * Get all paths
   * @returns {Object} All directory and file paths
   */
  getPaths() {
    return {
      directories: { ...this.directories },
      files: { ...this.files }
    };
  }
}

module.exports = DirectoryManager;