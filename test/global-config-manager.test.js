/**
 * Global Configuration Manager Tests
 */

const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { GlobalConfigManager } = require('../lib/core/global-config-manager');

describe('GlobalConfigManager', () => {
  let configManager;
  let sandbox;
  let mockConfigDir;
  let mockConfigPath;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    configManager = new GlobalConfigManager();
    
    // Mock home directory
    mockConfigDir = '/tmp/test-poppobuilder';
    mockConfigPath = path.join(mockConfigDir, 'config.json');
    
    sandbox.stub(os, 'homedir').returns('/tmp/test-home');
    configManager.configDir = mockConfigDir;
    configManager.configPath = mockConfigPath;
  });

  afterEach(() => {
    sandbox.restore();
    if (configManager.fileWatcher) {
      configManager.stopWatching();
    }
  });

  describe('initialize', () => {
    it('should create config directory and file if they do not exist', async () => {
      const mkdirStub = sandbox.stub(fs, 'mkdir').resolves();
      const accessStub = sandbox.stub(fs, 'access').rejects(new Error('ENOENT'));
      const writeFileStub = sandbox.stub(fs, 'writeFile').resolves();
      const renameStub = sandbox.stub(fs, 'rename').resolves();
      
      await configManager.initialize();
      
      expect(mkdirStub.calledWith(mockConfigDir, { recursive: true })).to.be.true;
      expect(mkdirStub.calledWith(path.join(mockConfigDir, 'logs'), { recursive: true })).to.be.true;
      expect(mkdirStub.calledWith(path.join(mockConfigDir, 'projects'), { recursive: true })).to.be.true;
      expect(writeFileStub.called).to.be.true;
      expect(configManager.config).to.exist;
      expect(configManager.config.version).to.equal('1.0.0');
    });

    it('should load existing config file', async () => {
      const existingConfig = {
        version: '1.0.0',
        daemon: {
          maxProcesses: 5
        }
      };
      
      sandbox.stub(fs, 'mkdir').resolves();
      sandbox.stub(fs, 'access').resolves();
      sandbox.stub(fs, 'readFile').resolves(JSON.stringify(existingConfig));
      
      await configManager.initialize();
      
      expect(configManager.config.daemon.maxProcesses).to.equal(5);
    });
  });

  describe('get/set', () => {
    beforeEach(async () => {
      sandbox.stub(fs, 'mkdir').resolves();
      sandbox.stub(fs, 'access').rejects(new Error('ENOENT'));
      sandbox.stub(fs, 'writeFile').resolves();
      sandbox.stub(fs, 'rename').resolves();
      
      await configManager.initialize();
    });

    it('should get configuration value by path', () => {
      const value = configManager.get('daemon.maxProcesses');
      expect(value).to.equal(2);
    });

    it('should return undefined for non-existent path', () => {
      const value = configManager.get('non.existent.path');
      expect(value).to.be.undefined;
    });

    it('should set configuration value by path', async () => {
      await configManager.set('daemon.maxProcesses', 4);
      expect(configManager.get('daemon.maxProcesses')).to.equal(4);
    });

    it('should validate configuration after setting', async () => {
      try {
        await configManager.set('daemon.maxProcesses', 20); // exceeds maximum
      } catch (error) {
        expect(error.message).to.include('Invalid value');
      }
    });
  });

  describe('validation', () => {
    it('should validate correct configuration', () => {
      const validConfig = {
        version: '1.0.0',
        daemon: {
          maxProcesses: 3
        }
      };
      
      const result = configManager.validateConfig(validConfig);
      expect(result).to.be.true;
    });

    it('should reject invalid configuration', () => {
      const invalidConfig = {
        version: 'invalid-version',
        daemon: {
          maxProcesses: 'not-a-number'
        }
      };
      
      const result = configManager.validateConfig(invalidConfig);
      expect(result).to.be.false;
    });
  });

  describe('update', () => {
    beforeEach(async () => {
      sandbox.stub(fs, 'mkdir').resolves();
      sandbox.stub(fs, 'access').rejects(new Error('ENOENT'));
      sandbox.stub(fs, 'writeFile').resolves();
      sandbox.stub(fs, 'rename').resolves();
      
      await configManager.initialize();
    });

    it('should update multiple configuration values', async () => {
      const updates = {
        daemon: {
          port: 12345,
          schedulingStrategy: 'priority'
        }
      };
      
      await configManager.update(updates);
      
      expect(configManager.get('daemon.port')).to.equal(12345);
      expect(configManager.get('daemon.schedulingStrategy')).to.equal('priority');
    });

    it('should rollback on validation failure', async () => {
      const originalPort = configManager.get('daemon.port');
      const invalidUpdates = {
        daemon: {
          port: 999 // below minimum
        }
      };
      
      try {
        await configManager.update(invalidUpdates);
      } catch (error) {
        expect(configManager.get('daemon.port')).to.equal(originalPort);
      }
    });
  });

  describe('reset', () => {
    beforeEach(async () => {
      sandbox.stub(fs, 'mkdir').resolves();
      sandbox.stub(fs, 'access').rejects(new Error('ENOENT'));
      sandbox.stub(fs, 'writeFile').resolves();
      sandbox.stub(fs, 'rename').resolves();
      
      await configManager.initialize();
    });

    it('should reset configuration to defaults', async () => {
      await configManager.set('daemon.maxProcesses', 5);
      await configManager.reset();
      
      expect(configManager.get('daemon.maxProcesses')).to.equal(2); // default value
    });
  });

  describe('export/import', () => {
    beforeEach(async () => {
      sandbox.stub(fs, 'mkdir').resolves();
      sandbox.stub(fs, 'access').rejects(new Error('ENOENT'));
      sandbox.stub(fs, 'writeFile').resolves();
      sandbox.stub(fs, 'rename').resolves();
      
      await configManager.initialize();
    });

    it('should export configuration as JSON string', async () => {
      const exported = await configManager.export();
      const parsed = JSON.parse(exported);
      
      expect(parsed.version).to.equal('1.0.0');
      expect(parsed.daemon).to.exist;
    });

    it('should import configuration from JSON string', async () => {
      const newConfig = {
        version: '1.0.0',
        daemon: {
          enabled: true,
          maxProcesses: 8,
          schedulingStrategy: 'weighted',
          port: 54321
        }
      };
      
      await configManager.import(JSON.stringify(newConfig));
      
      expect(configManager.get('daemon.maxProcesses')).to.equal(8);
      expect(configManager.get('daemon.port')).to.equal(54321);
    });

    it('should reject invalid import', async () => {
      const invalidConfig = {
        version: 'bad-version'
      };
      
      try {
        await configManager.import(JSON.stringify(invalidConfig));
      } catch (error) {
        expect(error.message).to.include('Invalid configuration format');
      }
    });
  });

  describe('events', () => {
    beforeEach(async () => {
      sandbox.stub(fs, 'mkdir').resolves();
      sandbox.stub(fs, 'access').rejects(new Error('ENOENT'));
      sandbox.stub(fs, 'writeFile').resolves();
      sandbox.stub(fs, 'rename').resolves();
    });

    it('should emit initialized event', (done) => {
      configManager.once('initialized', (config) => {
        expect(config).to.exist;
        expect(config.version).to.equal('1.0.0');
        done();
      });
      
      configManager.initialize();
    });

    it('should emit changed event on set', (done) => {
      configManager.initialize().then(() => {
        configManager.once('changed', (event) => {
          expect(event.path).to.equal('daemon.maxProcesses');
          expect(event.oldValue).to.equal(2);
          expect(event.newValue).to.equal(3);
          done();
        });
        
        configManager.set('daemon.maxProcesses', 3);
      });
    });
  });
});