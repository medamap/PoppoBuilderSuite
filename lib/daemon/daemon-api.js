/**
 * Daemon API Server
 * RESTful HTTP API server for PoppoBuilder daemon control
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * DaemonAPI class provides RESTful endpoints for daemon control
 */
class DaemonAPI extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      port: options.port || 3003,
      host: options.host || '127.0.0.1',
      enableAuth: options.enableAuth !== false,
      authToken: options.authToken || null,
      corsOrigin: options.corsOrigin || ['http://localhost:3000', 'http://localhost:3001'],
      rateLimitWindowMs: options.rateLimitWindowMs || 15 * 60 * 1000, // 15 minutes
      rateLimitMax: options.rateLimitMax || 100,
      ...options
    };
    
    this.app = express();
    this.server = null;
    this.isRunning = false;
    
    // Dependencies will be injected
    this.daemonManager = null;
    this.queueManager = null;
    this.projectRegistry = null;
    this.workerPool = null;
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Inject dependencies
   */
  setDependencies({ daemonManager, queueManager, projectRegistry, workerPool }) {
    this.daemonManager = daemonManager;
    this.queueManager = queueManager;
    this.projectRegistry = projectRegistry;
    this.workerPool = workerPool;
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    // Security headers
    this.app.use(helmet({
      contentSecurityPolicy: false // Allow loading resources for dashboard
    }));
    
    // CORS configuration
    this.app.use(cors({
      origin: this.options.corsOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization']
    }));
    
    // Body parsers
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    
    // Rate limiting
    const limiter = rateLimit({
      windowMs: this.options.rateLimitWindowMs,
      max: this.options.rateLimitMax,
      message: 'Too many requests from this IP, please try again later.'
    });
    this.app.use('/api/', limiter);
    
    // Request logging
    this.app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        this.emit('request', {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration,
          ip: req.ip
        });
      });
      next();
    });
    
    // Authentication middleware for protected routes
    if (this.options.enableAuth) {
      this.app.use('/api', (req, res, next) => {
        // Skip auth for health check
        if (req.path === '/health') {
          return next();
        }
        
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ error: 'Missing authorization header' });
        }
        
        const token = authHeader.substring(7);
        if (token !== this.options.authToken) {
          return res.status(401).json({ error: 'Invalid authorization token' });
        }
        
        next();
      });
    }
  }

  /**
   * Setup API routes
   */
  setupRoutes() {
    // Health check endpoint (no auth required)
    this.app.get('/api/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });

    // ===== Daemon Control Endpoints =====
    
    /**
     * GET /api/daemon/status - Get daemon status
     */
    this.app.get('/api/daemon/status', async (req, res) => {
      try {
        if (!this.daemonManager) {
          return res.status(503).json({ error: 'Daemon manager not available' });
        }
        
        const status = await this.daemonManager.getStatus();
        res.json(status);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * GET /api/daemon/info - Get daemon information
     */
    this.app.get('/api/daemon/info', async (req, res) => {
      try {
        if (!this.daemonManager) {
          return res.status(503).json({ error: 'Daemon manager not available' });
        }
        
        const info = {
          version: require('../../package.json').version,
          pid: process.pid,
          uptime: process.uptime(),
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          memory: process.memoryUsage(),
          config: await this.daemonManager.getConfig()
        };
        
        res.json(info);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /api/daemon/reload - Reload configuration
     */
    this.app.post('/api/daemon/reload', async (req, res) => {
      try {
        if (!this.daemonManager) {
          return res.status(503).json({ error: 'Daemon manager not available' });
        }
        
        await this.daemonManager.reload();
        res.json({ 
          success: true,
          message: 'Configuration reloaded successfully',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /api/daemon/shutdown - Graceful shutdown
     */
    this.app.post('/api/daemon/shutdown', async (req, res) => {
      try {
        if (!this.daemonManager) {
          return res.status(503).json({ error: 'Daemon manager not available' });
        }
        
        const { force = false, timeout = 30000 } = req.body;
        
        res.json({ 
          success: true,
          message: 'Shutdown initiated',
          timestamp: new Date().toISOString()
        });
        
        // Initiate shutdown after response
        setImmediate(async () => {
          try {
            await this.daemonManager.shutdown({ force, timeout });
          } catch (error) {
            console.error('Shutdown error:', error);
          }
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // ===== Project Management Endpoints =====
    
    /**
     * GET /api/projects - List all projects
     */
    this.app.get('/api/projects', async (req, res) => {
      try {
        if (!this.projectRegistry) {
          return res.status(503).json({ error: 'Project registry not available' });
        }
        
        const projects = await this.projectRegistry.getAllProjects();
        res.json(projects);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /api/projects - Register new project
     */
    this.app.post('/api/projects', async (req, res) => {
      try {
        if (!this.projectRegistry) {
          return res.status(503).json({ error: 'Project registry not available' });
        }
        
        const { id, name, path: projectPath, config } = req.body;
        
        if (!id || !name || !projectPath) {
          return res.status(400).json({ 
            error: 'Missing required fields: id, name, path' 
          });
        }
        
        const project = await this.projectRegistry.registerProject({
          id,
          name,
          path: projectPath,
          config
        });
        
        res.status(201).json(project);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * GET /api/projects/:id - Get project details
     */
    this.app.get('/api/projects/:id', async (req, res) => {
      try {
        if (!this.projectRegistry) {
          return res.status(503).json({ error: 'Project registry not available' });
        }
        
        const project = await this.projectRegistry.getProject(req.params.id);
        if (!project) {
          return res.status(404).json({ error: 'Project not found' });
        }
        
        res.json(project);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * PUT /api/projects/:id - Update project
     */
    this.app.put('/api/projects/:id', async (req, res) => {
      try {
        if (!this.projectRegistry) {
          return res.status(503).json({ error: 'Project registry not available' });
        }
        
        const updates = req.body;
        const project = await this.projectRegistry.updateProject(req.params.id, updates);
        
        if (!project) {
          return res.status(404).json({ error: 'Project not found' });
        }
        
        res.json(project);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * DELETE /api/projects/:id - Unregister project
     */
    this.app.delete('/api/projects/:id', async (req, res) => {
      try {
        if (!this.projectRegistry) {
          return res.status(503).json({ error: 'Project registry not available' });
        }
        
        const success = await this.projectRegistry.unregisterProject(req.params.id);
        
        if (!success) {
          return res.status(404).json({ error: 'Project not found' });
        }
        
        res.status(204).send();
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /api/projects/:id/validate - Validate project
     */
    this.app.post('/api/projects/:id/validate', async (req, res) => {
      try {
        if (!this.projectRegistry) {
          return res.status(503).json({ error: 'Project registry not available' });
        }
        
        const validation = await this.projectRegistry.validateProject(req.params.id);
        
        if (!validation) {
          return res.status(404).json({ error: 'Project not found' });
        }
        
        res.json(validation);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * GET /api/projects/:id/health - Get project health
     */
    this.app.get('/api/projects/:id/health', async (req, res) => {
      try {
        if (!this.projectRegistry) {
          return res.status(503).json({ error: 'Project registry not available' });
        }
        
        const health = await this.projectRegistry.getProjectHealth(req.params.id);
        
        if (!health) {
          return res.status(404).json({ error: 'Project not found' });
        }
        
        res.json(health);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // ===== Queue Management Endpoints =====
    
    /**
     * GET /api/queue/status - Queue statistics
     */
    this.app.get('/api/queue/status', async (req, res) => {
      try {
        if (!this.queueManager) {
          return res.status(503).json({ error: 'Queue manager not available' });
        }
        
        const status = await this.queueManager.getStatus();
        res.json(status);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * GET /api/queue/tasks - List queued tasks
     */
    this.app.get('/api/queue/tasks', async (req, res) => {
      try {
        if (!this.queueManager) {
          return res.status(503).json({ error: 'Queue manager not available' });
        }
        
        const { limit = 100, offset = 0, projectId, status } = req.query;
        
        const tasks = await this.queueManager.getTasks({
          limit: parseInt(limit),
          offset: parseInt(offset),
          projectId,
          status
        });
        
        res.json(tasks);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /api/queue/tasks - Add task manually
     */
    this.app.post('/api/queue/tasks', async (req, res) => {
      try {
        if (!this.queueManager) {
          return res.status(503).json({ error: 'Queue manager not available' });
        }
        
        const { projectId, type, data, priority = 'normal' } = req.body;
        
        if (!projectId || !type || !data) {
          return res.status(400).json({ 
            error: 'Missing required fields: projectId, type, data' 
          });
        }
        
        const task = await this.queueManager.addTask({
          projectId,
          type,
          data,
          priority
        });
        
        res.status(201).json(task);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * DELETE /api/queue/tasks/:id - Remove task
     */
    this.app.delete('/api/queue/tasks/:id', async (req, res) => {
      try {
        if (!this.queueManager) {
          return res.status(503).json({ error: 'Queue manager not available' });
        }
        
        const success = await this.queueManager.removeTask(req.params.id);
        
        if (!success) {
          return res.status(404).json({ error: 'Task not found' });
        }
        
        res.status(204).send();
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /api/queue/clear - Clear queue (with confirmation)
     */
    this.app.post('/api/queue/clear', async (req, res) => {
      try {
        if (!this.queueManager) {
          return res.status(503).json({ error: 'Queue manager not available' });
        }
        
        const { confirm = false, projectId } = req.body;
        
        if (!confirm) {
          return res.status(400).json({ 
            error: 'Confirmation required. Set confirm: true in request body.' 
          });
        }
        
        const result = await this.queueManager.clearQueue({ projectId });
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // ===== Worker Management Endpoints =====
    
    /**
     * GET /api/workers - List workers
     */
    this.app.get('/api/workers', async (req, res) => {
      try {
        if (!this.workerPool) {
          return res.status(503).json({ error: 'Worker pool not available' });
        }
        
        const workers = await this.workerPool.getWorkers();
        res.json(workers);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * GET /api/workers/:id - Worker details
     */
    this.app.get('/api/workers/:id', async (req, res) => {
      try {
        if (!this.workerPool) {
          return res.status(503).json({ error: 'Worker pool not available' });
        }
        
        const worker = await this.workerPool.getWorker(req.params.id);
        
        if (!worker) {
          return res.status(404).json({ error: 'Worker not found' });
        }
        
        res.json(worker);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /api/workers/:id/restart - Restart worker
     */
    this.app.post('/api/workers/:id/restart', async (req, res) => {
      try {
        if (!this.workerPool) {
          return res.status(503).json({ error: 'Worker pool not available' });
        }
        
        const { graceful = true, timeout = 30000 } = req.body;
        
        const result = await this.workerPool.restartWorker(req.params.id, {
          graceful,
          timeout
        });
        
        if (!result) {
          return res.status(404).json({ error: 'Worker not found' });
        }
        
        res.json({ 
          success: true,
          message: 'Worker restart initiated',
          workerId: req.params.id
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // ===== Error Handling =====
    
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({ 
        error: 'Not found',
        path: req.path,
        method: req.method
      });
    });
    
    // Global error handler
    this.app.use((err, req, res, next) => {
      console.error('API Error:', err);
      
      const status = err.status || 500;
      const message = err.message || 'Internal server error';
      
      res.status(status).json({
        error: message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
      });
    });
  }

  /**
   * Start the API server
   */
  async start() {
    if (this.isRunning) {
      throw new Error('API server is already running');
    }
    
    // Generate auth token if not provided
    if (this.options.enableAuth && !this.options.authToken) {
      this.options.authToken = crypto.randomBytes(32).toString('hex');
      console.log('Generated auth token:', this.options.authToken);
    }
    
    return new Promise((resolve, reject) => {
      this.server = createServer(this.app);
      
      this.server.listen(this.options.port, this.options.host, (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        this.isRunning = true;
        console.log(`Daemon API server listening on http://${this.options.host}:${this.options.port}`);
        this.emit('started', { 
          host: this.options.host, 
          port: this.options.port,
          authEnabled: this.options.enableAuth 
        });
        resolve();
      });
      
      this.server.on('error', (err) => {
        this.emit('error', err);
      });
    });
  }

  /**
   * Stop the API server
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }
    
    return new Promise((resolve) => {
      this.server.close(() => {
        this.isRunning = false;
        console.log('Daemon API server stopped');
        this.emit('stopped');
        resolve();
      });
    });
  }

  /**
   * Get server status
   */
  getStatus() {
    return {
      running: this.isRunning,
      host: this.options.host,
      port: this.options.port,
      authEnabled: this.options.enableAuth,
      uptime: this.isRunning ? process.uptime() : 0
    };
  }
}

module.exports = DaemonAPI;