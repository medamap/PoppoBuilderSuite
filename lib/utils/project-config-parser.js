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
 * @param {number} defaultPriority - Default priority value
 * @returns {Object} Configuration parameters for buildProjectConfig
 */
function parseSimpleRegistrationAnswers(answers, projectInfo, defaultPriority) {
  return {
    name: projectInfo.name,
    description: `PoppoBuilder project: ${projectInfo.name}`,
    github: {
      owner: projectInfo.githubInfo.detected && answers.confirmGitHub !== false ? 
        projectInfo.githubInfo.owner : answers.githubOwner,
      repo: projectInfo.githubInfo.detected && answers.confirmGitHub !== false ? 
        projectInfo.githubInfo.repo : answers.githubRepo
    },
    priority: defaultPriority,
    tags: ['poppobuilder']
  };
}

module.exports = {
  parseProjectOptions,
  parseSimpleRegistrationAnswers
};