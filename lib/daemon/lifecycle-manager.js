/**
 * Daemon Lifecycle Manager
 * Handles daemon lifecycle states, transitions, and component coordination
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Lifecycle states
const LifecycleStates = {
  STOPPED: 'stopped',
  STARTING: 'starting',
  RUNNING: 'running',
  RELOADING: 'reloading',
  STOPPING: 'stopping',
  ERROR: 'error'
};

// Valid state transitions
const StateTransitions = {
  [LifecycleStates.STOPPED]: [LifecycleStates.STARTING],
  [LifecycleStates.STARTING]: [LifecycleStates.RUNNING, LifecycleStates.ERROR, LifecycleStates.STOPPING],
  [LifecycleStates.RUNNING]: [LifecycleStates.RELOADING, LifecycleStates.STOPPING, LifecycleStates.ERROR],
  [LifecycleStates.RELOADING]: [LifecycleStates.RUNNING, LifecycleStates.ERROR, LifecycleStates.STOPPING],
  [LifecycleStates.STOPPING]: [LifecycleStates.STOPPED, LifecycleStates.ERROR],
  [LifecycleStates.ERROR]: [LifecycleStates.STOPPING, LifecycleStates.STOPPED]
};

// Component types
const ComponentTypes = {
  CONFIG: 'config',
  REGISTRY: 'registry',
  QUEUE: 'queue',
  WORKERS: 'workers',
  API: 'api',
  IPC: 'ipc',
  TASK_STATUS_TRACKER: 'taskStatusTracker',
  TASK_PRIORITY_MANAGER: 'taskPriorityManager',
  TASK_SCHEDULER: 'taskScheduler',
  TASK_EXECUTOR: 'taskExecutor',
  TASK_RESULT_HANDLER: 'taskResultHandler',
  TASK_RETRY_MANAGER: 'taskRetryManager'
};

// Component startup order
const STARTUP_ORDER = [
  ComponentTypes.CONFIG,
  ComponentTypes.REGISTRY,
  ComponentTypes.QUEUE,
  ComponentTypes.WORKERS,
  // ComponentTypes.TASK_STATUS_TRACKER, // 一時的にスキップ
  // ComponentTypes.TASK_PRIORITY_MANAGER, // 一時的にスキップ
  // ComponentTypes.TASK_RETRY_MANAGER, // 一時的にスキップ
  // ComponentTypes.TASK_RESULT_HANDLER, // 一時的にスキップ
  ComponentTypes.TASK_SCHEDULER,
  ComponentTypes.API,
  ComponentTypes.IPC
];

// Component shutdown order (reverse of startup)
const SHUTDOWN_ORDER = [...STARTUP_ORDER].reverse();

class LifecycleManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      stateFile: path.join(os.homedir(), '.poppobuilder', 'daemon', 'lifecycle.state'),
      healthCheckInterval: 30000, // 30 seconds
      componentTimeout: 30000, // 30 seconds for component operations
      maxRecoveryAttempts: 3,
      recoveryDelay: 5000, // 5 seconds
      gracefulShutdownTimeout: 60000, // 1 minute
      ...options
    };
    
    this.state = LifecycleStates.STOPPED;
    this.currentState = LifecycleStates.STOPPED; // Add currentState property
    this.previousState = null;
    this.components = new Map();
    this.healthChecks = new Map();
    this.healthCheckTimer = null;
    this.recoveryAttempts = new Map();
    this.stateHistory = [];
    this.transitionInProgress = false;
    
    // Initialize component states
    for (const type of Object.values(ComponentTypes)) {
      this.components.set(type, {
        type,
        status: 'stopped',
        health: 'unknown',
        lastHealthCheck: null,
        instance: null,
        startTime: null,
        errors: []
      });
    }
  }

  /**
   * Initialize the lifecycle manager
   */
  async initialize() {
    try {
      // Ensure state directory exists
      const stateDir = path.dirname(this.options.stateFile);
      await fs.mkdir(stateDir, { recursive: true });
      
      // Load previous state if exists
      await this.loadState();
      
      // Reset to stopped if was in transitional state
      if ([LifecycleStates.STARTING, LifecycleStates.STOPPING, LifecycleStates.RELOADING].includes(this.state)) {
        await this.transitionTo(LifecycleStates.STOPPED);
      }
      
      this.emit('initialized', { state: this.state });
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Register a component
   */
  registerComponent(type, instance, options = {}) {
    if (!Object.values(ComponentTypes).includes(type)) {
      throw new Error(`Invalid component type: ${type}`);
    }
    
    const component = this.components.get(type);
    component.instance = instance;
    component.status = 'registered';
    component.options = options;
    
    // Extract healthCheck from instance object
    if (instance.healthCheck && typeof instance.healthCheck === 'function') {
      this.healthChecks.set(type, instance.healthCheck);
    }
    
    this.emit('component-registered', { type, component });
  }

  /**
   * Start the daemon lifecycle
   */
  async start() {
    if (!this.canTransitionTo(LifecycleStates.STARTING)) {
      throw new Error(`Cannot start from state: ${this.state}`);
    }
    
    await this.transitionTo(LifecycleStates.STARTING);
    
    try {
      // Start components in order
      for (const type of STARTUP_ORDER) {
        await this.startComponent(type);
      }
      
      // All components started successfully
      await this.transitionTo(LifecycleStates.RUNNING);
      
      // Start health monitoring
      this.startHealthMonitoring();
      
      this.emit('started');
      
    } catch (error) {
      this.emit('error', error);
      await this.transitionTo(LifecycleStates.ERROR, error);
      
      // Attempt to stop any started components
      await this.emergencyStop();
      
      throw error;
    }
  }

  /**
   * Start a single component
   */
  async startComponent(type) {
    const component = this.components.get(type);
    
    if (!component.instance) {
      throw new Error(`Component ${type} not registered`);
    }
    
    try {
      this.emit('component-starting', { type });
      component.status = 'starting';
      component.startTime = Date.now();
      
      // Start with timeout
      const startPromise = component.instance.start ? 
        component.instance.start() : 
        Promise.resolve();
        
      await this.withTimeout(startPromise, this.options.componentTimeout);
      
      component.status = 'running';
      component.health = 'healthy';
      component.errors = [];
      
      this.emit('component-started', { type, component });
      
    } catch (error) {
      component.status = 'error';
      component.health = 'unhealthy';
      component.errors.push({
        timestamp: Date.now(),
        error: error.message
      });
      
      throw new Error(`Failed to start component ${type}: ${error.message}`);
    }
  }

  /**
   * Stop the daemon lifecycle
   */
  async stop() {
    if (!this.canTransitionTo(LifecycleStates.STOPPING)) {
      throw new Error(`Cannot stop from state: ${this.state}`);
    }
    
    await this.transitionTo(LifecycleStates.STOPPING);
    
    try {
      // Stop health monitoring
      this.stopHealthMonitoring();
      
      // Stop components in reverse order
      for (const type of SHUTDOWN_ORDER) {
        await this.stopComponent(type);
      }
      
      // All components stopped successfully
      await this.transitionTo(LifecycleStates.STOPPED);
      
      this.emit('stopped');
      
    } catch (error) {
      this.emit('error', error);
      // Still transition to stopped even if there were errors
      await this.transitionTo(LifecycleStates.STOPPED);
      throw error;
    }
  }

  /**
   * Stop a single component
   */
  async stopComponent(type, graceful = true) {
    const component = this.components.get(type);
    
    if (!component.instance || component.status === 'stopped') {
      return;
    }
    
    try {
      this.emit('component-stopping', { type, graceful });
      component.status = 'stopping';
      
      if (graceful && component.instance.stop) {
        // Graceful stop with timeout
        const stopPromise = component.instance.stop();
        await this.withTimeout(stopPromise, this.options.gracefulShutdownTimeout);
      } else if (component.instance.destroy) {
        // Force stop
        await component.instance.destroy();
      }
      
      component.status = 'stopped';
      component.health = 'unknown';
      component.instance = null;
      component.startTime = null;
      
      this.emit('component-stopped', { type, component });
      
    } catch (error) {
      component.status = 'error';
      component.errors.push({
        timestamp: Date.now(),
        error: error.message
      });
      
      // Force cleanup
      component.instance = null;
      
      throw new Error(`Failed to stop component ${type}: ${error.message}`);
    }
  }

  /**
   * Reload configuration and components
   */
  async reload() {
    if (!this.canTransitionTo(LifecycleStates.RELOADING)) {
      throw new Error(`Cannot reload from state: ${this.state}`);
    }
    
    const previousState = this.state;
    await this.transitionTo(LifecycleStates.RELOADING);
    
    try {
      this.emit('reloading');
      
      // Components that support hot reload
      const hotReloadable = ['config', 'registry'];
      
      // Hot reload supported components
      for (const type of hotReloadable) {
        const component = this.components.get(type);
        if (component.instance && component.instance.reload) {
          await this.reloadComponent(type);
        }
      }
      
      // For other components, might need restart
      const needsRestart = [];
      for (const [type, component] of this.components) {
        if (!hotReloadable.includes(type) && component.instance && !component.instance.reload) {
          needsRestart.push(type);
        }
      }
      
      // Restart components that don't support hot reload
      for (const type of needsRestart) {
        await this.restartComponent(type);
      }
      
      // Return to running state
      await this.transitionTo(LifecycleStates.RUNNING);
      
      this.emit('reloaded');
      
    } catch (error) {
      this.emit('error', error);
      
      // Try to return to previous state
      if (previousState === LifecycleStates.RUNNING) {
        await this.transitionTo(LifecycleStates.RUNNING);
      } else {
        await this.transitionTo(LifecycleStates.ERROR, error);
      }
      
      throw error;
    }
  }

  /**
   * Reload a single component
   */
  async reloadComponent(type) {
    const component = this.components.get(type);
    
    if (!component.instance || !component.instance.reload) {
      throw new Error(`Component ${type} does not support reload`);
    }
    
    try {
      this.emit('component-reloading', { type });
      
      await this.withTimeout(
        component.instance.reload(),
        this.options.componentTimeout
      );
      
      this.emit('component-reloaded', { type });
      
    } catch (error) {
      component.errors.push({
        timestamp: Date.now(),
        error: error.message
      });
      
      throw new Error(`Failed to reload component ${type}: ${error.message}`);
    }
  }

  /**
   * Restart a component
   */
  async restartComponent(type) {
    await this.stopComponent(type);
    await this.startComponent(type);
  }

  /**
   * Start health monitoring
   */
  startHealthMonitoring() {
    if (this.healthCheckTimer) {
      return;
    }
    
    const runHealthChecks = async () => {
      for (const [type, healthCheck] of this.healthChecks) {
        try {
          await this.checkComponentHealth(type, healthCheck);
        } catch (error) {
          this.emit('health-check-error', { type, error });
        }
      }
    };
    
    // Run initial health check
    runHealthChecks();
    
    // Schedule periodic health checks
    this.healthCheckTimer = setInterval(runHealthChecks, this.options.healthCheckInterval);
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Check component health
   */
  async checkComponentHealth(type, healthCheck) {
    const component = this.components.get(type);
    
    if (!component.instance || component.status !== 'running') {
      return;
    }
    
    try {
      const health = await healthCheck();
      
      component.health = health.healthy ? 'healthy' : 'unhealthy';
      component.lastHealthCheck = Date.now();
      
      if (!health.healthy) {
        this.emit('component-unhealthy', { type, component, health });
        
        // Attempt recovery
        await this.attemptComponentRecovery(type);
      } else {
        // Reset recovery attempts on successful health check
        this.recoveryAttempts.delete(type);
      }
      
    } catch (error) {
      component.health = 'unhealthy';
      component.errors.push({
        timestamp: Date.now(),
        error: error.message
      });
      
      this.emit('component-unhealthy', { type, component, error });
      await this.attemptComponentRecovery(type);
    }
  }

  /**
   * Attempt to recover an unhealthy component
   */
  async attemptComponentRecovery(type) {
    const attempts = this.recoveryAttempts.get(type) || 0;
    
    if (attempts >= this.options.maxRecoveryAttempts) {
      this.emit('component-recovery-failed', { type, attempts });
      return;
    }
    
    this.recoveryAttempts.set(type, attempts + 1);
    
    try {
      this.emit('component-recovery-attempt', { type, attempt: attempts + 1 });
      
      // Wait before attempting recovery
      await new Promise(resolve => setTimeout(resolve, this.options.recoveryDelay));
      
      // Try to restart the component
      await this.restartComponent(type);
      
      this.emit('component-recovered', { type });
      
    } catch (error) {
      this.emit('component-recovery-error', { type, error });
    }
  }

  /**
   * Emergency stop - stop all components immediately
   */
  async emergencyStop() {
    this.emit('emergency-stop');
    
    // Stop all components in parallel, ignoring errors
    const stopPromises = [];
    
    for (const [type, component] of this.components) {
      if (component.instance && component.status !== 'stopped') {
        stopPromises.push(
          this.stopComponent(type, false).catch(error => {
            this.emit('emergency-stop-error', { type, error });
          })
        );
      }
    }
    
    await Promise.allSettled(stopPromises);
  }

  /**
   * Get current lifecycle state
   */
  getState() {
    return this.state;
  }

  /**
   * Get component status
   */
  getComponentStatus(type) {
    return this.components.get(type);
  }

  /**
   * Get all components status
   */
  getAllComponentsStatus() {
    const status = {};
    for (const [type, component] of this.components) {
      status[type] = {
        status: component.status,
        health: component.health,
        uptime: component.startTime ? Date.now() - component.startTime : 0,
        lastHealthCheck: component.lastHealthCheck,
        errors: component.errors.slice(-5) // Last 5 errors
      };
    }
    return status;
  }

  /**
   * Get lifecycle statistics
   */
  getStatistics() {
    return {
      state: this.state,
      previousState: this.previousState,
      components: this.getAllComponentsStatus(),
      stateHistory: this.stateHistory.slice(-10), // Last 10 transitions
      healthyComponents: Array.from(this.components.values())
        .filter(c => c.health === 'healthy').length,
      totalComponents: this.components.size
    };
  }

  /**
   * Check if can transition to a state
   */
  canTransitionTo(newState) {
    const validTransitions = StateTransitions[this.state] || [];
    return validTransitions.includes(newState);
  }

  /**
   * Transition to a new state
   */
  async transitionTo(newState, context = null) {
    if (this.transitionInProgress) {
      throw new Error('State transition already in progress');
    }
    
    if (!this.canTransitionTo(newState)) {
      throw new Error(`Invalid state transition: ${this.state} -> ${newState}`);
    }
    
    this.transitionInProgress = true;
    
    try {
      const oldState = this.state;
      this.previousState = oldState;
      this.state = newState;
      this.currentState = newState;
      
      // Record transition
      const transition = {
        from: oldState,
        to: newState,
        timestamp: Date.now(),
        context
      };
      
      this.stateHistory.push(transition);
      
      // Persist state
      await this.saveState();
      
      this.emit('state-changed', transition);
      
    } finally {
      this.transitionInProgress = false;
    }
  }

  /**
   * Save current state to disk
   */
  async saveState() {
    const stateData = {
      state: this.state,
      previousState: this.previousState,
      components: Object.fromEntries(
        Array.from(this.components.entries()).map(([type, component]) => [
          type,
          {
            status: component.status,
            health: component.health,
            startTime: component.startTime,
            lastHealthCheck: component.lastHealthCheck
          }
        ])
      ),
      stateHistory: this.stateHistory.slice(-50), // Keep last 50 transitions
      timestamp: Date.now()
    };
    
    await fs.writeFile(this.options.stateFile, JSON.stringify(stateData, null, 2));
  }

  /**
   * Load state from disk
   */
  async loadState() {
    try {
      const data = await fs.readFile(this.options.stateFile, 'utf8');
      const stateData = JSON.parse(data);
      
      this.state = stateData.state || LifecycleStates.STOPPED;
      this.currentState = this.state;
      this.previousState = stateData.previousState;
      this.stateHistory = stateData.stateHistory || [];
      
      // Update component states
      if (stateData.components) {
        for (const [type, componentState] of Object.entries(stateData.components)) {
          const component = this.components.get(type);
          if (component) {
            Object.assign(component, componentState);
          }
        }
      }
      
    } catch (error) {
      // No state file or invalid, use defaults
      this.state = LifecycleStates.STOPPED;
      this.currentState = LifecycleStates.STOPPED;
    }
  }

  /**
   * Helper to run operation with timeout
   */
  async withTimeout(promise, timeout) {
    return Promise.race([
      promise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Operation timed out')), timeout)
      )
    ]);
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    this.stopHealthMonitoring();
    await this.saveState();
    this.removeAllListeners();
  }
}

// Export states and manager
module.exports = {
  LifecycleManager,
  LifecycleStates,
  ComponentTypes
};