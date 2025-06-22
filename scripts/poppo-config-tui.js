#!/usr/bin/env node

/**
 * PoppoBuilder TUI Configuration Interface
 * Terminal-based UI for managing PoppoBuilder settings
 */

const blessed = require('blessed');
const ConfigLoader = require('../src/config-loader');
const GlobalConfig = require('../src/core/global-config');
const fs = require('fs').promises;
const path = require('path');

class ConfigTUI {
  constructor() {
    this.screen = null;
    this.configLoader = new ConfigLoader();
    this.currentConfig = null;
    this.modifiedConfig = {};
    this.currentSection = 'main';
  }

  async init() {
    // Load current configuration
    await this.loadConfig();
    
    // Create screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'PoppoBuilder Configuration'
    });

    // Create UI elements
    this.createUI();
    
    // Setup key bindings
    this.setupKeys();
    
    // Initial render
    this.screen.render();
  }

  async loadConfig() {
    // Load global config
    await GlobalConfig.initialize();
    
    // Load merged config
    this.currentConfig = this.configLoader.loadConfig();
    this.modifiedConfig = JSON.parse(JSON.stringify(this.currentConfig));
  }

  createUI() {
    // Header
    this.header = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: ' PoppoBuilder Configuration Manager',
      style: {
        fg: 'white',
        bg: 'blue',
        bold: true
      },
      align: 'center'
    });

    // Menu
    this.menu = blessed.list({
      parent: this.screen,
      top: 3,
      left: 0,
      width: '30%',
      height: '70%-3',
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'cyan'
        },
        selected: {
          bg: 'blue',
          fg: 'white'
        }
      },
      keys: true,
      mouse: true,
      label: ' Configuration Sections ',
      items: [
        'GitHub Settings',
        'Claude Settings',
        'Language Settings',
        'Storage Settings',
        'Rate Limiting',
        'Logging',
        'Backup',
        'Advanced'
      ]
    });

    // Content area
    this.content = blessed.box({
      parent: this.screen,
      top: 3,
      left: '30%',
      width: '70%',
      height: '70%-3',
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'green'
        }
      },
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      label: ' Settings '
    });

    // Status bar
    this.statusBar = blessed.box({
      parent: this.screen,
      bottom: 3,
      left: 0,
      width: '100%',
      height: 3,
      style: {
        fg: 'white',
        bg: 'black'
      }
    });

    // Help
    this.help = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: ' F1: Help | F2: Save | F3: Load | F5: Refresh | F10: Exit | Tab: Next Field | Enter: Edit ',
      style: {
        fg: 'yellow',
        bg: 'black'
      }
    });

    // Menu selection handler
    this.menu.on('select', (item, index) => {
      this.showSection(index);
    });

    // Initial section
    this.menu.select(0);
    this.showSection(0);
  }

  showSection(index) {
    this.content.setContent('');
    this.content.children.forEach(child => child.destroy());
    
    switch (index) {
      case 0: // GitHub Settings
        this.showGitHubSettings();
        break;
      case 1: // Claude Settings
        this.showClaudeSettings();
        break;
      case 2: // Language Settings
        this.showLanguageSettings();
        break;
      case 3: // Storage Settings
        this.showStorageSettings();
        break;
      case 4: // Rate Limiting
        this.showRateLimitingSettings();
        break;
      case 5: // Logging
        this.showLoggingSettings();
        break;
      case 6: // Backup
        this.showBackupSettings();
        break;
      case 7: // Advanced
        this.showAdvancedSettings();
        break;
    }
    
    this.screen.render();
  }

  showGitHubSettings() {
    this.createForm('GitHub Settings', [
      {
        label: 'Owner',
        key: 'github.owner',
        type: 'textbox',
        value: this.modifiedConfig.github?.owner || ''
      },
      {
        label: 'Repository',
        key: 'github.repo',
        type: 'textbox',
        value: this.modifiedConfig.github?.repo || ''
      },
      {
        label: 'Token',
        key: 'github.token',
        type: 'textbox',
        value: this.modifiedConfig.github?.token || process.env.GITHUB_TOKEN || '',
        censor: true
      }
    ]);
  }

  showClaudeSettings() {
    this.createForm('Claude Settings', [
      {
        label: 'Max Concurrent',
        key: 'claude.maxConcurrent',
        type: 'textbox',
        value: String(this.modifiedConfig.claude?.maxConcurrent || 3)
      },
      {
        label: 'Timeout (ms)',
        key: 'claude.timeout',
        type: 'textbox',
        value: String(this.modifiedConfig.claude?.timeout || 120000)
      },
      {
        label: 'Max Retries',
        key: 'claude.maxRetries',
        type: 'textbox',
        value: String(this.modifiedConfig.claude?.maxRetries || 3)
      },
      {
        label: 'Model',
        key: 'claude.model',
        type: 'select',
        options: ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
        value: this.modifiedConfig.claude?.model || 'claude-3-opus-20240229'
      }
    ]);
  }

  showLanguageSettings() {
    this.createForm('Language Settings', [
      {
        label: 'Primary Language',
        key: 'language.primary',
        type: 'select',
        options: ['ja', 'en'],
        value: this.modifiedConfig.language?.primary || 'ja'
      },
      {
        label: 'Output Language',
        key: 'language.output',
        type: 'select',
        options: ['ja', 'en', 'auto'],
        value: this.modifiedConfig.language?.output || 'auto'
      }
    ]);
  }

  showStorageSettings() {
    this.createForm('Storage Settings', [
      {
        label: 'Base Directory',
        key: 'storage.baseDir',
        type: 'textbox',
        value: this.modifiedConfig.storage?.baseDir || '~/.poppobuilder'
      },
      {
        label: 'Log Retention',
        key: 'storage.logs.retention',
        type: 'textbox',
        value: this.modifiedConfig.storage?.logs?.retention || '30d'
      },
      {
        label: 'Max Log Size',
        key: 'storage.logs.maxSize',
        type: 'textbox',
        value: this.modifiedConfig.storage?.logs?.maxSize || '1GB'
      },
      {
        label: 'Enable Compression',
        key: 'storage.logs.compress',
        type: 'checkbox',
        value: this.modifiedConfig.storage?.logs?.compress !== false
      }
    ]);
  }

  showRateLimitingSettings() {
    this.createForm('Rate Limiting', [
      {
        label: 'Requests per Minute',
        key: 'rateLimiting.requestsPerMinute',
        type: 'textbox',
        value: String(this.modifiedConfig.rateLimiting?.requestsPerMinute || 10)
      },
      {
        label: 'Burst Size',
        key: 'rateLimiting.burstSize',
        type: 'textbox',
        value: String(this.modifiedConfig.rateLimiting?.burstSize || 5)
      },
      {
        label: 'Retry After (ms)',
        key: 'rateLimiting.retryAfter',
        type: 'textbox',
        value: String(this.modifiedConfig.rateLimiting?.retryAfter || 60000)
      }
    ]);
  }

  showLoggingSettings() {
    this.createForm('Logging Settings', [
      {
        label: 'Log Level',
        key: 'logLevel',
        type: 'select',
        options: ['ERROR', 'WARN', 'INFO', 'DEBUG'],
        value: this.modifiedConfig.logLevel || 'INFO'
      },
      {
        label: 'Enable Rotation',
        key: 'logRotation.enabled',
        type: 'checkbox',
        value: this.modifiedConfig.logRotation?.enabled !== false
      },
      {
        label: 'Max File Size',
        key: 'logRotation.maxSize',
        type: 'textbox',
        value: String(this.modifiedConfig.logRotation?.maxSize || 104857600)
      },
      {
        label: 'Max Files',
        key: 'logRotation.maxFiles',
        type: 'textbox',
        value: String(this.modifiedConfig.logRotation?.maxFiles || 10)
      }
    ]);
  }

  showBackupSettings() {
    this.createForm('Backup Settings', [
      {
        label: 'Enable Backup',
        key: 'backup.enabled',
        type: 'checkbox',
        value: this.modifiedConfig.backup?.enabled === true
      },
      {
        label: 'Schedule (cron)',
        key: 'backup.schedule',
        type: 'textbox',
        value: this.modifiedConfig.backup?.schedule || '0 2 * * *'
      },
      {
        label: 'Retention Days',
        key: 'backup.retention',
        type: 'textbox',
        value: String(this.modifiedConfig.backup?.retention || 30)
      },
      {
        label: 'Storage Path',
        key: 'backup.storage.path',
        type: 'textbox',
        value: this.modifiedConfig.backup?.storage?.path || './backups'
      }
    ]);
  }

  showAdvancedSettings() {
    this.createForm('Advanced Settings', [
      {
        label: 'Maintenance Mode',
        key: 'maintenanceMode',
        type: 'checkbox',
        value: false
      },
      {
        label: 'Debug Mode',
        key: 'debug',
        type: 'checkbox',
        value: this.modifiedConfig.debug === true
      },
      {
        label: 'Dry Run',
        key: 'dryRun',
        type: 'checkbox',
        value: this.modifiedConfig.dryRun === true
      },
      {
        label: 'Max Task Queue Size',
        key: 'taskQueue.maxSize',
        type: 'textbox',
        value: String(this.modifiedConfig.taskQueue?.maxSize || 100)
      }
    ]);
  }

  createForm(title, fields) {
    this.content.setLabel(` ${title} `);
    
    let yOffset = 1;
    const formElements = [];

    fields.forEach((field, index) => {
      // Label
      const label = blessed.text({
        parent: this.content,
        top: yOffset,
        left: 2,
        content: field.label + ':',
        style: {
          fg: 'cyan'
        }
      });

      // Input element
      let input;
      
      if (field.type === 'textbox') {
        input = blessed.textbox({
          parent: this.content,
          top: yOffset,
          left: 25,
          width: '50%',
          height: 1,
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
          inputOnFocus: true,
          value: field.value,
          censor: field.censor
        });

        input.on('submit', (value) => {
          this.setConfigValue(field.key, value);
          this.updateStatus(`Updated ${field.label}`);
          this.screen.render();
        });
        
      } else if (field.type === 'checkbox') {
        input = blessed.checkbox({
          parent: this.content,
          top: yOffset,
          left: 25,
          checked: field.value,
          text: field.value ? 'Enabled' : 'Disabled',
          style: {
            fg: 'green'
          }
        });

        input.on('check', () => {
          input.text = 'Enabled';
          this.setConfigValue(field.key, true);
          this.updateStatus(`Enabled ${field.label}`);
          this.screen.render();
        });

        input.on('uncheck', () => {
          input.text = 'Disabled';
          this.setConfigValue(field.key, false);
          this.updateStatus(`Disabled ${field.label}`);
          this.screen.render();
        });
        
      } else if (field.type === 'select') {
        input = blessed.list({
          parent: this.content,
          top: yOffset,
          left: 25,
          width: '50%',
          height: 3,
          border: {
            type: 'line'
          },
          style: {
            border: {
              fg: 'gray'
            },
            selected: {
              bg: 'blue',
              fg: 'white'
            }
          },
          items: field.options,
          mouse: true,
          keys: true
        });

        const currentIndex = field.options.indexOf(field.value);
        if (currentIndex >= 0) {
          input.select(currentIndex);
        }

        input.on('select', (item, index) => {
          this.setConfigValue(field.key, item.content);
          this.updateStatus(`Updated ${field.label} to ${item.content}`);
        });
      }

      formElements.push({ label, input, field });
      yOffset += field.type === 'select' ? 5 : 3;
    });

    // Tab navigation
    formElements.forEach((element, index) => {
      element.input.key(['tab'], () => {
        const nextIndex = (index + 1) % formElements.length;
        formElements[nextIndex].input.focus();
      });

      element.input.key(['S-tab'], () => {
        const prevIndex = (index - 1 + formElements.length) % formElements.length;
        formElements[prevIndex].input.focus();
      });
    });

    // Focus first element
    if (formElements.length > 0) {
      formElements[0].input.focus();
    }
  }

  setConfigValue(key, value) {
    const keys = key.split('.');
    let obj = this.modifiedConfig;
    
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) {
        obj[keys[i]] = {};
      }
      obj = obj[keys[i]];
    }
    
    // Convert numeric strings to numbers
    if (typeof value === 'string' && !isNaN(value) && value !== '') {
      value = Number(value);
    }
    
    obj[keys[keys.length - 1]] = value;
  }

  updateStatus(message) {
    const timestamp = new Date().toLocaleTimeString();
    this.statusBar.setContent(` [${timestamp}] ${message}`);
    this.screen.render();
  }

  setupKeys() {
    // F1 - Help
    this.screen.key(['f1'], () => {
      this.showHelp();
    });

    // F2 - Save
    this.screen.key(['f2'], async () => {
      await this.saveConfig();
    });

    // F3 - Load
    this.screen.key(['f3'], async () => {
      await this.loadConfig();
      this.updateStatus('Configuration reloaded');
      this.showSection(this.menu.selected);
    });

    // F5 - Refresh
    this.screen.key(['f5'], () => {
      this.screen.render();
    });

    // F10 or q - Exit
    this.screen.key(['f10', 'q', 'C-c'], () => {
      this.confirmExit();
    });

    // Tab navigation between menu and content
    this.screen.key(['C-tab'], () => {
      if (this.menu.focused) {
        this.content.focus();
      } else {
        this.menu.focus();
      }
      this.screen.render();
    });
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
PoppoBuilder Configuration Manager Help

Navigation:
  - Use arrow keys to navigate menus
  - Tab/Shift+Tab to move between fields
  - Ctrl+Tab to switch between menu and content
  - Enter to edit/select

Commands:
  F1  - Show this help
  F2  - Save configuration
  F3  - Reload configuration
  F5  - Refresh screen
  F10 - Exit application
  
Configuration Files:
  - Global: ~/.poppobuilder/config.json
  - Project: .poppo/config.json
  - Main: config/config.json

Notes:
  - Settings are validated before saving
  - Some changes require restart
  - Use environment variables for sensitive data

Press any key to close this help...`,
      scrollable: true,
      keys: true
    });

    helpBox.focus();
    helpBox.key(['escape', 'enter', 'space'], () => {
      helpBox.destroy();
      this.screen.render();
    });

    this.screen.render();
  }

  async saveConfig() {
    const saveDialog = blessed.list({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: 10,
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'green'
        },
        selected: {
          bg: 'blue',
          fg: 'white'
        }
      },
      label: ' Save Configuration To ',
      items: [
        'Global Configuration (~/.poppobuilder/config.json)',
        'Project Configuration (.poppo/config.json)',
        'Cancel'
      ],
      mouse: true,
      keys: true
    });

    saveDialog.on('select', async (item, index) => {
      saveDialog.destroy();
      
      if (index === 2) {
        this.screen.render();
        return;
      }

      try {
        if (index === 0) {
          // Save to global config
          await GlobalConfig.update(this.modifiedConfig);
          this.updateStatus('Saved to global configuration');
        } else if (index === 1) {
          // Save to project config
          const projectConfigPath = path.join(process.cwd(), '.poppo', 'config.json');
          await fs.mkdir(path.dirname(projectConfigPath), { recursive: true });
          await fs.writeFile(projectConfigPath, JSON.stringify(this.modifiedConfig, null, 2));
          this.updateStatus('Saved to project configuration');
        }
      } catch (error) {
        this.updateStatus(`Error saving: ${error.message}`);
      }
      
      this.screen.render();
    });

    saveDialog.focus();
    this.screen.render();
  }

  confirmExit() {
    // Check if there are unsaved changes
    const hasChanges = JSON.stringify(this.currentConfig) !== JSON.stringify(this.modifiedConfig);
    
    if (!hasChanges) {
      process.exit(0);
    }

    const confirmBox = blessed.question({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: 7,
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'red'
        }
      },
      label: ' Unsaved Changes '
    });

    confirmBox.ask('You have unsaved changes. Exit anyway? (y/n)', (err, answer) => {
      if (answer && answer.toLowerCase() === 'y') {
        process.exit(0);
      }
      this.screen.render();
    });
  }

  async run() {
    await this.init();
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

// Run the TUI
if (require.main === module) {
  const tui = new ConfigTUI();
  tui.run().catch(error => {
    console.error('Error starting TUI:', error);
    process.exit(1);
  });
}

module.exports = ConfigTUI;