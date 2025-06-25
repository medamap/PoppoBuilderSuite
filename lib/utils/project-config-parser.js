/**
 * Project Configuration Parser
 * Parses command line options into project configuration
 */

/**
 * Parse command line options into project configuration parameters
 * @param {Object} options - Command line options
 * @param {Object} config - Base configuration (from interactive prompts or defaults)
 * @returns {Object} Configuration parameters for buildProjectConfig
 */
function parseProjectOptions(options, config) {
  const params = {
    name: config.project?.name || config.name,
    description: options.description,
    priority: options.priority ? parseInt(options.priority) : undefined,
    tags: options.tags ? options.tags.split(',').map(t => t.trim()) : undefined
  };

  // Add GitHub info if available
  if (config.github?.owner && config.github?.repo) {
    params.github = {
      owner: config.github.owner,
      repo: config.github.repo
    };
  }

  // Parse schedule options
  if (options.checkInterval) {
    params.schedule = {
      checkInterval: parseInt(options.checkInterval)
    };
  }

  // Parse resource options
  const hasResourceOptions = options.maxConcurrent || options.cpuWeight || options.memoryLimit;
  if (hasResourceOptions) {
    params.resources = {};
    if (options.maxConcurrent) {
      params.resources.maxConcurrent = parseInt(options.maxConcurrent);
    }
    if (options.cpuWeight) {
      params.resources.cpuWeight = parseFloat(options.cpuWeight);
    }
    if (options.memoryLimit) {
      params.resources.memoryLimit = options.memoryLimit;
    }
  }

  return params;
}

/**
 * Parse simple registration answers into configuration parameters
 * @param {Object} answers - Interactive prompt answers
 * @param {Object} projectInfo - Project information (name, github info, etc.)
 * @returns {Object} Configuration parameters for buildProjectConfig
 */
function parseSimpleRegistrationAnswers(answers, projectInfo) {
  const result = {
    name: projectInfo.name,
    description: `PoppoBuilder project: ${projectInfo.name}`
  };

  // Only add github if we have valid data
  const owner = projectInfo.githubInfo.detected && answers.confirmGitHub !== false ? 
    projectInfo.githubInfo.owner : answers.githubOwner;
  const repo = projectInfo.githubInfo.detected && answers.confirmGitHub !== false ? 
    projectInfo.githubInfo.repo : answers.githubRepo;
  
  if (owner && repo) {
    result.github = { owner, repo };
  }

  // Priority will be handled by schema default

  // Don't set default tags - let schema handle it
  
  return result;
}

module.exports = {
  parseProjectOptions,
  parseSimpleRegistrationAnswers
};