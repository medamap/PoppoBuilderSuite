/**
 * Init Command Tests
 */

const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

describe('InitCommand', () => {
  let InitCommand;
  let initCommand;
  let sandbox;
  let mockProjectDir;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    
    // Load InitCommand
    InitCommand = require('../lib/commands/init');
    initCommand = new InitCommand();
    
    // Mock project directory
    mockProjectDir = '/tmp/test-project';
    
    // Mock file system operations
    sandbox.stub(fs, 'access').resolves();
    sandbox.stub(fs, 'mkdir').resolves();
    sandbox.stub(fs, 'writeFile').resolves();
    sandbox.stub(fs, 'readFile').resolves('');
    sandbox.stub(fs, 'appendFile').resolves();
    sandbox.stub(fs, 'chmod').resolves();
    
    // Mock process
    sandbox.stub(process, 'cwd').returns(mockProjectDir);
    
    // Mock child_process
    const childProcess = require('child_process');
    sandbox.stub(childProcess, 'execSync').returns('git@github.com:owner/repo.git\n');
    
    // Mock i18n
    const i18n = require('../lib/i18n');
    sandbox.stub(i18n, 'init').resolves();
    sandbox.stub(i18n, 't').returns('Test message');
    
    // Mock SetupWizard class
    const mockSetupWizardClass = sandbox.stub();
    mockSetupWizardClass.prototype.runSetup = sandbox.stub().resolves(true);
    
    // Replace the require for setup-wizard
    const Module = require('module');
    const originalRequire = Module.prototype.require;
    sandbox.stub(Module.prototype, 'require').callsFake(function(id) {
      if (id === './setup-wizard') {
        return mockSetupWizardClass;
      }
      return originalRequire.apply(this, arguments);
    });
    
    // Mock global components
    const mockGlobalConfigManager = {
      initialize: sandbox.stub().resolves()
    };
    const mockProjectRegistry = {
      initialize: sandbox.stub().resolves(),
      register: sandbox.stub().resolves('test-project-abc123'),
      getProjectByPath: sandbox.stub().returns(null)
    };
    
    sandbox.stub(require('../lib/core/global-config-manager'), 'getInstance').returns(mockGlobalConfigManager);
    sandbox.stub(require('../lib/core/project-registry'), 'getInstance').returns(mockProjectRegistry);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('execute', () => {
    it('should initialize project in current directory by default', async () => {
      const options = { lang: 'en', interactive: false };
      
      // Mock file not exists for force check
      fs.access.rejects(new Error('ENOENT'));
      
      await initCommand.execute(options);
      
      expect(fs.mkdir.called).to.be.true;
      expect(fs.writeFile.called).to.be.true;
    });

    it('should initialize project in specified directory', async () => {
      const customDir = '/custom/project/path';
      const options = { lang: 'en', interactive: false, dir: customDir };
      
      fs.access.rejects(new Error('ENOENT'));
      
      await initCommand.execute(options);
      
      // Check that mkdir was called with custom directory
      const mkdirCalls = fs.mkdir.getCalls();
      expect(mkdirCalls.some(call => 
        call.args[0].startsWith(path.resolve(customDir))
      )).to.be.true;
    });

    it('should register project with custom configuration', async () => {
      const options = {
        lang: 'en',
        interactive: false,
        description: 'Test project',
        priority: '80',
        tags: 'web,api,test',
        maxConcurrent: '5',
        cpuWeight: '2.0',
        memoryLimit: '1G'
      };
      
      fs.access.rejects(new Error('ENOENT'));
      
      const projectRegistry = require('../lib/core/project-registry').getInstance();
      
      await initCommand.execute(options);
      
      expect(projectRegistry.register.called).to.be.true;
      
      const registerCall = projectRegistry.register.getCall(0);
      const projectConfig = registerCall.args[1];
      
      expect(projectConfig.config.description).to.equal('Test project');
      expect(projectConfig.config.priority).to.equal(80);
      expect(projectConfig.config.tags).to.deep.equal(['web', 'api', 'test']);
      expect(projectConfig.config.resources.maxConcurrent).to.equal(5);
      expect(projectConfig.config.resources.cpuWeight).to.equal(2.0);
      expect(projectConfig.config.resources.memoryLimit).to.equal('1G');
    });

    it('should handle existing configuration gracefully', async () => {
      const options = { lang: 'en', interactive: false };
      
      // Mock config file exists
      fs.access.resolves();
      
      await initCommand.execute(options);
      
      // Should not create new files when config exists and no force
      expect(fs.writeFile.called).to.be.false;
    });

    it('should overwrite existing configuration with force option', async () => {
      const options = { lang: 'en', interactive: false, force: true };
      
      // Mock config file exists
      fs.access.resolves();
      
      await initCommand.execute(options);
      
      // Should create files even when config exists with force
      expect(fs.writeFile.called).to.be.true;
    });
  });

  describe('getProjectInfo', () => {
    it('should extract project information correctly', async () => {
      const projectDir = '/test/project';
      
      fs.access.withArgs(path.join(projectDir, '.git')).resolves();
      fs.access.withArgs(path.join(projectDir, 'package.json')).resolves();
      
      const info = await initCommand.getProjectInfo(projectDir);
      
      expect(info.name).to.equal('project');
      expect(info.path).to.equal(projectDir);
      expect(info.hasGit).to.be.true;
      expect(info.hasPackageJson).to.be.true;
      expect(info.gitRemote).to.deep.equal({ owner: 'owner', repo: 'repo' });
    });

    it('should handle missing Git remote gracefully', async () => {
      const projectDir = '/test/project';
      
      fs.access.withArgs(path.join(projectDir, '.git')).resolves();
      const childProcess = require('child_process');
      childProcess.execSync.throws(new Error('No remote'));
      
      const info = await initCommand.getProjectInfo(projectDir);
      
      expect(info.gitRemote).to.be.null;
    });
  });

  describe('createDirectories', () => {
    it('should create all required directories', async () => {
      const projectDir = '/test/project';
      
      await initCommand.createDirectories(projectDir);
      
      const expectedDirs = [
        path.join(projectDir, '.poppobuilder'),
        path.join(projectDir, '.poppobuilder', 'state'),
        path.join(projectDir, '.poppobuilder', 'logs'),
        path.join(projectDir, '.poppobuilder', 'data')
      ];
      
      expectedDirs.forEach(dir => {
        expect(fs.mkdir.calledWith(dir, { recursive: true })).to.be.true;
      });
    });
  });

  describe('registerProject', () => {
    it('should register project successfully', async () => {
      const projectDir = '/test/project';
      const config = {
        project: { name: 'test-project' },
        github: { owner: 'testowner', repo: 'testrepo' }
      };
      const options = {
        description: 'Test description',
        priority: '75'
      };
      
      const projectRegistry = require('../lib/core/project-registry').getInstance();
      
      const result = await initCommand.registerProject(projectDir, config, options);
      
      expect(result).to.equal('test-project-abc123');
      expect(projectRegistry.register.calledWith(projectDir)).to.be.true;
      
      const registerCall = projectRegistry.register.getCall(0);
      const projectConfig = registerCall.args[1];
      
      expect(projectConfig.config.name).to.equal('test-project');
      expect(projectConfig.config.description).to.equal('Test description');
      expect(projectConfig.config.priority).to.equal(75);
      expect(projectConfig.config.github).to.deep.equal({
        owner: 'testowner',
        repo: 'testrepo'
      });
    });

    it('should handle already registered project', async () => {
      const projectDir = '/test/project';
      const config = { project: { name: 'test-project' } };
      const options = {};
      
      const projectRegistry = require('../lib/core/project-registry').getInstance();
      projectRegistry.register.throws(new Error('Project already registered: test-project'));
      projectRegistry.getProjectByPath.returns({ id: 'existing-id' });
      
      const result = await initCommand.registerProject(projectDir, config, options);
      
      expect(result).to.be.null;
    });

    it('should handle registration failure gracefully', async () => {
      const projectDir = '/test/project';
      const config = { project: { name: 'test-project' } };
      const options = {};
      
      const projectRegistry = require('../lib/core/project-registry').getInstance();
      projectRegistry.register.throws(new Error('Some other error'));
      
      const result = await initCommand.registerProject(projectDir, config, options);
      
      expect(result).to.be.null;
    });
  });

  describe('createDefaultConfig', () => {
    it('should create valid default configuration', () => {
      const options = { lang: 'ja', agents: true };
      const projectInfo = {
        name: 'test-project',
        gitRemote: { owner: 'testowner', repo: 'testrepo' }
      };
      
      const config = initCommand.createDefaultConfig(options, projectInfo);
      
      expect(config.version).to.equal('1.0');
      expect(config.project.name).to.equal('test-project');
      expect(config.language.primary).to.equal('ja');
      expect(config.github.owner).to.equal('testowner');
      expect(config.github.repo).to.equal('testrepo');
      expect(config.features.agents).to.be.true;
    });

    it('should handle missing Git remote', () => {
      const options = { lang: 'en' };
      const projectInfo = { name: 'test-project', gitRemote: null };
      
      const config = initCommand.createDefaultConfig(options, projectInfo);
      
      expect(config.github.owner).to.equal('YOUR_GITHUB_OWNER');
      expect(config.github.repo).to.equal('YOUR_GITHUB_REPO');
    });
  });
});