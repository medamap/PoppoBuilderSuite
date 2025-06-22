/**
 * Integration test for poppobuilder move command
 */

const { expect } = require('chai');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { execSync } = require('child_process');
const MoveCommand = require('../../lib/commands/move');
const { getInstance: getProjectRegistry } = require('../../lib/core/project-registry');

describe('Move Command Integration Tests', () => {
  let tempDir;
  let testProjectPath;
  let moveCommand;
  let registry;
  
  before(async () => {
    // Create temp directory for all tests
    tempDir = path.join(os.tmpdir(), `poppobuilder-integration-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    
    moveCommand = new MoveCommand();
    registry = getProjectRegistry();
  });
  
  after(async () => {
    // Clean up
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (err) {
      console.error('Failed to clean up temp directory:', err);
    }
  });
  
  beforeEach(async () => {
    // Create a test project for each test
    testProjectPath = path.join(tempDir, `test-project-${Date.now()}`);
    await createTestProject(testProjectPath);
  });
  
  describe('Real File System Operations', () => {
    it('should move a complete project structure', async function() {
      this.timeout(10000);
      
      const newPath = path.join(tempDir, `moved-project-${Date.now()}`);
      
      // Create additional files and directories
      await fs.mkdir(path.join(testProjectPath, 'src'), { recursive: true });
      await fs.mkdir(path.join(testProjectPath, 'logs'), { recursive: true });
      await fs.writeFile(path.join(testProjectPath, 'src', 'index.js'), 'console.log("Hello");');
      await fs.writeFile(path.join(testProjectPath, 'logs', 'app.log'), 'Log entry');
      await fs.writeFile(path.join(testProjectPath, 'README.md'), '# Test Project');
      
      // Initialize registry with the test project
      await registry.initialize();
      await registry.registerProject({
        path: testProjectPath,
        config: {
          name: 'Integration Test Project',
          version: '1.0.0'
        }
      });
      
      const projectId = registry.getProjectByPath(testProjectPath).id;
      
      // Execute move
      await moveCommand.execute(projectId, newPath, { force: true });
      
      // Verify all files were moved
      expect(await pathExists(newPath)).to.be.true;
      expect(await pathExists(path.join(newPath, 'src', 'index.js'))).to.be.true;
      expect(await pathExists(path.join(newPath, 'logs', 'app.log'))).to.be.true;
      expect(await pathExists(path.join(newPath, 'README.md'))).to.be.true;
      expect(await pathExists(path.join(newPath, '.poppobuilder', 'config.json'))).to.be.true;
      
      // Verify old location is gone
      expect(await pathExists(testProjectPath)).to.be.false;
      
      // Verify registry was updated
      const movedProject = registry.getProject(projectId);
      expect(movedProject.path).to.equal(newPath);
    });
    
    it('should handle nested directory structures', async function() {
      this.timeout(10000);
      
      const newPath = path.join(tempDir, 'deeply', 'nested', 'project', 'location');
      
      // Create deeply nested structure
      const deepPath = path.join(testProjectPath, 'a', 'b', 'c', 'd', 'e');
      await fs.mkdir(deepPath, { recursive: true });
      await fs.writeFile(path.join(deepPath, 'deep.txt'), 'Deep file content');
      
      // Initialize registry
      await registry.initialize();
      await registry.registerProject({
        path: testProjectPath,
        config: { name: 'Deep Project' }
      });
      
      const projectId = registry.getProjectByPath(testProjectPath).id;
      
      // Execute move with parent creation
      await moveCommand.execute(projectId, newPath, { force: true, parents: true });
      
      // Verify deep structure was preserved
      const movedDeepFile = path.join(newPath, 'a', 'b', 'c', 'd', 'e', 'deep.txt');
      expect(await pathExists(movedDeepFile)).to.be.true;
      
      const content = await fs.readFile(movedDeepFile, 'utf8');
      expect(content).to.equal('Deep file content');
    });
  });
  
  describe('Git Repository Handling', () => {
    it('should handle git repository move', async function() {
      this.timeout(10000);
      
      // Skip if git is not available
      try {
        execSync('git --version', { stdio: 'ignore' });
      } catch {
        this.skip();
      }
      
      const newPath = path.join(tempDir, `git-moved-${Date.now()}`);
      
      // Initialize git repository
      execSync('git init', { cwd: testProjectPath, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: testProjectPath, stdio: 'ignore' });
      execSync('git config user.name "Test User"', { cwd: testProjectPath, stdio: 'ignore' });
      
      // Add and commit files
      await fs.writeFile(path.join(testProjectPath, 'test.js'), 'console.log("test");');
      execSync('git add .', { cwd: testProjectPath, stdio: 'ignore' });
      execSync('git commit -m "Initial commit"', { cwd: testProjectPath, stdio: 'ignore' });
      
      // Initialize registry
      await registry.initialize();
      await registry.registerProject({
        path: testProjectPath,
        config: { name: 'Git Project', github: true }
      });
      
      const projectId = registry.getProjectByPath(testProjectPath).id;
      
      // Execute move
      await moveCommand.execute(projectId, newPath, { force: true });
      
      // Verify git repository was moved correctly
      expect(await pathExists(path.join(newPath, '.git'))).to.be.true;
      
      // Verify git still works in new location
      const gitStatus = execSync('git status --porcelain', {
        cwd: newPath,
        encoding: 'utf8'
      }).trim();
      
      expect(gitStatus).to.equal(''); // No changes
    });
  });
  
  describe('Symlink Functionality', () => {
    it('should create working symlink', async function() {
      this.timeout(10000);
      
      // Skip on Windows if not admin
      if (process.platform === 'win32') {
        try {
          execSync('net session', { stdio: 'ignore' });
        } catch {
          this.skip();
        }
      }
      
      const newPath = path.join(tempDir, `symlink-test-${Date.now()}`);
      
      // Create test file
      await fs.writeFile(path.join(testProjectPath, 'data.txt'), 'Test data');
      
      // Initialize registry
      await registry.initialize();
      await registry.registerProject({
        path: testProjectPath,
        config: { name: 'Symlink Project' }
      });
      
      const projectId = registry.getProjectByPath(testProjectPath).id;
      
      // Execute move with symlink
      await moveCommand.execute(projectId, newPath, { force: true, symlink: true });
      
      // Verify symlink works
      const dataViaSymlink = await fs.readFile(
        path.join(testProjectPath, 'data.txt'),
        'utf8'
      );
      expect(dataViaSymlink).to.equal('Test data');
      
      // Verify it's actually a symlink
      const stats = await fs.lstat(testProjectPath);
      expect(stats.isSymbolicLink()).to.be.true;
    });
  });
  
  describe('Permission and Access Tests', () => {
    it('should preserve file permissions', async function() {
      this.timeout(10000);
      
      // Skip on Windows
      if (process.platform === 'win32') {
        this.skip();
      }
      
      const newPath = path.join(tempDir, `permissions-test-${Date.now()}`);
      
      // Create file with specific permissions
      const scriptPath = path.join(testProjectPath, 'script.sh');
      await fs.writeFile(scriptPath, '#!/bin/bash\necho "Hello"');
      await fs.chmod(scriptPath, 0o755); // Make executable
      
      // Initialize registry
      await registry.initialize();
      await registry.registerProject({
        path: testProjectPath,
        config: { name: 'Permissions Project' }
      });
      
      const projectId = registry.getProjectByPath(testProjectPath).id;
      
      // Execute move
      await moveCommand.execute(projectId, newPath, { force: true });
      
      // Check permissions were preserved
      const movedScriptPath = path.join(newPath, 'script.sh');
      const stats = await fs.stat(movedScriptPath);
      const mode = stats.mode & 0o777;
      
      expect(mode).to.equal(0o755);
    });
  });
  
  describe('Large File Handling', () => {
    it('should handle projects with large files', async function() {
      this.timeout(30000); // Longer timeout for large file operations
      
      const newPath = path.join(tempDir, `large-file-test-${Date.now()}`);
      
      // Create a moderately large file (10MB)
      const largeFilePath = path.join(testProjectPath, 'large.data');
      const size = 10 * 1024 * 1024; // 10MB
      const buffer = Buffer.alloc(size, 'x');
      await fs.writeFile(largeFilePath, buffer);
      
      // Initialize registry
      await registry.initialize();
      await registry.registerProject({
        path: testProjectPath,
        config: { name: 'Large File Project' }
      });
      
      const projectId = registry.getProjectByPath(testProjectPath).id;
      
      // Execute move
      await moveCommand.execute(projectId, newPath, { force: true });
      
      // Verify large file was moved correctly
      const movedFilePath = path.join(newPath, 'large.data');
      const stats = await fs.stat(movedFilePath);
      expect(stats.size).to.equal(size);
    });
  });
  
  describe('Error Recovery', () => {
    it('should handle move interruption gracefully', async function() {
      this.timeout(10000);
      
      const newPath = path.join(tempDir, `recovery-test-${Date.now()}`);
      
      // Initialize registry
      await registry.initialize();
      await registry.registerProject({
        path: testProjectPath,
        config: { name: 'Recovery Test Project' }
      });
      
      const projectId = registry.getProjectByPath(testProjectPath).id;
      
      // Create a file that will be locked (simulating interruption)
      const lockFile = path.join(testProjectPath, '.lock');
      await fs.writeFile(lockFile, 'locked');
      
      // Make the registry update fail to simulate error
      const originalUpdate = registry.updateProject;
      let updateCalled = false;
      registry.updateProject = async () => {
        updateCalled = true;
        throw new Error('Simulated failure');
      };
      
      try {
        await moveCommand.execute(projectId, newPath, { force: true });
      } catch (error) {
        // Expected to fail
      }
      
      // Restore original method
      registry.updateProject = originalUpdate;
      
      // Verify project is still in original location if update failed
      if (updateCalled) {
        expect(await pathExists(testProjectPath)).to.be.true;
        expect(await pathExists(path.join(testProjectPath, '.poppobuilder', 'config.json'))).to.be.true;
      }
    });
  });
});

// Helper functions
async function createTestProject(projectPath) {
  await fs.mkdir(projectPath, { recursive: true });
  await fs.mkdir(path.join(projectPath, '.poppobuilder'), { recursive: true });
  
  const config = {
    name: 'Test Project',
    version: '1.0.0',
    description: 'Integration test project',
    created: new Date().toISOString()
  };
  
  await fs.writeFile(
    path.join(projectPath, '.poppobuilder', 'config.json'),
    JSON.stringify(config, null, 2)
  );
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}