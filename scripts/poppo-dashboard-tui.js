#!/usr/bin/env node

/**
 * PoppoBuilder TUI Dashboard
 * Full-featured terminal-based dashboard for PoppoBuilder
 */

const blessed = require('blessed');
const axios = require('axios');
const chalk = require('chalk');

class DashboardTUI {
  constructor() {
    this.screen = null;
    this.apiUrl = 'http://localhost:3001/api';
    this.updateInterval = 5000;
    this.currentView = 'overview';
    this.selectedProcess = null;
    this.processes = [];
    this.systemStats = {};
    this.logs = [];
    this.updateTimer = null;
  }

  async init() {
    // Create screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'PoppoBuilder Dashboard',
      dockBorders: true,
      fullUnicode: true
    });

    // Create UI
    this.createLayout();
    
    // Setup event handlers
    this.setupEventHandlers();
    
    // Initial data load
    await this.updateData();
    
    // Start auto-update
    this.startAutoUpdate();
    
    // Initial render
    this.screen.render();
  }

  createLayout() {
    // Header
    this.header = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: '{center}🤖 PoppoBuilder Dashboard{/center}',
      tags: true,
      style: {
        fg: 'white',
        bg: 'blue',
        bold: true
      }
    });

    // Navigation
    this.navigation = blessed.listbar({
      parent: this.screen,
      top: 3,
      left: 0,
      width: '100%',
      height: 3,
      mouse: true,
      keys: true,
      style: {
        bg: 'black',
        item: {
          fg: 'white',
          bg: 'black'
        },
        selected: {
          fg: 'black',
          bg: 'green'
        }
      },
      commands: {
        'Overview': {
          keys: ['1'],
          callback: () => this.switchView('overview')
        },
        'Processes': {
          keys: ['2'],
          callback: () => this.switchView('processes')
        },
        'Logs': {
          keys: ['3'],
          callback: () => this.switchView('logs')
        },
        'Analytics': {
          keys: ['4'],
          callback: () => this.switchView('analytics')
        },
        'Health': {
          keys: ['5'],
          callback: () => this.switchView('health')
        },
        'Config': {
          keys: ['6'],
          callback: () => this.switchView('config')
        }
      }
    });

    // Main content area
    this.content = blessed.box({
      parent: this.screen,
      top: 6,
      left: 0,
      width: '100%',
      height: '100%-9',
      style: {
        fg: 'white',
        bg: 'black'
      }
    });

    // Status bar
    this.statusBar = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: ' F1: Help | F5: Refresh | F10: Exit | Tab: Navigate | Enter: Select ',
      style: {
        fg: 'yellow',
        bg: 'black'
      }
    });

    // Create views
    this.createOverviewView();
    this.createProcessesView();
    this.createLogsView();
    this.createAnalyticsView();
    this.createHealthView();
    this.createConfigView();

    // Show initial view
    this.switchView('overview');
  }

  createOverviewView() {
    this.overviewView = blessed.box({
      parent: this.content,
      hidden: true,
      style: {
        fg: 'white'
      }
    });

    // System status
    this.systemStatus = blessed.box({
      parent: this.overviewView,
      top: 0,
      left: 0,
      width: '50%',
      height: 10,
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'cyan'
        }
      },
      label: ' System Status ',
      tags: true
    });

    // Statistics
    this.statistics = blessed.box({
      parent: this.overviewView,
      top: 0,
      left: '50%',
      width: '50%',
      height: 10,
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'green'
        }
      },
      label: ' Statistics ',
      tags: true
    });

    // Recent activity
    this.recentActivity = blessed.list({
      parent: this.overviewView,
      top: 10,
      left: 0,
      width: '100%',
      height: '100%-10',
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'yellow'
        },
        selected: {
          bg: 'blue'
        }
      },
      label: ' Recent Activity ',
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      keys: true,
      vi: true
    });
  }

  createProcessesView() {
    this.processesView = blessed.box({
      parent: this.content,
      hidden: true
    });

    // Process list
    this.processList = blessed.listtable({
      parent: this.processesView,
      top: 0,
      left: 0,
      width: '60%',
      height: '100%',
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'cyan'
        },
        header: {
          fg: 'blue',
          bold: true
        },
        selected: {
          bg: 'blue'
        }
      },
      label: ' Active Processes ',
      align: 'left',
      mouse: true,
      keys: true,
      vi: true,
      scrollable: true,
      alwaysScroll: true
    });

    // Process details
    this.processDetails = blessed.box({
      parent: this.processesView,
      top: 0,
      left: '60%',
      width: '40%',
      height: '100%',
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'green'
        }
      },
      label: ' Process Details ',
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      keys: true,
      tags: true
    });
  }

  createLogsView() {
    this.logsView = blessed.box({
      parent: this.content,
      hidden: true
    });

    // Log filter
    this.logFilter = blessed.form({
      parent: this.logsView,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'cyan'
        }
      },
      label: ' Log Filter '
    });

    // Log level selector
    this.logLevelSelect = blessed.list({
      parent: this.logFilter,
      top: 0,
      left: 0,
      width: '25%',
      height: 3,
      items: ['ALL', 'ERROR', 'WARN', 'INFO', 'DEBUG'],
      style: {
        selected: {
          bg: 'blue'
        }
      },
      mouse: true,
      keys: true
    });

    // Search box
    this.logSearchBox = blessed.textbox({
      parent: this.logFilter,
      top: 0,
      left: '25%',
      width: '50%',
      height: 3,
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'gray'
        },
        focus: {
          border: {
            fg: 'green'
          }
        }
      },
      inputOnFocus: true
    });

    // Log display
    this.logDisplay = blessed.log({
      parent: this.logsView,
      top: 5,
      left: 0,
      width: '100%',
      height: '100%-5',
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'yellow'
        }
      },
      label: ' Logs ',
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      keys: true,
      tags: true
    });
  }

  createAnalyticsView() {
    this.analyticsView = blessed.box({
      parent: this.content,
      hidden: true
    });

    // Performance chart (text-based)
    this.performanceChart = blessed.box({
      parent: this.analyticsView,
      top: 0,
      left: 0,
      width: '50%',
      height: '50%',
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'cyan'
        }
      },
      label: ' Performance Metrics ',
      tags: true
    });

    // Token usage
    this.tokenUsage = blessed.box({
      parent: this.analyticsView,
      top: 0,
      left: '50%',
      width: '50%',
      height: '50%',
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'green'
        }
      },
      label: ' Token Usage ',
      tags: true
    });

    // Task statistics
    this.taskStats = blessed.table({
      parent: this.analyticsView,
      top: '50%',
      left: 0,
      width: '100%',
      height: '50%',
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'yellow'
        },
        header: {
          fg: 'blue',
          bold: true
        }
      },
      label: ' Task Statistics ',
      data: [
        ['Task Type', 'Total', 'Success', 'Failed', 'Avg Duration']
      ]
    });
  }

  createHealthView() {
    this.healthView = blessed.box({
      parent: this.content,
      hidden: true
    });

    // Overall health
    this.overallHealth = blessed.box({
      parent: this.healthView,
      top: 0,
      left: 0,
      width: '100%',
      height: 8,
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'cyan'
        }
      },
      label: ' System Health ',
      tags: true
    });

    // Component health
    this.componentHealth = blessed.list({
      parent: this.healthView,
      top: 8,
      left: 0,
      width: '50%',
      height: '100%-8',
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'green'
        }
      },
      label: ' Component Status ',
      mouse: true,
      keys: true,
      scrollable: true
    });

    // Alerts
    this.alerts = blessed.list({
      parent: this.healthView,
      top: 8,
      left: '50%',
      width: '50%',
      height: '100%-8',
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'red'
        }
      },
      label: ' Active Alerts ',
      mouse: true,
      keys: true,
      scrollable: true
    });
  }

  createConfigView() {
    this.configView = blessed.box({
      parent: this.content,
      hidden: true
    });

    // Configuration summary
    this.configSummary = blessed.box({
      parent: this.configView,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'cyan'
        }
      },
      label: ' Configuration ',
      content: '\n  Press C to open Configuration Manager\n\n  Current configuration is displayed here in read-only mode.\n',
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      keys: true
    });
  }

  setupEventHandlers() {
    // Global keys
    this.screen.key(['f5', 'r'], () => {
      this.updateData();
    });

    this.screen.key(['f1', '?'], () => {
      this.showHelp();
    });

    this.screen.key(['f10', 'q', 'C-c'], () => {
      this.quit();
    });

    this.screen.key(['tab'], () => {
      this.screen.focusNext();
    });

    this.screen.key(['S-tab'], () => {
      this.screen.focusPrevious();
    });

    // Process list selection
    this.processList.on('select', (item, index) => {
      if (index > 0 && this.processes[index - 1]) {
        this.selectedProcess = this.processes[index - 1];
        this.updateProcessDetails();
      }
    });

    // Config view shortcut
    this.configSummary.key(['c', 'C'], () => {
      this.openConfigManager();
    });
  }

  switchView(view) {
    // Hide all views
    this.overviewView.hide();
    this.processesView.hide();
    this.logsView.hide();
    this.analyticsView.hide();
    this.healthView.hide();
    this.configView.hide();

    // Show selected view
    switch (view) {
      case 'overview':
        this.overviewView.show();
        break;
      case 'processes':
        this.processesView.show();
        break;
      case 'logs':
        this.logsView.show();
        break;
      case 'analytics':
        this.analyticsView.show();
        break;
      case 'health':
        this.healthView.show();
        break;
      case 'config':
        this.configView.show();
        this.updateConfigView();
        break;
    }

    this.currentView = view;
    this.screen.render();
  }

  async updateData() {
    try {
      // Update timestamp
      const now = new Date().toLocaleString();
      this.statusBar.setContent(` Last Update: ${now} | F1: Help | F5: Refresh | F10: Exit `);

      // Fetch data based on current view
      switch (this.currentView) {
        case 'overview':
          await this.updateOverview();
          break;
        case 'processes':
          await this.updateProcesses();
          break;
        case 'logs':
          await this.updateLogs();
          break;
        case 'analytics':
          await this.updateAnalytics();
          break;
        case 'health':
          await this.updateHealth();
          break;
      }

      this.screen.render();
    } catch (error) {
      this.showError(`Failed to update data: ${error.message}`);
    }
  }

  async updateOverview() {
    // Fetch system stats
    const statsResponse = await axios.get(`${this.apiUrl}/system/stats`);
    this.systemStats = statsResponse.data;

    // Update system status
    this.systemStatus.setContent(`
  {bold}Status:{/bold} {green-fg}Running{/green-fg}
  {bold}Uptime:{/bold} ${this.formatUptime(this.systemStats.uptime || 0)}
  {bold}Memory:{/bold} ${this.formatMemory(this.systemStats.memory)}
  {bold}CPU:{/bold} ${this.systemStats.cpu || 'N/A'}%
  {bold}Active Tasks:{/bold} ${this.systemStats.activeTasks || 0}
    `);

    // Update statistics
    this.statistics.setContent(`
  {bold}Total Processes:{/bold} ${this.systemStats.totalProcesses || 0}
  {bold}Running:{/bold} {green-fg}${this.systemStats.runningProcesses || 0}{/green-fg}
  {bold}Completed:{/bold} {blue-fg}${this.systemStats.completedProcesses || 0}{/blue-fg}
  {bold}Failed:{/bold} {red-fg}${this.systemStats.failedProcesses || 0}{/red-fg}
  {bold}Success Rate:{/bold} ${this.systemStats.successRate || 0}%
    `);

    // Update recent activity
    const processesResponse = await axios.get(`${this.apiUrl}/processes`);
    const recentProcesses = processesResponse.data.slice(0, 20);
    
    const activityItems = recentProcesses.map(p => {
      const status = this.getStatusColor(p.status);
      return `${p.startTime} | ${status} | ${p.taskType} | ${p.description || 'N/A'}`;
    });
    
    this.recentActivity.setItems(activityItems);
  }

  async updateProcesses() {
    // Fetch processes
    const response = await axios.get(`${this.apiUrl}/processes/running`);
    this.processes = response.data;

    // Update process list
    const headers = ['PID', 'Task ID', 'Type', 'Status', 'Duration'];
    const rows = [headers];
    
    this.processes.forEach(p => {
      rows.push([
        p.pid || 'N/A',
        p.taskId.substring(0, 8),
        p.taskType,
        p.status,
        this.formatDuration(p.duration)
      ]);
    });

    this.processList.setData(rows);

    // Update details if a process is selected
    if (this.selectedProcess) {
      this.updateProcessDetails();
    }
  }

  async updateLogs() {
    // Fetch recent logs
    const params = new URLSearchParams({
      limit: 100,
      level: this.logLevelSelect.selected || 0
    });
    
    const response = await axios.get(`${this.apiUrl}/logs/search?${params}`);
    this.logs = response.data.results;

    // Update log display
    this.logDisplay.setContent('');
    this.logs.forEach(log => {
      const color = this.getLogColor(log.level);
      const line = `[${log.timestamp}] ${color}[${log.level}]{/} ${log.message}`;
      this.logDisplay.log(line);
    });
  }

  async updateAnalytics() {
    // Fetch analytics data
    const statsResponse = await axios.get(`${this.apiUrl}/analytics/statistics/all');
    const stats = statsResponse.data;

    // Update performance chart (simplified text representation)
    const perfData = this.createTextChart(stats.performance || []);
    this.performanceChart.setContent(perfData);

    // Update token usage
    const tokenResponse = await axios.get(`${this.apiUrl}/token-usage/usage`);
    const tokenData = tokenResponse.data;
    
    this.tokenUsage.setContent(`
  {bold}Today:{/bold} ${tokenData.today || 0}
  {bold}This Week:{/bold} ${tokenData.week || 0}
  {bold}This Month:{/bold} ${tokenData.month || 0}
  {bold}Total:{/bold} ${tokenData.total || 0}
  
  {bold}Cost Estimate:{/bold} $${(tokenData.total * 0.00002).toFixed(2)}
    `);

    // Update task statistics
    const taskStats = stats.taskTypes || [];
    const tableData = [
      ['Task Type', 'Total', 'Success', 'Failed', 'Avg Duration']
    ];
    
    taskStats.forEach(stat => {
      tableData.push([
        stat.type,
        stat.total.toString(),
        stat.success.toString(),
        stat.failed.toString(),
        this.formatDuration(stat.avgDuration)
      ]);
    });
    
    this.taskStats.setData(tableData);
  }

  async updateHealth() {
    // Fetch health data
    const response = await axios.get(`${this.apiUrl}/health/detailed`);
    const health = response.data;

    // Update overall health
    const overallStatus = health.status === 'healthy' ? '{green-fg}Healthy{/green-fg}' : 
                         health.status === 'degraded' ? '{yellow-fg}Degraded{/yellow-fg}' : 
                         '{red-fg}Unhealthy{/red-fg}';
    
    this.overallHealth.setContent(`
  {bold}Status:{/bold} ${overallStatus}
  {bold}Score:{/bold} ${health.score || 0}/100
  {bold}Uptime:{/bold} ${this.formatUptime(health.uptime || 0)}
  {bold}Last Check:{/bold} ${new Date(health.timestamp).toLocaleString()}
    `);

    // Update component health
    const components = health.components || {};
    const componentItems = Object.entries(components).map(([name, status]) => {
      const statusColor = status.healthy ? '{green-fg}✓{/green-fg}' : '{red-fg}✗{/red-fg}';
      return `${statusColor} ${name}: ${status.message || 'OK'}`;
    });
    
    this.componentHealth.setItems(componentItems);

    // Update alerts
    const alerts = health.alerts || [];
    const alertItems = alerts.map(alert => {
      const level = alert.level === 'critical' ? '{red-fg}CRITICAL{/red-fg}' : 
                   alert.level === 'warning' ? '{yellow-fg}WARNING{/yellow-fg}' : 
                   '{blue-fg}INFO{/blue-fg}';
      return `${level} ${alert.message}`;
    });
    
    this.alerts.setItems(alertItems.length > 0 ? alertItems : ['No active alerts']);
  }

  async updateConfigView() {
    // Fetch current configuration
    const response = await axios.get(`${this.apiUrl}/config/current`);
    const config = response.data;

    // Format configuration for display
    const configText = this.formatConfig(config.final || {});
    this.configSummary.setContent(configText);
  }

  updateProcessDetails() {
    if (!this.selectedProcess) return;

    const p = this.selectedProcess;
    const details = `
  {bold}Task ID:{/bold} ${p.taskId}
  {bold}Type:{/bold} ${p.taskType}
  {bold}Status:{/bold} ${this.getStatusColor(p.status)}
  {bold}PID:{/bold} ${p.pid || 'N/A'}
  {bold}Started:{/bold} ${p.startTime}
  {bold}Duration:{/bold} ${this.formatDuration(p.duration)}
  {bold}Memory:{/bold} ${this.formatMemory(p.memory)}
  {bold}CPU:{/bold} ${p.cpu || 0}%
  
  {bold}Description:{/bold}
  ${p.description || 'No description available'}
  
  {bold}Output:{/bold}
  ${p.output ? p.output.slice(-500) : 'No output available'}
    `;

    this.processDetails.setContent(details);
  }

  startAutoUpdate() {
    this.updateTimer = setInterval(() => {
      this.updateData();
    }, this.updateInterval);
  }

  stopAutoUpdate() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  formatDuration(ms) {
    if (!ms) return 'N/A';
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  formatMemory(bytes) {
    if (!bytes) return 'N/A';
    
    const mb = bytes / (1024 * 1024);
    if (mb > 1024) {
      return `${(mb / 1024).toFixed(2)} GB`;
    } else {
      return `${mb.toFixed(2)} MB`;
    }
  }

  formatConfig(config, indent = 2) {
    const lines = [];
    const prefix = ' '.repeat(indent);
    
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'object' && value !== null) {
        lines.push(`${prefix}{bold}${key}:{/bold}`);
        lines.push(this.formatConfig(value, indent + 2));
      } else {
        lines.push(`${prefix}{bold}${key}:{/bold} ${value}`);
      }
    }
    
    return lines.join('\n');
  }

  createTextChart(data) {
    if (!data || data.length === 0) {
      return '\n  No data available\n';
    }

    const maxValue = Math.max(...data.map(d => d.value));
    const height = 10;
    const width = 40;
    
    let chart = '\n';
    
    // Create chart
    for (let i = height; i > 0; i--) {
      const threshold = (i / height) * maxValue;
      let line = '  ';
      
      data.slice(-width).forEach(d => {
        line += d.value >= threshold ? '█' : ' ';
      });
      
      chart += line + '\n';
    }
    
    // Add axis
    chart += '  ' + '─'.repeat(Math.min(data.length, width)) + '\n';
    
    return chart;
  }

  getStatusColor(status) {
    switch (status) {
      case 'running':
        return '{yellow-fg}' + status + '{/yellow-fg}';
      case 'completed':
        return '{green-fg}' + status + '{/green-fg}';
      case 'failed':
      case 'error':
        return '{red-fg}' + status + '{/red-fg}';
      default:
        return status;
    }
  }

  getLogColor(level) {
    switch (level) {
      case 'ERROR':
        return '{red-fg}';
      case 'WARN':
        return '{yellow-fg}';
      case 'INFO':
        return '{green-fg}';
      case 'DEBUG':
        return '{blue-fg}';
      default:
        return '{white-fg}';
    }
  }

  showHelp() {
    const helpBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '80%',
      height: '80%',
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'yellow'
        }
      },
      label: ' Help ',
      content: `
PoppoBuilder TUI Dashboard Help

Navigation:
  1-6     - Switch between views
  Tab     - Move focus forward
  S-Tab   - Move focus backward
  Enter   - Select item
  Arrow   - Navigate lists

Commands:
  F1/?    - Show this help
  F5/r    - Refresh data
  F10/q   - Exit dashboard
  c       - Open config manager (in Config view)

Views:
  1. Overview   - System status and recent activity
  2. Processes  - Active process management
  3. Logs       - Real-time log viewer
  4. Analytics  - Performance metrics and statistics
  5. Health     - System health monitoring
  6. Config     - Configuration overview

Tips:
  - Auto-refresh is enabled (5 seconds)
  - Click on items with mouse support
  - Process details update automatically

Press any key to close...`,
      scrollable: true,
      keys: true,
      tags: true
    });

    helpBox.focus();
    helpBox.key(['escape', 'enter', 'space'], () => {
      helpBox.destroy();
      this.screen.render();
    });

    this.screen.render();
  }

  showError(message) {
    const errorBox = blessed.message({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: 'shrink',
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'red'
        }
      },
      label: ' Error '
    });

    errorBox.error(message, () => {
      this.screen.render();
    });
  }

  openConfigManager() {
    // Stop auto-update
    this.stopAutoUpdate();
    
    // Clear screen and run config TUI
    this.screen.destroy();
    
    const { spawn } = require('child_process');
    const configTUI = spawn('node', ['scripts/poppo-config-tui.js'], {
      stdio: 'inherit'
    });

    configTUI.on('close', () => {
      // Restart dashboard
      this.init();
    });
  }

  quit() {
    this.stopAutoUpdate();
    process.exit(0);
  }

  async run() {
    try {
      await this.init();
    } catch (error) {
      console.error('Failed to start dashboard:', error);
      process.exit(1);
    }
  }
}

// Check if blessed is installed
try {
  require.resolve('blessed');
} catch (e) {
  console.error('Error: blessed package is not installed.');
  console.log('Please install it by running:');
  console.log('  npm install blessed');
  process.exit(1);
}

// Run the dashboard
if (require.main === module) {
  const dashboard = new DashboardTUI();
  dashboard.run();
}

module.exports = DashboardTUI;