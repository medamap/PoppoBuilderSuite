const { describe, it, before, after } = require('mocha');
const { expect } = require('chai');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

// Import the actual implementations
const ConfigCommand = require('../../lib/commands/config');
const { GlobalConfigManager } = require('../../lib/core/global-config-manager');
const ConfigUpdater = require('../../lib/utils/config-updater');

describe('Config Command Integration', function() {
  this.timeout(10000);
  
  let configCommand;
  let configManager;
  let originalConfigPath;
  let testConfigPath;

  before(async () => {
    // Create a test config directory
    const testDir = path.join(os.tmpdir(), 'poppobuilder-config-test-' + Date.now());
    await fs.mkdir(testDir, { recursive: true });
    testConfigPath = path.join(testDir, 'config.json');
    
    // Save original config path and override
    configManager = new GlobalConfigManager();
    originalConfigPath = configManager.configPath;
    configManager.configPath = testConfigPath;
    configManager.configDir = testDir;
    
    // Initialize with test config
    await configManager.initialize();
    
    // Create config command with test manager
    configCommand = new ConfigCommand();
    configCommand.configManager = configManager;
  });

  after(async () => {
    // Cleanup test directory
    if (testConfigPath) {
      const testDir = path.dirname(testConfigPath);
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  describe('Basic Operations', () => {
    it('should list configuration', async () => {
      await configCommand.execute('--list', []);
      const config = configManager.getAll();
      expect(config).to.have.property('version');
      expect(config).to.have.property('daemon');
    });

    it('should get specific configuration value', async () => {
      const value = configManager.get('daemon.maxProcesses');
      expect(value).to.be.a('number');
    });

    it('should set configuration value', async () => {
      await configCommand.execute('set', ['daemon.maxProcesses', '5']);
      const value = configManager.get('daemon.maxProcesses');
      expect(value).to.equal(5);
    });
  });

  describe('Quick Options', () => {
    it('should set max processes via flag', async () => {
      await configCommand.execute('--max-processes', ['3']);
      const value = configManager.get('daemon.maxProcesses');
      expect(value).to.equal(3);
    });

    it('should set scheduling strategy via flag', async () => {
      await configCommand.execute('--strategy', ['weighted']);
      const value = configManager.get('daemon.schedulingStrategy');
      expect(value).to.equal('weighted');
    });

    it('should validate scheduling strategy values', async () => {
      try {
        await configCommand.execute('--strategy', ['invalid-strategy']);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('requires one of');
      }
    });
  });

  describe('Value Type Parsing', () => {
    it('should parse boolean values', async () => {
      await configCommand.execute('set', ['daemon.enabled', 'false']);
      const value = configManager.get('daemon.enabled');
      expect(value).to.equal(false);
    });

    it('should parse numeric values', async () => {
      await configCommand.execute('set', ['defaults.checkInterval', '60000']);
      const value = configManager.get('defaults.checkInterval');
      expect(value).to.equal(60000);
    });

    it('should parse JSON arrays', async () => {
      await configCommand.execute('set', ['registry.discoveryPaths', '["path1", "path2"]']);
      const value = configManager.get('registry.discoveryPaths');
      expect(value).to.deep.equal(['path1', 'path2']);
    });
  });

  describe('Configuration Validation', () => {
    it('should reject invalid max processes value', async () => {
      try {
        await configCommand.execute('set', ['daemon.maxProcesses', '100']);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Invalid value');
      }
    });

    it('should reject invalid log level', async () => {
      try {
        await configCommand.execute('set', ['logging.level', 'invalid']);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Invalid value');
      }
    });
  });

  describe('ConfigUpdater', () => {
    it('should identify restart-required changes', () => {
      const changes = {
        'daemon.port': 12345,
        'daemon.maxProcesses': 4,
        'logging.level': 'debug'
      };
      
      const restartRequired = ConfigUpdater.getRestartRequiredChanges(changes);
      expect(restartRequired).to.include('daemon.port');
      expect(restartRequired).to.not.include('daemon.maxProcesses');
    });

    it('should identify applicable changes', () => {
      const changes = {
        'daemon.maxProcesses': 4,
        'daemon.schedulingStrategy': 'weighted',
        'logging.level': 'debug',
        'daemon.port': 12345
      };
      
      const applicable = ConfigUpdater.getApplicableChanges(changes);
      expect(applicable).to.include('daemon.maxProcesses');
      expect(applicable).to.include('daemon.schedulingStrategy');
      expect(applicable).to.include('logging.level');
      expect(applicable).to.not.include('daemon.port');
    });
  });
});