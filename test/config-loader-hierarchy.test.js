const { describe, it, before, after, beforeEach } = require('mocha');
const { expect } = require('chai');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const ConfigLoader = require('../src/config-loader');

describe('ConfigLoader Hierarchy Support', function() {
  let configLoader;
  let testHomeDir;
  let testProjectDir;
  const originalHome = process.env.HOME;
  const originalCwd = process.cwd();

  before(async function() {
    // Create test directories
    testHomeDir = path.join(os.tmpdir(), 'poppobuilder-test-' + Date.now());
    testProjectDir = path.join(testHomeDir, 'test-project');
    
    await fs.mkdir(testHomeDir, { recursive: true });
    await fs.mkdir(testProjectDir, { recursive: true });
    await fs.mkdir(path.join(testProjectDir, '.poppo'), { recursive: true });
    
    // Override HOME and change to project directory
    process.env.HOME = testHomeDir;
    process.chdir(testProjectDir);
  });

  after(async function() {
    // Restore original environment
    process.env.HOME = originalHome;
    process.chdir(originalCwd);
    
    // Clean up test directories
    try {
      await fs.rm(testHomeDir, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to clean up test directory:', error);
    }
  });

  beforeEach(function() {
    // Clear environment variables
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('POPPO_')) {
        delete process.env[key];
      }
    });
    
    configLoader = new ConfigLoader();
  });

  describe('Configuration Hierarchy', function() {
    it('should load configuration in correct priority order', async function() {
      // Create global config
      const globalConfigDir = path.join(testHomeDir, '.poppobuilder');
      await fs.mkdir(globalConfigDir, { recursive: true });
      await fs.writeFile(
        path.join(globalConfigDir, 'config.json'),
        JSON.stringify({
          version: '1.0.0',
          defaults: {
            timeout: 300000,
            language: 'en'
          }
        })
      );

      // Create project config
      await fs.writeFile(
        path.join(testProjectDir, '.poppo', 'config.json'),
        JSON.stringify({
          github: {
            owner: 'testuser',
            repo: 'testrepo'
          },
          language: {
            primary: 'ja'
          }
        })
      );

      // Set environment variable
      process.env.POPPO_LANGUAGE_PRIMARY = 'fr';

      // Load config
      const config = await configLoader.loadConfig();

      // Environment variable should override everything
      expect(config.language.primary).to.equal('fr');
      
      // Project config should be present
      expect(config.github.owner).to.equal('testuser');
      expect(config.github.repo).to.equal('testrepo');
    });

    it('should handle missing configuration files gracefully', async function() {
      // No config files exist, should use defaults
      const config = await configLoader.loadConfig();
      
      expect(config).to.be.an('object');
      expect(config.language.primary).to.be.oneOf(['en', 'ja']);
    });

    it('should support synchronous loading for backward compatibility', function() {
      const config = configLoader.loadConfigSync();
      
      expect(config).to.be.an('object');
      expect(config.language).to.be.an('object');
    });

    it('should merge nested configurations correctly', async function() {
      // Create project config with partial settings
      await fs.writeFile(
        path.join(testProjectDir, '.poppo', 'config.json'),
        JSON.stringify({
          claude: {
            timeout: 120000
          }
        })
      );

      const config = await configLoader.loadConfig();
      
      // Should have both project and default values
      expect(config.claude.timeout).to.equal(120000);
      expect(config.language).to.be.an('object'); // From defaults
    });

    it('should parse environment variables with correct types', async function() {
      process.env.POPPO_CLAUDE_MAXCONCURRENT = '5';
      process.env.POPPO_SYSTEMPROMT_ENFORCELANGUAGE = 'false';
      process.env.POPPO_GITHUB_POLLINGINTERVAL = '60000';

      const config = await configLoader.loadConfig();

      expect(config.claude.maxconcurrent).to.equal(5);
      expect(config.systempromt.enforcelanguage).to.equal(false);
      expect(config.github.pollinginterval).to.equal(60000);
    });
  });

  describe('Global Configuration Integration', function() {
    it('should extract relevant settings from global config', async function() {
      // Create a mock global config
      const globalConfigDir = path.join(testHomeDir, '.poppobuilder');
      await fs.mkdir(globalConfigDir, { recursive: true });
      await fs.writeFile(
        path.join(globalConfigDir, 'config.json'),
        JSON.stringify({
          version: '1.0.0',
          daemon: {
            enabled: true,
            maxProcesses: 4
          },
          defaults: {
            pollingInterval: 300000,
            timeout: 600000,
            language: 'en'
          },
          resources: {
            maxMemoryMB: 2048,
            maxCpuPercent: 75
          },
          logging: {
            level: 'debug'
          }
        })
      );

      const config = await configLoader.loadConfig();

      // Should include relevant defaults
      expect(config.defaults).to.be.an('object');
      expect(config.defaults.timeout).to.equal(600000);
      
      // Should NOT include daemon settings (those are global only)
      expect(config.daemon).to.be.undefined;
    });
  });

  describe('Configuration Sources', function() {
    it('should report correct configuration sources', function() {
      const sources = configLoader.getConfigSources();
      
      expect(sources).to.have.all.keys('systemDefault', 'global', 'project', 'environment');
      expect(sources.project.path).to.include('.poppo/config.json');
      expect(sources.global.path).to.include('.poppobuilder/config.json');
    });

    it('should list environment variables', function() {
      process.env.POPPO_TEST_VALUE = 'test';
      process.env.POPPO_ANOTHER_VALUE = '123';

      const vars = configLoader.getEnvironmentVariables();
      
      expect(vars).to.have.property('POPPO_TEST_VALUE', 'test');
      expect(vars).to.have.property('POPPO_ANOTHER_VALUE', '123');
    });
  });

  describe('Validation', function() {
    it('should validate merged configuration', async function() {
      // Create invalid project config
      await fs.writeFile(
        path.join(testProjectDir, '.poppo', 'config.json'),
        JSON.stringify({
          claude: {
            maxConcurrent: 20 // Invalid: too high
          },
          github: {
            pollingInterval: 5000 // Invalid: too low
          }
        })
      );

      // Should still load but with warnings
      const config = await configLoader.loadConfig();
      
      expect(config).to.be.an('object');
      // Validation warnings should have been logged
    });
  });
});