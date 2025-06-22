/**
 * Global Configuration Schema
 * Defines the structure and validation rules for PoppoBuilder global configuration
 */

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv({ allErrors: true, useDefaults: true });
addFormats(ajv);

const globalConfigSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["version"],
  properties: {
    version: {
      type: "string",
      pattern: "^\\d+\\.\\d+\\.\\d+$",
      description: "Configuration schema version"
    },
    daemon: {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          default: true,
          description: "Enable daemon mode for managing multiple projects"
        },
        maxProcesses: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          default: 2,
          description: "Maximum number of concurrent Claude processes"
        },
        schedulingStrategy: {
          type: "string",
          enum: ["round-robin", "priority", "weighted", "weighted-round-robin", "deadline-aware"],
          default: "round-robin",
          description: "Strategy for scheduling tasks across projects"
        },
        port: {
          type: ["integer", "null"],
          minimum: 1024,
          maximum: 65535,
          default: 3003,
          description: "Port for daemon API server"
        },
        socketPath: {
          type: ["string", "null"],
          description: "Unix socket path for IPC (optional, overrides port)"
        }
      },
      additionalProperties: false
    },
    resources: {
      type: "object",
      properties: {
        maxMemoryMB: {
          type: "integer",
          minimum: 512,
          default: 4096,
          description: "Maximum memory usage in MB"
        },
        maxCpuPercent: {
          type: "integer",
          minimum: 10,
          maximum: 100,
          default: 80,
          description: "Maximum CPU usage percentage"
        }
      },
      additionalProperties: false
    },
    defaults: {
      type: "object",
      properties: {
        pollingInterval: {
          type: "integer",
          minimum: 60000,
          default: 300000,
          description: "Default polling interval for checking issues (ms)"
        },
        timeout: {
          type: "integer",
          minimum: 60000,
          default: 600000,
          description: "Default timeout for Claude operations (ms)"
        },
        retryAttempts: {
          type: "integer",
          minimum: 0,
          maximum: 5,
          default: 3,
          description: "Default number of retry attempts"
        },
        retryDelay: {
          type: "integer",
          minimum: 1000,
          default: 5000,
          description: "Default delay between retries (ms)"
        },
        language: {
          type: "string",
          enum: ["en", "ja"],
          default: "en",
          description: "Default language for new projects"
        }
      },
      additionalProperties: false
    },
    registry: {
      type: "object",
      properties: {
        maxProjects: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 20,
          description: "Maximum number of registered projects"
        },
        autoDiscovery: {
          type: "boolean",
          default: false,
          description: "Automatically discover PoppoBuilder projects"
        },
        discoveryPaths: {
          type: "array",
          items: {
            type: "string"
          },
          default: [],
          description: "Paths to search for PoppoBuilder projects"
        }
      },
      additionalProperties: false
    },
    logging: {
      type: "object",
      properties: {
        level: {
          type: "string",
          enum: ["debug", "info", "warn", "error"],
          default: "info",
          description: "Global logging level"
        },
        directory: {
          type: "string",
          default: "~/.poppobuilder/logs",
          description: "Directory for global logs"
        },
        maxFiles: {
          type: "integer",
          minimum: 1,
          default: 30,
          description: "Maximum number of log files to keep"
        },
        maxSize: {
          type: "string",
          pattern: "^\\d+[KMG]?$",
          default: "10M",
          description: "Maximum size per log file"
        }
      },
      additionalProperties: false
    },
    telemetry: {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          default: false,
          description: "Enable anonymous usage telemetry"
        },
        endpoint: {
          type: "string",
          format: "uri",
          description: "Telemetry collection endpoint"
        }
      },
      additionalProperties: false
    },
    updates: {
      type: "object",
      properties: {
        checkForUpdates: {
          type: "boolean",
          default: true,
          description: "Check for PoppoBuilder updates"
        },
        autoUpdate: {
          type: "boolean",
          default: false,
          description: "Automatically install updates"
        },
        channel: {
          type: "string",
          enum: ["stable", "beta", "dev"],
          default: "stable",
          description: "Update channel"
        }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};

// Default configuration values
const defaultGlobalConfig = {
  version: "1.0.0",
  daemon: {
    enabled: true,
    maxProcesses: 2,
    schedulingStrategy: "round-robin",
    port: 3003,
    socketPath: null
  },
  resources: {
    maxMemoryMB: 4096,
    maxCpuPercent: 80
  },
  defaults: {
    pollingInterval: 300000,
    timeout: 600000,
    retryAttempts: 3,
    retryDelay: 5000,
    language: "en"
  },
  registry: {
    maxProjects: 20,
    autoDiscovery: false,
    discoveryPaths: []
  },
  logging: {
    level: "info",
    directory: "~/.poppobuilder/logs",
    maxFiles: 30,
    maxSize: "10M"
  },
  telemetry: {
    enabled: false,
    endpoint: null
  },
  updates: {
    checkForUpdates: true,
    autoUpdate: false,
    channel: "stable"
  }
};

// Compile the schema
const validate = ajv.compile(globalConfigSchema);

module.exports = {
  schema: globalConfigSchema,
  validate,
  defaultConfig: defaultGlobalConfig
};