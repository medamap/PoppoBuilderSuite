/**
 * Project Schema
 * Defines the structure and validation rules for project registry entries
 */

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv({ allErrors: true, useDefaults: true });
addFormats(ajv);

const projectSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["path", "enabled", "createdAt"],
  properties: {
    path: {
      type: "string",
      description: "Absolute path to the project directory"
    },
    enabled: {
      type: "boolean",
      default: true,
      description: "Whether the project is enabled for processing"
    },
    createdAt: {
      type: "string",
      format: "date-time",
      description: "Project registration timestamp"
    },
    updatedAt: {
      type: "string",
      format: "date-time",
      description: "Last update timestamp"
    },
    config: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Human-readable project name"
        },
        description: {
          type: "string",
          default: "",
          description: "Project description"
        },
        github: {
          type: "object",
          properties: {
            owner: {
              type: "string",
              description: "GitHub repository owner"
            },
            repo: {
              type: "string",
              description: "GitHub repository name"
            }
          },
          additionalProperties: false
        },
        priority: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          default: 50,
          description: "Project priority for scheduling"
        },
        weight: {
          type: "number",
          minimum: 0.1,
          maximum: 10.0,
          default: 1.0,
          description: "Project weight for weighted scheduling"
        },
        tags: {
          type: "array",
          items: {
            type: "string"
          },
          default: [],
          description: "Project tags for categorization"
        },
        schedule: {
          type: "object",
          properties: {
            checkInterval: {
              type: "integer",
              minimum: 60000,
              description: "Override global check interval (ms)"
            },
            activeHours: {
              type: "object",
              properties: {
                start: {
                  type: "string",
                  pattern: "^([01]?[0-9]|2[0-3]):[0-5][0-9]$",
                  description: "Start time (HH:MM)"
                },
                end: {
                  type: "string",
                  pattern: "^([01]?[0-9]|2[0-3]):[0-5][0-9]$",
                  description: "End time (HH:MM)"
                },
                timezone: {
                  type: "string",
                  default: "UTC",
                  description: "Timezone for active hours"
                }
              },
              additionalProperties: false
            }
          },
          additionalProperties: false
        },
        resources: {
          type: "object",
          properties: {
            maxConcurrent: {
              type: "integer",
              minimum: 1,
              maximum: 10,
              default: 2,
              description: "Maximum concurrent tasks for this project"
            },
            cpuWeight: {
              type: "number",
              minimum: 0.1,
              maximum: 10,
              default: 1.0,
              description: "CPU weight for resource allocation"
            },
            memoryLimit: {
              type: "string",
              pattern: "^[0-9]+(M|G)$",
              default: "512M",
              description: "Memory limit (e.g., 512M, 2G)"
            }
          },
          additionalProperties: false
        },
        labels: {
          type: "object",
          properties: {
            misc: {
              type: "string",
              default: "task:misc",
              description: "Label for miscellaneous tasks"
            },
            dogfooding: {
              type: "string",
              default: "task:dogfooding",
              description: "Label for dogfooding tasks"
            },
            bug: {
              type: "string",
              default: "task:bug",
              description: "Label for bug tasks"
            },
            feature: {
              type: "string",
              default: "task:feature",
              description: "Label for feature tasks"
            }
          },
          additionalProperties: true
        }
      },
      additionalProperties: true
    },
    stats: {
      type: "object",
      properties: {
        lastCheckAt: {
          type: "string",
          format: "date-time",
          description: "Last check timestamp"
        },
        lastActivityAt: {
          type: "string",
          format: "date-time",
          description: "Last activity timestamp"
        },
        totalIssuesProcessed: {
          type: "integer",
          minimum: 0,
          default: 0,
          description: "Total number of issues processed"
        },
        totalErrors: {
          type: "integer",
          minimum: 0,
          default: 0,
          description: "Total number of errors"
        },
        averageProcessingTime: {
          type: "number",
          minimum: 0,
          default: 0,
          description: "Average processing time in milliseconds"
        }
      },
      additionalProperties: false
    },
    validation: {
      type: "object",
      properties: {
        lastValidated: {
          type: "string",
          format: "date-time",
          description: "Last validation timestamp"
        },
        result: {
          type: "object",
          description: "Validation result object"
        }
      },
      additionalProperties: false
    },
    health: {
      type: "object",
      properties: {
        lastChecked: {
          type: "string",
          format: "date-time",
          description: "Last health check timestamp"
        },
        status: {
          type: "string",
          enum: ["excellent", "good", "fair", "poor", "unhealthy", "error"],
          description: "Overall health status"
        },
        score: {
          type: "number",
          minimum: 0,
          maximum: 100,
          description: "Health score (0-100)"
        },
        grade: {
          type: "string",
          enum: ["A", "B", "C", "D", "F"],
          description: "Health grade"
        }
      },
      additionalProperties: false
    }
  },
  additionalProperties: true
};

const projectsRegistrySchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: {
    version: {
      type: "string",
      pattern: "^\\d+\\.\\d+\\.\\d+$",
      default: "1.0.0",
      description: "Registry schema version"
    },
    projects: {
      type: "object",
      patternProperties: {
        "^[a-zA-Z0-9][a-zA-Z0-9-_]*$": projectSchema
      },
      additionalProperties: false,
      description: "Map of project ID to project configuration"
    },
    metadata: {
      type: "object",
      properties: {
        createdAt: {
          type: "string",
          format: "date-time",
          description: "Registry creation timestamp"
        },
        updatedAt: {
          type: "string",
          format: "date-time",
          description: "Registry last update timestamp"
        },
        totalProjects: {
          type: "integer",
          minimum: 0,
          default: 0,
          description: "Total number of registered projects"
        }
      },
      additionalProperties: false
    }
  },
  required: ["version", "projects"],
  additionalProperties: false
};

// Compile schemas
const validateProject = ajv.compile(projectSchema);
const validateRegistry = ajv.compile(projectsRegistrySchema);

module.exports = {
  projectSchema,
  projectsRegistrySchema,
  validateProject,
  validateRegistry
};