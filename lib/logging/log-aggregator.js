/**
 * Issue #125: Log Aggregation System
 * 
 * Central log aggregation for production environments
 */

const fs = require('fs').promises;
const path = require('path');
const { createReadStream } = require('fs');
const { createGzip } = require('zlib');
const { pipeline } = require('stream/promises');

class LogAggregator {
  constructor(options = {}) {
    this.centralLogDir = options.centralLogDir || path.join(process.cwd(), 'logs', 'aggregated');
    this.sourceDirectories = options.sourceDirectories || [];
    this.aggregationInterval = options.aggregationInterval || 5 * 60 * 1000; // 5 minutes
    this.compressionEnabled = options.compressionEnabled !== false;
    this.maxFileSize = options.maxFileSize || 50 * 1024 * 1024; // 50MB
    this.retentionDays = options.retentionDays || 30;
    
    this.isRunning = false;
    this.aggregationTimer = null;
  }

  /**
   * Initialize log aggregator
   */
  async initialize() {
    await fs.mkdir(this.centralLogDir, { recursive: true });
    await fs.mkdir(path.join(this.centralLogDir, 'raw'), { recursive: true });
    await fs.mkdir(path.join(this.centralLogDir, 'compressed'), { recursive: true });
    await fs.mkdir(path.join(this.centralLogDir, 'indexes'), { recursive: true });
  }

  /**
   * Start log aggregation
   */
  async start() {
    if (this.isRunning) return;
    
    await this.initialize();
    this.isRunning = true;
    
    // Initial aggregation
    await this.aggregateLogs();
    
    // Schedule periodic aggregation
    this.aggregationTimer = setInterval(async () => {
      try {
        await this.aggregateLogs();
      } catch (error) {
        console.error('Log aggregation error:', error);
      }
    }, this.aggregationInterval);
  }

