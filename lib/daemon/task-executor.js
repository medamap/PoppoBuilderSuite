/**
 * Task Executor for PoppoBuilder Daemon
 * Executes tasks in the context of their project with isolation
 */

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const EventEmitter = require('events');
const { spawn } = require('child_process');

// PoppoBuilder components
const GitHubClient = require('../../src/github-client');
const IndependentProcessManager = require('../../src/independent-process-manager');
const EnhancedRateLimiter = require('../../src/enhanced-rate-limiter');
const Logger = require('../../src/logger');
const ConfigLoader = require('../../src/config-loader');
const TwoStageProcessor = require('../../src/two-stage-processor');
const StatusManager = require('../../src/status-manager');
const FileStateManager = require('../../src/file-state-manager');

class TaskExecutor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      workerId: options.workerId || 'default',
      logDir: options.logDir || path.join(__dirname, '../../logs'),
      tempDir: options.tempDir || path.join(__dirname, '../../temp'),
      timeout: options.timeout || 600000, // 10 minutes default
      ...options
    };
    
    // Execution state
    this.currentTask = null;
    this.currentProject = null;
    this.isExecuting = false;
    this.startTime = null;
    
    // Project-specific components
    this.projectComponents = new Map();
    
    // Metrics
    this.metrics = {
      tasksExecuted: 0,
      tasksSucceeded: 0,
      tasksFailed: 0,
      totalExecutionTime: 0,
      projectMetrics: new Map()
    };
    
    // Plugin system for custom task types
    this.taskHandlers = new Map();
    this.registerDefaultHandlers();
  }
  
  /**
   * Register default task handlers
   */
  registerDefaultHandlers() {
    // Issue processing handler
    this.registerTaskHandler('process-issue', async (task, context) => {
      return await this.processIssue(task, context);
    });
    
    // Comment processing handler
    this.registerTaskHandler('process-comment', async (task, context) => {
      return await this.processComment(task, context);
    });
    
    // Pull request processing handler
    this.registerTaskHandler('process-pr', async (task, context) => {
      return await this.processPullRequest(task, context);
    });
    
    // Claude CLI execution handler
    this.registerTaskHandler('claude-cli', async (task, context) => {
      return await this.executeClaudeCLI(task, context);
    });
    
    // Custom command handler
    this.registerTaskHandler('custom-command', async (task, context) => {
      return await this.executeCustomCommand(task, context);
    });
  }
  
  /**
   * Register a custom task handler
   */
  registerTaskHandler(type, handler) {
    this.taskHandlers.set(type, handler);
    this.emit('handler-registered', { type });
  }
  
  /**
   * Execute a task with project context
   */
  async execute(task) {
    if (this.isExecuting) {
      throw new Error('Executor is already executing a task');
    }
    
    this.isExecuting = true;
    this.currentTask = task;
    this.startTime = Date.now();
    
    try {
      // Validate task
      this.validateTask(task);
      
      // Set up project context
      const context = await this.setupProjectContext(task);
      
      // Execute task with timeout
      const result = await this.executeWithTimeout(async () => {
        // Get task handler
        const handler = this.taskHandlers.get(task.type);
        if (!handler) {
          throw new Error(`No handler registered for task type: ${task.type}`);
        }
        
        // Execute task
        return await handler(task, context);
      }, task.timeout || this.options.timeout);
      
      // Update metrics
      this.updateMetrics(task, true, Date.now() - this.startTime);
      
      // Emit success event
      this.emit('task-completed', {
        task,
        result,
        duration: Date.now() - this.startTime
      });
      
      return result;
      
    } catch (error) {
      // Update metrics
      this.updateMetrics(task, false, Date.now() - this.startTime);
      
      // Emit error event
      this.emit('task-failed', {
        task,
        error,
        duration: Date.now() - this.startTime
      });
      
      throw error;
      
    } finally {
      // Clean up
      await this.cleanupProjectContext();
      this.isExecuting = false;
      this.currentTask = null;
      this.currentProject = null;
    }
  }
  
  /**
   * Validate task structure
   */
  validateTask(task) {
    if (!task.id) {
      throw new Error('Task must have an id');
    }
    
    if (!task.type) {
      throw new Error('Task must have a type');
    }
    
    if (!task.projectId) {
      throw new Error('Task must have a projectId');
    }
    
    if (!task.projectPath) {
      throw new Error('Task must have a projectPath');
    }
  }
  
  /**
   * Set up project context for task execution
   */
  async setupProjectContext(task) {
    const { projectId, projectPath, projectConfig = {} } = task;
    
    // Validate project path
    try {
      const stats = await fs.stat(projectPath);
      if (!stats.isDirectory()) {
        throw new Error(`Project path is not a directory: ${projectPath}`);
      }
    } catch (error) {
      throw new Error(`Invalid project path: ${projectPath} - ${error.message}`);
    }
    
    // Get or create project components
    let components = this.projectComponents.get(projectId);
    if (!components) {
      components = await this.createProjectComponents(projectId, projectPath, projectConfig);
      this.projectComponents.set(projectId, components);
    }
    
    // Create execution context
    const context = {
      projectId,
      projectPath,
      projectConfig,
      components,
      workingDirectory: projectPath,
      environment: this.createProjectEnvironment(projectId, projectConfig),
      credentials: await this.loadProjectCredentials(projectId, projectConfig)
    };
    
    this.currentProject = context;
    
    // Change to project directory
    const originalCwd = process.cwd();
    process.chdir(projectPath);
    context.originalCwd = originalCwd;
    
    // Apply project environment
    this.applyProjectEnvironment(context.environment);
    
    return context;
  }
  
  /**
   * Create project-specific components
   */
  async createProjectComponents(projectId, projectPath, projectConfig) {
    // Load project-specific configuration
    const configLoader = new ConfigLoader();
    const projectConfigPath = path.join(projectPath, '.poppo', 'config.json');
    let config;
    
    try {
      // Try to load project-specific config
      config = configLoader.loadConfig(projectConfigPath);
    } catch (error) {
      // Fall back to default config with project overrides
      config = configLoader.loadConfig();
      Object.assign(config, projectConfig);
    }
    
    // Create logger for this project with explicit log directory
    const logDir = path.join(projectPath, '.poppo', 'logs');
    
    // Ensure log directory exists
    if (!fsSync.existsSync(logDir)) {
      fsSync.mkdirSync(logDir, { recursive: true });
    }
    
    const logger = new Logger(
      logDir,  // Use old format constructor to avoid StoragePaths issues
      {
        ...config.logging
      }
    );
    
    // Create GitHub client with project credentials
    const githubConfig = {
      ...config.github,
      token: projectConfig.githubToken || process.env[`GITHUB_TOKEN_${projectId.toUpperCase()}`] || process.env.GITHUB_TOKEN
    };
    const github = new GitHubClient(githubConfig);
    
    // Create rate limiter
    const rateLimiter = new EnhancedRateLimiter(config.rateLimiting || {});
    
    // Create state managers
    const stateManager = new FileStateManager(path.join(projectPath, '.poppo', 'state'));
    const statusManager = new StatusManager(
      path.join(projectPath, '.poppo', 'state', 'issue-status.json'),
      logger
    );
    
    // Create process manager
    const processManager = new IndependentProcessManager(
      config.claude,
      rateLimiter,
      logger,
      stateManager
    );
    
    // Create two-stage processor if enabled
    let twoStageProcessor = null;
    if (config.twoStageProcessing?.enabled) {
      twoStageProcessor = new TwoStageProcessor(
        processManager,
        github,
        config.twoStageProcessing,
        logger
      );
    }
    
    return {
      config,
      logger,
      github,
      rateLimiter,
      stateManager,
      statusManager,
      processManager,
      twoStageProcessor
    };
  }
  
  /**
   * Create project-specific environment variables
   */
  createProjectEnvironment(projectId, projectConfig) {
    const env = {
      POPPOBUILDER_PROJECT_ID: projectId,
      POPPOBUILDER_WORKER_ID: this.options.workerId,
      POPPOBUILDER_DAEMON: 'true',
      ...projectConfig.environment
    };
    
    // Add project-specific GitHub token if available
    if (projectConfig.githubToken) {
      env.GITHUB_TOKEN = projectConfig.githubToken;
    }
    
    return env;
  }
  
  /**
   * Load project credentials
   */
  async loadProjectCredentials(projectId, projectConfig) {
    const credentials = {
      github: {
        token: projectConfig.githubToken || 
               process.env[`GITHUB_TOKEN_${projectId.toUpperCase()}`] ||
               process.env.GITHUB_TOKEN
      }
    };
    
    // Load from credentials file if exists
    try {
      const credPath = path.join(this.currentProject.projectPath, '.poppo', 'credentials.json');
      const credData = await fs.readFile(credPath, 'utf8');
      const fileCreds = JSON.parse(credData);
      Object.assign(credentials, fileCreds);
    } catch (error) {
      // Credentials file is optional
    }
    
    return credentials;
  }
  
  /**
   * Apply project environment variables
   */
  applyProjectEnvironment(env) {
    this.originalEnv = {};
    
    for (const [key, value] of Object.entries(env)) {
      this.originalEnv[key] = process.env[key];
      process.env[key] = value;
    }
  }
  
  /**
   * Clean up project context
   */
  async cleanupProjectContext() {
    if (!this.currentProject) return;
    
    try {
      // Restore original working directory
      if (this.currentProject.originalCwd) {
        process.chdir(this.currentProject.originalCwd);
      }
      
      // Restore original environment
      if (this.originalEnv) {
        for (const [key, value] of Object.entries(this.originalEnv)) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
        this.originalEnv = null;
      }
      
      // Emit cleanup event
      this.emit('context-cleaned', {
        projectId: this.currentProject.projectId
      });
      
    } catch (error) {
      this.emit('error', new Error(`Failed to cleanup project context: ${error.message}`));
    }
  }
  
  /**
   * Execute with timeout
   */
  async executeWithTimeout(fn, timeout) {
    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Task execution timeout after ${timeout}ms`));
      }, timeout);
      
      try {
        const result = await fn();
        clearTimeout(timer);
        resolve(result);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }
  
  /**
   * Process an issue
   */
  async processIssue(task, context) {
    const { issueNumber, issue } = task;
    const { components } = context;
    
    // Report progress
    this.emit('progress', {
      task,
      stage: 'checkout',
      message: `Checking out issue #${issueNumber}`
    });
    
    // Check out the issue
    await components.statusManager.checkout(issueNumber, this.options.workerId);
    
    try {
      // Use two-stage processor if enabled
      if (components.twoStageProcessor && components.config.twoStageProcessing?.enabled) {
        const result = await components.twoStageProcessor.processInstruction(
          issue.body,
          {
            issueNumber,
            issueTitle: issue.title,
            labels: issue.labels?.map(l => l.name) || []
          }
        );
        
        if (result.actionTaken === 'create_issue') {
          await components.statusManager.checkin(issueNumber, 'completed');
          return {
            success: true,
            actionTaken: 'create_issue',
            newIssueNumber: result.issueNumber,
            newIssueUrl: result.issueUrl
          };
        }
      }
      
      // Report progress
      this.emit('progress', {
        task,
        stage: 'execute',
        message: 'Executing with Claude'
      });
      
      // Generate system prompt
      const systemPrompt = this.generateSystemPrompt(issue, components.config);
      
      // Execute with Claude
      const result = await components.processManager.executeClaudeTask({
        type: 'issue',
        issueNumber,
        repoInfo: components.config.github,
        instructions: issue.body,
        systemPrompt,
        metadata: {
          issueTitle: issue.title,
          labels: issue.labels?.map(l => l.name) || [],
          projectId: context.projectId
        }
      });
      
      // Report progress
      this.emit('progress', {
        task,
        stage: 'respond',
        message: 'Posting response'
      });
      
      // Post result as comment
      if (result.success && result.response) {
        await components.github.createComment(
          issueNumber,
          `🤖 PoppoBuilder実行結果:\n\n${result.response}`
        );
      }
      
      // Check in the issue
      await components.statusManager.checkin(issueNumber, 'completed');
      
      return result;
      
    } catch (error) {
      // Reset issue status on error
      await components.statusManager.resetIssueStatus(issueNumber);
      throw error;
    }
  }
  
  /**
   * Process a comment
   */
  async processComment(task, context) {
    const { issueNumber, comment } = task;
    const { components } = context;
    
    // Check out the issue
    await components.statusManager.checkout(issueNumber, this.options.workerId);
    
    try {
      // Get issue details
      const issue = await components.github.getIssue(issueNumber);
      
      // Generate system prompt
      const systemPrompt = this.generateSystemPrompt(issue, components.config, comment);
      
      // Execute with Claude
      const result = await components.processManager.executeClaudeTask({
        type: 'comment',
        issueNumber,
        commentId: comment.id,
        repoInfo: components.config.github,
        instructions: comment.body,
        systemPrompt,
        metadata: {
          issueTitle: issue.title,
          labels: issue.labels?.map(l => l.name) || [],
          commentAuthor: comment.user?.login,
          projectId: context.projectId
        }
      });
      
      // Post result as reply
      if (result.success && result.response) {
        await components.github.createComment(
          issueNumber,
          `🤖 @${comment.user.login} への返信:\n\n${result.response}`
        );
      }
      
      // Check in the issue
      await components.statusManager.checkin(issueNumber, 'completed');
      
      return result;
      
    } catch (error) {
      // Reset issue status on error
      await components.statusManager.resetIssueStatus(issueNumber);
      throw error;
    }
  }
  
  /**
   * Process a pull request
   */
  async processPullRequest(task, context) {
    const { prNumber, pullRequest, action } = task;
    const { components } = context;
    
    this.emit('progress', {
      task,
      stage: 'analyze',
      message: `Analyzing PR #${prNumber}`
    });
    
    // Get PR details
    const pr = pullRequest || await components.github.getPullRequest(prNumber);
    
    // Get changed files
    const files = await components.github.getPullRequestFiles(prNumber);
    
    // Generate review context
    const reviewContext = {
      title: pr.title,
      description: pr.body,
      author: pr.user.login,
      branch: pr.head.ref,
      baseBranch: pr.base.ref,
      files: files.map(f => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes
      }))
    };
    
    // Generate system prompt for PR review
    const systemPrompt = this.generatePRSystemPrompt(pr, components.config);
    
    // Execute review with Claude
    const result = await components.processManager.executeClaudeTask({
      type: 'pr-review',
      prNumber,
      repoInfo: components.config.github,
      instructions: `Review this pull request:\n\n${JSON.stringify(reviewContext, null, 2)}`,
      systemPrompt,
      metadata: {
        prTitle: pr.title,
        author: pr.user.login,
        projectId: context.projectId
      }
    });
    
    // Post review comment
    if (result.success && result.response) {
      await components.github.createPullRequestReview(prNumber, {
        body: `🤖 PoppoBuilder PR Review:\n\n${result.response}`,
        event: 'COMMENT'
      });
    }
    
    return result;
  }
  
  /**
   * Execute Claude CLI task
   */
  async executeClaudeCLI(task, context) {
    const { instructions, taskContext } = task;
    const { components } = context;
    
    const result = await components.processManager.executeClaudeTask({
      type: 'claude-cli',
      instructions,
      context: taskContext,
      repoInfo: components.config.github,
      metadata: {
        projectId: context.projectId,
        ...task.metadata
      }
    });
    
    return result;
  }
  
  /**
   * Execute custom command
   */
  async executeCustomCommand(task, context) {
    const { command, args = [], options = {} } = task;
    
    return new Promise((resolve, reject) => {
      const childProcess = spawn(command, args, {
        cwd: context.projectPath,
        env: {
          ...process.env,
          ...context.environment
        },
        ...options
      });
      
      let stdout = '';
      let stderr = '';
      
      childProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      childProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      childProcess.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            stdout,
            stderr,
            exitCode: code
          });
        } else {
          reject(new Error(`Command failed with exit code ${code}: ${stderr}`));
        }
      });
      
      childProcess.on('error', (error) => {
        reject(error);
      });
    });
  }
  
  /**
   * Generate system prompt for Claude
   */
  generateSystemPrompt(issue, config, comment = null) {
    const language = config.language?.primary || 'en';
    const isJapanese = language === 'ja';
    
    let prompt = isJapanese ? 
      'あなたはGitHub Issueを処理する開発アシスタントです。\n' :
      'You are a development assistant processing GitHub issues.\n';
    
    // Add issue context
    prompt += isJapanese ?
      `\nIssue #${issue.number}: ${issue.title}\n` :
      `\nIssue #${issue.number}: ${issue.title}\n`;
    
    // Add labels
    if (issue.labels && issue.labels.length > 0) {
      const labelNames = issue.labels.map(l => l.name).join(', ');
      prompt += isJapanese ?
        `ラベル: ${labelNames}\n` :
        `Labels: ${labelNames}\n`;
    }
    
    // Add comment context if processing a comment
    if (comment) {
      prompt += isJapanese ?
        `\nユーザー @${comment.user.login} からのコメントに返信してください。\n` :
        `\nReply to comment from user @${comment.user.login}.\n`;
    }
    
    // Add custom system prompt if configured
    if (config.systemPrompt) {
      prompt += '\n' + config.systemPrompt;
    }
    
    return prompt;
  }
  
  /**
   * Generate system prompt for PR review
   */
  generatePRSystemPrompt(pr, config) {
    const language = config.language?.primary || 'en';
    const isJapanese = language === 'ja';
    
    let prompt = isJapanese ? 
      'あなたはコードレビューを行う開発アシスタントです。\n' :
      'You are a development assistant performing code reviews.\n';
    
    prompt += isJapanese ?
      '\n以下の観点でレビューしてください:\n' :
      '\nPlease review with the following aspects:\n';
    
    const aspects = isJapanese ? [
      '- コードの品質と可読性',
      '- 潜在的なバグや問題',
      '- パフォーマンスの考慮事項',
      '- セキュリティの懸念事項',
      '- ベストプラクティスへの準拠'
    ] : [
      '- Code quality and readability',
      '- Potential bugs or issues',
      '- Performance considerations',
      '- Security concerns',
      '- Best practices compliance'
    ];
    
    prompt += aspects.join('\n') + '\n';
    
    return prompt;
  }
  
  /**
   * Update execution metrics
   */
  updateMetrics(task, success, duration) {
    this.metrics.tasksExecuted++;
    
    if (success) {
      this.metrics.tasksSucceeded++;
    } else {
      this.metrics.tasksFailed++;
    }
    
    this.metrics.totalExecutionTime += duration;
    
    // Update project-specific metrics
    const projectMetrics = this.metrics.projectMetrics.get(task.projectId) || {
      tasksExecuted: 0,
      tasksSucceeded: 0,
      tasksFailed: 0,
      totalExecutionTime: 0
    };
    
    projectMetrics.tasksExecuted++;
    if (success) {
      projectMetrics.tasksSucceeded++;
    } else {
      projectMetrics.tasksFailed++;
    }
    projectMetrics.totalExecutionTime += duration;
    
    this.metrics.projectMetrics.set(task.projectId, projectMetrics);
  }
  
  /**
   * Get current metrics
   */
  getMetrics() {
    const projectMetrics = [];
    for (const [projectId, metrics] of this.metrics.projectMetrics) {
      projectMetrics.push({
        projectId,
        ...metrics,
        avgExecutionTime: metrics.tasksExecuted > 0 ? 
          metrics.totalExecutionTime / metrics.tasksExecuted : 0
      });
    }
    
    return {
      overall: {
        ...this.metrics,
        avgExecutionTime: this.metrics.tasksExecuted > 0 ?
          this.metrics.totalExecutionTime / this.metrics.tasksExecuted : 0
      },
      projects: projectMetrics,
      currentTask: this.currentTask ? {
        id: this.currentTask.id,
        type: this.currentTask.type,
        projectId: this.currentTask.projectId,
        executionTime: Date.now() - this.startTime
      } : null
    };
  }
  
  /**
   * Cancel current task execution
   */
  async cancel() {
    if (!this.isExecuting) {
      throw new Error('No task is currently executing');
    }
    
    this.emit('task-cancelled', {
      task: this.currentTask,
      duration: Date.now() - this.startTime
    });
    
    // Clean up project context
    await this.cleanupProjectContext();
    
    // Force stop any running processes
    if (this.currentProject?.components?.processManager) {
      // Implement process cancellation if needed
    }
    
    this.isExecuting = false;
    this.currentTask = null;
    this.currentProject = null;
  }
}

module.exports = TaskExecutor;