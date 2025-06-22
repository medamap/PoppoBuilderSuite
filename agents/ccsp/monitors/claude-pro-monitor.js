/**
 * Claude Pro Usage Monitor ($20/month)
 * 
 * For Claude Pro subscribers with basic 5-hour blocks
 */

const UsageMonitorInterface = require('../usage-monitor-interface');
const CcusageMonitor = require('../ccusage-prototype');

class ClaudeProMonitor extends UsageMonitorInterface {
  constructor(config = {}) {
    super();
    this.config = {
      tokenLimit: config.tokenLimit || Math.floor(580472 / 20), // Pro is 1/20 of Max20 (~29k)
      blockHours: 5,
      ...config
    };
    this.ccusage = new CcusageMonitor();
  }

  async getCurrentUsage() {
    const blockStatus = await this.ccusage.getCurrentBlockStatus(this.config.tokenLimit);
    
    if (!blockStatus) {
      return this.getEmptyStatus();
    }

    return {
      type: 'subscription',
      plan: 'Claude Pro',
      block: {
        startTime: blockStatus.startTime,
        endTime: blockStatus.endTime,
        remainingTime: blockStatus.remainingTime,
        remainingMinutes: blockStatus.remainingMinutes
      },
      tokens: {
        used: blockStatus.tokens.used,
        limit: blockStatus.tokens.limit,
        remaining: blockStatus.tokens.remaining,
        percentage: blockStatus.tokens.percentage,
        unit: 'tokens'
      },
      burnRate: blockStatus.burnRate,
      status: blockStatus.status,
      canContinue: blockStatus.status.canContinue
    };
  }

  async canContinue(priority = 'normal') {
    const usage = await this.getCurrentUsage();
    
    if (!usage.status) {
      return { canContinue: true, reason: null };
    }
    
    // Follow the status recommendations
    if (!usage.status.canContinue) {
      return {
        canContinue: false,
        reason: usage.status.message
      };
    }
    
    // Only critical tasks when onlyCritical flag is set
    if (usage.status.onlyCritical && priority !== 'critical') {
      return {
        canContinue: false,
        reason: 'Only critical tasks allowed at current usage level'
      };
    }
    
    return {
      canContinue: true,
      reason: null
    };
  }

  async getRecommendations() {
    const usage = await this.getCurrentUsage();
    const recommendations = [];
    
    if (usage.status && usage.status.level !== 'normal') {
      recommendations.push({
        level: usage.status.level,
        message: usage.status.message
      });
    }
    
    // Pro-specific recommendations
    if (usage.tokens && usage.tokens.percentage > 70 && usage.block.remainingMinutes > 120) {
      recommendations.push({
        level: 'info',
        message: 'Consider Max5 plan for 5x more tokens per block'
      });
    }
    
    return recommendations;
  }

  getPlanInfo() {
    return {
      name: 'Claude Pro',
      type: 'subscription',
      description: 'Basic subscription with 5-hour token blocks',
      pricing: '$20/month',
      limits: {
        tokensPerBlock: this.config.tokenLimit,
        blockDuration: '5 hours',
        blocksPerDay: '4.8'
      },
      features: [
        'Fixed monthly cost',
        '5-hour usage blocks',
        'Priority access',
        'Suitable for regular usage'
      ]
    };
  }

  getEmptyStatus() {
    return {
      type: 'subscription',
      plan: 'Claude Pro',
      block: {
        remainingTime: 'Unknown',
        remainingMinutes: 0
      },
      tokens: {
        used: 0,
        limit: this.config.tokenLimit,
        remaining: this.config.tokenLimit,
        percentage: 0,
        unit: 'tokens'
      },
      canContinue: true
    };
  }
}

module.exports = ClaudeProMonitor;