  /**
   * Stop log aggregation
   */
  stop() {
    this.isRunning = false;
    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer);
      this.aggregationTimer = null;
    }
  }

  /**
   * Aggregate logs from all source directories
   */
  async aggregateLogs() {
    const timestamp = new Date().toISOString().split('T')[0];
    const aggregatedFile = path.join(this.centralLogDir, 'raw', `aggregated-${timestamp}.log`);
    
    const logEntries = [];
    
    for (const sourceDir of this.sourceDirectories) {
      try {
        const entries = await this.collectLogsFromDirectory(sourceDir);
        logEntries.push(...entries);
      } catch (error) {
        console.error(`Failed to collect logs from ${sourceDir}:`, error);
      }
    }
    
    // Sort by timestamp
    logEntries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    // Write aggregated logs
    const content = logEntries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
    await fs.appendFile(aggregatedFile, content);
    
    // Compress if file is large enough
    await this.compressIfNeeded(aggregatedFile);
    
    // Create index
    await this.createLogIndex(logEntries, timestamp);
    
    return {
      entriesProcessed: logEntries.length,
      outputFile: aggregatedFile
    };
  }

  /**
   * Collect logs from a directory
   */
  async collectLogsFromDirectory(directory) {
    const entries = [];
    
    try {
      const files = await fs.readdir(directory);
      
      for (const file of files) {
        if (!file.endsWith('.log')) continue;
        
        const filePath = path.join(directory, file);
        const content = await fs.readFile(filePath, 'utf-8');
        
        const lines = content.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          try {
            // Try to parse as JSON (structured logs)
            const parsed = JSON.parse(line);
            entries.push({
              ...parsed,
              sourceFile: filePath,
              collectedAt: new Date().toISOString()
            });
          } catch {
            // Plain text log
            entries.push({
              timestamp: new Date().toISOString(),
              level: 'INFO',
              message: line,
              sourceFile: filePath,
              collectedAt: new Date().toISOString(),
              structured: false
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${directory}:`, error);
    }
    
    return entries;
  }

  /**
   * Compress log file if it exceeds size limit
   */
  async compressIfNeeded(filePath) {
    if (!this.compressionEnabled) return;
    
    try {
      const stats = await fs.stat(filePath);
      
      if (stats.size > this.maxFileSize) {
        const compressedPath = path.join(
          this.centralLogDir, 
          'compressed', 
          path.basename(filePath) + '.gz'
        );
        
        await pipeline(
          createReadStream(filePath),
          createGzip(),
          require('fs').createWriteStream(compressedPath)
        );
        
        // Remove original file after compression
        await fs.unlink(filePath);
        
        return compressedPath;
      }
    } catch (error) {
      console.error(`Compression error for ${filePath}:`, error);
    }
    
    return filePath;
  }

  /**
   * Create search index for logs
   */
  async createLogIndex(entries, date) {
    const indexPath = path.join(this.centralLogDir, 'indexes', `index-${date}.json`);
    
    const index = {
      date,
      totalEntries: entries.length,
      levels: {},
      components: {},
      projects: {},
      errors: [],
      timeRange: {
        start: entries[0]?.timestamp,
        end: entries[entries.length - 1]?.timestamp
      }
    };
    
    entries.forEach((entry, i) => {
      // Count by level
      index.levels[entry.level] = (index.levels[entry.level] || 0) + 1;
      
      // Count by component
      if (entry.component) {
        index.components[entry.component] = (index.components[entry.component] || 0) + 1;
      }
      
      // Count by project
      if (entry.projectId) {
        index.projects[entry.projectId] = (index.projects[entry.projectId] || 0) + 1;
      }
      
      // Track errors with context
      if (entry.level === 'ERROR' && entry.error) {
        index.errors.push({
          index: i,
          timestamp: entry.timestamp,
          message: entry.error.message,
          component: entry.component,
          correlationId: entry.correlationId
        });
      }
    });
    
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
    return index;
  }

  /**
   * Search logs
   */
  async searchLogs(query) {
    const {
      startDate,
      endDate,
      level,
      component,
      projectId,
      message,
      correlationId,
      limit = 100
    } = query;
    
    const results = [];
    const searchDates = this.getDateRange(startDate, endDate);
    
    for (const date of searchDates) {
      const logFile = path.join(this.centralLogDir, 'raw', `aggregated-${date}.log`);
      const compressedFile = path.join(this.centralLogDir, 'compressed', `aggregated-${date}.log.gz`);
      
      let content;
      try {
        if (await this.fileExists(logFile)) {
          content = await fs.readFile(logFile, 'utf-8');
        } else if (await this.fileExists(compressedFile)) {
          // TODO: Implement decompression for search
          continue;
        } else {
          continue;
        }
      } catch (error) {
        continue;
      }
      
      const lines = content.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        if (results.length >= limit) break;
        
        try {
          const entry = JSON.parse(line);
          
          // Apply filters
          if (level && entry.level !== level.toUpperCase()) continue;
          if (component && entry.component !== component) continue;
          if (projectId && entry.projectId !== projectId) continue;
          if (correlationId && entry.correlationId !== correlationId) continue;
          if (message && !entry.message.toLowerCase().includes(message.toLowerCase())) continue;
          
          // Date range filter
          const entryDate = new Date(entry.timestamp);
          if (startDate && entryDate < new Date(startDate)) continue;
          if (endDate && entryDate > new Date(endDate)) continue;
          
          results.push(entry);
        } catch (error) {
          // Skip malformed JSON
        }
      }
      
      if (results.length >= limit) break;
    }
    
    return {
      results,
      totalFound: results.length,
      query
    };
  }

  /**
   * Get date range for search
   */
  getDateRange(startDate, endDate) {
    const dates = [];
    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date();
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }
    
    return dates.length > 0 ? dates : [new Date().toISOString().split('T')[0]];
  }

  /**
   * Check if file exists
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get aggregation statistics
   */
  async getStatistics() {
    const stats = {
      totalFiles: 0,
      totalSize: 0,
      oldestLog: null,
      newestLog: null,
      compressionRatio: 0
    };
    
    try {
      // Raw files
      const rawFiles = await fs.readdir(path.join(this.centralLogDir, 'raw'));
      for (const file of rawFiles) {
        const filePath = path.join(this.centralLogDir, 'raw', file);
        const stat = await fs.stat(filePath);
        stats.totalFiles++;
        stats.totalSize += stat.size;
        
        if (!stats.oldestLog || stat.mtime < new Date(stats.oldestLog)) {
          stats.oldestLog = stat.mtime.toISOString();
        }
        if (!stats.newestLog || stat.mtime > new Date(stats.newestLog)) {
          stats.newestLog = stat.mtime.toISOString();
        }
      }
      
      // Compressed files
      const compressedFiles = await fs.readdir(path.join(this.centralLogDir, 'compressed'));
      let compressedSize = 0;
      for (const file of compressedFiles) {
        const filePath = path.join(this.centralLogDir, 'compressed', file);
        const stat = await fs.stat(filePath);
        stats.totalFiles++;
        compressedSize += stat.size;
      }
      
      stats.totalSize += compressedSize;
      
      // Calculate compression ratio
      if (compressedSize > 0 && stats.totalSize > compressedSize) {
        stats.compressionRatio = (1 - compressedSize / stats.totalSize) * 100;
      }
    } catch (error) {
      console.error('Error calculating statistics:', error);
    }
    
    return stats;
  }

  /**
   * Add source directory for aggregation
   */
  addSourceDirectory(directory) {
    if (!this.sourceDirectories.includes(directory)) {
      this.sourceDirectories.push(directory);
    }
  }

  /**
   * Remove source directory
   */
  removeSourceDirectory(directory) {
    const index = this.sourceDirectories.indexOf(directory);
    if (index > -1) {
      this.sourceDirectories.splice(index, 1);
    }
  }
}

module.exports = LogAggregator;