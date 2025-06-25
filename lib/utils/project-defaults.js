/**
 * Project Configuration Defaults
 * Provides consistent default values for project registration
 */

/**
 * Get default project configuration values
 * @param {string} projectName - The project name
 * @returns {Object} Default configuration values
 */
function getProjectDefaults(projectName) {
  return {
    description: `PoppoBuilder project: ${projectName}`,
    priority: 50,
    tags: ['poppobuilder'],
    weight: 1.0,
    schedule: {
      // checkInterval is optional, no default
    },
    resources: {
      // maxConcurrent, cpuWeight, memoryLimit are optional, no defaults
    },
    labels: {
      // Use schema defaults
    }
  };
}

/**
 * Apply defaults to project configuration
 * Only adds missing values, doesn't override existing ones
 * @param {Object} config - Project configuration
 * @param {string} projectName - Project name for generating defaults
 * @returns {Object} Configuration with defaults applied
 */
function applyProjectDefaults(config, projectName) {
  const defaults = getProjectDefaults(projectName);
  
  return {
    name: config.name,
    description: config.description ?? defaults.description,
    priority: config.priority ?? defaults.priority,
    tags: config.tags && config.tags.length > 0 ? config.tags : defaults.tags,
    weight: config.weight ?? defaults.weight,
    github: config.github,
    schedule: config.schedule,
    resources: config.resources,
    labels: config.labels
  };
}

/**
 * Check if a value is effectively empty
 * @param {any} value - Value to check
 * @returns {boolean} True if the value is null, undefined, or empty object
 */
function isEmpty(value) {
  return value === null || 
         value === undefined || 
         (typeof value === 'object' && Object.keys(value).length === 0);
}

/**
 * Clean configuration by removing empty values
 * @param {Object} config - Configuration object
 * @returns {Object} Cleaned configuration
 */
function cleanProjectConfig(config) {
  const cleaned = {};
  
  for (const [key, value] of Object.entries(config)) {
    if (!isEmpty(value)) {
      cleaned[key] = value;
    }
  }
  
  return cleaned;
}

module.exports = {
  getProjectDefaults,
  applyProjectDefaults,
  cleanProjectConfig
};