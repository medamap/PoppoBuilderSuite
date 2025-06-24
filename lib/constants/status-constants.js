/**
 * Status Command Constants
 * Centralized configuration for the unified status command
 */

module.exports = {
  // Display formatting constants
  DISPLAY: {
    SEPARATOR_LENGTH: 50,
    PROJECT_ID_MAX_LENGTH: 37,
    TABLE_COL_WIDTHS: [40, 10, 10, 15, 15],
    WATCH_DEFAULT_INTERVAL: 2000,
    FORCE_EXIT_TIMEOUT: 10000, // 10 seconds for daemon shutdown
    ERROR_PREFIX: '❌ ',
    SUCCESS_PREFIX: '✓ ',
    WARNING_PREFIX: '⚠️ ',
    INFO_PREFIX: '👁️ '
  },

  // Agent session definitions
  AGENTS: {
    'pbs-main': { 
      name: 'PoppoBuilder Main', 
      status: 'unknown',
      description: 'Main PoppoBuilder processing'
    },
    'pbs-medama': { 
      name: 'MedamaRepair', 
      status: 'unknown',
      description: 'PoppoBuilder monitoring and auto-repair'
    },
    'pbs-mera': { 
      name: 'MeraCleaner', 
      status: 'unknown',
      description: 'Error comment analysis and cleanup'
    },
    'pbs-mirin': { 
      name: 'MirinOrphanManager', 
      status: 'unknown',
      description: 'Orphan issue detection and management'
    }
  },

  // tmux configuration
  TMUX: {
    LOG_TAIL_LINES: 3,
    CAPTURE_COMMAND_TIMEOUT: 2000
  },

  // Status display colors
  COLORS: {
    header: 'blue',
    success: 'green',
    error: 'red',
    warning: 'yellow',
    info: 'cyan',
    muted: 'gray'
  },

  // Translation keys mapping (for i18n consistency)
  I18N_KEYS: {
    TABLE_COLUMNS: {
      project: 'commands:list.table.project',
      status: 'commands:list.table.status',
      processes: 'commands:list.table.processes',
      activeIssues: 'commands:list.table.activeIssues',
      lastActivity: 'commands:list.table.lastActivity'
    },
    TIME: {
      days: 'common:time.days',
      hours: 'common:time.hours',
      minutes: 'common:time.minutes',
      ago: 'common:time.ago',
      justNow: 'common:time.justNow'
    }
  }
};