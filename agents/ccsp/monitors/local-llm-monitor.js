/**
 * Local LLM Usage Monitor
 * 
 * For users running local LLMs (Ollama, LM Studio, etc.)
 */

const UsageMonitorInterface = require('../usage-monitor-interface');

class LocalLLMMonitor extends UsageMonitorInterface {
  constructor(config = {}) {
    super();
    this.config = {
      provider: config.provider || 'ollama',
      endpoint: config.endpoint || 'http://localhost:11434',
      resourceLimits: {
        maxConcurrent: config.maxConcurrent || 3,
        maxMemoryGB: config.maxMemoryGB || 16,
        maxGPUMemoryGB: config.maxGPUMemoryGB || 8
      },
      ...config
    };
    this.metrics = {
      requestsToday: 0,
      tokensProcessed: 0,
      averageLatency: 0,
      startTime: Date.now()
    };
  }

  async getCurrentUsage() {
    // For local LLMs, monitor system resources instead of tokens/cost
    const systemResources = await this.getSystemResources();
    
    return {
      type: 'local',
      provider: this.config.provider,
      resources: {
        cpu: {
          usage: systemResources.cpuUsage,
          cores: systemResources.cpuCores,
          unit: 'percentage'
        },
        memory: {
          used: systemResources.memoryUsed,
          total: systemResources.memoryTotal,
          percentage: (systemResources.memoryUsed / systemResources.memoryTotal) * 100,
          unit: 'GB'
        },
        gpu: systemResources.gpuAvailable ? {
          used: systemResources.gpuMemoryUsed,
          total: systemResources.gpuMemoryTotal,
          percentage: (systemResources.gpuMemoryUsed / systemResources.gpuMemoryTotal) * 100,
          unit: 'GB'
        } : null
      },
      metrics: {
        requestsToday: this.metrics.requestsToday,
        tokensProcessed: this.metrics.tokensProcessed,
        averageLatency: this.metrics.averageLatency,
        uptime: Math.floor((Date.now() - this.metrics.startTime) / 1000 / 60) // minutes
      },
      canContinue: this.checkResourceAvailability(systemResources)
    };
  }

  async getSystemResources() {
    // This is a simplified version - in production, use proper system monitoring
    const os = require('os');
    
    const totalMemory = os.totalmem() / (1024 * 1024 * 1024); // GB
    const freeMemory = os.freemem() / (1024 * 1024 * 1024); // GB
    const cpuUsage = os.loadavg()[0] / os.cpus().length * 100; // Rough estimate
    
    return {
      cpuUsage: Math.min(100, cpuUsage),
      cpuCores: os.cpus().length,
      memoryUsed: totalMemory - freeMemory,
      memoryTotal: totalMemory,
      gpuAvailable: false, // Would need nvidia-smi or similar
      gpuMemoryUsed: 0,
      gpuMemoryTotal: 0
    };
  }

  checkResourceAvailability(resources) {
    // Check if we have enough resources to continue
    const memoryOk = resources.memoryUsed < this.config.resourceLimits.maxMemoryGB * 0.9;
    const cpuOk = resources.cpuUsage < 90;
    
    return memoryOk && cpuOk;
  }

  async canContinue(priority = 'normal') {
    const usage = await this.getCurrentUsage();
    
    if (!usage.canContinue) {
      return {
        canContinue: false,
        reason: 'System resources exhausted'
      };
    }
    
    // For local LLMs, prioritize based on system load
    const memoryPercentage = usage.resources.memory.percentage;
    
    if (priority === 'critical') {
      return {
        canContinue: memoryPercentage < 95,
        reason: memoryPercentage >= 95 ? 'Critical memory threshold reached' : null
      };
    }
    
    if (priority === 'high') {
      return {
        canContinue: memoryPercentage < 85,
        reason: memoryPercentage >= 85 ? 'High memory usage detected' : null
      };
    }
    
    // Normal and low priority
    return {
      canContinue: memoryPercentage < 75,
      reason: memoryPercentage >= 75 ? 'Memory usage high for non-priority tasks' : null
    };
  }

  async getRecommendations() {
    const usage = await this.getCurrentUsage();
    const recommendations = [];
    
    // Memory recommendations
    if (usage.resources.memory.percentage > 80) {
      recommendations.push({
        level: 'warning',
        message: 'High memory usage. Consider reducing model size or concurrent requests.'
      });
    }
    
    // CPU recommendations
    if (usage.resources.cpu.usage > 80) {
      recommendations.push({
        level: 'warning',
        message: 'High CPU usage. Tasks may process slowly.'
      });
    }
    
    // Performance recommendations
    if (this.metrics.averageLatency > 5000) {
      recommendations.push({
        level: 'info',
        message: 'Consider using GPU acceleration or a smaller model for better performance.'
      });
    }
    
    return recommendations;
  }

  getPlanInfo() {
    return {
      name: `Local LLM (${this.config.provider})`,
      type: 'self-hosted',
      description: 'Self-hosted language model with no external costs',
      pricing: 'Free (hardware costs only)',
      limits: {
        concurrent: this.config.resourceLimits.maxConcurrent,
        memory: `${this.config.resourceLimits.maxMemoryGB}GB`,
        gpu: this.config.resourceLimits.maxGPUMemoryGB ? `${this.config.resourceLimits.maxGPUMemoryGB}GB` : 'N/A'
      },
      features: [
        'No API costs',
        'Complete privacy',
        'Unlimited requests',
        'Dependent on hardware',
        'Customizable models'
      ]
    };
  }

  // Track metrics for local usage
  recordRequest(tokens, latency) {
    this.metrics.requestsToday++;
    this.metrics.tokensProcessed += tokens;
    
    // Update average latency
    const currentAvg = this.metrics.averageLatency;
    const totalRequests = this.metrics.requestsToday;
    this.metrics.averageLatency = ((currentAvg * (totalRequests - 1)) + latency) / totalRequests;
  }
}

module.exports = LocalLLMMonitor;