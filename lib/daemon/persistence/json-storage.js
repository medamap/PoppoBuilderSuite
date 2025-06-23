/**
 * JSON File Storage Adapter
 * Implements file-based persistence with atomic writes and backup rotation
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const BaseStorage = require('./base-storage');

class JsonStorage extends BaseStorage {
  constructor(options = {}) {
    super(options);
    
    this.options = {
      filePath: path.join(os.homedir(), '.poppobuilder', 'queue.json'),
      backupCount: 5,
      compressBackups: false,
      snapshotDir: path.join(os.homedir(), '.poppobuilder', 'snapshots'),
      ...options
    };
    
    this.lockFile = `${this.options.filePath}.lock`;
    this.tempFile = `${this.options.filePath}.tmp`;
  }

  /**
   * Initialize storage
   */
  async initialize() {
    try {
      // Ensure directories exist
      await fs.mkdir(path.dirname(this.options.filePath), { recursive: true });
      await fs.mkdir(this.options.snapshotDir, { recursive: true });
      
      this.isInitialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize JSON storage: ${error.message}`);
    }
  }

  /**
   * Save queue data with atomic write
   */
  async save(data) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const dataWithMeta = this.addMetadata(data);
    
    try {
      // Acquire lock
      await this.acquireLock();
      
      // Write to temp file first
      await fs.writeFile(
        this.tempFile,
        JSON.stringify(dataWithMeta, null, 2),
        'utf8'
      );
      
      // Create backup if main file exists
      try {
        await fs.access(this.options.filePath);
        await this.rotateBackups();
      } catch (error) {
        // File doesn't exist yet, no backup needed
      }
      
      // Atomic rename
      await fs.rename(this.tempFile, this.options.filePath);
      
    } finally {
      // Release lock
      await this.releaseLock();
    }
  }

  /**
   * Load queue data
   */
  async load() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const content = await fs.readFile(this.options.filePath, 'utf8');
      const data = JSON.parse(content);
      
      // Validate data integrity
      if (!this.validateData(data)) {
        throw new Error('Invalid queue data format');
      }
      
      // Verify checksum if present
      if (data.checksum) {
        const expectedChecksum = data.checksum;
        const actualData = { ...data };
        delete actualData.checksum;
        delete actualData.savedAt;
        delete actualData.version;
        
        const actualChecksum = this.calculateChecksum(actualData);
        if (expectedChecksum !== actualChecksum) {
          console.warn('Queue data checksum mismatch, attempting recovery');
          return await this.attemptRecovery();
        }
      }
      
      return data;
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, return empty queue
        return {
          queue: [],
          processing: {},
          projectStats: {},
          savedAt: new Date().toISOString()
        };
      }
      
      // Try to recover from backup
      console.error('Failed to load queue data:', error);
      return await this.attemptRecovery();
    }
  }

  /**
   * Create a snapshot
   */
  async createSnapshot(snapshotId, data) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const snapshotPath = path.join(this.options.snapshotDir, `${snapshotId}.json`);
    const dataWithMeta = {
      ...this.addMetadata(data),
      snapshotId,
      snapshotCreatedAt: new Date().toISOString()
    };
    
    await fs.writeFile(
      snapshotPath,
      JSON.stringify(dataWithMeta, null, 2),
      'utf8'
    );
  }

  /**
   * Restore from snapshot
   */
  async restoreSnapshot(snapshotId) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const snapshotPath = path.join(this.options.snapshotDir, `${snapshotId}.json`);
    
    try {
      const content = await fs.readFile(snapshotPath, 'utf8');
      const data = JSON.parse(content);
      
      if (!this.validateData(data)) {
        throw new Error('Invalid snapshot data format');
      }
      
      return data;
      
    } catch (error) {
      throw new Error(`Failed to restore snapshot ${snapshotId}: ${error.message}`);
    }
  }

  /**
   * List available snapshots
   */
  async listSnapshots() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const files = await fs.readdir(this.options.snapshotDir);
      const snapshots = [];
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.options.snapshotDir, file);
          const stat = await fs.stat(filePath);
          
          try {
            const content = await fs.readFile(filePath, 'utf8');
            const data = JSON.parse(content);
            
            snapshots.push({
              id: file.replace('.json', ''),
              createdAt: data.snapshotCreatedAt || stat.mtime.toISOString(),
              size: stat.size,
              queueLength: data.queue ? data.queue.length : 0
            });
          } catch (error) {
            // Skip corrupted snapshots
            console.warn(`Skipping corrupted snapshot ${file}:`, error.message);
          }
        }
      }
      
      // Sort by creation date, newest first
      return snapshots.sort((a, b) => 
        new Date(b.createdAt) - new Date(a.createdAt)
      );
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Delete a snapshot
   */
  async deleteSnapshot(snapshotId) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const snapshotPath = path.join(this.options.snapshotDir, `${snapshotId}.json`);
    
    try {
      await fs.unlink(snapshotPath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`Failed to delete snapshot ${snapshotId}: ${error.message}`);
      }
    }
  }

  /**
   * Get storage statistics
   */
  async getStats() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const stats = {
      type: 'json',
      mainFile: {
        exists: false,
        size: 0,
        modifiedAt: null
      },
      backups: [],
      snapshots: [],
      totalSize: 0
    };
    
    // Main file stats
    try {
      const mainStat = await fs.stat(this.options.filePath);
      stats.mainFile = {
        exists: true,
        size: mainStat.size,
        modifiedAt: mainStat.mtime.toISOString()
      };
      stats.totalSize += mainStat.size;
    } catch (error) {
      // File doesn't exist
    }
    
    // Backup stats
    for (let i = 1; i <= this.options.backupCount; i++) {
      const backupPath = `${this.options.filePath}.backup${i}`;
      try {
        const backupStat = await fs.stat(backupPath);
        stats.backups.push({
          index: i,
          size: backupStat.size,
          modifiedAt: backupStat.mtime.toISOString()
        });
        stats.totalSize += backupStat.size;
      } catch (error) {
        // Backup doesn't exist
      }
    }
    
    // Snapshot stats
    stats.snapshots = await this.listSnapshots();
    for (const snapshot of stats.snapshots) {
      stats.totalSize += snapshot.size;
    }
    
    return stats;
  }

  /**
   * Clear all stored data
   */
  async clear() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Remove main file
      await fs.unlink(this.options.filePath);
    } catch (error) {
      // Ignore if doesn't exist
    }
    
    // Remove backups
    for (let i = 1; i <= this.options.backupCount; i++) {
      try {
        await fs.unlink(`${this.options.filePath}.backup${i}`);
      } catch (error) {
        // Ignore if doesn't exist
      }
    }
  }

  /**
   * Rotate backup files
   */
  async rotateBackups() {
    // Delete oldest backup if exists
    try {
      await fs.unlink(`${this.options.filePath}.backup${this.options.backupCount}`);
    } catch (error) {
      // Ignore if doesn't exist
    }
    
    // Rotate existing backups
    for (let i = this.options.backupCount - 1; i >= 1; i--) {
      try {
        await fs.rename(
          `${this.options.filePath}.backup${i}`,
          `${this.options.filePath}.backup${i + 1}`
        );
      } catch (error) {
        // Ignore if doesn't exist
      }
    }
    
    // Copy current file to backup1
    await fs.copyFile(this.options.filePath, `${this.options.filePath}.backup1`);
  }

  /**
   * Attempt to recover from backup
   */
  async attemptRecovery() {
    console.log('Attempting to recover from backup...');
    
    // Try each backup in order
    for (let i = 1; i <= this.options.backupCount; i++) {
      try {
        const backupPath = `${this.options.filePath}.backup${i}`;
        const content = await fs.readFile(backupPath, 'utf8');
        const data = JSON.parse(content);
        
        if (this.validateData(data)) {
          console.log(`Successfully recovered from backup ${i}`);
          return data;
        }
      } catch (error) {
        // Continue to next backup
      }
    }
    
    // No valid backup found, return empty queue
    console.warn('No valid backup found, starting with empty queue');
    return {
      queue: [],
      processing: {},
      projectStats: {},
      savedAt: new Date().toISOString()
    };
  }

  /**
   * Acquire file lock
   */
  async acquireLock() {
    const maxRetries = 50;
    const retryDelay = 100;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        // Try to create lock file exclusively
        await fs.writeFile(this.lockFile, process.pid.toString(), { flag: 'wx' });
        return;
      } catch (error) {
        if (error.code === 'EEXIST') {
          // Lock exists, wait and retry
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        } else {
          throw error;
        }
      }
    }
    
    throw new Error('Failed to acquire lock after maximum retries');
  }

  /**
   * Release file lock
   */
  async releaseLock() {
    try {
      await fs.unlink(this.lockFile);
    } catch (error) {
      // Ignore if lock doesn't exist
    }
  }
}

module.exports = JsonStorage;