const { EventEmitter } = require('events');

class LoadBalancer extends EventEmitter {
  constructor(logger, config = {}) {
    super();
    this.logger = logger;
    this.config = {
      algorithm: config.algorithm || 'round-robin',
      healthCheckInterval: config.healthCheckInterval || 30000,
      unhealthyThreshold: config.unhealthyThreshold || 3,
      healthyThreshold: config.healthyThreshold || 2,
      requestTimeout: config.requestTimeout || 30000,
      retryAttempts: config.retryAttempts || 2,
      stickySession: config.stickySession || false,
      sessionTimeout: config.sessionTimeout || 3600000,
      ...config
    };
    
    this.agents = new Map();
    this.healthChecks = new Map();
    this.sessions = new Map();
    this.roundRobinIndex = 0;
    this.requestStats = new Map();
    this.healthCheckTimer = null;
    this.isRunning = false;
  }
  
  start() {
    if (this.isRunning) {
      this.logger.warn('LoadBalancer is already running');
      return;
    }
    
    this.isRunning = true;
    this.logger.info('Starting LoadBalancer', { config: this.config });
    
    this.healthCheckTimer = setInterval(() => {
      this.performHealthChecks();
    }, this.config.healthCheckInterval);
    
    this.performHealthChecks();
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
    
    this.logger.info('LoadBalancer stopped');
  }
  
  registerAgent(agentId, agentInfo) {
    const agent = {
      id: agentId,
      ...agentInfo,
      weight: agentInfo.weight || 1,
      maxConcurrent: agentInfo.maxConcurrent || 10,
      currentLoad: 0,
      status: 'healthy',
      registeredAt: Date.now(),
      lastActivity: Date.now()
    };
    
    this.agents.set(agentId, agent);
    this.healthChecks.set(agentId, {
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastCheck: null
    });
    this.requestStats.set(agentId, {
      total: 0,
      success: 0,
      failed: 0,
      avgResponseTime: 0,
      totalResponseTime: 0
    });
    
    this.logger.info('Agent registered', { agentId, agentInfo: agent });
    this.emit('agent-registered', { agentId, agent });
  }
  
