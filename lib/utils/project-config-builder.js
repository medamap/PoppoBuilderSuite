/**
 * Project Configuration Builder
 * Standardizes project configuration creation across different registration methods
 */

const { cleanProjectConfig } = require('./project-defaults');

/**
 * Build a standardized project configuration object
 * @param {Object} params - Configuration parameters
 * @param {string} params.name - Project name
 * @param {string} [params.description] - Project description
 * @param {Object} [params.github] - GitHub repository info
 * @param {number} [params.priority=50] - Project priority
 * @param {Array<string>} [params.tags=[]] - Project tags
 * @param {number} [params.weight=1.0] - Project weight
 * @param {Object} [params.schedule] - Schedule configuration
 * @param {Object} [params.resources] - Resource limits
 * @returns {Object} Standardized project configuration
 */
function buildProjectConfig(params) {
  const config = {
    name: params.name,
    priority: params.priority ?? 50,
    tags: params.tags || [],
    weight: params.weight ?? 1.0
  };

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
  return cleanProjectConfig(config);
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