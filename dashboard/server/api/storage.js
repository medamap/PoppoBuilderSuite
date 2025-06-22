const express = require('express');
const StorageMonitor = require('../../../src/storage-monitor');

/**
 * Storage Monitoring API
 */
class StorageAPI {
  constructor(logger) {
    this.logger = logger;
    this.router = express.Router();
    this.storageMonitor = new StorageMonitor(logger);
    
    // Initialize storage monitor
    this.storageMonitor.initialize({
      checkInterval: 5 * 60 * 1000,
      thresholds: {
        warning: 0.8,
        critical: 0.9
      },
      paths: [process.cwd()]
    });
    
    this.setupRoutes();
  }

  setupRoutes() {
    // Get current storage status
    this.router.get('/status', async (req, res) => {
      try {
        const status = this.storageMonitor.getStatus();
        const usage = await this.storageMonitor.checkStorage();
        
        res.json({
          ...status,
          current: usage
        });
      } catch (error) {
        this.logger?.error('Failed to get storage status:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Get storage recommendations
    this.router.get('/recommendations', async (req, res) => {
      try {
        const recommendations = await this.storageMonitor.getRecommendations();
        res.json(recommendations);
      } catch (error) {
        this.logger?.error('Failed to get storage recommendations:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Cleanup old files
    this.router.post('/cleanup', async (req, res) => {
      try {
        const { directory, daysOld = 30 } = req.body;
        
        if (!directory) {
          return res.status(400).json({ error: 'Directory is required' });
        }
        
        const results = await this.storageMonitor.cleanupOldFiles(directory, daysOld);
        res.json(results);
      } catch (error) {
        this.logger?.error('Failed to cleanup files:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Add a path to monitor
    this.router.post('/monitor', async (req, res) => {
      try {
        const { path } = req.body;
        
        if (!path) {
          return res.status(400).json({ error: 'Path is required' });
        }
        
        if (!this.storageMonitor.config.paths.includes(path)) {
          this.storageMonitor.config.paths.push(path);
          const usage = await this.storageMonitor.getDiskUsage(path);
          res.json({ 
            success: true, 
            message: 'Path added to monitoring',
            usage 
          });
        } else {
          res.json({ 
            success: false, 
            message: 'Path already being monitored' 
          });
        }
      } catch (error) {
        this.logger?.error('Failed to add monitoring path:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Remove a path from monitoring
    this.router.delete('/monitor/:path', (req, res) => {
      try {
        const path = decodeURIComponent(req.params.path);
        const index = this.storageMonitor.config.paths.indexOf(path);
        
        if (index > -1) {
          this.storageMonitor.config.paths.splice(index, 1);
          res.json({ 
            success: true, 
            message: 'Path removed from monitoring' 
          });
        } else {
          res.status(404).json({ 
            success: false, 
            message: 'Path not found in monitoring list' 
          });
        }
      } catch (error) {
        this.logger?.error('Failed to remove monitoring path:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Get disk usage for a specific path
    this.router.get('/usage/:path', async (req, res) => {
      try {
        const path = decodeURIComponent(req.params.path);
        const usage = await this.storageMonitor.getDiskUsage(path);
        res.json(usage);
      } catch (error) {
        this.logger?.error('Failed to get disk usage:', error);
        res.status(500).json({ error: error.message });
      }
    });
  }

  getRouter() {
    return this.router;
  }
}

module.exports = StorageAPI;