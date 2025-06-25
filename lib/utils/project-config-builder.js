/**
 * Project Configuration Builder
 * Standardizes project configuration creation across different registration methods
 */

/**
 * Build a standardized project configuration object
 * @param {Object} params - Configuration parameters
 * @param {string} params.name - Project name
 * @param {string} [params.description] - Project description
 * @param {Object} [params.github] - GitHub repository info
 * @param {number} [params.priority] - Project priority
 * @param {Array<string>} [params.tags] - Project tags
 * @param {number} [params.weight] - Project weight
 * @param {Object} [params.schedule] - Schedule configuration
 * @param {Object} [params.resources] - Resource limits
 * @returns {Object} Standardized project configuration
 */
function buildProjectConfig(params) {
  const config = {
    name: params.name
  };

  // Add values if explicitly provided (let schema handle defaults)
  if (params.priority !== undefined) {
    config.priority = params.priority;
  }
  if (params.tags !== undefined) {
    config.tags = params.tags;
  }
  if (params.weight !== undefined) {
    config.weight = params.weight;
  }

  // Add optional fields if provided
  if (params.description) {
    config.description = params.description;
  }

  if (params.github) {
    config.github = {
      owner: params.github.owner,
      repo: params.github.repo
    };
  }

  if (params.schedule) {
    config.schedule = params.schedule;
  }

  if (params.resources) {
    config.resources = params.resources;
  }

  if (params.labels) {
    config.labels = params.labels;
  }

  // Remove empty values to let schema defaults apply
  return cleanConfig(config);
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
function cleanConfig(config) {
  const cleaned = {};
  
  for (const [key, value] of Object.entries(config)) {
    if (!isEmpty(value)) {
      cleaned[key] = value;
    }
  }
  
  return cleaned;
}

/**
 * Build registration options object
 * @param {boolean} enabled - Whether the project is enabled
 * @param {Object} config - Project configuration
 * @returns {Object} Registration options
 */
function buildRegistrationOptions(enabled, config) {
  return {
    enabled: enabled ?? true,
    config: config
  };
}

module.exports = {
  buildProjectConfig,
  buildRegistrationOptions
};