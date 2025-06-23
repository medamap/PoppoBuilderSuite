/**
 * Base Storage Adapter
 * Abstract base class for queue persistence storage adapters
 */

class BaseStorage {
  constructor(options = {}) {
    this.options = options;
    this.isInitialized = false;
  }

  /**
   * Initialize the storage adapter
   */
  async initialize() {
    throw new Error('initialize() must be implemented by subclass');
  }

  /**
   * Save queue data
   * @param {Object} data - Queue data to save
   */
  async save(data) {
    throw new Error('save() must be implemented by subclass');
  }

  /**
   * Load queue data
   * @returns {Object} Loaded queue data
   */
  async load() {
    throw new Error('load() must be implemented by subclass');
  }

  /**
   * Create a snapshot
   * @param {string} snapshotId - Unique identifier for the snapshot
   * @param {Object} data - Data to snapshot
   */
  async createSnapshot(snapshotId, data) {
    throw new Error('createSnapshot() must be implemented by subclass');
  }

  /**
   * Restore from snapshot
   * @param {string} snapshotId - Snapshot identifier to restore
   * @returns {Object} Restored data
   */
  async restoreSnapshot(snapshotId) {
    throw new Error('restoreSnapshot() must be implemented by subclass');
  }

  /**
   * List available snapshots
   * @returns {Array} List of snapshots
   */
  async listSnapshots() {
    throw new Error('listSnapshots() must be implemented by subclass');
  }

  /**
   * Delete a snapshot
   * @param {string} snapshotId - Snapshot identifier to delete
   */
  async deleteSnapshot(snapshotId) {
    throw new Error('deleteSnapshot() must be implemented by subclass');
  }

  /**
   * Get storage statistics
   * @returns {Object} Storage statistics
   */
  async getStats() {
    throw new Error('getStats() must be implemented by subclass');
  }

  /**
   * Clear all stored data
   */
  async clear() {
    throw new Error('clear() must be implemented by subclass');
  }

  /**
   * Close storage connection
   */
  async close() {
    // Override if needed
  }

  /**
   * Validate data integrity
   * @param {Object} data - Data to validate
   * @returns {boolean} True if valid
   */
  validateData(data) {
    if (!data || typeof data !== 'object') {
      return false;
    }
    
    if (!Array.isArray(data.queue)) {
      return false;
    }
    
    if (!data.savedAt || !Date.parse(data.savedAt)) {
      return false;
    }
    
    return true;
  }

  /**
   * Create metadata for saved data
   * @param {Object} data - Original data
   * @returns {Object} Data with metadata
   */
  addMetadata(data) {
    return {
      ...data,
      savedAt: new Date().toISOString(),
      version: '1.0',
      checksum: this.calculateChecksum(data)
    };
  }

  /**
   * Calculate checksum for data
   * @param {Object} data - Data to checksum
   * @returns {string} Checksum
   */
  calculateChecksum(data) {
    const crypto = require('crypto');
    const content = JSON.stringify(data);
    return crypto.createHash('md5').update(content).digest('hex');
  }
}

module.exports = BaseStorage;