const { describe, it, before, after, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const ProjectValidator = require('../lib/core/project-validator');
const ProjectHealthTracker = require('../lib/core/project-health-tracker');
const { getInstance, resetInstance } = require('../lib/core/project-registry');

describe('Project Validation and Health Tracking', function() {
  let testDir;
  let testProject;
  let validator;
  let healthTracker;
  let registry;

  before(async function() {
    // Create test directory structure
    testDir = path.join(os.tmpdir(), 'poppobuilder-test-validation-' + Date.now());
    testProject = path.join(testDir, 'test-project');
    
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(testProject, { recursive: true });
    await fs.mkdir(path.join(testProject, '.poppo'), { recursive: true });
    
    // Create test project files
    await fs.writeFile(path.join(testProject, 'package.json'), JSON.stringify({
      name: 'test-project',
      version: '1.0.0',
      description: 'A test project for validation',
      author: 'Test Author',
      license: 'MIT',
      scripts: {
        test: 'echo "test"',
        start: 'node index.js'
      },
      dependencies: {
        express: '^4.18.0'
      },
      engines: {
        node: '>=14.0.0'
      }
    }));
    
    await fs.writeFile(path.join(testProject, 'README.md'), '# Test Project\n\nThis is a test project.');
    await fs.writeFile(path.join(testProject, '.gitignore'), 'node_modules/\n.env\n');
    await fs.writeFile(path.join(testProject, 'LICENSE'), 'MIT License');
    
    await fs.writeFile(path.join(testProject, '.poppo', 'config.json'), JSON.stringify({
      github: {
        owner: 'testuser',
        repo: 'test-project'
      },
      language: {
        primary: 'en'
      }
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

  beforeEach(function() {
    validator = new ProjectValidator();
    healthTracker = new ProjectHealthTracker();
    
    // Use test-specific health data path
    healthTracker.healthDataPath = path.join(testDir, '.health-test-' + Date.now());
    
    // Reset registry instance
    resetInstance();
    registry = getInstance();
  });

  afterEach(async function() {
    if (healthTracker) {
      await healthTracker.cleanup();
    }
    if (registry) {
      await registry.cleanup();
    }
  });

  describe('ProjectValidator', function() {
    it('should validate a well-formed project', async function() {
      const result = await validator.validateProject(testProject);
      
      expect(result).to.be.an('object');
      expect(result.valid).to.be.true;
      expect(result.score).to.be.above(80); // Should score well
      expect(result.issues).to.be.an('array');
      expect(result.warnings).to.be.an('array');
      expect(result.recommendations).to.be.an('array');
      expect(result.checks).to.be.an('object');
      expect(result.metadata).to.be.an('object');
    });

    it('should detect missing required files', async function() {
      // Create a project without package.json
      const badProject = path.join(testDir, 'bad-project');
      await fs.mkdir(badProject, { recursive: true });
      
      const result = await validator.validateProject(badProject);
      
      // Should be invalid due to missing package.json
      expect(result.valid).to.be.false;
      expect(result.score).to.be.below(60); // Should have low score
      expect(result.issues.some(issue => issue.code === 'MISSING_REQUIRED_FILE' && issue.file === 'package.json')).to.be.true;
    });

    it('should validate package.json content', async function() {
      const result = await validator.validateProject(testProject);
      
      expect(result.checks.packageJson).to.be.an('object');
      expect(result.checks.packageJson.valid).to.be.true;
      expect(result.checks.packageJson.data).to.be.an('object');
      expect(result.checks.packageJson.data.name).to.equal('test-project');
    });

    it('should check Node.js version compatibility', async function() {
      const result = await validator.validateProject(testProject);
      
      expect(result.checks.nodeVersion).to.be.an('object');
      expect(result.checks.nodeVersion.current).to.be.a('string');
      expect(result.checks.nodeVersion.compatible).to.be.a('boolean');
    });

    it('should validate PoppoBuilder configuration', async function() {
      const result = await validator.validateProject(testProject);
      
      expect(result.checks.poppoConfig).to.be.an('object');
      expect(result.checks.poppoConfig.exists).to.be.true;
      expect(result.checks.poppoConfig.valid).to.be.true;
      expect(result.checks.poppoConfig.config).to.be.an('object');
    });

    it('should generate different report formats', async function() {
      const result = await validator.validateProject(testProject);
      
      const textReport = validator.generateReport(result, 'text');
      expect(textReport).to.be.a('string');
      expect(textReport).to.include('Project Validation Report');
      
      const markdownReport = validator.generateReport(result, 'markdown');
      expect(markdownReport).to.be.a('string');
      expect(markdownReport).to.include('# Project Validation Report');
      
      const jsonReport = validator.generateReport(result, 'json');
      expect(() => JSON.parse(jsonReport)).to.not.throw();
    });

    it('should calculate validation scores correctly', async function() {
      const result = await validator.validateProject(testProject);
      const summary = validator.getValidationSummary(result);
      
      expect(summary.score).to.be.a('number');
      expect(summary.score).to.be.within(0, 100);
      expect(summary.grade).to.be.oneOf(['A', 'B', 'C', 'D', 'F']);
      expect(summary.valid).to.be.a('boolean');
    });
  });

  describe('ProjectHealthTracker', function() {
    beforeEach(async function() {
      await healthTracker.initialize();
    });

    it('should track project health', async function() {
      const healthData = await healthTracker.trackProject('test-project', testProject);
      
      expect(healthData).to.be.an('object');
      expect(healthData.projectId).to.equal('test-project');
      expect(healthData.projectPath).to.equal(testProject);
      expect(healthData.timestamp).to.be.a('string');
      expect(healthData.overall).to.be.an('object');
      expect(healthData.overall.status).to.be.a('string');
      expect(healthData.overall.score).to.be.a('number');
      expect(healthData.overall.grade).to.be.a('string');
      expect(healthData.metrics).to.be.an('object');
    });

    it('should check project availability', async function() {
      const healthData = await healthTracker.trackProject('test-project', testProject);
      
      expect(healthData.metrics.availability).to.be.an('object');
      expect(healthData.metrics.availability.accessible).to.be.true;
      expect(healthData.metrics.availability.score).to.equal(100);
    });

    it('should analyze project performance', async function() {
      const healthData = await healthTracker.trackProject('test-project', testProject);
      
      expect(healthData.metrics.performance).to.be.an('object');
      expect(healthData.metrics.performance.score).to.be.a('number');
      expect(healthData.metrics.performance.score).to.be.within(0, 100);
    });

    it('should check security status', async function() {
      const healthData = await healthTracker.trackProject('test-project', testProject);
      
      expect(healthData.metrics.security).to.be.an('object');
      expect(healthData.metrics.security.score).to.be.a('number');
      expect(healthData.metrics.security.securityFiles).to.be.an('object');
      expect(healthData.metrics.security.securityFiles.hasGitignore).to.be.true;
      expect(healthData.metrics.security.securityFiles.hasLicense).to.be.true;
    });

    it('should track maintenance status', async function() {
      const healthData = await healthTracker.trackProject('test-project', testProject);
      
      expect(healthData.metrics.maintenance).to.be.an('object');
      expect(healthData.metrics.maintenance.score).to.be.a('number');
    });

    it('should check dependency health', async function() {
      const healthData = await healthTracker.trackProject('test-project', testProject);
      
      expect(healthData.metrics.dependencies).to.be.an('object');
      expect(healthData.metrics.dependencies.score).to.be.a('number');
      expect(healthData.metrics.dependencies.totalDependencies).to.be.a('number');
    });

    it('should check configuration health', async function() {
      const healthData = await healthTracker.trackProject('test-project', testProject);
      
      expect(healthData.metrics.configuration).to.be.an('object');
      expect(healthData.metrics.configuration.hasPoppoConfig).to.be.true;
      expect(healthData.metrics.configuration.configValid).to.be.true;
    });

    it('should generate health alerts', async function() {
      const healthData = await healthTracker.trackProject('test-project', testProject);
      
      expect(healthData.alerts).to.be.an('array');
      // Alerts may or may not be present depending on project state
    });

    it('should provide health recommendations', async function() {
      const healthData = await healthTracker.trackProject('test-project', testProject);
      
      expect(healthData.recommendations).to.be.an('array');
      // Recommendations may or may not be present depending on project state
    });

    it('should calculate health trends', async function() {
      // Track the same project multiple times to build history
      await healthTracker.trackProject('test-project', testProject);
      await healthTracker.trackProject('test-project', testProject);
      
      const healthData = await healthTracker.trackProject('test-project', testProject);
      
      expect(healthData.trends).to.be.an('object');
      expect(healthData.trends.trend).to.be.a('string');
      expect(healthData.trends.change).to.be.a('number');
    });

    it('should save and load health data', async function() {
      const healthData = await healthTracker.trackProject('test-project', testProject);
      
      // Save health data
      await healthTracker.saveHealthData('test-project');
      
      // Get health data
      const retrieved = healthTracker.getHealthData('test-project');
      expect(retrieved).to.deep.equal(healthData);
    });
  });

  describe('Registry Integration', function() {
    beforeEach(async function() {
      // Initialize registry with unique test directory
      const testRegistryDir = path.join(testDir, '.poppobuilder-test-' + Date.now());
      await fs.mkdir(testRegistryDir, { recursive: true });
      registry.registryFile = path.join(testRegistryDir, 'projects.json');
      
      // Use test-specific health data path for registry health tracker
      registry.healthTracker.healthDataPath = path.join(testDir, '.health-registry-' + Date.now());
      
      await registry.initialize();
    });

    it('should validate project during registration', async function() {
      const projectId = await registry.register(testProject, {
        name: 'Test Project'
      });
      
      const project = registry.getProject(projectId);
      expect(project.validation).to.be.an('object');
      expect(project.validation.lastValidated).to.be.a('string');
      expect(project.validation.result).to.be.an('object');
      expect(project.validation.result.valid).to.be.true;
    });

    it('should track health during registration', async function() {
      const projectId = await registry.register(testProject, {
        name: 'Test Project'
      });
      
      const project = registry.getProject(projectId);
      expect(project.health).to.be.an('object');
      expect(project.health.lastChecked).to.be.a('string');
      expect(project.health.status).to.be.a('string');
      expect(project.health.score).to.be.a('number');
      expect(project.health.grade).to.be.a('string');
    });

    it('should validate specific project', async function() {
      const projectId = await registry.register(testProject);
      
      const validationResult = await registry.validateProject(projectId);
      expect(validationResult.valid).to.be.true;
      expect(validationResult.score).to.be.a('number');
    });

    it('should check specific project health', async function() {
      const projectId = await registry.register(testProject);
      
      const healthData = await registry.checkProjectHealth(projectId);
      expect(healthData.overall.status).to.be.a('string');
      expect(healthData.overall.score).to.be.a('number');
    });

    it('should filter projects by health status', async function() {
      const projectId = await registry.register(testProject);
      const project = registry.getProject(projectId);
      
      const healthyProjects = registry.getProjectsByHealthStatus(project.health.status);
      expect(healthyProjects).to.be.an('object');
      expect(healthyProjects[projectId]).to.be.an('object');
    });

    it('should filter projects by validation status', async function() {
      const projectId = await registry.register(testProject);
      
      const validProjects = registry.getProjectsByValidationStatus(true);
      expect(validProjects).to.be.an('object');
      expect(validProjects[projectId]).to.be.an('object');
    });

    it('should provide registry statistics', async function() {
      await registry.register(testProject);
      
      const stats = registry.getRegistryStatistics();
      expect(stats).to.be.an('object');
      expect(stats.totalProjects).to.equal(1);
      expect(stats.validatedProjects).to.equal(1);
      expect(stats.healthCheckedProjects).to.equal(1);
      expect(stats.averageHealthScore).to.be.a('number');
      expect(stats.averageValidationScore).to.be.a('number');
    });

    it('should validate all projects', async function() {
      const projectId1 = await registry.register(testProject);
      
      const results = await registry.validateAllProjects();
      expect(results).to.be.an('object');
      expect(results[projectId1]).to.be.an('object');
      expect(results[projectId1].valid).to.be.true;
    });

    it('should check health of all projects', async function() {
      const projectId1 = await registry.register(testProject);
      
      const results = await registry.checkAllProjectsHealth();
      expect(results).to.be.an('object');
      expect(results[projectId1]).to.be.an('object');
      expect(results[projectId1].overall).to.be.an('object');
    });

    it('should disable validation and health tracking', async function() {
      registry.setValidationEnabled(false);
      registry.setHealthTrackingEnabled(false);
      
      const projectId = await registry.register(testProject);
      const project = registry.getProject(projectId);
      
      expect(project.validation).to.be.undefined;
      expect(project.health).to.be.undefined;
    });
  });
});