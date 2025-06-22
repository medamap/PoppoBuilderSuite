const { describe, it } = require('mocha');
const { expect } = require('chai');
const { schema, validate, defaultConfig } = require('../lib/schemas/global-config-schema');

describe('Global Configuration Schema', function() {
  describe('Schema Validation', function() {
    it('should accept valid configuration', function() {
      const validConfig = {
        version: '1.0.0',
        daemon: {
          enabled: true,
          maxProcesses: 3,
          schedulingStrategy: 'priority',
          port: 3003
        },
        resources: {
          maxMemoryMB: 2048,
          maxCpuPercent: 75
        },
        defaults: {
          pollingInterval: 300000,
          timeout: 600000,
          retryAttempts: 2,
          retryDelay: 3000,
          language: 'ja'
        },
        registry: {
          maxProjects: 10,
          autoDiscovery: true,
          discoveryPaths: ['/home/user/projects']
        },
        logging: {
          level: 'debug',
          directory: '/var/log/poppobuilder',
          maxFiles: 20,
          maxSize: '50M'
        },
        telemetry: {
          enabled: true,
          endpoint: 'https://telemetry.example.com'
        },
        updates: {
          checkForUpdates: false,
          autoUpdate: false,
          channel: 'beta'
        }
      };

      const isValid = validate(validConfig);
      expect(isValid).to.be.true;
      expect(validate.errors).to.be.null;
    });

    it('should reject configuration without required version', function() {
      const invalidConfig = {
        daemon: {
          enabled: true
        }
      };

      const isValid = validate(invalidConfig);
      expect(isValid).to.be.false;
      expect(validate.errors).to.have.length.greaterThan(0);
      expect(validate.errors[0].message).to.include('required property');
    });

    it('should reject invalid version format', function() {
      const invalidConfig = {
        version: '1.0'  // Missing patch version
      };

      const isValid = validate(invalidConfig);
      expect(isValid).to.be.false;
    });

    it('should reject maxProcesses outside range', function() {
      const invalidConfig = {
        version: '1.0.0',
        daemon: {
          maxProcesses: 15  // Maximum is 10
        }
      };

      const isValid = validate(invalidConfig);
      expect(isValid).to.be.false;
    });

    it('should reject invalid scheduling strategy', function() {
      const invalidConfig = {
        version: '1.0.0',
        daemon: {
          schedulingStrategy: 'invalid-strategy'
        }
      };

      const isValid = validate(invalidConfig);
      expect(isValid).to.be.false;
    });

    it('should reject invalid port number', function() {
      const invalidConfig = {
        version: '1.0.0',
        daemon: {
          port: 80  // Minimum is 1024
        }
      };

      const isValid = validate(invalidConfig);
      expect(isValid).to.be.false;
    });

    it('should accept null for optional fields', function() {
      const validConfig = {
        version: '1.0.0',
        daemon: {
          port: null,
          socketPath: null
        },
        telemetry: {
          endpoint: null
        }
      };

      const isValid = validate(validConfig);
      expect(isValid).to.be.true;
    });

    it('should reject invalid logging level', function() {
      const invalidConfig = {
        version: '1.0.0',
        logging: {
          level: 'verbose'  // Not in enum
        }
      };

      const isValid = validate(invalidConfig);
      expect(isValid).to.be.false;
    });

    it('should reject CPU percentage outside range', function() {
      const invalidConfig = {
        version: '1.0.0',
        resources: {
          maxCpuPercent: 150  // Maximum is 100
        }
      };

      const isValid = validate(invalidConfig);
      expect(isValid).to.be.false;
    });

    it('should reject additional properties', function() {
      const invalidConfig = {
        version: '1.0.0',
        unknownProperty: 'value'
      };

      const isValid = validate(invalidConfig);
      expect(isValid).to.be.false;
    });
  });

  describe('Default Configuration', function() {
    it('should have all required properties', function() {
      expect(defaultConfig).to.have.property('version');
      expect(defaultConfig).to.have.property('daemon');
      expect(defaultConfig).to.have.property('resources');
      expect(defaultConfig).to.have.property('defaults');
      expect(defaultConfig).to.have.property('registry');
      expect(defaultConfig).to.have.property('logging');
      expect(defaultConfig).to.have.property('telemetry');
      expect(defaultConfig).to.have.property('updates');
    });

    it('should pass schema validation', function() {
      const isValid = validate(defaultConfig);
      expect(isValid).to.be.true;
      expect(validate.errors).to.be.null;
    });

    it('should have correct default values', function() {
      expect(defaultConfig.version).to.equal('1.0.0');
      expect(defaultConfig.daemon.maxProcesses).to.equal(2);
      expect(defaultConfig.daemon.port).to.equal(3003);
      expect(defaultConfig.daemon.schedulingStrategy).to.equal('round-robin');
      expect(defaultConfig.resources.maxMemoryMB).to.equal(4096);
      expect(defaultConfig.resources.maxCpuPercent).to.equal(80);
      expect(defaultConfig.defaults.pollingInterval).to.equal(300000);
      expect(defaultConfig.defaults.timeout).to.equal(600000);
      expect(defaultConfig.defaults.language).to.equal('en');
    });
  });

  describe('Schema Structure', function() {
    it('should define all expected properties', function() {
      expect(schema.properties).to.have.all.keys(
        'version', 'daemon', 'resources', 'defaults', 
        'registry', 'logging', 'telemetry', 'updates'
      );
    });

    it('should have correct required fields', function() {
      expect(schema.required).to.deep.equal(['version']);
    });

    it('should not allow additional properties', function() {
      expect(schema.additionalProperties).to.be.false;
    });
  });
});