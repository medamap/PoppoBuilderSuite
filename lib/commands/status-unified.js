/**
 * Unified Status Command
 * Combines functionality from all three status implementations
 */

const chalk = require('chalk');
const { t, initI18n } = require('../i18n');
const Table = require('cli-table3');
const { IPCClient } = require('../daemon/ipc');
const DaemonState = require('../daemon/daemon-state');
const StatusAggregator = require('../utils/status-aggregator');
const { execSync } = require('child_process');
const TimeFormatter = require('../utils/time-formatter');
const { DISPLAY, AGENTS, TMUX, COLORS, I18N_KEYS } = require('../constants/status-constants');

class UnifiedStatusCommand {
  constructor() {
    this.aggregator = new StatusAggregator();
    this.ipcClient = null;
  }

  /**
   * Execute status command with options
   */
  async execute(options = {}) {
    try {
      // Initialize i18n if needed
      try {
        await initI18n();
      } catch (error) {
        // i18n might already be initialized
      }

      // Handle watch mode
      if (options.watch) {
        return await this.watchStatus(options);
      }

      // Get comprehensive status
      const status = await this.getComprehensiveStatus(options);

      // Output based on format
      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        await this.displayStatus(status, options);
      }

    } catch (error) {
      console.error(chalk.red(DISPLAY.ERROR_PREFIX + t('general.error') + ':'), error.message);
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    } finally {
      // Clean up IPC connection
      if (this.ipcClient) {
        try {
          await this.ipcClient.disconnect();
        } catch (error) {
          // Ignore disconnect errors
        }
      }
    }
  }

  /**
   * Ensure IPC connection is established
   */
  async ensureIPCConnection() {
    if (!this.ipcClient) {
      this.ipcClient = new IPCClient();
      await this.ipcClient.connect();
    }
    return this.ipcClient;
  }

  /**
   * Get comprehensive status from all sources
   */
  async getComprehensiveStatus(options) {
    const status = {
      daemon: null,
      projects: {},
      agents: {},
      workers: null,
      queues: null,
      health: null,
      summary: {
        totalProjects: 0,
        activeProjects: 0,
        runningProcesses: 0,
        totalProcesses: 0,
        issuesProcessed: 0,
        totalErrors: 0
      }
    };

    // 1. Check daemon status via multiple methods
    status.daemon = await this.getDaemonStatus();

    // 2. Get project status from aggregator
    const aggregatorStatus = await this.aggregator.getGlobalStatus();
    status.projects = aggregatorStatus.projects || {};
    
    // Update summary from aggregator
    if (aggregatorStatus.summary) {
      Object.assign(status.summary, aggregatorStatus.summary);
    }

    // 3. If daemon is running, get detailed info via IPC
    if (status.daemon.running && status.daemon.responsive) {
      try {
        const ipcStatus = await this.getIPCStatus();
        
        // Merge IPC data
        if (ipcStatus) {
          status.workers = ipcStatus.workers;
          status.queues = ipcStatus.queue;
          status.health = ipcStatus.health;
          
          // Merge project data from IPC
          if (ipcStatus.projects && typeof ipcStatus.projects === 'object') {
            Object.keys(ipcStatus.projects).forEach(projectId => {
              if (!status.projects[projectId]) {
                status.projects[projectId] = {};
              }
              Object.assign(status.projects[projectId], ipcStatus.projects[projectId]);
            });
          }
        }
      } catch (error) {
        if (options.verbose) {
          console.error(chalk.yellow('⚠️  IPC communication error:'), error.message);
        }
      }
    }

    // 4. Get agent status if requested
    if (options.agents !== false) {
      status.agents = await this.getAgentStatus();
    }

    // 5. Project-specific view if requested
    if (options.projectId) {
      const project = status.projects[options.projectId];
      if (!project) {
        throw new Error(`Project ${options.projectId} not found`);
      }
      return {
        project: {
          id: options.projectId,
          ...project
        },
        daemon: status.daemon
      };
    }

    return status;
  }

  /**
   * Get daemon status using multiple methods
   */
  async getDaemonStatus() {
    const status = {
      running: false,
      responsive: false,
      pid: null,
      uptime: null,
      startTime: null,
      version: null,
      error: null
    };

    // First check via DaemonState
    const daemonState = await DaemonState.checkExisting();
    if (daemonState) {
      status.pid = daemonState.pid;
      status.running = true;
      status.startTime = daemonState.startTime;
      
      // Calculate uptime
      if (daemonState.startTime) {
        status.uptime = TimeFormatter.calculateUptime(daemonState.startTime);
      }
    }

    // Try IPC connection to verify responsiveness
    if (status.running) {
      try {
        await this.ensureIPCConnection();
        const ipcStatus = await this.ipcClient.sendCommand('status');
        
        status.responsive = true;
        if (ipcStatus.daemon) {
          status.version = ipcStatus.daemon.version;
          status.uptime = ipcStatus.daemon.uptime || status.uptime;
        }
      } catch (error) {
        status.responsive = false;
        status.error = error.message;
      }
    }

    return status;
  }

  /**
   * Get detailed status via IPC
   */
  async getIPCStatus() {
    await this.ensureIPCConnection();
    return await this.ipcClient.sendCommand('status');
  }

  /**
   * Get agent (tmux session) status
   */
  async getAgentStatus() {
    // Deep clone AGENTS to avoid modifying the constant
    const agents = JSON.parse(JSON.stringify(AGENTS));

    try {
      // Check tmux sessions
      const tmuxList = execSync('tmux list-sessions 2>/dev/null || true', { encoding: 'utf8' });
      
      Object.keys(agents).forEach(sessionName => {
        if (tmuxList.includes(sessionName)) {
          agents[sessionName].status = 'running';
          
          // Get last few lines from session
          try {
            const logs = execSync(
              `tmux capture-pane -t ${sessionName} -p | grep -v "^$" | tail -${TMUX.LOG_TAIL_LINES}`,
              { encoding: 'utf8', timeout: TMUX.CAPTURE_COMMAND_TIMEOUT }
            );
            agents[sessionName].lastLog = logs.trim();
          } catch (error) {
            // Ignore capture errors
          }
        } else {
          agents[sessionName].status = 'stopped';
        }
      });
    } catch (error) {
      // tmux not available or other error
      if (process.env.DEBUG) {
        console.error('Agent status error:', error);
      }
    }

    return agents;
  }

  /**
   * Display formatted status
   */
  async displayStatus(status, options) {
    // Header
    console.log(chalk.bold.blue(t('commands:status.title') || 'PoppoBuilder Status'));
    console.log(chalk.gray('='.repeat(DISPLAY.SEPARATOR_LENGTH)));
    console.log();

    // Daemon status
    this.displayDaemonStatus(status.daemon, options);

    // Summary (only if not project-specific view)
    if (!status.project) {
      this.displaySummary(status.summary);
    }

    // Project(s)
    if (status.project) {
      this.displayProjectDetail(status.project);
    } else if (Object.keys(status.projects).length > 0) {
      this.displayProjectsTable(status.projects);
    } else {
      console.log(chalk.gray(t('commands:status.projects.noProjects') || 'No projects configured'));
      console.log();
    }

    // Workers and Queues (if daemon is running and requested)
    if (status.daemon.responsive && (options.workers || options.queues || options.verbose)) {
      if (status.workers) {
        this.displayWorkers(status.workers);
      }
      if (status.queues) {
        this.displayQueues(status.queues);
      }
    }

    // Health status (if requested)
    if (options.health && status.health) {
      this.displayHealth(status.health);
    }

    // Agent status (if available)
    if (status.agents && Object.keys(status.agents).length > 0) {
      this.displayAgents(status.agents);
    }
  }

  /**
   * Display daemon status section
   */
  displayDaemonStatus(daemon, options) {
    console.log(chalk.bold(t('commands:status.daemon.title') || 'Daemon Status:'));
    
    if (daemon.running) {
      if (daemon.responsive) {
        console.log(chalk.green(`  ${DISPLAY.SUCCESS_PREFIX} ${t('common:status.running') || 'Running'}`) + 
                   chalk.gray(` (PID: ${daemon.pid})`));
        
        if (daemon.uptime) {
          console.log(`  ${chalk.gray(t('commands:status.daemon.uptime') || 'Uptime:')} ${TimeFormatter.formatDuration(daemon.uptime)}`);
        }
        
        if (daemon.version && options.verbose) {
          console.log(`  ${chalk.gray('Version:')} ${daemon.version}`);
        }
      } else {
        console.log(chalk.yellow(`  ${DISPLAY.WARNING_PREFIX} ${t('common:status.unresponsive') || 'Unresponsive'}`) + 
                   chalk.gray(` (PID: ${daemon.pid})`));
        if (daemon.error) {
          console.log(chalk.red(`  ${t('general.error') || 'Error'}: ${daemon.error}`));
        }
      }
    } else {
      console.log(chalk.red(`  ✗ ${t('common:status.stopped') || 'Not running'}`));
    }
    console.log();
  }

  /**
   * Display summary section
   */
  displaySummary(summary) {
    console.log(chalk.bold(t('commands:status.summary.title') || 'Summary:'));
    
    const table = new Table({
      chars: { 'top': '', 'top-mid': '', 'top-left': '', 'top-right': '',
               'bottom': '', 'bottom-mid': '', 'bottom-left': '', 'bottom-right': '',
               'left': '  ', 'left-mid': '', 'mid': '', 'mid-mid': '',
               'right': '', 'right-mid': '', 'middle': ' ' },
      style: { 'padding-left': 0, 'padding-right': 2 }
    });

    // Add rows
    table.push(
      [chalk.gray(t('commands:status.summary.totalProjects') || 'Total Projects'), summary.totalProjects],
      [chalk.gray(t('commands:status.summary.activeProjects') || 'Active Projects'), chalk.green(summary.activeProjects)],
      [chalk.gray(t('commands:status.summary.runningProcesses') || 'Running Processes'), 
       `${chalk.cyan(summary.runningProcesses)}/${summary.totalProcesses}`],
      [chalk.gray(t('commands:status.summary.issuesProcessed') || 'Issues Processed'), summary.issuesProcessed]
    );

    if (summary.totalErrors > 0) {
      table.push([chalk.gray(t('commands:status.summary.totalErrors') || 'Total Errors'), chalk.red(summary.totalErrors)]);
    }

    console.log(table.toString());
    console.log();
  }

  /**
   * Display projects table
   */
  displayProjectsTable(projects) {
    console.log(chalk.bold(t('commands:status.projects.title') || 'Projects:'));
    
    const table = new Table({
      head: [
        chalk.cyan(t(I18N_KEYS.TABLE_COLUMNS.project) || 'Project'),
        chalk.cyan(t(I18N_KEYS.TABLE_COLUMNS.status) || 'Status'),
        chalk.cyan(t(I18N_KEYS.TABLE_COLUMNS.processes) || 'Processes'),
        chalk.cyan(t(I18N_KEYS.TABLE_COLUMNS.activeIssues) || 'Active Issues'),
        chalk.cyan(t(I18N_KEYS.TABLE_COLUMNS.lastActivity) || 'Last Activity')
      ],
      colWidths: DISPLAY.TABLE_COL_WIDTHS
    });

    Object.entries(projects).forEach(([projectId, project]) => {
      table.push([
        projectId.length > DISPLAY.PROJECT_ID_MAX_LENGTH 
          ? projectId.substring(0, DISPLAY.PROJECT_ID_MAX_LENGTH) + '...'
          : projectId,
        project.enabled ? chalk.green(t('common:enabled') || 'Enabled') : chalk.gray(t('common:disabled') || 'Disabled'),
        `${project.processes?.active || 0}/${project.processes?.total || 0}`,
        project.activeIssues || 0,
        project.lastActivity ? TimeFormatter.formatRelativeTime(project.lastActivity) : '-'
      ]);
    });

    console.log(table.toString());
    console.log();
  }

  /**
   * Display detailed project information
   */
  displayProjectDetail(project) {
    console.log(chalk.bold(t('commands:status.project.title') || 'Project Details:'));
    console.log(chalk.cyan(`  ${project.id}`));
    console.log(`  ${chalk.gray('Path:')} ${project.path || 'Unknown'}`);
    console.log(`  ${chalk.gray('Status:')} ${project.enabled ? chalk.green('Enabled') : chalk.gray('Disabled')}`);
    console.log(`  ${chalk.gray('Active Issues:')} ${project.activeIssues || 0}`);
    console.log(`  ${chalk.gray('Processed Issues:')} ${project.stats?.issuesProcessed || 0}`);
    
    if (project.stats?.errors > 0) {
      console.log(`  ${chalk.gray('Errors:')} ${chalk.red(project.stats.errors)}`);
    }
    
    console.log();
  }

  /**
   * Display workers information
   */
  displayWorkers(workers) {
    console.log(chalk.bold('Workers:'));
    console.log(`  ${chalk.gray('Total:')} ${workers.totalWorkers || 0}`);
    console.log(`  ${chalk.gray('Active:')} ${chalk.cyan(workers.activeWorkers || 0)}`);
    console.log(`  ${chalk.gray('Idle:')} ${workers.idleWorkers || 0}`);
    console.log();
  }

  /**
   * Display queue information
   */
  displayQueues(queues) {
    console.log(chalk.bold('Queues:'));
    console.log(`  ${chalk.gray('Pending:')} ${queues.pending || 0}`);
    console.log(`  ${chalk.gray('Active:')} ${chalk.cyan(queues.active || 0)}`);
    console.log(`  ${chalk.gray('Completed:')} ${chalk.green(queues.completed || 0)}`);
    console.log(`  ${chalk.gray('Failed:')} ${chalk.red(queues.failed || 0)}`);
    console.log();
  }

  /**
   * Display health status
   */
  displayHealth(health) {
    console.log(chalk.bold('Health Status:'));
    
    const table = new Table({
      head: [chalk.cyan('Component'), chalk.cyan('Status'), chalk.cyan('Details')],
      colWidths: [20, 15, 45]
    });

    Object.entries(health).forEach(([component, status]) => {
      const statusColor = status.healthy ? chalk.green('✓ Healthy') : chalk.red('✗ Unhealthy');
      table.push([component, statusColor, status.message || '-']);
    });

    console.log(table.toString());
    console.log();
  }

  /**
   * Display agent status
   */
  displayAgents(agents) {
    console.log(chalk.bold('Agent Sessions:'));
    
    Object.entries(agents).forEach(([sessionName, agent]) => {
      const statusIcon = agent.status === 'running' 
        ? chalk.green(DISPLAY.SUCCESS_PREFIX) 
        : chalk.red('✗');
      console.log(`  ${statusIcon} ${agent.name}: ${agent.status}`);
      
      if (agent.lastLog) {
        const indentedLog = agent.lastLog.split('\n')
          .map(line => `    ${line}`)
          .join('\n');
        console.log(chalk.gray(indentedLog));
      }
    });
    console.log();
  }

  /**
   * Watch status with live updates
   */
  async watchStatus(options) {
    console.log(chalk.blue(`${DISPLAY.INFO_PREFIX} Watching PoppoBuilder status (Press Ctrl+C to exit)...\n`));
    
    const updateInterval = options.interval || DISPLAY.WATCH_DEFAULT_INTERVAL;
    let iteration = 0;

    const update = async () => {
      // Clear screen
      process.stdout.write('\x1Bc');
      
      console.log(chalk.blue(`${DISPLAY.INFO_PREFIX} PoppoBuilder Status (Live)`));
      console.log(chalk.gray(`Updated: ${new Date().toLocaleTimeString()} (${++iteration})\n`));
      
      try {
        const status = await this.getComprehensiveStatus(options);
        await this.displayStatus(status, { ...options, watch: false });
      } catch (error) {
        console.error(chalk.red('Error updating status:'), error.message);
      }
      
      console.log(chalk.gray('\nPress Ctrl+C to exit'));
    };

    // Initial update
    await update();

    // Set up interval
    const interval = setInterval(update, updateInterval);

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      clearInterval(interval);
      console.log(chalk.blue('\n👋 Status monitoring stopped'));
      process.exit(0);
    });

    // Keep process alive
    return new Promise(() => {});
  }

}

module.exports = UnifiedStatusCommand;