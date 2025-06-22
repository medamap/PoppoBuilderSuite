/**
 * Test for poppobuilder move command
 */

const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs').promises;
const path = require('path');
const MoveCommand = require('../lib/commands/move');
const { getInstance: getProjectRegistry } = require('../lib/core/project-registry');
const prompts = require('../lib/utils/interactive-prompts');
const { execSync } = require('child_process');
const os = require('os');

describe('MoveCommand', () => {
  let moveCommand;
  let registry;
  let tempDir;
  let sandbox;
  let consoleSpy;
  
  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    moveCommand = new MoveCommand();
    registry = getProjectRegistry();
    
    // Create temp directory for tests
    tempDir = path.join(os.tmpdir(), `poppobuilder-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    
    // Mock registry
    sandbox.stub(registry, 'initialize').resolves();
    sandbox.stub(registry, 'updateProject').resolves();
    
    // Spy on console
    consoleSpy = {
      log: sandbox.spy(console, 'log'),
      error: sandbox.spy(console, 'error')
    };
    
    // Mock prompts
    sandbox.stub(prompts, 'confirm').resolves(true);
    sandbox.stub(prompts, 'close');
  });
  
  afterEach(async () => {
    sandbox.restore();
    
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });
  
  describe('Basic Move Operations', () => {
    it('should move project to new location on same device', async () => {
      const oldPath = path.join(tempDir, 'project1');
      const newPath = path.join(tempDir, 'project2');
      
      // Setup project
      await fs.mkdir(oldPath, { recursive: true });
      await fs.mkdir(path.join(oldPath, '.poppobuilder'), { recursive: true });
      await fs.writeFile(
        path.join(oldPath, '.poppobuilder', 'config.json'),
        JSON.stringify({ name: 'Test Project' })
      );
      
      const mockProject = {
        path: oldPath,
        config: { name: 'Test Project' }
      };
      
      sandbox.stub(registry, 'getProject').returns(mockProject);
      sandbox.stub(registry, 'getProjectByPath').returns(null);
      
      await moveCommand.execute('test-project', newPath, { force: true });
      
      // Verify move
      expect(await pathExists(newPath)).to.be.true;
      expect(await pathExists(oldPath)).to.be.false;
      expect(registry.updateProject.calledOnce).to.be.true;
      expect(registry.updateProject.calledWith('test-project', { path: newPath })).to.be.true;
    });
    
    it('should update configuration paths after move', async () => {
      const oldPath = path.join(tempDir, 'project1');
      const newPath = path.join(tempDir, 'project2');
      
      // Setup project with paths in config
      await fs.mkdir(oldPath, { recursive: true });
      await fs.mkdir(path.join(oldPath, '.poppobuilder'), { recursive: true });
      
      const config = {
        name: 'Test Project',
        logPath: path.join(oldPath, 'logs'),
        dataPath: path.join(oldPath, 'data')
      };
      
      await fs.writeFile(
        path.join(oldPath, '.poppobuilder', 'config.json'),
        JSON.stringify(config, null, 2)
      );
      
      const mockProject = {
        path: oldPath,
        config: config
      };
      
      sandbox.stub(registry, 'getProject').returns(mockProject);
      sandbox.stub(process, 'exit');
      
      await moveCommand.execute('test-project', newPath, { force: true });
      
      // Read updated config
      const updatedConfig = JSON.parse(
        await fs.readFile(path.join(newPath, '.poppobuilder', 'config.json'), 'utf8')
      );
      
      expect(updatedConfig.logPath).to.equal(path.join(newPath, 'logs'));
      expect(updatedConfig.dataPath).to.equal(path.join(newPath, 'data'));
    });
  });
  
  describe('Symlink Option', () => {
    it('should create symlink at old location when --symlink is used', async () => {
      const oldPath = path.join(tempDir, 'project1');
      const newPath = path.join(tempDir, 'project2');
      
      // Setup project
      await fs.mkdir(oldPath, { recursive: true });
      await fs.mkdir(path.join(oldPath, '.poppobuilder'), { recursive: true });
      await fs.writeFile(
        path.join(oldPath, '.poppobuilder', 'config.json'),
        JSON.stringify({ name: 'Test Project' })
      );
      
      const mockProject = {
        path: oldPath,
        config: { name: 'Test Project' }
      };
      
      sandbox.stub(registry, 'getProject').returns(mockProject);
      sandbox.stub(process, 'exit');
      
      await moveCommand.execute('test-project', newPath, { force: true, symlink: true });
      
      // Verify symlink
      const stats = await fs.lstat(oldPath);
      expect(stats.isSymbolicLink()).to.be.true;
      
      const linkTarget = await fs.readlink(oldPath);
      expect(linkTarget).to.equal(newPath);
    });
    
    it('should handle symlink creation failure gracefully', async () => {
      const oldPath = path.join(tempDir, 'project1');
      const newPath = path.join(tempDir, 'project2');
      
      // Setup project
      await fs.mkdir(oldPath, { recursive: true });
      await fs.mkdir(path.join(oldPath, '.poppobuilder'), { recursive: true });
      await fs.writeFile(
        path.join(oldPath, '.poppobuilder', 'config.json'),
        JSON.stringify({ name: 'Test Project' })
      );
      
      const mockProject = {
        path: oldPath,
        config: { name: 'Test Project' }
      };
      
      sandbox.stub(registry, 'getProject').returns(mockProject);
      sandbox.stub(process, 'exit');
      
      // Mock symlink to fail
      const originalSymlink = fs.symlink;
      sandbox.stub(fs, 'symlink').callsFake(async (...args) => {
        // First call (for move) should succeed
        if (args[0] === oldPath && args[1] === newPath) {
          return originalSymlink.apply(fs, args);
        }
        // Second call (creating symlink) should fail
        throw new Error('Permission denied');
      });
      
      await moveCommand.execute('test-project', newPath, { force: true, symlink: true });
      
      // Verify move succeeded even though symlink failed
      expect(await pathExists(newPath)).to.be.true;
      expect(consoleSpy.log.calledWith(sinon.match(/Warning: Could not create symlink/))).to.be.true;
    });
  });
  
  describe('Git Integration', () => {
    it('should detect uncommitted changes and prompt user', async () => {
      const oldPath = path.join(tempDir, 'project1');
      const newPath = path.join(tempDir, 'project2');
      
      // Setup git project
      await fs.mkdir(oldPath, { recursive: true });
      await fs.mkdir(path.join(oldPath, '.git'), { recursive: true });
      await fs.mkdir(path.join(oldPath, '.poppobuilder'), { recursive: true });
      await fs.writeFile(
        path.join(oldPath, '.poppobuilder', 'config.json'),
        JSON.stringify({ name: 'Test Project' })
      );
      
      const mockProject = {
        path: oldPath,
        config: { name: 'Test Project', github: true }
      };
      
      sandbox.stub(registry, 'getProject').returns(mockProject);
      sandbox.stub(moveCommand, 'checkGitStatus').resolves({
        hasChanges: true,
        changes: ['M file1.js', 'A file2.js']
      });
      
      // User confirms to proceed
      prompts.confirm.resolves(true);
      
      await moveCommand.execute('test-project', newPath, {});
      
      expect(prompts.confirm.calledOnce).to.be.true;
      expect(consoleSpy.log.calledWith(sinon.match(/Warning: Git repository has uncommitted changes/))).to.be.true;
    });
    
    it('should skip git check when --force is used', async () => {
      const oldPath = path.join(tempDir, 'project1');
      const newPath = path.join(tempDir, 'project2');
      
      // Setup git project
      await fs.mkdir(oldPath, { recursive: true });
      await fs.mkdir(path.join(oldPath, '.git'), { recursive: true });
      await fs.mkdir(path.join(oldPath, '.poppobuilder'), { recursive: true });
      await fs.writeFile(
        path.join(oldPath, '.poppobuilder', 'config.json'),
        JSON.stringify({ name: 'Test Project' })
      );
      
      const mockProject = {
        path: oldPath,
        config: { name: 'Test Project' }
      };
      
      sandbox.stub(registry, 'getProject').returns(mockProject);
      sandbox.stub(moveCommand, 'checkGitStatus').resolves({
        hasChanges: true,
        changes: ['M file1.js']
      });
      sandbox.stub(process, 'exit');
      
      await moveCommand.execute('test-project', newPath, { force: true });
      
      // Should not prompt for confirmation
      expect(prompts.confirm.notCalled).to.be.true;
    });
  });
  
  describe('Parent Directory Creation', () => {
    it('should fail if parent directory does not exist without --parents', async () => {
      const oldPath = path.join(tempDir, 'project1');
      const newPath = path.join(tempDir, 'nonexistent', 'subdir', 'project2');
      
      // Setup project
      await fs.mkdir(oldPath, { recursive: true });
      await fs.mkdir(path.join(oldPath, '.poppobuilder'), { recursive: true });
      await fs.writeFile(
        path.join(oldPath, '.poppobuilder', 'config.json'),
        JSON.stringify({ name: 'Test Project' })
      );
      
      const mockProject = {
        path: oldPath,
        config: { name: 'Test Project' }
      };
      
      sandbox.stub(registry, 'getProject').returns(mockProject);
      const exitStub = sandbox.stub(process, 'exit');
      
      await moveCommand.execute('test-project', newPath, { force: true });
      
      expect(exitStub.calledWith(1)).to.be.true;
      expect(consoleSpy.error.calledWith(sinon.match(/Parent directory does not exist/))).to.be.true;
    });
    
    it('should create parent directories with --parents option', async () => {
      const oldPath = path.join(tempDir, 'project1');
      const newPath = path.join(tempDir, 'new', 'deep', 'path', 'project2');
      
      // Setup project
      await fs.mkdir(oldPath, { recursive: true });
      await fs.mkdir(path.join(oldPath, '.poppobuilder'), { recursive: true });
      await fs.writeFile(
        path.join(oldPath, '.poppobuilder', 'config.json'),
        JSON.stringify({ name: 'Test Project' })
      );
      
      const mockProject = {
        path: oldPath,
        config: { name: 'Test Project' }
      };
      
      sandbox.stub(registry, 'getProject').returns(mockProject);
      sandbox.stub(process, 'exit');
      
      await moveCommand.execute('test-project', newPath, { force: true, parents: true });
      
      // Verify parent directories were created
      expect(await pathExists(path.dirname(newPath))).to.be.true;
      expect(await pathExists(newPath)).to.be.true;
    });
  });
  
  describe('Error Cases', () => {
    it('should fail if project is not found', async () => {
      sandbox.stub(registry, 'getProject').returns(null);
      sandbox.stub(registry, 'getProjectByPath').returns(null);
      sandbox.stub(registry, 'getAllProjects').returns({});
      const exitStub = sandbox.stub(process, 'exit');
      
      await moveCommand.execute('nonexistent-project', '/new/path');
      
      expect(exitStub.calledWith(1)).to.be.true;
      expect(consoleSpy.error.calledWith(sinon.match(/Project not found/))).to.be.true;
    });
    
    it('should fail if source and destination are the same', async () => {
      const projectPath = path.join(tempDir, 'project1');
      
      // Setup project
      await fs.mkdir(projectPath, { recursive: true });
      await fs.mkdir(path.join(projectPath, '.poppobuilder'), { recursive: true });
      await fs.writeFile(
        path.join(projectPath, '.poppobuilder', 'config.json'),
        JSON.stringify({ name: 'Test Project' })
      );
      
      const mockProject = {
        path: projectPath,
        config: { name: 'Test Project' }
      };
      
      sandbox.stub(registry, 'getProject').returns(mockProject);
      const exitStub = sandbox.stub(process, 'exit');
      
      await moveCommand.execute('test-project', projectPath, { force: true });
      
      expect(exitStub.calledWith(1)).to.be.true;
      expect(consoleSpy.error.calledWith(sinon.match(/Source and destination paths are the same/))).to.be.true;
    });
    
    it('should fail if target already exists without --merge', async () => {
      const oldPath = path.join(tempDir, 'project1');
      const newPath = path.join(tempDir, 'project2');
      
      // Setup both directories
      await fs.mkdir(oldPath, { recursive: true });
      await fs.mkdir(newPath, { recursive: true });
      await fs.mkdir(path.join(oldPath, '.poppobuilder'), { recursive: true });
      await fs.writeFile(
        path.join(oldPath, '.poppobuilder', 'config.json'),
        JSON.stringify({ name: 'Test Project' })
      );
      
      const mockProject = {
        path: oldPath,
        config: { name: 'Test Project' }
      };
      
      sandbox.stub(registry, 'getProject').returns(mockProject);
      const exitStub = sandbox.stub(process, 'exit');
      
      await moveCommand.execute('test-project', newPath, { force: true });
      
      expect(exitStub.calledWith(1)).to.be.true;
      expect(consoleSpy.error.calledWith(sinon.match(/Target path already exists/))).to.be.true;
    });
    
    it('should fail if target contains a PoppoBuilder project', async () => {
      const oldPath = path.join(tempDir, 'project1');
      const newPath = path.join(tempDir, 'project2');
      
      // Setup both projects
      for (const projectPath of [oldPath, newPath]) {
        await fs.mkdir(projectPath, { recursive: true });
        await fs.mkdir(path.join(projectPath, '.poppobuilder'), { recursive: true });
        await fs.writeFile(
          path.join(projectPath, '.poppobuilder', 'config.json'),
          JSON.stringify({ name: 'Test Project' })
        );
      }
      
      const mockProject = {
        path: oldPath,
        config: { name: 'Test Project' }
      };
      
      sandbox.stub(registry, 'getProject').returns(mockProject);
      const exitStub = sandbox.stub(process, 'exit');
      
      await moveCommand.execute('test-project', newPath, { force: true, merge: true });
      
      expect(exitStub.calledWith(1)).to.be.true;
      expect(consoleSpy.error.calledWith(sinon.match(/already contains a PoppoBuilder project/))).to.be.true;
    });
    
    it('should fail if there are running tasks', async () => {
      const oldPath = path.join(tempDir, 'project1');
      const newPath = path.join(tempDir, 'project2');
      
      // Setup project
      await fs.mkdir(oldPath, { recursive: true });
      await fs.mkdir(path.join(oldPath, '.poppobuilder'), { recursive: true });
      await fs.writeFile(
        path.join(oldPath, '.poppobuilder', 'config.json'),
        JSON.stringify({ name: 'Test Project' })
      );
      
      const mockProject = {
        path: oldPath,
        config: { name: 'Test Project' }
      };
      
      sandbox.stub(registry, 'getProject').returns(mockProject);
      sandbox.stub(moveCommand, 'checkRunningTasks').resolves([
        { id: 'task1', name: 'Running task' }
      ]);
      const exitStub = sandbox.stub(process, 'exit');
      
      await moveCommand.execute('test-project', newPath, { force: true });
      
      expect(exitStub.calledWith(1)).to.be.true;
      expect(consoleSpy.error.calledWith(sinon.match(/Cannot move project with 1 running tasks/))).to.be.true;
    });
  });
  
  describe('Cross-Device Move', () => {
    it('should handle cross-device move by copying files', async () => {
      const oldPath = path.join(tempDir, 'project1');
      const newPath = path.join(tempDir, 'project2');
      
      // Setup project
      await fs.mkdir(oldPath, { recursive: true });
      await fs.mkdir(path.join(oldPath, '.poppobuilder'), { recursive: true });
      await fs.writeFile(
        path.join(oldPath, '.poppobuilder', 'config.json'),
        JSON.stringify({ name: 'Test Project' })
      );
      await fs.writeFile(path.join(oldPath, 'test.txt'), 'test content');
      
      const mockProject = {
        path: oldPath,
        config: { name: 'Test Project' }
      };
      
      sandbox.stub(registry, 'getProject').returns(mockProject);
      
      // Mock fs.rename to throw EXDEV error
      const originalRename = fs.rename;
      sandbox.stub(fs, 'rename').callsFake(async () => {
        const error = new Error('Cross-device link');
        error.code = 'EXDEV';
        throw error;
      });
      
      // Mock copy and remove operations
      sandbox.stub(moveCommand, 'copyDirectory').resolves();
      sandbox.stub(moveCommand, 'removeDirectory').resolves();
      sandbox.stub(process, 'exit');
      
      await moveCommand.execute('test-project', newPath, { force: true });
      
      expect(moveCommand.copyDirectory.calledOnce).to.be.true;
      expect(moveCommand.copyDirectory.calledWith(oldPath, newPath)).to.be.true;
      expect(moveCommand.removeDirectory.calledOnce).to.be.true;
      expect(moveCommand.removeDirectory.calledWith(oldPath)).to.be.true;
      expect(consoleSpy.log.calledWith(sinon.match(/Cross-device move detected/))).to.be.true;
    });
  });
  
  describe('Rollback on Error', () => {
    it('should attempt rollback if move fails after rename', async () => {
      const oldPath = path.join(tempDir, 'project1');
      const newPath = path.join(tempDir, 'project2');
      
      // Setup project
      await fs.mkdir(oldPath, { recursive: true });
      await fs.mkdir(path.join(oldPath, '.poppobuilder'), { recursive: true });
      await fs.writeFile(
        path.join(oldPath, '.poppobuilder', 'config.json'),
        JSON.stringify({ name: 'Test Project' })
      );
      
      const mockProject = {
        path: oldPath,
        config: { name: 'Test Project' }
      };
      
      sandbox.stub(registry, 'getProject').returns(mockProject);
      
      // Make updateProject fail after rename
      let renameCount = 0;
      const originalRename = fs.rename;
      sandbox.stub(fs, 'rename').callsFake(async (...args) => {
        renameCount++;
        if (renameCount === 1) {
          // First rename (actual move) succeeds
          return originalRename.apply(fs, args);
        } else {
          // Second rename (rollback) succeeds
          return originalRename.apply(fs, args);
        }
      });
      
      registry.updateProject.rejects(new Error('Registry update failed'));
      const exitStub = sandbox.stub(process, 'exit');
      
      await moveCommand.execute('test-project', newPath, { force: true });
      
      // Verify rollback was attempted
      expect(renameCount).to.equal(2);
      expect(await pathExists(oldPath)).to.be.true;
      expect(await pathExists(newPath)).to.be.false;
      expect(consoleSpy.log.calledWith(sinon.match(/Attempting to rollback/))).to.be.true;
      expect(consoleSpy.log.calledWith(sinon.match(/Rollback successful/))).to.be.true;
    });
  });
  
  describe('Project Suggestions', () => {
    it('should suggest similar projects when project not found', async () => {
      sandbox.stub(registry, 'getProject').returns(null);
      sandbox.stub(registry, 'getProjectByPath').returns(null);
      sandbox.stub(registry, 'getAllProjects').returns({
        'test-project-1': { config: { name: 'Test Project 1' }, path: '/path/to/test1' },
        'test-project-2': { config: { name: 'Test Project 2' }, path: '/path/to/test2' },
        'other-project': { config: { name: 'Other Project' }, path: '/path/to/other' }
      });
      const exitStub = sandbox.stub(process, 'exit');
      
      await moveCommand.execute('test-proj', '/new/path');
      
      expect(exitStub.calledWith(1)).to.be.true;
      expect(consoleSpy.log.calledWith(sinon.match(/Did you mean one of these/))).to.be.true;
      expect(consoleSpy.log.calledWith(sinon.match(/test-project-1/))).to.be.true;
      expect(consoleSpy.log.calledWith(sinon.match(/test-project-2/))).to.be.true;
    });
  });
});

// Helper function
async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}