  unregisterAgent(agentId) {
    if (!this.agents.has(agentId)) {
      this.logger.warn('Attempt to unregister unknown agent', { agentId });
      return;
    }
    
    const agent = this.agents.get(agentId);
    this.agents.delete(agentId);
    this.healthChecks.delete(agentId);
    this.requestStats.delete(agentId);
    
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.agentId === agentId) {
        this.sessions.delete(sessionId);
      }
    }
    
    this.logger.info('Agent unregistered', { agentId });
    this.emit('agent-unregistered', { agentId, agent });
  }
  
  async selectAgent(task, sessionId = null) {
    if (this.config.stickySession && sessionId) {
      const session = this.sessions.get(sessionId);
      if (session && this.isAgentHealthy(session.agentId)) {
        const agent = this.agents.get(session.agentId);
        if (agent && agent.currentLoad < agent.maxConcurrent) {
          session.lastActivity = Date.now();
          return session.agentId;
        }
      }
    }
    
    const availableAgents = this.getAvailableAgents();
    if (availableAgents.length === 0) {
      throw new Error('No available agents');
    }
    
    let selectedAgentId;
    
    switch (this.config.algorithm) {
      case 'round-robin':
        selectedAgentId = this.selectRoundRobin(availableAgents);
        break;
      case 'least-connections':
        selectedAgentId = this.selectLeastConnections(availableAgents);
        break;
      case 'weighted-round-robin':
        selectedAgentId = this.selectWeightedRoundRobin(availableAgents);
        break;
      case 'response-time':
        selectedAgentId = this.selectByResponseTime(availableAgents);
        break;
      case 'random':
        selectedAgentId = this.selectRandom(availableAgents);
        break;
      default:
        selectedAgentId = this.selectRoundRobin(availableAgents);
    }
    
    if (this.config.stickySession && sessionId) {
      this.sessions.set(sessionId, {
        agentId: selectedAgentId,
        createdAt: Date.now(),
        lastActivity: Date.now()
      });
      
      this.cleanupExpiredSessions();
    }
    
    return selectedAgentId;
  }
  
  getAvailableAgents() {
    const available = [];
    
    for (const [agentId, agent] of this.agents.entries()) {
      if (this.isAgentHealthy(agentId) && agent.currentLoad < agent.maxConcurrent) {
        available.push(agentId);
      }
    }
    
    return available;
  }
  
  isAgentHealthy(agentId) {
    const agent = this.agents.get(agentId);
    return agent && agent.status === 'healthy';
  }
  
  selectRoundRobin(availableAgents) {
    const selected = availableAgents[this.roundRobinIndex % availableAgents.length];
    this.roundRobinIndex++;
    return selected;
  }
  
  selectLeastConnections(availableAgents) {
    let minLoad = Infinity;
    let selectedAgent = null;
    
    for (const agentId of availableAgents) {
      const agent = this.agents.get(agentId);
      if (agent.currentLoad < minLoad) {
        minLoad = agent.currentLoad;
        selectedAgent = agentId;
      }
    }
    
    return selectedAgent;
  }
  
  selectWeightedRoundRobin(availableAgents) {
    const weightedAgents = [];
    
    for (const agentId of availableAgents) {
      const agent = this.agents.get(agentId);
      for (let i = 0; i < agent.weight; i++) {
        weightedAgents.push(agentId);
      }
    }
    
    return weightedAgents[this.roundRobinIndex % weightedAgents.length];
  }
  
  selectByResponseTime(availableAgents) {
    let bestResponseTime = Infinity;
    let selectedAgent = null;
    
    for (const agentId of availableAgents) {
      const stats = this.requestStats.get(agentId);
      const avgResponseTime = stats.avgResponseTime || Infinity;
      
      if (avgResponseTime < bestResponseTime) {
        bestResponseTime = avgResponseTime;
        selectedAgent = agentId;
      }
    }
    
    return selectedAgent || availableAgents[0];
  }
  
  selectRandom(availableAgents) {
    return availableAgents[Math.floor(Math.random() * availableAgents.length)];
  }
  
  incrementLoad(agentId) {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.currentLoad++;
      agent.lastActivity = Date.now();
    }
  }
  
  decrementLoad(agentId) {
    const agent = this.agents.get(agentId);
    if (agent && agent.currentLoad > 0) {
      agent.currentLoad--;
    }
  }
  
  recordRequestResult(agentId, success, responseTime) {
    const stats = this.requestStats.get(agentId);
    if (!stats) return;
    
    stats.total++;
    if (success) {
      stats.success++;
    } else {
      stats.failed++;
    }
    
    stats.totalResponseTime += responseTime;
    stats.avgResponseTime = stats.totalResponseTime / stats.total;
    
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.lastActivity = Date.now();
    }
  }
  
  async performHealthChecks() {
    const checks = [];
    
    for (const [agentId, agent] of this.agents.entries()) {
      checks.push(this.checkAgentHealth(agentId));
    }
    
    await Promise.allSettled(checks);
  }
  
  async checkAgentHealth(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    
    const healthCheck = this.healthChecks.get(agentId);
    
    try {
      const isHealthy = await this.performHealthCheck(agent);
      
      if (isHealthy) {
        healthCheck.consecutiveFailures = 0;
        healthCheck.consecutiveSuccesses++;
        
        if (agent.status === 'unhealthy' && 
            healthCheck.consecutiveSuccesses >= this.config.healthyThreshold) {
          agent.status = 'healthy';
          this.logger.info('Agent marked as healthy', { agentId });
          this.emit('agent-healthy', { agentId });
        }
      } else {
        healthCheck.consecutiveSuccesses = 0;
        healthCheck.consecutiveFailures++;
        
        if (agent.status === 'healthy' && 
            healthCheck.consecutiveFailures >= this.config.unhealthyThreshold) {
          agent.status = 'unhealthy';
          this.logger.warn('Agent marked as unhealthy', { agentId });
          this.emit('agent-unhealthy', { agentId });
        }
      }
      
      healthCheck.lastCheck = Date.now();
      
    } catch (error) {
      this.logger.error('Health check failed', { agentId, error });
      healthCheck.consecutiveSuccesses = 0;
      healthCheck.consecutiveFailures++;
    }
  }
  
  async performHealthCheck(agent) {
    if (agent.healthCheck && typeof agent.healthCheck === 'function') {
      return await agent.healthCheck();
    }
    
    const timeSinceLastActivity = Date.now() - agent.lastActivity;
    return timeSinceLastActivity < this.config.healthCheckInterval * 3;
  }
  
  cleanupExpiredSessions() {
    const now = Date.now();
    const expired = [];
    
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivity > this.config.sessionTimeout) {
        expired.push(sessionId);
      }
    }
    
    for (const sessionId of expired) {
      this.sessions.delete(sessionId);
    }
    
    if (expired.length > 0) {
      this.logger.debug('Cleaned up expired sessions', { count: expired.length });
    }
  }
  
  getStatus() {
    const agents = [];
    
    for (const [agentId, agent] of this.agents.entries()) {
      const stats = this.requestStats.get(agentId);
      const healthCheck = this.healthChecks.get(agentId);
      
      agents.push({
        id: agentId,
        status: agent.status,
        currentLoad: agent.currentLoad,
        maxConcurrent: agent.maxConcurrent,
        weight: agent.weight,
        stats: {
          total: stats.total,
          success: stats.success,
          failed: stats.failed,
          successRate: stats.total > 0 ? (stats.success / stats.total * 100) : 0,
          avgResponseTime: stats.avgResponseTime
        },
        healthCheck: {
          consecutiveFailures: healthCheck.consecutiveFailures,
          consecutiveSuccesses: healthCheck.consecutiveSuccesses,
          lastCheck: healthCheck.lastCheck
        },
        lastActivity: agent.lastActivity
      });
    }
    
    return {
      algorithm: this.config.algorithm,
      totalAgents: this.agents.size,
      healthyAgents: agents.filter(a => a.status === 'healthy').length,
      unhealthyAgents: agents.filter(a => a.status === 'unhealthy').length,
      activeSessions: this.sessions.size,
      agents
    };
  }
  
  resetStats(agentId = null) {
    if (agentId) {
      const stats = this.requestStats.get(agentId);
      if (stats) {
        stats.total = 0;
        stats.success = 0;
        stats.failed = 0;
        stats.avgResponseTime = 0;
        stats.totalResponseTime = 0;
      }
    } else {
      for (const stats of this.requestStats.values()) {
        stats.total = 0;
        stats.success = 0;
        stats.failed = 0;
        stats.avgResponseTime = 0;
        stats.totalResponseTime = 0;
      }
    }
    
    this.logger.info('LoadBalancer stats reset', { agentId: agentId || 'all' });
  }
}

module.exports = LoadBalancer;