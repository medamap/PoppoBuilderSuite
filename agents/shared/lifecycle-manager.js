const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const path = require('path');

class LifecycleManager extends EventEmitter {
  constructor(logger, config = {}) {
    super();
    this.logger = logger;
    this.config = {
      gracefulShutdownTimeout: config.gracefulShutdownTimeout || 30000,
      healthCheckInterval: config.healthCheckInterval || 10000,
      startupTimeout: config.startupTimeout || 60000,
      restartDelay: config.restartDelay || 5000,
      maxRestartAttempts: config.maxRestartAttempts || 3,
      zombieCheckInterval: config.zombieCheckInterval || 60000,
      ...config
    };
    
    this.agents = new Map();
    this.healthCheckTimer = null;
    this.zombieCheckTimer = null;
    this.isRunning = false;
  }
  
  start() {
    if (this.isRunning) {
      this.logger.warn('LifecycleManager is already running');
      return;
    }
    
    this.isRunning = true;
    this.logger.info('Starting LifecycleManager', { config: this.config });
    
    this.healthCheckTimer = setInterval(() => {
      this.performHealthChecks();
    }, this.config.healthCheckInterval);
    
    this.zombieCheckTimer = setInterval(() => {
      this.checkForZombies();
    }, this.config.zombieCheckInterval);
  }
  
  stop() {
    if (!this.isRunning) {
      return;
    }
    
    this.isRunning = false;
    
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    
    if (this.zombieCheckTimer) {
      clearInterval(this.zombieCheckTimer);
      this.zombieCheckTimer = null;
    }
    
    this.logger.info('LifecycleManager stopped');
  }
  
  async spawnAgent(agentId, agentConfig) {
    if (this.agents.has(agentId)) {
      throw new Error(`Agent ${agentId} already exists`);
    }
    
    const agentInfo = {
      id: agentId,
      config: agentConfig,
      process: null,
      status: 'starting',
      startTime: Date.now(),
      restartCount: 0,
      lastHealthCheck: null,
      pid: null,
      exitCode: null,
      exitSignal: null
    };
    
    this.agents.set(agentId, agentInfo);
    
    try {
      await this.startAgent(agentInfo);
      this.logger.info('Agent spawned successfully', { agentId });
      this.emit('agent-spawned', { agentId, pid: agentInfo.pid });
      return agentInfo;
    } catch (error) {
      this.agents.delete(agentId);
      throw error;
    }
  }
  
  async startAgent(agentInfo) {
    const { id, config } = agentInfo;
    
    return new Promise((resolve, reject) => {
      const startTimeout = setTimeout(() => {
        reject(new Error(`Agent ${id} failed to start within timeout`));
      }, this.config.startupTimeout);
      
      const env = {
        ...process.env,
        AGENT_ID: id,
        AGENT_TYPE: config.type,
        ...config.env
      };
      
      const agentProcess = spawn(
        config.command || 'node',
        config.args || [],
        {
          cwd: config.cwd || process.cwd(),
          env,
          stdio: ['pipe', 'pipe', 'pipe', 'ipc']
        }
      );
      
      agentInfo.process = agentProcess;
      agentInfo.pid = agentProcess.pid;
      
      agentProcess.stdout.on('data', (data) => {
        this.logger.debug(`[${id}] stdout:`, data.toString().trim());
      });
      
      agentProcess.stderr.on('data', (data) => {
        this.logger.error(`[${id}] stderr:`, data.toString().trim());
      });
      
      agentProcess.on('message', (message) => {
        if (message.type === 'ready') {
          clearTimeout(startTimeout);
          agentInfo.status = 'running';
          resolve();
        }
        
        this.emit('agent-message', { agentId: id, message });
      });
      
      agentProcess.on('error', (error) => {
        clearTimeout(startTimeout);
        this.logger.error(`Agent ${id} process error`, error);
        agentInfo.status = 'error';
        reject(error);
      });
      
      agentProcess.on('exit', (code, signal) => {
        clearTimeout(startTimeout);
        agentInfo.exitCode = code;
        agentInfo.exitSignal = signal;
        agentInfo.status = 'stopped';
        agentInfo.process = null;
        
        this.logger.info(`Agent ${id} exited`, { code, signal });
        this.emit('agent-exit', { agentId: id, code, signal });
        
        this.handleAgentExit(agentInfo);
      });
    });
  }
  
