/**
 * Config Updater
 * Handles real-time configuration updates to running daemon
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');

class ConfigUpdater {
  constructor() {
    this.configDir = path.join(os.homedir(), '.poppobuilder');
    this.pidFile = path.join(this.configDir, 'daemon.pid');
    this.socketPath = path.join(this.configDir, 'daemon.sock');
  }

  /**
   * Notify daemon of configuration changes
   * @param {Object} changes - Configuration changes
   */
  async notifyDaemon(changes) {
    try {
      // Check if daemon is running
      const daemonInfo = await this.getDaemonInfo();
      if (!daemonInfo) {
        // Daemon not running, changes will be picked up on next start
        return { success: true, message: 'Configuration saved. Changes will take effect when daemon starts.' };
      }

      // Try to connect via socket or HTTP
      const response = await this.sendConfigUpdate(daemonInfo, changes);
      
      if (response.requiresRestart) {
        return { 
          success: true, 
          message: 'Configuration saved. Some changes require daemon restart.',
          requiresRestart: true,
          restartRequired: response.restartRequired
        };
      }

      return { 
        success: true, 
        message: 'Configuration updated successfully.',
        applied: response.applied
      };

    } catch (error) {
      // If notification fails, changes are still saved and will be used on next restart
      return { 
        success: true, 
        message: 'Configuration saved. Unable to notify running daemon.',
        error: error.message
      };
    }
  }

  /**
   * Get daemon information from PID file
   */
  async getDaemonInfo() {
    try {
      const pidContent = await fs.readFile(this.pidFile, 'utf8');
      const lines = pidContent.trim().split('\n');
      
      if (lines.length < 2) return null;
      
      const pid = parseInt(lines[0]);
      const port = parseInt(lines[1]) || null;
      
      // Check if process is running
      if (!this.isProcessRunning(pid)) {
        // Clean up stale PID file
        await fs.unlink(this.pidFile).catch(() => {});
        return null;
      }
      
      return { pid, port };
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if process is running
   */
  isProcessRunning(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Send configuration update to daemon
   */
  async sendConfigUpdate(daemonInfo, changes) {
    // First try Unix socket
    try {
      return await this.sendViaSocket(changes);
    } catch (error) {
      // Fall back to HTTP if socket fails and port is available
      if (daemonInfo.port) {
        return await this.sendViaHttp(daemonInfo.port, changes);
      }
      throw error;
    }
  }

  /**
   * Send update via Unix socket
   */
  async sendViaSocket(changes) {
    return new Promise((resolve, reject) => {
      const client = net.createConnection(this.socketPath, () => {
        const message = JSON.stringify({
          type: 'config-update',
          changes: changes,
          timestamp: Date.now()
        });
        
        client.write(message);
      });

      let response = '';
      client.on('data', (data) => {
        response += data.toString();
      });

      client.on('end', () => {
        try {
          const result = JSON.parse(response);
          resolve(result);
        } catch (error) {
          reject(new Error('Invalid response from daemon'));
        }
      });

      client.on('error', reject);
      
      // Timeout after 5 seconds
      client.setTimeout(5000);
      client.on('timeout', () => {
        client.destroy();
        reject(new Error('Connection timeout'));
      });
    });
  }

  /**
   * Send update via HTTP
   */
  async sendViaHttp(port, changes) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        type: 'config-update',
        changes: changes,
        timestamp: Date.now()
      });

      const options = {
        hostname: 'localhost',
        port: port,
        path: '/api/config/update',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 5000
      };

      const req = http.request(options, (res) => {
        let body = '';

        res.on('data', (chunk) => {
          body += chunk.toString();
        });

        res.on('end', () => {
          try {
            const result = JSON.parse(body);
            if (res.statusCode === 200) {
              resolve(result);
            } else {
              reject(new Error(result.error || 'Configuration update failed'));
            }
          } catch (error) {
            reject(new Error('Invalid response from daemon'));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Connection timeout'));
      });

      req.write(data);
      req.end();
    });
  }

  /**
   * Check which configuration changes require restart
   */
  static getRestartRequiredChanges(changes) {
    const restartRequired = [];
    const changesObj = typeof changes === 'object' ? changes : {};

    // List of configuration keys that require restart
    const restartKeys = [
      'daemon.port',
      'daemon.socketPath',
      'daemon.enabled',
      'logging.directory',
      'registry.maxProjects'
    ];

    for (const key of Object.keys(changesObj)) {
      if (restartKeys.some(rk => key.startsWith(rk))) {
        restartRequired.push(key);
      }
    }

    return restartRequired;
  }

  /**
   * Apply configuration changes that don't require restart
   */
  static getApplicableChanges(changes) {
    const applicable = [];
    const changesObj = typeof changes === 'object' ? changes : {};

    // List of configuration keys that can be applied without restart
    const liveKeys = [
      'daemon.maxProcesses',
      'daemon.schedulingStrategy',
      'defaults.checkInterval',
      'defaults.timeout',
      'defaults.retryAttempts',
      'defaults.language',
      'logging.level',
      'telemetry.enabled',
      'updates.checkForUpdates'
    ];

    for (const key of Object.keys(changesObj)) {
      if (liveKeys.some(lk => key.startsWith(lk))) {
        applicable.push(key);
      }
    }

    return applicable;
  }
}

module.exports = ConfigUpdater;