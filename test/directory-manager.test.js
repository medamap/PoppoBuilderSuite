const { describe, it, before, after } = require('mocha');
const { expect } = require('chai');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const DirectoryManager = require('../lib/core/directory-manager');

describe('DirectoryManager', function() {
  let directoryManager;
  let testHomeDir;
  const originalHome = process.env.HOME;

  before(async function() {
    // Create a temporary directory for testing
    testHomeDir = path.join(os.tmpdir(), 'poppobuilder-test-' + Date.now());
    await fs.mkdir(testHomeDir, { recursive: true });
    
    // Override HOME environment variable
    process.env.HOME = testHomeDir;
    
    directoryManager = new DirectoryManager();
  });

  after(async function() {
    // Restore original HOME
    process.env.HOME = originalHome;
    
    // Clean up test directory
    try {
      await fs.rm(testHomeDir, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to clean up test directory:', error);
    }
  });

  describe('#initialize()', function() {
    it('should create all required directories', async function() {
      const results = await directoryManager.initialize();
      
      expect(results.errors).to.be.empty;
      expect(results.created.length + results.existing.length).to.equal(
        Object.keys(directoryManager.directories).length
      );
      
      // Verify all directories exist
      for (const dirPath of Object.values(directoryManager.directories)) {
        const stats = await fs.stat(dirPath);
        expect(stats.isDirectory()).to.be.true;
      }
    });

    it('should set correct permissions on root directory', async function() {
      await directoryManager.initialize();
      
      const stats = await fs.stat(directoryManager.rootDir);
      const mode = stats.mode & parseInt('777', 8);
      
      // On some systems, the exact permissions might vary slightly
      // Check that it's restricted to owner
      expect(mode & 0o077).to.equal(0); // No permissions for group/others
    });

    it('should create initial files', async function() {
      await directoryManager.initialize();
      
      // Check projects.json
      const projectsContent = await fs.readFile(directoryManager.files.projects, 'utf-8');
      expect(JSON.parse(projectsContent)).to.deep.equal({ projects: {} });
      
      // Check statistics.json
      const statsContent = await fs.readFile(directoryManager.files.statistics, 'utf-8');
      const stats = JSON.parse(statsContent);
      expect(stats).to.have.property('totalTasks', 0);
      expect(stats).to.have.property('successfulTasks', 0);
      expect(stats).to.have.property('failedTasks', 0);
    });

    it('should handle existing directories gracefully', async function() {
      // First initialization
      const results1 = await directoryManager.initialize();
      expect(results1.created.length).to.be.greaterThan(0);
      
      // Second initialization
      const results2 = await directoryManager.initialize();
      expect(results2.existing.length).to.be.greaterThan(0);
      expect(results2.created).to.be.empty;
      expect(results2.errors).to.be.empty;
    });
  });

  describe('#verify()', function() {
    it('should verify valid directory structure', async function() {
      await directoryManager.initialize();
      
      const results = await directoryManager.verify();
      expect(results.valid).to.be.true;
      expect(results.missing).to.be.empty;
      expect(results.permissions).to.be.empty;
    });

    it('should detect missing directories', async function() {
      await directoryManager.initialize();
      
      // Remove a directory
      await fs.rmdir(directoryManager.directories.temp);
      
      const results = await directoryManager.verify();
      expect(results.valid).to.be.false;
      expect(results.missing).to.include(directoryManager.directories.temp);
    });
  });

  describe('#cleanTemp()', function() {
    it('should remove old temporary files', async function() {
      await directoryManager.initialize();
      
      // Create test files
      const tempDir = directoryManager.directories.temp;
      const oldFile = path.join(tempDir, 'old.txt');
      const newFile = path.join(tempDir, 'new.txt');
      
      await fs.writeFile(oldFile, 'old content');
      await fs.writeFile(newFile, 'new content');
      
      // Make old file older
      const oldTime = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
      await fs.utimes(oldFile, oldTime / 1000, oldTime / 1000);
      
      // Clean files older than 24 hours
      const result = await directoryManager.cleanTemp();
      
      expect(result.removed).to.equal(1);
      expect(result.total).to.equal(2);
      
      // Verify old file is gone, new file remains
      await expect(fs.access(oldFile)).to.be.rejected;
      await expect(fs.access(newFile)).to.be.fulfilled;
    });
  });

  describe('#getDirectorySizes()', function() {
    it('should calculate directory sizes', async function() {
      await directoryManager.initialize();
      
      // Create some test files
      const testFile = path.join(directoryManager.directories.data, 'test.txt');
      await fs.writeFile(testFile, 'x'.repeat(1024)); // 1KB file
      
      const sizes = await directoryManager.getDirectorySizes();
      
      expect(sizes.data).to.have.property('bytes');
      expect(sizes.data.bytes).to.be.at.least(1024);
      expect(sizes.data).to.have.property('humanReadable');
      expect(sizes.data).to.have.property('fileCount');
      expect(sizes.data.fileCount).to.be.at.least(1);
    });
  });

  describe('#formatBytes()', function() {
    it('should format bytes correctly', function() {
      expect(directoryManager.formatBytes(0)).to.equal('0 B');
      expect(directoryManager.formatBytes(1023)).to.equal('1023 B');
      expect(directoryManager.formatBytes(1024)).to.equal('1 KB');
      expect(directoryManager.formatBytes(1048576)).to.equal('1 MB');
      expect(directoryManager.formatBytes(1073741824)).to.equal('1 GB');
    });
  });

  describe('#getPaths()', function() {
    it('should return all paths', function() {
      const paths = directoryManager.getPaths();
      
      expect(paths).to.have.property('directories');
      expect(paths).to.have.property('files');
      expect(paths.directories).to.have.all.keys(
        'root', 'logs', 'queue', 'data', 'backup', 'temp'
      );
      expect(paths.files).to.have.all.keys(
        'config', 'projects', 'daemonPid', 'daemonLog', 
        'apiLog', 'statistics', 'health'
      );
    });
  });
});