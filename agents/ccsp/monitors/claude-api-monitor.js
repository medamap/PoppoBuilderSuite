/**
 * Claude API Usage Monitor (Pay-as-you-go)
 * 
 * For users using Claude API with traditional API keys
 */

const UsageMonitorInterface = require('../usage-monitor-interface');
const CcusageMonitor = require('../ccusage-prototype');

class ClaudeAPIMonitor extends UsageMonitorInterface {
  constructor(config = {}) {
    super();
    this.config = {
      dailyBudget: config.dailyBudget || 50,
      monthlyBudget: config.monthlyBudget || 1500,
      warningThreshold: config.warningThreshold || 0.8,
      criticalThreshold: config.criticalThreshold || 0.95,
      ...config
    };
    this.ccusage = new CcusageMonitor();
  }

  async getCurrentUsage() {
    const budgetStatus = await this.ccusage.checkBudgetStatus(
      this.config.dailyBudget,
      this.config.monthlyBudget
    );

    return {
      type: 'pay-as-you-go',
      daily: {
        used: budgetStatus.daily.current,
        limit: budgetStatus.daily.limit,
        percentage: budgetStatus.daily.percentage,
        unit: 'USD'
      },
      monthly: {
        used: budgetStatus.monthly.current,
        limit: budgetStatus.monthly.limit,
        percentage: budgetStatus.monthly.percentage,
        unit: 'USD'
      },
      canContinue: budgetStatus.daily.withinBudget && budgetStatus.monthly.withinBudget,
      recommendations: budgetStatus.recommendations
    };
  }

  async canContinue(priority = 'normal') {
    const usage = await this.getCurrentUsage();
    
    // Critical tasks can continue until 95%
    if (priority === 'critical') {
      return {
        canContinue: usage.daily.percentage < this.config.criticalThreshold * 100,
        reason: usage.daily.percentage >= this.config.criticalThreshold * 100 
          ? 'Daily budget critical threshold reached' 
          : null
      };
    }
    
    // High priority tasks can continue until 80%
    if (priority === 'high') {
      return {
        canContinue: usage.daily.percentage < this.config.warningThreshold * 100,
        reason: usage.daily.percentage >= this.config.warningThreshold * 100
          ? 'Daily budget warning threshold reached'
          : null
      };
    }
    
    // Normal and low priority stop at 70%
    return {
      canContinue: usage.daily.percentage < 70,
      reason: usage.daily.percentage >= 70
        ? 'Daily budget limit approaching for non-priority tasks'
        : null
    };
  }

  async getRecommendations() {
    const usage = await this.getCurrentUsage();
    const recommendations = [...usage.recommendations];
    
    // Add API-specific recommendations
    if (usage.daily.percentage > 50) {
      recommendations.push({
        level: 'info',
        message: 'Consider upgrading to Claude Pro for fixed monthly pricing'
      });
    }
    
    return recommendations;
  }

  getPlanInfo() {
    return {
      name: 'Claude API',
      type: 'pay-as-you-go',
      description: 'Traditional API usage with per-token pricing',
      limits: {
        daily: `$${this.config.dailyBudget} (configurable)`,
        monthly: `$${this.config.monthlyBudget} (configurable)`
      },
      pricing: 'Per token usage',
      features: [
        'Pay only for what you use',
        'No token limits',
        'API key authentication',
        'Suitable for variable workloads'
      ]
    };
  }
}

module.exports = ClaudeAPIMonitor;