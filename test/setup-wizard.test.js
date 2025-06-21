/**
 * SetupWizard Tests
 */

const { expect } = require('chai');
const sinon = require('sinon');
const childProcess = require('child_process');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

describe('SetupWizard', () => {
  let SetupWizard;
  let setupWizard;
  let sandbox;
  let execSyncStub;
  let spawnStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    
    // Mock child_process
    execSyncStub = sandbox.stub(childProcess, 'execSync');
    spawnStub = sandbox.stub(childProcess, 'spawn');
    
    // Mock fs operations
    sandbox.stub(fs, 'access').resolves();
    sandbox.stub(fs, 'writeFile').resolves();
    sandbox.stub(fs, 'unlink').resolves();
    
    // Load SetupWizard after mocks are in place
    delete require.cache[require.resolve('../lib/commands/setup-wizard')];
    SetupWizard = require('../lib/commands/setup-wizard');
    setupWizard = new SetupWizard();
    
    // Mock console methods
    sandbox.stub(console, 'log');
    sandbox.stub(console, 'error');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('checkClaudeAvailability', () => {
    it('should detect Claude CLI when available', async () => {
      execSyncStub.withArgs('claude --version', { stdio: 'ignore' }).returns();
      
      await setupWizard.checkClaudeAvailability();
      
      expect(setupWizard.claudeAvailable).to.be.true;
    });

    it('should handle Claude CLI not being available', async () => {
      execSyncStub.withArgs('claude --version', { stdio: 'ignore' }).throws(new Error('command not found'));
      
      await setupWizard.checkClaudeAvailability();
      
      expect(setupWizard.claudeAvailable).to.be.false;
    });
  });

  describe('validateGitSetup', () => {
    it('should return true when git repo with remote exists', async () => {
      fs.access.resolves();
      execSyncStub.withArgs('git remote', { encoding: 'utf8' }).returns('origin\n');
      
      const result = await setupWizard.validateGitSetup();
      
      expect(result).to.be.true;
    });

    it('should return false when .git directory does not exist', async () => {
      fs.access.rejects(new Error('ENOENT'));
      
      const result = await setupWizard.validateGitSetup();
      
      expect(result).to.be.false;
    });

    it('should return false when no remote configured', async () => {
      fs.access.resolves();
      execSyncStub.withArgs('git remote', { encoding: 'utf8' }).returns('');
      
      const result = await setupWizard.validateGitSetup();
      
      expect(result).to.be.false;
    });
  });

  describe('validateGhSetup', () => {
    it('should return true when gh is installed and authenticated', async () => {
      execSyncStub.withArgs('gh --version', { stdio: 'ignore' }).returns();
      execSyncStub.withArgs('gh auth status', { stdio: 'ignore' }).returns();
      
      const result = await setupWizard.validateGhSetup();
      
      expect(result).to.be.true;
    });

    it('should return false when gh is not installed', async () => {
      execSyncStub.withArgs('gh --version', { stdio: 'ignore' }).throws(new Error('command not found'));
      
      const result = await setupWizard.validateGhSetup();
      
      expect(result).to.be.false;
    });

    it('should return false when gh is not authenticated', async () => {
      execSyncStub.withArgs('gh --version', { stdio: 'ignore' }).returns();
      execSyncStub.withArgs('gh auth status', { stdio: 'ignore' }).throws(new Error('not authenticated'));
      
      const result = await setupWizard.validateGhSetup();
      
      expect(result).to.be.false;
    });
  });

  describe('validateBranchSetup', () => {
    it('should return true when on work/poppo-builder branch', async () => {
      execSyncStub.withArgs('git branch --show-current', { encoding: 'utf8' }).returns('work/poppo-builder\n');
      execSyncStub.withArgs('git branch -a', { encoding: 'utf8' }).returns('* work/poppo-builder\n  main\n');
      
      const result = await setupWizard.validateBranchSetup();
      
      expect(result).to.be.true;
    });

    it('should return true when work/poppo-builder branch exists', async () => {
      execSyncStub.withArgs('git branch --show-current', { encoding: 'utf8' }).returns('main\n');
      execSyncStub.withArgs('git branch -a', { encoding: 'utf8' }).returns('  work/poppo-builder\n* main\n');
      
      const result = await setupWizard.validateBranchSetup();
      
      expect(result).to.be.true;
    });

    it('should return false when work/poppo-builder branch does not exist', async () => {
      execSyncStub.withArgs('git branch --show-current', { encoding: 'utf8' }).returns('main\n');
      execSyncStub.withArgs('git branch -a', { encoding: 'utf8' }).returns('* main\n  develop\n');
      
      const result = await setupWizard.validateBranchSetup();
      
      expect(result).to.be.false;
    });
  });

  describe('autoFixGitSetup', () => {
    it('should initialize git repo if not exists', async () => {
      sandbox.stub(setupWizard, 'fileExists').resolves(false);
      execSyncStub.withArgs('git init', { stdio: 'inherit' }).returns();
      execSyncStub.withArgs('git remote', { encoding: 'utf8' }).returns('origin\n');
      
      const result = await setupWizard.autoFixGitSetup();
      
      expect(result).to.be.true;
      expect(execSyncStub.calledWith('git init')).to.be.true;
    });

    it('should return false if no remote configured', async () => {
      sandbox.stub(setupWizard, 'fileExists').resolves(true);
      execSyncStub.withArgs('git remote', { encoding: 'utf8' }).returns('');
      
      const result = await setupWizard.autoFixGitSetup();
      
      expect(result).to.be.false;
    });
  });

  describe('autoFixBranchSetup', () => {
    it('should switch to existing work/poppo-builder branch', async () => {
      execSyncStub.withArgs('git branch --show-current', { encoding: 'utf8' }).returns('main\n');
      execSyncStub.withArgs('git branch -a', { encoding: 'utf8' }).returns('  work/poppo-builder\n* main\n');
      execSyncStub.withArgs('git checkout work/poppo-builder', { stdio: 'inherit' }).returns();
      
      const result = await setupWizard.autoFixBranchSetup();
      
      expect(result).to.be.true;
      expect(execSyncStub.calledWith('git checkout work/poppo-builder')).to.be.true;
    });

    it('should create new work/poppo-builder branch', async () => {
      execSyncStub.withArgs('git branch --show-current', { encoding: 'utf8' }).returns('main\n');
      execSyncStub.withArgs('git branch -a', { encoding: 'utf8' }).returns('* main\n');
      execSyncStub.withArgs('git checkout -b work/poppo-builder main', { stdio: 'inherit' }).returns();
      execSyncStub.withArgs('git push -u origin work/poppo-builder', { stdio: 'inherit' }).returns();
      
      const result = await setupWizard.autoFixBranchSetup();
      
      expect(result).to.be.true;
      expect(execSyncStub.calledWith('git checkout -b work/poppo-builder main')).to.be.true;
    });

    it('should handle branch creation from master if main does not exist', async () => {
      execSyncStub.withArgs('git branch --show-current', { encoding: 'utf8' }).returns('master\n');
      execSyncStub.withArgs('git branch -a', { encoding: 'utf8' }).returns('* master\n');
      execSyncStub.withArgs('git checkout -b work/poppo-builder main', { stdio: 'inherit' }).throws(new Error('no main'));
      execSyncStub.withArgs('git checkout -b work/poppo-builder master', { stdio: 'inherit' }).returns();
      execSyncStub.withArgs('git push -u origin work/poppo-builder', { stdio: 'inherit' }).returns();
      
      const result = await setupWizard.autoFixBranchSetup();
      
      expect(result).to.be.true;
      expect(execSyncStub.calledWith('git checkout -b work/poppo-builder master')).to.be.true;
    });
  });

  describe('checkSystemDependencies', () => {
    it('should check all required dependencies', async () => {
      execSyncStub.withArgs('node --version', { encoding: 'utf8' }).returns('v16.14.0\n');
      execSyncStub.withArgs('npm --version', { encoding: 'utf8' }).returns('8.3.0\n');
      execSyncStub.withArgs('git --version', { encoding: 'utf8' }).returns('git version 2.30.0\n');
      execSyncStub.withArgs('yarn --version', { encoding: 'utf8' }).returns('1.22.0\n');
      
      const result = await setupWizard.checkSystemDependencies();
      
      expect(result.allPassed).to.be.true;
      expect(result.results).to.have.lengthOf(3);
      expect(result.results[0].name).to.equal('Node.js');
      expect(result.results[0].installed).to.be.true;
      expect(result.results[0].isValid).to.be.true;
    });

    it('should detect missing dependencies', async () => {
      execSyncStub.withArgs('node --version', { encoding: 'utf8' }).throws(new Error('command not found'));
      execSyncStub.withArgs('npm --version', { encoding: 'utf8' }).returns('8.3.0\n');
      execSyncStub.withArgs('git --version', { encoding: 'utf8' }).returns('git version 2.30.0\n');
      
      const result = await setupWizard.checkSystemDependencies();
      
      expect(result.allPassed).to.be.false;
      expect(result.results[0].installed).to.be.false;
    });

    it('should detect outdated versions', async () => {
      execSyncStub.withArgs('node --version', { encoding: 'utf8' }).returns('v12.0.0\n');
      execSyncStub.withArgs('npm --version', { encoding: 'utf8' }).returns('5.0.0\n');
      execSyncStub.withArgs('git --version', { encoding: 'utf8' }).returns('git version 1.9.0\n');
      
      const result = await setupWizard.checkSystemDependencies();
      
      expect(result.allPassed).to.be.false;
      expect(result.results[0].isValid).to.be.false;
      expect(result.results[1].isValid).to.be.false;
      expect(result.results[2].isValid).to.be.false;
    });
  });

  describe('compareVersions', () => {
    it('should correctly compare versions', () => {
      expect(setupWizard.compareVersions('14.0.0', '14.0.0')).to.equal(0);
      expect(setupWizard.compareVersions('16.0.0', '14.0.0')).to.equal(1);
      expect(setupWizard.compareVersions('12.0.0', '14.0.0')).to.equal(-1);
      expect(setupWizard.compareVersions('14.1.0', '14.0.0')).to.equal(1);
      expect(setupWizard.compareVersions('14.0.1', '14.0.0')).to.equal(1);
      expect(setupWizard.compareVersions('14.0.0', '14.0.1')).to.equal(-1);
    });

    it('should handle different version formats', () => {
      expect(setupWizard.compareVersions('14', '14.0.0')).to.equal(0);
      expect(setupWizard.compareVersions('14.1', '14.0.0')).to.equal(1);
      expect(setupWizard.compareVersions('14.0.0', '14')).to.equal(0);
    });
  });

  describe('validateDependencies', () => {
    it('should return true when all dependencies are valid', async () => {
      sandbox.stub(setupWizard, 'checkSystemDependencies').resolves({ allPassed: true });
      
      const result = await setupWizard.validateDependencies();
      
      expect(result).to.be.true;
    });

    it('should return false when dependencies are missing or outdated', async () => {
      sandbox.stub(setupWizard, 'checkSystemDependencies').resolves({ allPassed: false });
      
      const result = await setupWizard.validateDependencies();
      
      expect(result).to.be.false;
    });
  });

  describe('showManualInstructions', () => {
    it('should display dependency instructions', async () => {
      await setupWizard.showManualInstructions({ name: 'dependencies' });
      
      expect(console.log.called).to.be.true;
      expect(console.log.calledWithMatch('Node.js')).to.be.true;
      expect(console.log.calledWithMatch('npm')).to.be.true;
      expect(console.log.calledWithMatch('Claude CLI')).to.be.true;
      expect(console.log.calledWithMatch('Git')).to.be.true;
    });

    it('should display git-check instructions', async () => {
      await setupWizard.showManualInstructions({ name: 'git-check' });
      
      expect(console.log.called).to.be.true;
      expect(console.log.calledWithMatch('git status')).to.be.true;
      expect(console.log.calledWithMatch('git init')).to.be.true;
    });

    it('should display gh-setup instructions', async () => {
      await setupWizard.showManualInstructions({ name: 'gh-setup' });
      
      expect(console.log.called).to.be.true;
      expect(console.log.calledWithMatch('brew install gh')).to.be.true;
      expect(console.log.calledWithMatch('gh auth login')).to.be.true;
    });

    it('should display branch-setup instructions', async () => {
      await setupWizard.showManualInstructions({ name: 'branch-setup' });
      
      expect(console.log.called).to.be.true;
      expect(console.log.calledWithMatch('git checkout -b work/poppo-builder')).to.be.true;
      expect(console.log.calledWithMatch('git push -u origin work/poppo-builder')).to.be.true;
    });
  });

  describe('runClaudeGuide', () => {
    it('should create temp file and spawn claude process', async () => {
      const mockProcess = {
        on: sandbox.stub(),
        stdin: { write: sandbox.stub(), end: sandbox.stub() }
      };
      
      spawnStub.returns(mockProcess);
      mockProcess.on.withArgs('exit').callsArgWith(1, 0);
      
      const tmpFile = path.join(os.tmpdir(), 'poppobuilder-setup-test.txt');
      sandbox.stub(path, 'join').returns(tmpFile);
      
      const result = await setupWizard.runClaudeGuide('test prompt');
      
      expect(result).to.be.true;
      expect(fs.writeFile.calledWith(tmpFile, 'test prompt', 'utf8')).to.be.true;
      expect(fs.unlink.calledWith(tmpFile)).to.be.true;
    });

    it('should handle claude process errors', async () => {
      const mockProcess = {
        on: sandbox.stub()
      };
      
      spawnStub.returns(mockProcess);
      mockProcess.on.withArgs('error').callsArgWith(1, new Error('spawn error'));
      mockProcess.on.withArgs('exit').callsArgWith(1, 1);
      
      const result = await setupWizard.runClaudeGuide('test prompt');
      
      expect(result).to.be.false;
    });
  });
});