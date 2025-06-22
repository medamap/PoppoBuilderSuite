/**
 * Project Cleaner Utility
 * Cleans up project-related files and state
 */

const fs = require('fs').promises;
const path = require('path');
const { promisify } = require('util');
const glob = promisify(require('glob'));

class ProjectCleaner {
  constructor() {
    this.cleanupPatterns = [
      'logs/**/*{{projectId}}*',
      'state/*{{projectId}}*',
      '.poppo/cache/{{projectId}}/**/*',
      'data/{{projectId}}/**/*'
    ];
  }

  /**
   * Clean project-related files
   * @param {Object} project Project configuration
   * @param {Object} options Cleanup options
   * @returns {Object} Cleanup report
   */
  async cleanProject(project, options = {}) {
    const report = {
      filesRemoved: 0,
      bytesFreed: 0,
      errors: []
    };

    const projectId = project.id || project.name;
    
    try {
      // Clean project-specific files
      for (const pattern of this.cleanupPatterns) {
        const globPattern = pattern.replace(/{{projectId}}/g, projectId);
        
        try {
          const files = await glob(globPattern, {
            absolute: true,
            nodir: false
          });

          for (const file of files) {
            try {
              const stats = await fs.stat(file);
              
              if (options.dryRun) {
                console.log(`[DRY RUN] Would remove: ${file}`);
              } else {
                if (stats.isDirectory()) {
                  await this.removeDirectory(file);
                } else {
                  await fs.unlink(file);
                }
                
                report.filesRemoved++;
                report.bytesFreed += stats.size || 0;
                
                if (options.verbose) {
                  console.log(`Removed: ${file}`);
                }
              }
            } catch (error) {
              report.errors.push(`Failed to remove ${file}: ${error.message}`);
            }
          }
        } catch (error) {
          report.errors.push(`Failed to process pattern ${globPattern}: ${error.message}`);
        }
      }

      // Clean project directory cache and state files
      await this.cleanProjectDirectory(project, report, options);

      // Clean temporary files
      await this.cleanTempFiles(projectId, report, options);

    } catch (error) {
      report.errors.push(`General cleanup error: ${error.message}`);
    }

    return report;
  }

  /**
   * Clean files in the project directory
   * @param {Object} project Project configuration
   * @param {Object} report Cleanup report
   * @param {Object} options Cleanup options
   */
  async cleanProjectDirectory(project, report, options) {
    const projectPath = project.path;
    if (!projectPath) return;

    const localPatterns = [
      '.poppo/cache',
      '.poppo/tmp',
      '.poppo/processed-*.json',
      '.poppo/state-*.json'
    ];

    for (const pattern of localPatterns) {
      const targetPath = path.join(projectPath, pattern);
      
      try {
        const files = await glob(targetPath, {
          absolute: true,
          nodir: false
        });

        for (const file of files) {
          try {
            const stats = await fs.stat(file);
            
            if (options.dryRun) {
              console.log(`[DRY RUN] Would remove: ${file}`);
            } else {
              if (stats.isDirectory()) {
                await this.removeDirectory(file);
              } else {
                await fs.unlink(file);
              }
              
              report.filesRemoved++;
              report.bytesFreed += stats.size || 0;
              
              if (options.verbose) {
                console.log(`Removed: ${file}`);
              }
            }
          } catch (error) {
            if (error.code !== 'ENOENT') {
              report.errors.push(`Failed to remove ${file}: ${error.message}`);
            }
          }
        }
      } catch (error) {
        // Ignore glob errors for non-existent patterns
      }
    }
  }

  /**
   * Clean temporary files
   * @param {string} projectId Project ID
   * @param {Object} report Cleanup report
   * @param {Object} options Cleanup options
   */
  async cleanTempFiles(projectId, report, options) {
    const tempDir = path.join(require('os').tmpdir(), 'poppobuilder', projectId);
    
    try {
      await fs.access(tempDir);
      
      if (options.dryRun) {
        console.log(`[DRY RUN] Would remove temp directory: ${tempDir}`);
      } else {
        await this.removeDirectory(tempDir);
        report.filesRemoved++;
        
        if (options.verbose) {
          console.log(`Removed temp directory: ${tempDir}`);
        }
      }
    } catch (error) {
      // Temp directory doesn't exist, that's fine
    }
  }

  /**
   * Recursively remove a directory
   * @param {string} dirPath Directory path
   */
  async removeDirectory(dirPath) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          await this.removeDirectory(fullPath);
        } else {
          await fs.unlink(fullPath);
        }
      }
      
      await fs.rmdir(dirPath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Get estimated size of files to be cleaned
   * @param {Object} project Project configuration
   * @returns {Object} Size estimation
   */
  async estimateCleanupSize(project) {
    const estimation = {
      totalSize: 0,
      fileCount: 0,
      patterns: {}
    };

    const projectId = project.id || project.name;

    for (const pattern of this.cleanupPatterns) {
      const globPattern = pattern.replace(/{{projectId}}/g, projectId);
      
      try {
        const files = await glob(globPattern, {
          absolute: true,
          nodir: true
        });

        let patternSize = 0;
        for (const file of files) {
          try {
            const stats = await fs.stat(file);
            patternSize += stats.size || 0;
            estimation.fileCount++;
          } catch (error) {
            // Ignore stat errors
          }
        }

        estimation.patterns[pattern] = {
          size: patternSize,
          count: files.length
        };
        estimation.totalSize += patternSize;
      } catch (error) {
        // Ignore glob errors
      }
    }

    return estimation;
  }
}

module.exports = ProjectCleaner;