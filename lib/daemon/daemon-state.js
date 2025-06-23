/**
 * Daemon State Manager
 * Manages daemon state persistence and checks for existing instances
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class DaemonState {
  constructor() {
    this.stateDir = path.join(os.homedir(), '.poppobuilder', 'daemon');
    this.stateFile = path.join(this.stateDir, 'daemon.state');
    this.pidFile = path.join(this.stateDir, 'daemon.pid');
    this.state = {
      status: 'stopped',
      pid: null,
      startTime: null,
      lastHeartbeat: null
    };
  }

  /**
   * Initialize state management
   */
  async initialize() {
    // Ensure state directory exists
    await fs.mkdir(this.stateDir, { recursive: true });
    
    // Load existing state if available
    try {
      const data = await fs.readFile(this.stateFile, 'utf8');
      this.state = JSON.parse(data);
    } catch (error) {
      // No existing state, use defaults
    }
    
    // Write PID file
    await fs.writeFile(this.pidFile, process.pid.toString());
  }

  /**
   * Update daemon state
   */
  async updateState(updates) {
    this.state = {
      ...this.state,
      ...updates,
      lastUpdate: new Date().toISOString()
    };
    
    await fs.writeFile(this.stateFile, JSON.stringify(this.state, null, 2));
  }

  /**
   * Get current state
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Check if daemon is already running
   */
  static async checkExisting() {
    const stateDir = path.join(os.homedir(), '.poppobuilder', 'daemon');
    const pidFile = path.join(stateDir, 'daemon.pid');
    const stateFile = path.join(stateDir, 'daemon.state');
    
    try {
      // Check PID file
      const pidData = await fs.readFile(pidFile, 'utf8');
      const pid = parseInt(pidData.trim());
      
      // Check if process is still running
      if (DaemonState.isProcessRunning(pid)) {
        // Load state to get more info
        const stateData = await fs.readFile(stateFile, 'utf8');
        const state = JSON.parse(stateData);
        
        return {
          pid,
          ...state
        };
      } else {
        // Process not running, clean up stale files
        await DaemonState.cleanup();
        return null;
      }
    } catch (error) {
      // No PID file or other error
      return null;
    }
  }

  /**
   * Check if a process is running
   */
  static isProcessRunning(pid) {
    try {
      // Send signal 0 to check if process exists
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Clean up stale state files
   */
  static async cleanup() {
    const stateDir = path.join(os.homedir(), '.poppobuilder', 'daemon');
    const pidFile = path.join(stateDir, 'daemon.pid');
    const stateFile = path.join(stateDir, 'daemon.state');
    
    try {
      await fs.unlink(pidFile);
    } catch (error) {
      // Ignore if file doesn't exist
    }
    
    try {
      // Update state file to show stopped
      const stateData = await fs.readFile(stateFile, 'utf8');
      const state = JSON.parse(stateData);
      state.status = 'stopped';
      state.stopTime = new Date().toISOString();
      await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
    } catch (error) {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Get daemon status
   */
  static async getStatus() {
    const existing = await DaemonState.checkExisting();
    
    if (existing) {
      return {
        running: true,
        ...existing
      };
    } else {
      return {
        running: false,
        status: 'stopped'
      };
    }
  }

  /**
   * Force stop daemon by PID
   */
  static async forceStop(pid) {
    try {
      process.kill(pid, 'SIGTERM');
      
      // Wait a bit for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Check if still running
      if (DaemonState.isProcessRunning(pid)) {
        // Force kill
        process.kill(pid, 'SIGKILL');
      }
      
      // Clean up state files
      await DaemonState.cleanup();
      
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = DaemonState;