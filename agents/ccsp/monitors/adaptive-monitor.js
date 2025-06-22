/**
 * Adaptive Usage Monitor
 * 
 * Automatically adapts to the actual usage patterns and limits
 */

const UsageMonitorInterface = require('../usage-monitor-interface');
const CcusageMonitor = require('../ccusage-prototype');

class AdaptiveMonitor extends UsageMonitorInterface {
  constructor(config = {}) {
    super();
    this.config = config;
    this.ccusage = new CcusageMonitor();
    this.history = [];
    this.estimatedLimit = null;
  }

  async getCurrentUsage() {
    // Get raw data from ccusage
    const blocksData = await this.ccusage.executeCcusage('blocks --active --json');
    
    if (!blocksData.blocks || blocksData.blocks.length === 0) {
      return this.getEmptyStatus();
    }

    const currentBlock = blocksData.blocks[0];
    
    // Try to estimate the limit from historical data
    if (!this.estimatedLimit) {
      this.estimatedLimit = await this.estimateTokenLimit();
    }

    // Calculate remaining tokens if we have a limit
    let remainingTokens = null;
    let percentageUsed = null;
    let timeToLimit = null;
    
    if (this.estimatedLimit) {
      remainingTokens = this.estimatedLimit - currentBlock.totalTokens;
      percentageUsed = (currentBlock.totalTokens / this.estimatedLimit) * 100;
      
      // Calculate when we'll hit the limit at current burn rate
      if (currentBlock.burnRate && currentBlock.burnRate.tokensPerMinute > 0) {
        timeToLimit = Math.floor(remainingTokens / currentBlock.burnRate.tokensPerMinute);
      }
    }

    return {
      type: 'adaptive',
      block: {
        startTime: currentBlock.startTime,
        endTime: currentBlock.endTime,
        isActive: currentBlock.isActive,
        elapsedMinutes: this.getElapsedMinutes(currentBlock.startTime),
        remainingMinutes: this.getRemainingMinutes(currentBlock.startTime)
      },
      tokens: {
        used: currentBlock.totalTokens,
        limit: this.estimatedLimit,
        remaining: remainingTokens,
        percentage: percentageUsed,
        unit: 'tokens'
      },
      burnRate: currentBlock.burnRate,
      projection: currentBlock.projection,
      timeToLimit,
      canContinue: this.canContinueBasedOnUsage(currentBlock, remainingTokens),
      confidence: this.estimatedLimit ? 'estimated' : 'unknown'
    };
  }

  async estimateTokenLimit() {
    try {
      // Get recent blocks to find the maximum tokens used in a complete block
      const recentData = await this.ccusage.executeCcusage('blocks --recent --json');
      
      if (!recentData.blocks || recentData.blocks.length === 0) {
        return null;
      }

      // Find completed blocks (5 hours duration)
      const completedBlocks = recentData.blocks.filter(block => {
        if (!block.startTime || !block.endTime) return false;
        const duration = new Date(block.endTime) - new Date(block.startTime);
        const hours = duration / (1000 * 60 * 60);
        return hours >= 4.5 && hours <= 5.5; // Allow some variance
      });

      if (completedBlocks.length === 0) {
        return null;
      }

      // Find the maximum tokens used in any completed block
      const maxTokens = Math.max(...completedBlocks.map(b => b.totalTokens || 0));
      
      // Check if user hit limits (high token usage near end of block)
      const likelyLimitBlocks = completedBlocks.filter(block => {
        const usage = block.totalTokens || 0;
        return usage > maxTokens * 0.95; // Blocks that used >95% of max
      });

      if (likelyLimitBlocks.length > 0) {
        // User likely hit the limit, use the max observed
        return Math.ceil(maxTokens * 1.02); // Add 2% buffer
      } else {
        // User hasn't hit limits, we can't estimate accurately
        return null;
      }
    } catch (error) {
      console.warn('Could not estimate token limit:', error.message);
      return null;
    }
  }

  getElapsedMinutes(startTime) {
    const start = new Date(startTime);
    const now = new Date();
    return Math.floor((now - start) / (1000 * 60));
  }

  getRemainingMinutes(startTime) {
    const elapsed = this.getElapsedMinutes(startTime);
    return Math.max(0, 300 - elapsed); // 5 hours = 300 minutes
  }

  canContinueBasedOnUsage(block, remainingTokens) {
    // If we don't know the limit, always allow
    if (!this.estimatedLimit || remainingTokens === null) {
      return true;
    }

    // If we have very few tokens left
    if (remainingTokens < 1000) {
      return false;
    }

    // If burn rate will exhaust tokens before block ends
    if (block.burnRate && block.burnRate.tokensPerMinute > 0) {
      const remainingMinutes = this.getRemainingMinutes(block.startTime);
      const projectedUsage = block.burnRate.tokensPerMinute * remainingMinutes;
      
      if (projectedUsage > remainingTokens * 0.95) {
        return false; // Will likely hit limit
      }
    }

    return true;
  }

  async canContinue(priority = 'normal') {
    const usage = await this.getCurrentUsage();
    
    if (!usage.canContinue) {
      return {
        canContinue: false,
        reason: 'Token limit reached or will be reached soon'
      };
    }

    // If we don't know the limit, be conservative
    if (!usage.tokens.limit) {
      return {
        canContinue: true,
        reason: 'Token limit unknown, proceeding cautiously',
        caution: true
      };
    }

    // Priority-based decisions
    const percentage = usage.tokens.percentage || 0;
    
    if (priority === 'critical' && percentage < 98) {
      return { canContinue: true, reason: null };
    }
    
    if (priority === 'high' && percentage < 90) {
      return { canContinue: true, reason: null };
    }
    
    if (percentage < 80) {
      return { canContinue: true, reason: null };
    }

    return {
      canContinue: false,
      reason: `Token usage too high (${percentage.toFixed(1)}%) for ${priority} priority tasks`
    };
  }

  async getRecommendations() {
    const usage = await this.getCurrentUsage();
    const recommendations = [];

    if (!usage.tokens.limit) {
      recommendations.push({
        level: 'info',
        message: 'Token limit unknown. Consider setting it manually in config for better management.'
      });
    }

    if (usage.timeToLimit && usage.timeToLimit < 60) {
      recommendations.push({
        level: 'warning',
        message: `Will hit token limit in ~${usage.timeToLimit} minutes at current rate.`
      });
    }

    if (usage.tokens.percentage && usage.tokens.percentage > 80) {
      recommendations.push({
        level: 'warning',
        message: 'High token usage. Consider pausing non-critical tasks.'
      });
    }

    return recommendations;
  }

  getPlanInfo() {
    return {
      name: 'Adaptive Monitor',
      type: 'adaptive',
      description: 'Automatically adapts to your usage patterns',
      limits: {
        estimated: this.estimatedLimit ? `~${this.estimatedLimit.toLocaleString()} tokens` : 'Learning...'
      },
      features: [
        'Works with any Claude plan',
        'Learns from your usage history',
        'No manual configuration needed',
        'Estimates limits automatically'
      ]
    };
  }

  getEmptyStatus() {
    return {
      type: 'adaptive',
      block: {
        isActive: false
      },
      tokens: {
        used: 0,
        limit: this.estimatedLimit,
        remaining: this.estimatedLimit,
        percentage: 0,
        unit: 'tokens'
      },
      canContinue: true,
      confidence: 'unknown'
    };
  }
}

module.exports = AdaptiveMonitor;