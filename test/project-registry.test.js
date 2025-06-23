const { describe, it, before, after, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { getInstance, resetInstance } = require('../lib/core/project-registry');

describe('ProjectRegistry', function() {
  let registry;
  let testDir;
  let testProject1;
  let testProject2;

  before(async function() {
    // Create test directory structure
    testDir = path.join(os.tmpdir(), 'poppobuilder-test-registry-' + Date.now());
    testProject1 = path.join(testDir, 'project1');
    testProject2 = path.join(testDir, 'project2');
    
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(testProject1, { recursive: true });
    await fs.mkdir(testProject2, { recursive: true });
    
    // Create test project files
    await fs.writeFile(path.join(testProject1, 'package.json'), JSON.stringify({
      name: 'test-project-1',
      version: '1.0.0'
    }));
    
    await fs.writeFile(path.join(testProject2, 'package.json'), JSON.stringify({
      name: 'test-project-2',
      version: '1.0.0'
    }));
  });

  after(async function() {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to clean up test directory:', error);
    }
  });

  beforeEach(async function() {
    // Get fresh instance
    resetInstance();
    registry = getInstance();
    
    // Initialize with test directory (unique per test)
    const testRegistryDir = path.join(testDir, '.poppobuilder-test-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9));
    await fs.mkdir(testRegistryDir, { recursive: true });
    registry.registryFile = path.join(testRegistryDir, 'projects.json');
    
    await registry.initialize();
  });

  afterEach(async function() {
    // Clean up registry
    if (registry) {
      await registry.cleanup();
    }
  });

  describe('Initialization', function() {
    it('should initialize with default registry', async function() {
      expect(registry.isInitialized).to.be.true;
      expect(registry.registry).to.be.an('object');
      expect(registry.registry.version).to.equal('1.0.0');
      expect(registry.registry.projects).to.be.an('object');
      expect(registry.registry.metadata).to.be.an('object');
    });

    it('should emit initialized event', function(done) {
      registry.once('initialized', (reg) => {
        expect(reg).to.be.an('object');
        expect(reg.version).to.equal('1.0.0');
        done();
      });
      
      // Re-initialize to trigger event
      registry.isInitialized = false;
      registry.initialize();
    });
  });

  describe('Project Registration', function() {
    it('should register a new project', async function() {
      const projectId = await registry.register(testProject1, {
        name: 'Test Project 1',
        description: 'A test project',
        priority: 75,
        weight: 2.0,
        github: {
          owner: 'testuser',
          repo: 'testrepo'
        }
      });
      
      expect(projectId).to.be.a('string');
      expect(projectId).to.match(/^[a-z0-9-_]+-[a-f0-9]{6}$/);
      
      const project = registry.getProject(projectId);
      expect(project).to.be.an('object');
      expect(project.path).to.equal(testProject1);
      expect(project.enabled).to.be.true;
      expect(project.config.name).to.equal('Test Project 1');
      expect(project.config.priority).to.equal(75);
      expect(project.config.weight).to.equal(2.0);
    });

    it('should validate project configuration', async function() {
      try {
        // Invalid priority (too high)
        await registry.register(testProject1, {
          config: {
            priority: 150  // Should be max 100
          }
        });
        expect.fail('Should have thrown validation error');
      } catch (error) {
        expect(error.message).to.include('Invalid project configuration');
      }
    });

    it('should prevent duplicate registration', async function() {
      await registry.register(testProject1);
      
      try {
        await registry.register(testProject1);
        expect.fail('Should have thrown duplicate error');
      } catch (error) {
        expect(error.message).to.include('already registered');
      }
    });

    it('should generate unique project IDs', async function() {
      const id1 = await registry.register(testProject1);
      const id2 = await registry.register(testProject2);
      
      expect(id1).to.not.equal(id2);
    });

    it('should emit project-registered event', function(done) {
      registry.once('project-registered', (projectId, project) => {
        expect(projectId).to.be.a('string');
        expect(project).to.be.an('object');
        expect(project.path).to.equal(testProject1);
        done();
      });
      
      registry.register(testProject1);
    });
  });

  describe('Project Management', function() {
    let projectId;

    beforeEach(async function() {
      projectId = await registry.register(testProject1, {
        name: 'Test Project',
        priority: 50
      });
    });

    it('should update project configuration', async function() {
      const updated = await registry.updateProject(projectId, {
        enabled: false,
        config: {
          priority: 90,
          tags: ['test', 'example']
        }
      });
      
      expect(updated.enabled).to.be.false;
      expect(updated.config.priority).to.equal(90);
      expect(updated.config.tags).to.deep.equal(['test', 'example']);
      expect(updated.config.name).to.equal('Test Project'); // Should preserve existing
    });

    it('should not allow changing immutable fields', async function() {
      const originalPath = registry.getProject(projectId).path;
      const originalCreatedAt = registry.getProject(projectId).createdAt;
      
      await registry.updateProject(projectId, {
        path: '/different/path',
        createdAt: new Date().toISOString()
      });
      
      const project = registry.getProject(projectId);
      expect(project.path).to.equal(originalPath);
      expect(project.createdAt).to.equal(originalCreatedAt);
    });

    it('should enable/disable projects', async function() {
      await registry.setEnabled(projectId, false);
      expect(registry.getProject(projectId).enabled).to.be.false;
      
      await registry.setEnabled(projectId, true);
      expect(registry.getProject(projectId).enabled).to.be.true;
    });

    it('should unregister projects', async function() {
      await registry.unregister(projectId);
      
      expect(registry.getProject(projectId)).to.be.undefined;
      expect(Object.keys(registry.getAllProjects())).to.not.include(projectId);
    });

    it('should emit project-unregistered event', function(done) {
      registry.once('project-unregistered', (id, project) => {
        expect(id).to.equal(projectId);
        expect(project).to.be.an('object');
        expect(project.path).to.equal(testProject1);
        done();
      });
      
      registry.unregister(projectId);
    });
  });

  describe('Project Queries', function() {
    let id1, id2, id3;

    beforeEach(async function() {
      id1 = await registry.register(testProject1, {
        name: 'Project 1',
        priority: 80
      });
      
      id2 = await registry.register(testProject2, {
        name: 'Project 2',
        priority: 50
      });
      
      // Create and register third project (disabled)
      const testProject3 = path.join(testDir, 'project3');
      await fs.mkdir(testProject3, { recursive: true });
      id3 = await registry.register(testProject3);
      await registry.setEnabled(id3, false);
    });

    it('should get all projects', function() {
      const all = registry.getAllProjects();
      expect(Object.keys(all)).to.have.lengthOf(3);
      expect(all[id1]).to.be.an('object');
      expect(all[id2]).to.be.an('object');
      expect(all[id3]).to.be.an('object');
    });

    it('should get only enabled projects', function() {
      const enabled = registry.getEnabledProjects();
      expect(Object.keys(enabled)).to.have.lengthOf(2);
      expect(enabled[id1]).to.be.an('object');
      expect(enabled[id2]).to.be.an('object');
      expect(enabled[id3]).to.be.undefined;
    });

    it('should get project by path', function() {
      const project = registry.getProjectByPath(testProject1);
      expect(project).to.be.an('object');
      expect(project.id).to.equal(id1);
      expect(project.path).to.equal(testProject1);
      expect(project.config.name).to.equal('Project 1');
    });

    it('should return null for unknown path', function() {
      const project = registry.getProjectByPath('/unknown/path');
      expect(project).to.be.null;
    });
  });

  describe('Statistics', function() {
    let projectId;

    beforeEach(async function() {
      projectId = await registry.register(testProject1);
    });

    it('should update project statistics', async function() {
      await registry.updateStats(projectId, {
        totalIssuesProcessed: 10,
        totalErrors: 2,
        averageProcessingTime: 5000
      });
      
      const project = registry.getProject(projectId);
      expect(project.stats.totalIssuesProcessed).to.equal(10);
      expect(project.stats.totalErrors).to.equal(2);
      expect(project.stats.averageProcessingTime).to.equal(5000);
      expect(project.stats.lastActivityAt).to.be.a('string');
    });

    it('should merge statistics updates', async function() {
      await registry.updateStats(projectId, {
        totalIssuesProcessed: 5
      });
      
      await registry.updateStats(projectId, {
        totalErrors: 1
      });
      
      const project = registry.getProject(projectId);
      expect(project.stats.totalIssuesProcessed).to.equal(5);
      expect(project.stats.totalErrors).to.equal(1);
    });
  });

  describe('Persistence', function() {
    it('should save and load registry', async function() {
      const id1 = await registry.register(testProject1, {
        name: 'Persistent Project'
      });
      
      // Create new instance
      resetInstance();
      const newRegistry = getInstance();
      newRegistry.registryFile = registry.registryFile;
      await newRegistry.initialize();
      
      const project = newRegistry.getProject(id1);
      expect(project).to.be.an('object');
      expect(project.config.name).to.equal('Persistent Project');
    });

    it('should handle concurrent saves gracefully', async function() {
      // Create project directories first
      const projectPaths = [];
      for (let i = 0; i < 5; i++) {
        const projectPath = path.join(testDir, `concurrent-${i}`);
        await fs.mkdir(projectPath, { recursive: true });
        projectPaths.push(projectPath);
      }
      
      // Register multiple projects quickly
      const promises = projectPaths.map(projectPath => 
        registry.register(projectPath)
      );
      
      const results = await Promise.all(promises);
      
      // Verify all projects were saved
      expect(results).to.have.lengthOf(5);
      const all = registry.getAllProjects();
      expect(Object.keys(all)).to.have.lengthOf(5);
    });
  });

  describe('Import/Export', function() {
    it('should export registry to file', async function() {
      await registry.register(testProject1, { name: 'Export Test' });
      
      const exportPath = path.join(testDir, 'export.json');
      await registry.export(exportPath);
      
      const exported = JSON.parse(await fs.readFile(exportPath, 'utf8'));
      expect(exported.version).to.equal('1.0.0');
      expect(exported.projects).to.be.an('object');
      expect(Object.keys(exported.projects)).to.have.lengthOf(1);
    });

    it('should import registry from file', async function() {
      const importData = {
        version: '1.0.0',
        projects: {
          'imported-project': {
            path: '/imported/path',
            enabled: true,
            createdAt: new Date().toISOString(),
            config: { name: 'Imported Project' },
            stats: {}
          }
        },
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          totalProjects: 1
        }
      };
      
      const importPath = path.join(testDir, 'import.json');
      await fs.writeFile(importPath, JSON.stringify(importData));
      
      await registry.import(importPath);
      
      const project = registry.getProject('imported-project');
      expect(project).to.be.an('object');
      expect(project.config.name).to.equal('Imported Project');
    });
  });

  describe('Metadata', function() {
    it('should track metadata', async function() {
      const metadata = registry.getMetadata();
      expect(metadata.createdAt).to.be.a('string');
      expect(metadata.updatedAt).to.be.a('string');
      expect(metadata.totalProjects).to.equal(0);
      
      await registry.register(testProject1);
      
      const updated = registry.getMetadata();
      expect(updated.totalProjects).to.equal(1);
      expect(new Date(updated.updatedAt)).to.be.above(new Date(metadata.updatedAt));
    });
  });
});