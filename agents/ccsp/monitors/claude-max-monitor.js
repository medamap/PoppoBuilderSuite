/**
 * Claude Max5/Max20 Usage Monitor ($100/$200 per month)
 * 
 * For Claude Max subscribers with enhanced 5-hour blocks
 */

const UsageMonitorInterface = require('../usage-monitor-interface');
const CcusageMonitor = require('../ccusage-prototype');

class ClaudeMaxMonitor extends UsageMonitorInterface {
  constructor(config = {}) {
    super();
    this.config = {
      plan: config.plan || 'max20', // 'max5' or 'max20'
      tokenLimit: config.tokenLimit || this.getDefaultTokenLimit(config.plan),
      blockHours: 5,
      ...config
    };
    this.ccusage = new CcusageMonitor();
  }

  getDefaultTokenLimit(plan) {
    // Max20: ~580k tokens confirmed by ccusage
    // Pro is 1/20 of Max20, Max5 is 5x Pro (1/4 of Max20)
    const max20Limit = 580472;
    return {
      max5: Math.floor(max20Limit / 4),    // ~145k tokens (5x Pro)
      max20: max20Limit                     // ~580k tokens (20x Pro)
    }[plan] || max20Limit;
  }

  async getCurrentUsage() {
    const blockStatus = await this.ccusage.getCurrentBlockStatus(this.config.tokenLimit);
    
    if (!blockStatus) {
      return this.getEmptyStatus();
    }

    const planName = this.config.plan === 'max5' ? 'Claude Max5' : 'Claude Max20';
    const monthlyPrice = this.config.plan === 'max5' ? 100 : 200;

    return {
      type: 'subscription',
      plan: planName,
      monthlyPrice,
      block: {
        startTime: blockStatus.startTime,
        endTime: blockStatus.endTime,
        remainingTime: blockStatus.remainingTime,
        remainingMinutes: blockStatus.remainingMinutes,
        elapsedMinutes: blockStatus.elapsedMinutes
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
      canContinue: blockStatus.status.canContinue,
      efficiency: this.calculateEfficiency(blockStatus)
    };
  }

  calculateEfficiency(blockStatus) {
    // Calculate how efficiently tokens are being used
    const projectedUsage = blockStatus.burnRate.projectedTotal;
    const efficiency = (projectedUsage / blockStatus.tokens.limit) * 100;
    
    return {
      percentage: efficiency,
      rating: efficiency > 80 ? 'excellent' : efficiency > 50 ? 'good' : 'could be better',
      unusedTokensProjected: Math.max(0, blockStatus.tokens.limit - projectedUsage)
    };
  }

  async canContinue(priority = 'normal') {
    const usage = await this.getCurrentUsage();
    
    if (!usage.status) {
      return { canContinue: true, reason: null };
    }
    
    // Max plans have more generous limits
    if (!usage.status.canContinue) {
      return {
        canContinue: false,
        reason: usage.status.message
      };
    }
    
    // For Max plans, be more generous with non-critical tasks
    if (usage.status.onlyCritical && priority === 'low') {
      return {
        canContinue: false,
        reason: 'Low priority tasks paused to preserve tokens'
      };
    }
    
    // Throttle recommendation applies to all but critical
    if (usage.status.throttleRecommended && priority !== 'critical') {
      return {
        canContinue: true,
        reason: 'Consider reducing request frequency',
        throttle: true
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
    
    // Efficiency recommendations
    if (usage.efficiency && usage.efficiency.percentage < 50) {
      recommendations.push({
        level: 'info',
        message: `Token usage efficiency: ${usage.efficiency.percentage.toFixed(1)}%. Consider batching more tasks to maximize block usage.`
      });
    }
    
    // Plan-specific recommendations
    if (this.config.plan === 'max5' && usage.tokens.percentage > 80) {
      recommendations.push({
        level: 'info',
        message: 'Consider Max20 plan for 2x more tokens at better value'
      });
    }
    
    // Time-based recommendations
    if (usage.block.remainingMinutes < 30 && usage.efficiency.unusedTokensProjected > 50000) {
      recommendations.push({
        level: 'warning',
        message: `~${Math.floor(usage.efficiency.unusedTokensProjected / 1000)}k tokens may go unused. Queue more tasks!`
      });
    }
    
    return recommendations;
  }

  getPlanInfo() {
    const planDetails = {
      max5: {
        name: 'Claude Max5',
        pricing: '$100/month',
        tokensPerBlock: '~290,000',
        value: '5x more than Pro'
      },
      max20: {
        name: 'Claude Max20',
        pricing: '$200/month', 
        tokensPerBlock: '~580,000',
        value: '10x more than Pro, best $/token'
      }
    };

    const details = planDetails[this.config.plan] || planDetails.max20;

    return {
      name: details.name,
      type: 'subscription',
      description: 'Premium subscription with enhanced token blocks',
      pricing: details.pricing,
      limits: {
        tokensPerBlock: details.tokensPerBlock,
        blockDuration: '5 hours',
        blocksPerDay: '4.8',
        dailyTokens: `~${this.config.plan === 'max5' ? '1.4M' : '2.8M'}`
      },
      features: [
        'Fixed monthly cost',
        'Maximum tokens per block',
        details.value,
        'Priority access',
        'Best for heavy usage'
      ]
    };
  }

  getEmptyStatus() {
    const planName = this.config.plan === 'max5' ? 'Claude Max5' : 'Claude Max20';
    
    return {
      type: 'subscription',
      plan: planName,
      monthlyPrice: this.config.plan === 'max5' ? 100 : 200,
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

module.exports = ClaudeMaxMonitor;