/**
 * Project Registry Tests
 */

const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

describe('ProjectRegistry', () => {
  let ProjectRegistry;
  let registry;
  let sandbox;
  let mockRegistryFile;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    
    // Load ProjectRegistry
    const projectRegistryModule = require('../lib/core/project-registry');
    ProjectRegistry = projectRegistryModule.ProjectRegistry;
    
    registry = new ProjectRegistry();
    
    // Mock home directory and registry file
    mockRegistryFile = '/tmp/test-poppobuilder/projects.json';
    sandbox.stub(os, 'homedir').returns('/tmp/test-home');
    registry.registryFile = mockRegistryFile;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('initialize', () => {
    it('should initialize and create default registry', async () => {
      const mkdirStub = sandbox.stub(fs, 'mkdir').resolves();
      const accessStub = sandbox.stub(fs, 'access').rejects(new Error('ENOENT'));
      const writeFileStub = sandbox.stub(fs, 'writeFile').resolves();
      const renameStub = sandbox.stub(fs, 'rename').resolves();
      
      const result = await registry.initialize();
      
      expect(mkdirStub.called).to.be.true;
      expect(writeFileStub.called).to.be.true;
      expect(renameStub.called).to.be.true;
      expect(registry.isInitialized).to.be.true;
      expect(result.version).to.equal('1.0.0');
      expect(result.projects).to.deep.equal({});
    });

    it('should load existing registry', async () => {
      const existingRegistry = {
        version: '1.0.0',
        projects: {
          'test-project': {
            path: '/test/path',
            enabled: true,
            createdAt: '2025-01-01T00:00:00Z'
          }
        },
        metadata: {
          totalProjects: 1
        }
      };

      sandbox.stub(fs, 'mkdir').resolves();
      sandbox.stub(fs, 'access').resolves();
      sandbox.stub(fs, 'readFile').resolves(JSON.stringify(existingRegistry));
      
      await registry.initialize();
      
      expect(registry.registry.projects['test-project']).to.exist;
      expect(registry.registry.projects['test-project'].path).to.equal('/test/path');
    });
  });

  describe('register', () => {
    beforeEach(async () => {
      sandbox.stub(fs, 'mkdir').resolves();
      sandbox.stub(fs, 'access').rejects(new Error('ENOENT'));
      sandbox.stub(fs, 'writeFile').resolves();
      sandbox.stub(fs, 'rename').resolves();
      
      await registry.initialize();
    });

    it('should register a new project', async () => {
      const projectPath = '/test/project';
      const statStub = sandbox.stub(fs, 'stat').resolves({ isDirectory: () => true });
      
      const projectId = await registry.register(projectPath, {
        name: 'Test Project',
        description: 'A test project'
      });
      
      expect(statStub.calledWith(projectPath)).to.be.true;
      expect(projectId).to.be.a('string');
      expect(registry.registry.projects[projectId]).to.exist;
      expect(registry.registry.projects[projectId].path).to.equal(projectPath);
      expect(registry.registry.projects[projectId].config.name).to.equal('Test Project');
    });

    it('should throw error for non-directory path', async () => {
      const projectPath = '/test/file.txt';
      sandbox.stub(fs, 'stat').resolves({ isDirectory: () => false });
      
      try {
        await registry.register(projectPath);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('must be a directory');
      }
    });

    it('should throw error for already registered project', async () => {
      const projectPath = '/test/project';
      sandbox.stub(fs, 'stat').resolves({ isDirectory: () => true });
      
      // Register project first time
      await registry.register(projectPath);
      
      // Try to register again
      try {
        await registry.register(projectPath);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('already registered');
      }
    });
  });

  describe('unregister', () => {
    let projectId;

    beforeEach(async () => {
      sandbox.stub(fs, 'mkdir').resolves();
      sandbox.stub(fs, 'access').rejects(new Error('ENOENT'));
      sandbox.stub(fs, 'writeFile').resolves();
      sandbox.stub(fs, 'rename').resolves();
      sandbox.stub(fs, 'stat').resolves({ isDirectory: () => true });
      
      await registry.initialize();
      projectId = await registry.register('/test/project');
    });

    it('should unregister a project', async () => {
      expect(registry.registry.projects[projectId]).to.exist;
      
      await registry.unregister(projectId);
      
      expect(registry.registry.projects[projectId]).to.be.undefined;
    });

    it('should throw error for non-existent project', async () => {
      try {
        await registry.unregister('non-existent');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('not found');
      }
    });
  });

  describe('updateProject', () => {
    let projectId;

    beforeEach(async () => {
      sandbox.stub(fs, 'mkdir').resolves();
      sandbox.stub(fs, 'access').rejects(new Error('ENOENT'));
      sandbox.stub(fs, 'writeFile').resolves();
      sandbox.stub(fs, 'rename').resolves();
      sandbox.stub(fs, 'stat').resolves({ isDirectory: () => true });
      
      await registry.initialize();
      projectId = await registry.register('/test/project');
    });

    it('should update project configuration', async () => {
      const originalProject = registry.getProject(projectId);
      const originalUpdatedAt = originalProject.updatedAt;
      
      // Wait a small amount to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const updates = {
        config: {
          name: 'Updated Name',
          priority: 75
        }
      };
      
      const updated = await registry.updateProject(projectId, updates);
      
      expect(updated.config.name).to.equal('Updated Name');
      expect(updated.config.priority).to.equal(75);
      expect(updated.updatedAt).to.not.equal(originalUpdatedAt);
    });

    it('should preserve immutable fields', async () => {
      const originalPath = registry.registry.projects[projectId].path;
      const originalCreatedAt = registry.registry.projects[projectId].createdAt;
      
      const updates = {
        path: '/different/path',
        createdAt: '2020-01-01T00:00:00Z'
      };
      
      const updated = await registry.updateProject(projectId, updates);
      
      expect(updated.path).to.equal(originalPath);
      expect(updated.createdAt).to.equal(originalCreatedAt);
    });
  });

  describe('setEnabled', () => {
    let projectId;

    beforeEach(async () => {
      sandbox.stub(fs, 'mkdir').resolves();
      sandbox.stub(fs, 'access').rejects(new Error('ENOENT'));
      sandbox.stub(fs, 'writeFile').resolves();
      sandbox.stub(fs, 'rename').resolves();
      sandbox.stub(fs, 'stat').resolves({ isDirectory: () => true });
      
      await registry.initialize();
      projectId = await registry.register('/test/project');
    });

    it('should enable project', async () => {
      await registry.setEnabled(projectId, false);
      expect(registry.registry.projects[projectId].enabled).to.be.false;
      
      await registry.setEnabled(projectId, true);
      expect(registry.registry.projects[projectId].enabled).to.be.true;
    });

    it('should disable project', async () => {
      expect(registry.registry.projects[projectId].enabled).to.be.true;
      
      await registry.setEnabled(projectId, false);
      expect(registry.registry.projects[projectId].enabled).to.be.false;
    });
  });

  describe('getProject', () => {
    let projectId;

    beforeEach(async () => {
      sandbox.stub(fs, 'mkdir').resolves();
      sandbox.stub(fs, 'access').rejects(new Error('ENOENT'));
      sandbox.stub(fs, 'writeFile').resolves();
      sandbox.stub(fs, 'rename').resolves();
      sandbox.stub(fs, 'stat').resolves({ isDirectory: () => true });
      
      await registry.initialize();
      projectId = await registry.register('/test/project');
    });

    it('should return project by ID', () => {
      const project = registry.getProject(projectId);
      
      expect(project).to.exist;
      expect(project.path).to.equal('/test/project');
    });

    it('should return undefined for non-existent project', () => {
      const project = registry.getProject('non-existent');
      
      expect(project).to.be.undefined;
    });
  });

  describe('getProjectByPath', () => {
    let projectId;

    beforeEach(async () => {
      sandbox.stub(fs, 'mkdir').resolves();
      sandbox.stub(fs, 'access').rejects(new Error('ENOENT'));
      sandbox.stub(fs, 'writeFile').resolves();
      sandbox.stub(fs, 'rename').resolves();
      sandbox.stub(fs, 'stat').resolves({ isDirectory: () => true });
      
      await registry.initialize();
      projectId = await registry.register('/test/project');
    });

    it('should return project by path', () => {
      const project = registry.getProjectByPath('/test/project');
      
      expect(project).to.exist;
      expect(project.id).to.equal(projectId);
      expect(project.path).to.equal('/test/project');
    });

    it('should return null for non-existent path', () => {
      const project = registry.getProjectByPath('/non/existent');
      
      expect(project).to.be.null;
    });
  });

  describe('getEnabledProjects', () => {
    beforeEach(async () => {
      sandbox.stub(fs, 'mkdir').resolves();
      sandbox.stub(fs, 'access').rejects(new Error('ENOENT'));
      sandbox.stub(fs, 'writeFile').resolves();
      sandbox.stub(fs, 'rename').resolves();
      sandbox.stub(fs, 'stat').resolves({ isDirectory: () => true });
      
      await registry.initialize();
    });

    it('should return only enabled projects', async () => {
      const project1Id = await registry.register('/test/project1');
      const project2Id = await registry.register('/test/project2');
      await registry.setEnabled(project2Id, false);
      
      const enabledProjects = registry.getEnabledProjects();
      
      expect(Object.keys(enabledProjects)).to.have.lengthOf(1);
      expect(enabledProjects[project1Id]).to.exist;
      expect(enabledProjects[project2Id]).to.be.undefined;
    });
  });

  describe('generateProjectId', () => {
    it('should generate consistent ID for same path', () => {
      const path1 = '/home/user/projects/my-project';
      const path2 = '/home/user/projects/my-project';
      
      const id1 = registry.generateProjectId(path1);
      const id2 = registry.generateProjectId(path2);
      
      expect(id1).to.equal(id2);
    });

    it('should generate different IDs for different paths', () => {
      const path1 = '/home/user/projects/project1';
      const path2 = '/home/user/projects/project2';
      
      const id1 = registry.generateProjectId(path1);
      const id2 = registry.generateProjectId(path2);
      
      expect(id1).to.not.equal(id2);
    });

    it('should sanitize invalid characters', () => {
      const pathWithSpaces = '/home/user/My Project!/test';
      
      const id = registry.generateProjectId(pathWithSpaces);
      
      expect(id).to.match(/^[a-z0-9-]+$/);
    });
  });

  describe('updateStats', () => {
    let projectId;

    beforeEach(async () => {
      sandbox.stub(fs, 'mkdir').resolves();
      sandbox.stub(fs, 'access').rejects(new Error('ENOENT'));
      sandbox.stub(fs, 'writeFile').resolves();
      sandbox.stub(fs, 'rename').resolves();
      sandbox.stub(fs, 'stat').resolves({ isDirectory: () => true });
      
      await registry.initialize();
      projectId = await registry.register('/test/project');
    });

    it('should update project statistics', async () => {
      const stats = {
        totalIssuesProcessed: 5,
        totalErrors: 1,
        averageProcessingTime: 1500
      };
      
      const updated = await registry.updateStats(projectId, stats);
      
      expect(updated.stats.totalIssuesProcessed).to.equal(5);
      expect(updated.stats.totalErrors).to.equal(1);
      expect(updated.stats.averageProcessingTime).to.equal(1500);
      expect(updated.stats.lastActivityAt).to.exist;
    });
  });
});