  async handleAgentExit(agentInfo) {
    const { id, config } = agentInfo;
    
    if (!this.isRunning) {
      return;
    }
    
    if (agentInfo.restartCount < this.config.maxRestartAttempts) {
      agentInfo.restartCount++;
      
      this.logger.info(`Attempting to restart agent ${id}`, {
        attempt: agentInfo.restartCount,
        maxAttempts: this.config.maxRestartAttempts
      });
      
      setTimeout(async () => {
        try {
          await this.startAgent(agentInfo);
          this.logger.info(`Agent ${id} restarted successfully`);
          this.emit('agent-restarted', { agentId: id, attempt: agentInfo.restartCount });
        } catch (error) {
          this.logger.error(`Failed to restart agent ${id}`, error);
          agentInfo.status = 'failed';
          this.emit('agent-failed', { agentId: id, error });
        }
      }, this.config.restartDelay);
    } else {
      agentInfo.status = 'failed';
      this.logger.error(`Agent ${id} exceeded max restart attempts`);
      this.emit('agent-failed', { agentId: id, reason: 'max-restarts-exceeded' });
    }
  }
  
  async terminateAgent(agentId, force = false) {
    const agentInfo = this.agents.get(agentId);
    if (!agentInfo || !agentInfo.process) {
      throw new Error(`Agent ${agentId} not found or not running`);
    }
    
    agentInfo.status = 'stopping';
    
    if (!force) {
      await this.gracefulShutdown(agentInfo);
    } else {
      this.forceTerminate(agentInfo);
    }
    
    this.agents.delete(agentId);
    this.emit('agent-terminated', { agentId });
  }
  
  async gracefulShutdown(agentInfo) {
    const { id, process: agentProcess } = agentInfo;
    
    return new Promise((resolve) => {
      const shutdownTimeout = setTimeout(() => {
        this.logger.warn(`Agent ${id} did not shut down gracefully, forcing termination`);
        this.forceTerminate(agentInfo);
        resolve();
      }, this.config.gracefulShutdownTimeout);
      
      const exitHandler = () => {
        clearTimeout(shutdownTimeout);
        resolve();
      };
      
      agentProcess.once('exit', exitHandler);
      
      if (agentProcess.connected) {
        agentProcess.send({ type: 'shutdown' });
      }
      
      agentProcess.kill('SIGTERM');
    });
  }
  
  forceTerminate(agentInfo) {
    const { id, process: agentProcess } = agentInfo;
    
    if (agentProcess && !agentProcess.killed) {
      agentProcess.kill('SIGKILL');
      this.logger.info(`Agent ${id} force terminated`);
    }
  }
  
  async scaleAgents(targetCount, agentType) {
    const currentAgents = Array.from(this.agents.values())
      .filter(agent => agent.config.type === agentType && agent.status === 'running');
    
    const currentCount = currentAgents.length;
    const difference = targetCount - currentCount;
    
    if (difference === 0) {
      this.logger.info('No scaling needed', { currentCount, targetCount });
      return;
    }
    
    if (difference > 0) {
      await this.scaleUp(difference, agentType);
    } else {
      await this.scaleDown(Math.abs(difference), agentType, currentAgents);
    }
  }
  
