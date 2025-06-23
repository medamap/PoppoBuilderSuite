/**
 * Project Registry
 * Manages the registration and configuration of multiple projects
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const EventEmitter = require('events');
const { validateProject, validateRegistry } = require('../schemas/project-schema');
const ProjectValidator = require('./project-validator');
const ProjectHealthTracker = require('./project-health-tracker');

class ProjectRegistry extends EventEmitter {
  constructor() {
    super();
    this.registryFile = path.join(os.homedir(), '.poppobuilder', 'projects.json');
    this.registry = null;
    this.isInitialized = false;
    this.saveTimer = null;
    
    // Initialize validation and health tracking
    this.validator = new ProjectValidator();
    this.healthTracker = new ProjectHealthTracker();
    this.validationEnabled = true;
    this.healthTrackingEnabled = true;
  }

  /**
   * Initialize the project registry
   */
  async initialize() {
    try {
      // Ensure directory exists
      await this.ensureRegistryDirectory();
      
      // Load or create registry
      if (await this.exists()) {
        await this.load();
      } else {
        await this.createDefault();
      }
      
      // Initialize health tracker
      if (this.healthTrackingEnabled) {
        await this.healthTracker.initialize();
      }
      
      this.isInitialized = true;
      this.emit('initialized', this.registry);
      return this.registry;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to initialize project registry: ${error.message}`);
    }
  }

  /**
   * Ensure the registry directory exists
   */
  async ensureRegistryDirectory() {
    const dir = path.dirname(this.registryFile);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Check if registry file exists
   */
  async exists() {
    try {
      await fs.access(this.registryFile);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create default registry
   */
  async createDefault() {
    this.registry = {
      version: '1.0.0',
      projects: {},
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        totalProjects: 0
      }
    };
    
    await this.save();
    console.log('Created default project registry');
  }

  /**
   * Load registry from disk
   */
  async load() {
    try {
      const data = await fs.readFile(this.registryFile, 'utf8');
      const parsed = JSON.parse(data);
      
      if (!validateRegistry(parsed)) {
        throw new Error(`Invalid registry format: ${JSON.stringify(validateRegistry.errors)}`);
      }
      
      this.registry = parsed;
      this.emit('loaded', this.registry);
    } catch (error) {
      throw new Error(`Failed to load registry: ${error.message}`);
    }
  }

  /**
   * Save registry to disk
   */
  async save() {
    try {
      // Update metadata
      this.registry.metadata.updatedAt = new Date().toISOString();
      this.registry.metadata.totalProjects = Object.keys(this.registry.projects).length;
      
      // Validate before saving
      if (!validateRegistry(this.registry)) {
        throw new Error(`Invalid registry format: ${JSON.stringify(validateRegistry.errors)}`);
      }
      
      // Write atomically
      const tempFile = `${this.registryFile}.tmp`;
      await fs.writeFile(tempFile, JSON.stringify(this.registry, null, 2));
      await fs.rename(tempFile, this.registryFile);
      
      this.emit('saved', this.registry);
    } catch (error) {
      throw new Error(`Failed to save registry: ${error.message}`);
    }
  }

  /**
   * Schedule a save operation (debounced)
   */
  scheduleSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    
    this.saveTimer = setTimeout(async () => {
      try {
        await this.save();
      } catch (error) {
        this.emit('error', error);
      }
    }, 1000);
  }

  /**
   * Register a new project
   */
  async register(projectPath, config = {}) {
    if (!this.isInitialized) {
      throw new Error('Registry not initialized');
    }
    
    // Normalize and validate path
    const normalizedPath = path.resolve(projectPath);
    
    // Check if path exists
    try {
      const stat = await fs.stat(normalizedPath);
      if (!stat.isDirectory()) {
        throw new Error('Project path must be a directory');
      }
    } catch (error) {
      throw new Error(`Invalid project path: ${error.message}`);
    }
    
    // Generate project ID
    const projectId = this.generateProjectId(normalizedPath);
    
    // Check if already registered
    if (this.registry.projects[projectId]) {
      throw new Error(`Project already registered: ${projectId}`);
    }
    
    // Create project entry
    const project = {
      path: normalizedPath,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      config: config || {},
      stats: {
        totalIssuesProcessed: 0,
        totalErrors: 0,
        averageProcessingTime: 0
      }
    };
    
    // Validate project
    if (!validateProject(project)) {
      throw new Error(`Invalid project configuration: ${JSON.stringify(validateProject.errors)}`);
    }
    
    // Add to registry
    this.registry.projects[projectId] = project;
    
    // Perform validation if enabled
    if (this.validationEnabled) {
      try {
        const validationResult = await this.validator.validateProject(normalizedPath);
        project.validation = {
          lastValidated: new Date().toISOString(),
          result: validationResult
        };
      } catch (error) {
        console.warn(`Validation failed for project ${projectId}:`, error.message);
      }
    }
    
    // Start health tracking if enabled
    if (this.healthTrackingEnabled) {
      try {
        const healthData = await this.healthTracker.trackProject(projectId, normalizedPath);
        project.health = {
          lastChecked: new Date().toISOString(),
          status: healthData.overall.status,
          score: healthData.overall.score,
          grade: healthData.overall.grade
        };
      } catch (error) {
        console.warn(`Health tracking failed for project ${projectId}:`, error.message);
      }
    }
    
    // Save
    await this.save();
    
    this.emit('project-registered', projectId, project);
    return projectId;
  }

  /**
   * Unregister a project
   */
  async unregister(projectId) {
    if (!this.isInitialized) {
      throw new Error('Registry not initialized');
    }
    
    if (!this.registry.projects[projectId]) {
      throw new Error(`Project not found: ${projectId}`);
    }
    
    const project = this.registry.projects[projectId];
    delete this.registry.projects[projectId];
    
    await this.save();
    
    this.emit('project-unregistered', projectId, project);
  }

  /**
   * Update or re-register a project
   */
  async update(projectPath, config) {
    if (!this.isInitialized) {
      throw new Error('Registry not initialized');
    }
    
    const normalizedPath = path.resolve(projectPath);
    
    // Find existing project by path
    const existingEntry = Object.entries(this.registry.projects).find(
      ([id, project]) => project.path === normalizedPath
    );
    
    if (existingEntry) {
      // Update existing project
      const [projectId, existingProject] = existingEntry;
      return this.updateProject(projectId, { config });
    } else {
      // Register as new if not found
      return this.register(projectPath, config);
    }
  }

  /**
   * Update project configuration
   */
  async updateProject(projectId, updates) {
    if (!this.isInitialized) {
      throw new Error('Registry not initialized');
    }
    
    const project = this.registry.projects[projectId];
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    
    // Merge updates
    const updated = {
      ...project,
      ...updates,
      updatedAt: new Date().toISOString(),
      config: {
        ...project.config,
        ...(updates.config || {})
      },
      stats: {
        ...project.stats,
        ...(updates.stats || {})
      }
    };
    
    // Prevent changing certain fields
    updated.path = project.path;
    updated.createdAt = project.createdAt;
    
    // Validate
    if (!validateProject(updated)) {
      throw new Error(`Invalid project configuration: ${JSON.stringify(validateProject.errors)}`);
    }
    
    this.registry.projects[projectId] = updated;
    
    await this.save();
    
    this.emit('project-updated', projectId, updated);
    return updated;
  }

  /**
   * Enable or disable a project
   */
  async setEnabled(projectId, enabled) {
    return this.updateProject(projectId, { enabled });
  }

  /**
   * Get project by ID
   */
  getProject(projectId) {
    if (!this.isInitialized) {
      throw new Error('Registry not initialized');
    }
    
    return this.registry.projects[projectId];
  }

  /**
   * Get project by path
   */
  getProjectByPath(projectPath) {
    if (!this.isInitialized) {
      throw new Error('Registry not initialized');
    }
    
    const normalizedPath = path.resolve(projectPath);
    
    for (const [id, project] of Object.entries(this.registry.projects)) {
      if (project.path === normalizedPath) {
        return { id, ...project };
      }
    }
    
    return null;
  }

  /**
   * Get all projects
   */
  getAllProjects() {
    if (!this.isInitialized) {
      throw new Error('Registry not initialized');
    }
    
    return { ...this.registry.projects };
  }

  /**
   * Get enabled projects
   */
  getEnabledProjects() {
    if (!this.isInitialized) {
      throw new Error('Registry not initialized');
    }
    
    const enabled = {};
    for (const [id, project] of Object.entries(this.registry.projects)) {
      if (project.enabled) {
        enabled[id] = project;
      }
    }
    
    return enabled;
  }

  /**
   * Update project statistics
   */
  async updateStats(projectId, stats) {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    
    const updated = {
      stats: {
        ...project.stats,
        ...stats,
        lastActivityAt: new Date().toISOString()
      }
    };
    
    return this.updateProject(projectId, updated);
  }

  /**
   * Generate project ID from path
   */
  generateProjectId(projectPath) {
    // Use last two parts of path
    const parts = projectPath.split(path.sep);
    const name = parts.slice(-2).join('-').toLowerCase();
    
    // Replace invalid characters
    const sanitized = name.replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-');
    
    // Add short hash for uniqueness
    const hash = crypto.createHash('sha256').update(projectPath).digest('hex').slice(0, 6);
    
    return `${sanitized}-${hash}`;
  }

  /**
   * Validate project configuration
   */
  validateProject(project) {
    return validateProject(project);
  }

  /**
   * Export registry
   */
  async export(filePath) {
    if (!this.isInitialized) {
      throw new Error('Registry not initialized');
    }
    
    await fs.writeFile(filePath, JSON.stringify(this.registry, null, 2));
  }

  /**
   * Import registry
   */
  async import(filePath) {
    const data = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(data);
    
    if (!validateRegistry(parsed)) {
      throw new Error(`Invalid registry format: ${JSON.stringify(validateRegistry.errors)}`);
    }
    
    this.registry = parsed;
    await this.save();
    
    this.emit('imported', this.registry);
  }

  /**
   * Get registry metadata
   */
  getMetadata() {
    if (!this.isInitialized) {
      throw new Error('Registry not initialized');
    }
    
    return { ...this.registry.metadata };
  }

  /**
   * Validate a project
   * @param {string} projectId - Project ID
   * @param {Object} options - Validation options
   * @returns {Promise<Object>} Validation result
   */
  async validateProject(projectId, options = {}) {
    if (!this.isInitialized) {
      throw new Error('Registry not initialized');
    }

    const project = this.registry.projects[projectId];
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const validationResult = await this.validator.validateProject(project.path, options);
    
    // Update project with validation result
    await this.updateProject(projectId, {
      validation: {
        lastValidated: new Date().toISOString(),
        result: validationResult
      }
    });

    this.emit('project-validated', projectId, validationResult);
    return validationResult;
  }

  /**
   * Check project health
   * @param {string} projectId - Project ID
   * @param {Object} options - Health check options
   * @returns {Promise<Object>} Health data
   */
  async checkProjectHealth(projectId, options = {}) {
    if (!this.isInitialized) {
      throw new Error('Registry not initialized');
    }

    const project = this.registry.projects[projectId];
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const healthData = await this.healthTracker.trackProject(projectId, project.path, options);
    
    // Update project with health data
    await this.updateProject(projectId, {
      health: {
        lastChecked: new Date().toISOString(),
        status: healthData.overall.status,
        score: healthData.overall.score,
        grade: healthData.overall.grade
      }
    });

    this.emit('project-health-checked', projectId, healthData);
    return healthData;
  }

  /**
   * Get validation result for a project
   * @param {string} projectId - Project ID
   * @returns {Object|null} Validation result
   */
  getProjectValidation(projectId) {
    const project = this.getProject(projectId);
    return project ? project.validation : null;
  }

  /**
   * Get health data for a project
   * @param {string} projectId - Project ID
   * @returns {Object|null} Health data
   */
  getProjectHealth(projectId) {
    const project = this.getProject(projectId);
    return project ? project.health : null;
  }

  /**
   * Get projects by health status
   * @param {string} status - Health status to filter by
   * @returns {Object} Projects with specified health status
   */
  getProjectsByHealthStatus(status) {
    if (!this.isInitialized) {
      throw new Error('Registry not initialized');
    }

    const filtered = {};
    for (const [id, project] of Object.entries(this.registry.projects)) {
      if (project.health && project.health.status === status) {
        filtered[id] = project;
      }
    }

    return filtered;
  }

  /**
   * Get projects by validation status
   * @param {boolean} valid - Whether to get valid or invalid projects
   * @returns {Object} Projects with specified validation status
   */
  getProjectsByValidationStatus(valid = true) {
    if (!this.isInitialized) {
      throw new Error('Registry not initialized');
    }

    const filtered = {};
    for (const [id, project] of Object.entries(this.registry.projects)) {
      if (project.validation && project.validation.result && project.validation.result.valid === valid) {
        filtered[id] = project;
      }
    }

    return filtered;
  }

  /**
   * Start health monitoring for all projects
   */
  startHealthMonitoring() {
    if (!this.healthTrackingEnabled) {
      throw new Error('Health tracking is disabled');
    }

    const projects = Object.entries(this.registry.projects).map(([projectId, project]) => ({
      projectId,
      projectPath: project.path
    }));

    this.healthTracker.startMonitoring(projects);
    this.emit('health-monitoring-started', projects.length);
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring() {
    if (this.healthTracker) {
      this.healthTracker.stopMonitoring();
      this.emit('health-monitoring-stopped');
    }
  }

  /**
   * Validate all projects
   * @param {Object} options - Validation options
   * @returns {Promise<Object>} Validation results for all projects
   */
  async validateAllProjects(options = {}) {
    if (!this.isInitialized) {
      throw new Error('Registry not initialized');
    }

    const results = {};
    const projects = Object.keys(this.registry.projects);

    for (const projectId of projects) {
      try {
        results[projectId] = await this.validateProject(projectId, options);
      } catch (error) {
        results[projectId] = {
          valid: false,
          error: error.message
        };
      }
    }

    this.emit('all-projects-validated', results);
    return results;
  }

  /**
   * Check health of all projects
   * @param {Object} options - Health check options
   * @returns {Promise<Object>} Health data for all projects
   */
  async checkAllProjectsHealth(options = {}) {
    if (!this.isInitialized) {
      throw new Error('Registry not initialized');
    }

    const results = {};
    const projects = Object.keys(this.registry.projects);

    for (const projectId of projects) {
      try {
        results[projectId] = await this.checkProjectHealth(projectId, options);
      } catch (error) {
        results[projectId] = {
          overall: { status: 'error', score: 0 },
          error: error.message
        };
      }
    }

    this.emit('all-projects-health-checked', results);
    return results;
  }

  /**
   * Enable or disable validation
   * @param {boolean} enabled - Whether to enable validation
   */
  setValidationEnabled(enabled) {
    this.validationEnabled = enabled;
    this.emit('validation-toggled', enabled);
  }

  /**
   * Enable or disable health tracking
   * @param {boolean} enabled - Whether to enable health tracking
   */
  setHealthTrackingEnabled(enabled) {
    this.healthTrackingEnabled = enabled;
    if (!enabled && this.healthTracker) {
      this.healthTracker.stopMonitoring();
    }
    this.emit('health-tracking-toggled', enabled);
  }

  /**
   * Get registry statistics including health and validation data
   * @returns {Object} Registry statistics
   */
  getRegistryStatistics() {
    if (!this.isInitialized) {
      throw new Error('Registry not initialized');
    }

    const stats = {
      totalProjects: Object.keys(this.registry.projects).length,
      enabledProjects: 0,
      validatedProjects: 0,
      validProjects: 0,
      healthCheckedProjects: 0,
      healthyProjects: 0,
      healthStatus: {
        excellent: 0,
        good: 0,
        fair: 0,
        poor: 0,
        unhealthy: 0
      },
      averageHealthScore: 0,
      averageValidationScore: 0
    };

    let totalHealthScore = 0;
    let totalValidationScore = 0;
    let healthCount = 0;
    let validationCount = 0;

    for (const project of Object.values(this.registry.projects)) {
      if (project.enabled) {
        stats.enabledProjects++;
      }

      if (project.validation) {
        stats.validatedProjects++;
        if (project.validation.result && project.validation.result.valid) {
          stats.validProjects++;
        }
        if (project.validation.result && project.validation.result.score !== undefined) {
          totalValidationScore += project.validation.result.score;
          validationCount++;
        }
      }

      if (project.health) {
        stats.healthCheckedProjects++;
        if (project.health.status && project.health.status !== 'unhealthy') {
          stats.healthyProjects++;
        }
        if (project.health.status) {
          stats.healthStatus[project.health.status] = (stats.healthStatus[project.health.status] || 0) + 1;
        }
        if (project.health.score !== undefined) {
          totalHealthScore += project.health.score;
          healthCount++;
        }
      }
    }

    stats.averageHealthScore = healthCount > 0 ? Math.round(totalHealthScore / healthCount) : 0;
    stats.averageValidationScore = validationCount > 0 ? Math.round(totalValidationScore / validationCount) : 0;

    return stats;
  }

  /**
   * Cleanup and save any pending changes
   */
  async cleanup() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      await this.save();
    }
    
    // Cleanup health tracker
    if (this.healthTracker) {
      await this.healthTracker.cleanup();
    }
    
    this.removeAllListeners();
  }
}

// Export as singleton
let instance = null;

module.exports = {
  /**
   * Get or create the project registry instance
   */
  getInstance() {
    if (!instance) {
      instance = new ProjectRegistry();
    }
    return instance;
  },
  
  /**
   * Reset instance (for testing)
   */
  resetInstance() {
    if (instance) {
      instance.cleanup();
    }
    instance = null;
  },
  
  ProjectRegistry
};