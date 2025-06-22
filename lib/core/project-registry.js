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

class ProjectRegistry extends EventEmitter {
  constructor() {
    super();
    this.registryFile = path.join(os.homedir(), '.poppobuilder', 'projects.json');
    this.registry = null;
    this.isInitialized = false;
    this.saveTimer = null;
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
   * Cleanup and save any pending changes
   */
  async cleanup() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      await this.save();
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