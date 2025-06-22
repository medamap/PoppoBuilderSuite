/**
 * Init Command Simple Tests
 */

const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');

describe('InitCommand Simple Tests', () => {
  let InitCommand;
  let initCommand;
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    InitCommand = require('../lib/commands/init');
    initCommand = new InitCommand();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('constructor', () => {
    it('should initialize with correct default values', () => {
      expect(initCommand.configDir).to.equal('.poppobuilder');
      expect(initCommand.configFile).to.equal('config.json');
      expect(initCommand.stateDir).to.equal('state');
      expect(initCommand.logsDir).to.equal('logs');
    });
  });

  describe('fileExists', () => {
    it('should return true for existing file', async () => {
      const fs = require('fs').promises;
      sandbox.stub(fs, 'access').resolves();
      
      const result = await initCommand.fileExists('/some/file');
      expect(result).to.be.true;
    });

    it('should return false for non-existing file', async () => {
      const fs = require('fs').promises;
      sandbox.stub(fs, 'access').rejects(new Error('ENOENT'));
      
      const result = await initCommand.fileExists('/some/file');
      expect(result).to.be.false;
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
      expect(config.claude.enabled).to.be.true;
      expect(config.monitoring.enabled).to.be.true;
    });

    it('should handle missing Git remote', () => {
      const options = { lang: 'en' };
      const projectInfo = { name: 'test-project', gitRemote: null };
      
      const config = initCommand.createDefaultConfig(options, projectInfo);
      
      expect(config.github.owner).to.equal('YOUR_GITHUB_OWNER');
      expect(config.github.repo).to.equal('YOUR_GITHUB_REPO');
    });

    it('should handle agents disabled', () => {
      const options = { lang: 'en', agents: false };
      const projectInfo = { name: 'test-project' };
      
      const config = initCommand.createDefaultConfig(options, projectInfo);
      
      expect(config.features.agents).to.be.false;
    });

    it('should include correct task labels', () => {
      const options = { lang: 'en' };
      const projectInfo = { name: 'test-project' };
      
      const config = initCommand.createDefaultConfig(options, projectInfo);
      
      expect(config.tasks.labels).to.deep.equal([
        'task:misc', 'task:dogfooding', 'task:bug', 'task:feature', 'task:docs'
      ]);
      expect(config.tasks.priorityLabels).to.have.property('high');
      expect(config.tasks.priorityLabels).to.have.property('medium');
      expect(config.tasks.priorityLabels).to.have.property('low');
    });
  });

  describe('getProjectInfo', () => {
    it('should extract project name from directory', async () => {
      const projectDir = '/test/my-awesome-project';
      const fs = require('fs').promises;
      
      // Mock file system calls
      sandbox.stub(fs, 'access').rejects(new Error('ENOENT'));
      
      const info = await initCommand.getProjectInfo(projectDir);
      
      expect(info.name).to.equal('my-awesome-project');
      expect(info.path).to.equal(projectDir);
      expect(info.hasGit).to.be.false;
      expect(info.hasPackageJson).to.be.false;
      expect(info.gitRemote).to.be.null;
    });

    it('should detect Git and package.json', async () => {
      const projectDir = '/test/project';
      const fs = require('fs').promises;
      
      // Mock Git directory exists, package.json exists
      sandbox.stub(fs, 'access').callsFake((filePath) => {
        if (filePath.endsWith('.git') || filePath.endsWith('package.json')) {
          return Promise.resolve();
        }
        return Promise.reject(new Error('ENOENT'));
      });
      
      // Mock Git remote
      const childProcess = require('child_process');
      sandbox.stub(childProcess, 'execSync').returns('git@github.com:owner/repo.git\n');
      
      const info = await initCommand.getProjectInfo(projectDir);
      
      expect(info.hasGit).to.be.true;
      expect(info.hasPackageJson).to.be.true;
      expect(info.gitRemote).to.deep.equal({ owner: 'owner', repo: 'repo' });
    });

    it('should handle Git remote parsing for HTTPS URLs', async () => {
      const projectDir = '/test/project';
      const fs = require('fs').promises;
      
      sandbox.stub(fs, 'access').callsFake((filePath) => {
        if (filePath.endsWith('.git')) {
          return Promise.resolve();
        }
        return Promise.reject(new Error('ENOENT'));
      });
      
      const childProcess = require('child_process');
      sandbox.stub(childProcess, 'execSync').returns('https://github.com/owner/repo.git\n');
      
      const info = await initCommand.getProjectInfo(projectDir);
      
      expect(info.gitRemote).to.deep.equal({ owner: 'owner', repo: 'repo' });
    });

    it('should handle invalid Git remote URLs', async () => {
      const projectDir = '/test/project';
      const fs = require('fs').promises;
      
      sandbox.stub(fs, 'access').callsFake((filePath) => {
        if (filePath.endsWith('.git')) {
          return Promise.resolve();
        }
        return Promise.reject(new Error('ENOENT'));
      });
      
      const childProcess = require('child_process');
      sandbox.stub(childProcess, 'execSync').returns('invalid-url\n');
      
      const info = await initCommand.getProjectInfo(projectDir);
      
      expect(info.gitRemote).to.be.null;
    });

    it('should handle Git command failure', async () => {
      const projectDir = '/test/project';
      const fs = require('fs').promises;
      
      sandbox.stub(fs, 'access').callsFake((filePath) => {
        if (filePath.endsWith('.git')) {
          return Promise.resolve();
        }
        return Promise.reject(new Error('ENOENT'));
      });
      
      const childProcess = require('child_process');
      sandbox.stub(childProcess, 'execSync').throws(new Error('Git command failed'));
      
      const info = await initCommand.getProjectInfo(projectDir);
      
      expect(info.gitRemote).to.be.null;
    });
  });

  describe('integration test components', () => {
    it('should have the correct methods for integration', () => {
      expect(initCommand.initializeGlobalComponents).to.be.a('function');
      expect(initCommand.registerProject).to.be.a('function');
      expect(initCommand.createDirectories).to.be.a('function');
      expect(initCommand.saveConfig).to.be.a('function');
      expect(initCommand.updateGitignore).to.be.a('function');
    });
  });
});