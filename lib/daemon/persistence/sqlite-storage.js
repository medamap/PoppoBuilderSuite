/**
 * SQLite Storage Adapter
 * Implements SQLite-based persistence for queue data
 */

const path = require('path');
const os = require('os');
const BaseStorage = require('./base-storage');

class SqliteStorage extends BaseStorage {
  constructor(options = {}) {
    super(options);
    
    this.options = {
      dbPath: path.join(os.homedir(), '.poppobuilder', 'queue.db'),
      busyTimeout: 5000,
      walMode: true,
      ...options
    };
    
    this.db = null;
    this.sqlite3 = null;
  }

  /**
   * Initialize storage
   */
  async initialize() {
    try {
      // Lazy load sqlite3
      this.sqlite3 = require('sqlite3').verbose();
      
      // Create database connection
      await this.connect();
      
      // Create tables
      await this.createTables();
      
      this.isInitialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize SQLite storage: ${error.message}`);
    }
  }

  /**
   * Connect to database
   */
  async connect() {
    return new Promise((resolve, reject) => {
      this.db = new this.sqlite3.Database(this.options.dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          // Configure database
          this.db.configure('busyTimeout', this.options.busyTimeout);
          
          if (this.options.walMode) {
            this.db.run('PRAGMA journal_mode = WAL', (err) => {
              if (err) {
                console.warn('Failed to enable WAL mode:', err);
              }
            });
          }
          
          resolve();
        }
      });
    });
  }

  /**
   * Create required tables
   */
  async createTables() {
    const queries = [
      // Queue state table
      `CREATE TABLE IF NOT EXISTS queue_state (
        id INTEGER PRIMARY KEY,
        data TEXT NOT NULL,
        checksum TEXT,
        saved_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Individual tasks table for better querying
      `CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        type TEXT,
        priority INTEGER DEFAULT 0,
        status TEXT NOT NULL,
        data TEXT NOT NULL,
        added_at DATETIME,
        started_at DATETIME,
        completed_at DATETIME,
        failed_at DATETIME,
        retries INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Snapshots table
      `CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        checksum TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Indexes
      `CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority DESC)`,
      
      // Trigger to update updated_at
      `CREATE TRIGGER IF NOT EXISTS update_tasks_timestamp 
       AFTER UPDATE ON tasks 
       BEGIN 
         UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
       END`
    ];
    
    for (const query of queries) {
      await this.run(query);
    }
  }

  /**
   * Save queue data
   */
  async save(data) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const dataWithMeta = this.addMetadata(data);
    
    await this.run('BEGIN TRANSACTION');
    
    try {
      // Save main queue state
      await this.run(
        'INSERT INTO queue_state (data, checksum) VALUES (?, ?)',
        JSON.stringify(dataWithMeta),
        dataWithMeta.checksum
      );
      
      // Clear existing tasks
      await this.run('DELETE FROM tasks');
      
      // Save individual tasks for better querying
      const allTasks = [
        ...data.queue.map(t => ({ ...t, status: 'queued' })),
        ...Object.values(data.processing || {})
      ];
      
      for (const task of allTasks) {
        await this.run(
          `INSERT INTO tasks (
            id, project_id, type, priority, status, data,
            added_at, started_at, completed_at, failed_at, retries
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          task.id,
          task.projectId,
          task.type || null,
          task.priority || 0,
          task.status,
          JSON.stringify(task),
          task.addedAt || null,
          task.startedAt || null,
          task.completedAt || null,
          task.failedAt || null,
          task.retries || 0
        );
      }
      
      await this.run('COMMIT');
      
      // Keep only last N queue states
      await this.cleanup();
      
    } catch (error) {
      await this.run('ROLLBACK');
      throw error;
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
      // Get latest queue state
      const row = await this.get(
        'SELECT data FROM queue_state ORDER BY saved_at DESC LIMIT 1'
      );
      
      if (row) {
        const data = JSON.parse(row.data);
        
        if (!this.validateData(data)) {
          throw new Error('Invalid queue data format');
        }
        
        return data;
      }
      
      // No saved state, build from tasks table
      const tasks = await this.all('SELECT data FROM tasks WHERE status = "queued"');
      const processing = await this.all('SELECT data FROM tasks WHERE status = "processing"');
      
      return {
        queue: tasks.map(t => JSON.parse(t.data)),
        processing: processing.reduce((acc, t) => {
          const task = JSON.parse(t.data);
          acc[task.id] = task;
          return acc;
        }, {}),
        projectStats: {},
        savedAt: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('Failed to load queue data:', error);
      return {
        queue: [],
        processing: {},
        projectStats: {},
        savedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Create a snapshot
   */
  async createSnapshot(snapshotId, data) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const dataWithMeta = this.addMetadata(data);
    
    await this.run(
      'INSERT INTO snapshots (id, data, checksum) VALUES (?, ?, ?)',
      snapshotId,
      JSON.stringify(dataWithMeta),
      dataWithMeta.checksum
    );
  }

  /**
   * Restore from snapshot
   */
  async restoreSnapshot(snapshotId) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const row = await this.get(
      'SELECT data FROM snapshots WHERE id = ?',
      snapshotId
    );
    
    if (!row) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }
    
    const data = JSON.parse(row.data);
    
    if (!this.validateData(data)) {
      throw new Error('Invalid snapshot data format');
    }
    
    return data;
  }

  /**
   * List available snapshots
   */
  async listSnapshots() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const rows = await this.all(
      'SELECT id, created_at, LENGTH(data) as size FROM snapshots ORDER BY created_at DESC'
    );
    
    return rows.map(row => ({
      id: row.id,
      createdAt: row.created_at,
      size: row.size
    }));
  }

  /**
   * Delete a snapshot
   */
  async deleteSnapshot(snapshotId) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    await this.run('DELETE FROM snapshots WHERE id = ?', snapshotId);
  }

  /**
   * Get storage statistics
   */
  async getStats() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const stats = {
      type: 'sqlite',
      tasks: {
        total: 0,
        queued: 0,
        processing: 0,
        completed: 0,
        failed: 0
      },
      snapshots: 0,
      queueStates: 0,
      dbSize: 0
    };
    
    // Task statistics
    const taskStats = await this.all(
      'SELECT status, COUNT(*) as count FROM tasks GROUP BY status'
    );
    
    for (const row of taskStats) {
      stats.tasks[row.status] = row.count;
      stats.tasks.total += row.count;
    }
    
    // Snapshot count
    const snapshotCount = await this.get('SELECT COUNT(*) as count FROM snapshots');
    stats.snapshots = snapshotCount.count;
    
    // Queue state count
    const queueStateCount = await this.get('SELECT COUNT(*) as count FROM queue_state');
    stats.queueStates = queueStateCount.count;
    
    // Database size
    try {
      const fs = require('fs').promises;
      const dbStat = await fs.stat(this.options.dbPath);
      stats.dbSize = dbStat.size;
    } catch (error) {
      // Ignore
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

    await this.run('DELETE FROM queue_state');
    await this.run('DELETE FROM tasks');
    await this.run('VACUUM');
  }

  /**
   * Close database connection
   */
  async close() {
    if (this.db) {
      return new Promise((resolve, reject) => {
        this.db.close((err) => {
          if (err) {
            reject(err);
          } else {
            this.db = null;
            resolve();
          }
        });
      });
    }
  }

  /**
   * Cleanup old queue states
   */
  async cleanup() {
    // Keep only last 10 queue states
    await this.run(
      `DELETE FROM queue_state 
       WHERE id NOT IN (
         SELECT id FROM queue_state 
         ORDER BY saved_at DESC 
         LIMIT 10
       )`
    );
  }

  /**
   * Run a database query
   */
  async run(query, ...params) {
    return new Promise((resolve, reject) => {
      this.db.run(query, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ lastID: this.lastID, changes: this.changes });
        }
      });
    });
  }

  /**
   * Get a single row
   */
  async get(query, ...params) {
    return new Promise((resolve, reject) => {
      this.db.get(query, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  /**
   * Get all rows
   */
  async all(query, ...params) {
    return new Promise((resolve, reject) => {
      this.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  /**
   * Query builder helpers
   */
  async getTasksByProject(projectId) {
    return this.all(
      'SELECT data FROM tasks WHERE project_id = ? ORDER BY priority DESC',
      projectId
    ).then(rows => rows.map(r => JSON.parse(r.data)));
  }

  async getTasksByStatus(status) {
    return this.all(
      'SELECT data FROM tasks WHERE status = ? ORDER BY priority DESC',
      status
    ).then(rows => rows.map(r => JSON.parse(r.data)));
  }

  async getHighPriorityTasks(threshold = 5) {
    return this.all(
      'SELECT data FROM tasks WHERE priority >= ? AND status = "queued" ORDER BY priority DESC',
      threshold
    ).then(rows => rows.map(r => JSON.parse(r.data)));
  }
}

module.exports = SqliteStorage;