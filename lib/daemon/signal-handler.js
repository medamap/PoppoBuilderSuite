/**
 * Signal Handler
 * Handles system signals for graceful daemon management
 */

class SignalHandler {
  constructor(daemonManager) {
    this.daemonManager = daemonManager;
    this.signals = {
      'SIGTERM': this.handleSigterm.bind(this),
      'SIGINT': this.handleSigint.bind(this),
      'SIGHUP': this.handleSighup.bind(this),
      'SIGUSR1': this.handleSigusr1.bind(this),
      'SIGUSR2': this.handleSigusr2.bind(this)
    };
    this.cleanupHandlers = [];
  }

  /**
   * Set up signal handlers
   */
  setup() {
    // Prevent default behavior for some signals
    process.on('SIGTERM', () => {});
    process.on('SIGINT', () => {});
    
    // Set up signal handlers
    for (const [signal, handler] of Object.entries(this.signals)) {
      process.on(signal, handler);
    }
    
    // Handle uncaught exceptions and rejections
    process.on('uncaughtException', this.handleUncaughtException.bind(this));
    process.on('unhandledRejection', this.handleUnhandledRejection.bind(this));
    
    console.log('Signal handlers set up');
  }

  /**
   * Clean up signal handlers
   */
  cleanup() {
    for (const [signal, handler] of Object.entries(this.signals)) {
      process.removeListener(signal, handler);
    }
    
    // Run cleanup handlers
    for (const handler of this.cleanupHandlers) {
      try {
        handler();
      } catch (error) {
        console.error('Error in cleanup handler:', error);
      }
    }
  }

  /**
   * Add cleanup handler
   */
  addCleanupHandler(handler) {
    this.cleanupHandlers.push(handler);
  }

  /**
   * Handle SIGTERM - Graceful shutdown
   */
  async handleSigterm() {
    console.log('Received SIGTERM, initiating graceful shutdown...');
    try {
      await this.daemonManager.stop();
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  }

  /**
   * Handle SIGINT - Graceful shutdown (Ctrl+C)
   */
  async handleSigint() {
    console.log('Received SIGINT, initiating graceful shutdown...');
    try {
      await this.daemonManager.stop();
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  }

  /**
   * Handle SIGHUP - Reload configuration
   */
  async handleSighup() {
    console.log('Received SIGHUP, reloading configuration...');
    try {
      await this.daemonManager.reload();
    } catch (error) {
      console.error('Error reloading configuration:', error);
    }
  }

  /**
   * Handle SIGUSR1 - Dump status/diagnostics
   */
  async handleSigusr1() {
    console.log('Received SIGUSR1, dumping status...');
    try {
      const status = await this.daemonManager.getStatus();
      console.log('=== Daemon Status ===');
      console.log(JSON.stringify(status, null, 2));
      console.log('===================');
      
      // Also emit status event
      this.daemonManager.emit('status', status);
    } catch (error) {
      console.error('Error dumping status:', error);
    }
  }

  /**
   * Handle SIGUSR2 - Custom handler (e.g., rotate logs)
   */
  async handleSigusr2() {
    console.log('Received SIGUSR2');
    // Can be used for custom operations like log rotation
    this.daemonManager.emit('sigusr2');
  }

  /**
   * Handle uncaught exceptions
   */
  handleUncaughtException(error) {
    console.error('Uncaught exception:', error);
    
    // Log the error
    this.daemonManager.emit('error', error);
    
    // Attempt graceful shutdown
    this.daemonManager.stop().then(() => {
      process.exit(1);
    }).catch(() => {
      // Force exit if graceful shutdown fails
      process.exit(1);
    });
  }

  /**
   * Handle unhandled promise rejections
   */
  handleUnhandledRejection(reason, promise) {
    console.error('Unhandled promise rejection:', reason);
    
    // Log the error
    this.daemonManager.emit('error', new Error(`Unhandled rejection: ${reason}`));
    
    // In production, you might want to exit
    // For now, just log it
  }
}

module.exports = SignalHandler;