  async scaleUp(count, agentType) {
    const promises = [];
    
    for (let i = 0; i < count; i++) {
      const agentId = `${agentType}-${Date.now()}-${i}`;
      const agentConfig = {
        type: agentType,
        command: 'node',
        args: [`agents/${agentType}/index.js`],
        env: {
          NODE_ENV: process.env.NODE_ENV || 'production'
        }
      };
      
      promises.push(this.spawnAgent(agentId, agentConfig));
    }
    
    await Promise.allSettled(promises);
    this.logger.info(`Scaled up ${count} agents of type ${agentType}`);
  }
  
  async scaleDown(count, agentType, currentAgents) {
    const agentsToTerminate = currentAgents
      .sort((a, b) => a.startTime - b.startTime)
      .slice(0, count);
    
    const promises = agentsToTerminate.map(agent => 
      this.terminateAgent(agent.id, false)
    );
    
    await Promise.allSettled(promises);
    this.logger.info(`Scaled down ${count} agents of type ${agentType}`);
  }
  
  async performHealthChecks() {
    const checks = [];
    
    for (const [agentId, agentInfo] of this.agents.entries()) {
      if (agentInfo.status === 'running' && agentInfo.process) {
        checks.push(this.checkAgentHealth(agentInfo));
      }
    }
    
    await Promise.allSettled(checks);
  }
  
  async checkAgentHealth(agentInfo) {
    const { id, process: agentProcess } = agentInfo;
    
    if (!agentProcess || !agentProcess.connected) {
      agentInfo.status = 'unhealthy';
      this.emit('agent-unhealthy', { agentId: id, reason: 'disconnected' });
      return;
    }
    
    return new Promise((resolve) => {
      const healthTimeout = setTimeout(() => {
        agentInfo.status = 'unhealthy';
        this.emit('agent-unhealthy', { agentId: id, reason: 'timeout' });
        resolve();
      }, 5000);
      
      const messageHandler = (message) => {
        if (message.type === 'health-response') {
          clearTimeout(healthTimeout);
          agentInfo.lastHealthCheck = Date.now();
          
          if (message.healthy) {
            agentInfo.status = 'running';
          } else {
            agentInfo.status = 'unhealthy';
            this.emit('agent-unhealthy', { agentId: id, reason: message.reason });
          }
          
          agentProcess.removeListener('message', messageHandler);
          resolve();
        }
      };
      
      agentProcess.on('message', messageHandler);
      agentProcess.send({ type: 'health-check' });
    });
  }
  
  checkForZombies() {
    for (const [agentId, agentInfo] of this.agents.entries()) {
      if (agentInfo.status === 'running' && agentInfo.process) {
        try {
          process.kill(agentInfo.pid, 0);
        } catch (error) {
          this.logger.warn(`Detected zombie agent ${agentId}`);
          agentInfo.status = 'zombie';
          agentInfo.process = null;
          this.emit('agent-zombie', { agentId });
          
          this.agents.delete(agentId);
        }
      }
    }
  }
  
  getAgentStatus(agentId) {
    const agentInfo = this.agents.get(agentId);
    if (!agentInfo) {
      return null;
    }
    
    return {
      id: agentInfo.id,
      type: agentInfo.config.type,
      status: agentInfo.status,
      pid: agentInfo.pid,
      startTime: agentInfo.startTime,
      uptime: Date.now() - agentInfo.startTime,
      restartCount: agentInfo.restartCount,
      lastHealthCheck: agentInfo.lastHealthCheck,
      exitCode: agentInfo.exitCode,
      exitSignal: agentInfo.exitSignal
    };
  }
  
  getAllAgentsStatus() {
    const agents = [];
    
    for (const [agentId] of this.agents.entries()) {
      const status = this.getAgentStatus(agentId);
      if (status) {
        agents.push(status);
      }
    }
    
    return agents;
  }
  
  async terminateAllAgents(force = false) {
    const promises = [];
    
    for (const [agentId] of this.agents.entries()) {
      promises.push(this.terminateAgent(agentId, force));
    }
    
    await Promise.allSettled(promises);
    this.logger.info('All agents terminated');
  }
}

module.exports = LifecycleManager;