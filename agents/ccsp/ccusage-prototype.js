#!/usr/bin/env node

/**
 * ccusage Integration Prototype for CCSP Agent
 * 
 * This prototype demonstrates how to integrate ccusage with PoppoBuilder Suite
 * to monitor and manage Claude Code token usage.
 */

const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

class CcusageMonitor {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 60000; // 1 minute cache
  }

  /**
   * Get current date in YYYYMMDD format
   */
  getCurrentDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  /**
   * Execute ccusage command with caching
   */
  async executeCcusage(command) {
    const cacheKey = command;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      console.log('📦 Using cached data');
      return cached.data;
    }

    try {
      console.log(`🔄 Executing: npx ccusage@latest ${command}`);
      const { stdout, stderr } = await execAsync(`npx ccusage@latest ${command}`);
      
      if (stderr && !stderr.includes('WARN')) {
        console.error('⚠️ Warning:', stderr);
      }
      
      const data = JSON.parse(stdout);
      this.cache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch (error) {
      console.error('❌ Error executing ccusage:', error.message);
      throw error;
    }
  }

  /**
   * Get daily usage data
   */
  async getDailyUsage(days = 7) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().slice(0, 10).replace(/-/g, '');
    
    return await this.executeCcusage(`daily --json --since ${sinceStr}`);
  }

  /**
   * Get monthly usage data
   */
  async getMonthlyUsage() {
    return await this.executeCcusage('monthly --json');
  }

  /**
   * Get session usage data
   */
  async getSessionUsage() {
    return await this.executeCcusage('session --json');
  }

  /**
   * Get current billing block status
   */
  async getBillingBlocks() {
    return await this.executeCcusage('blocks --json');
  }

  /**
   * Get current 5-hour block status for Pro Max20 plan
   */
  async getCurrentBlockStatus(tokenLimit = 580472) {
    const blocks = await this.executeCcusage('blocks --active --json --token-limit max');
    
    if (!blocks.blocks || blocks.blocks.length === 0) {
      return null;
    }
    
    const currentBlock = blocks.blocks[blocks.blocks.length - 1];
    const startTime = new Date(currentBlock.startTime);
    const now = new Date();
    const elapsedMinutes = Math.floor((now - startTime) / 1000 / 60);
    const remainingMinutes = 300 - elapsedMinutes; // 5 hours = 300 minutes
    
    return {
      startTime: currentBlock.startTime,
      endTime: new Date(startTime.getTime() + 5 * 60 * 60 * 1000).toISOString(),
      elapsedMinutes,
      remainingMinutes,
      remainingTime: `${Math.floor(remainingMinutes / 60)}h ${remainingMinutes % 60}m`,
      tokens: {
        used: currentBlock.totalTokens || 0,
        limit: tokenLimit,
        remaining: tokenLimit - (currentBlock.totalTokens || 0),
        percentage: ((currentBlock.totalTokens || 0) / tokenLimit) * 100
      },
      burnRate: {
        tokensPerMinute: elapsedMinutes > 0 ? (currentBlock.totalTokens || 0) / elapsedMinutes : 0,
        projectedTotal: elapsedMinutes > 0 ? ((currentBlock.totalTokens || 0) / elapsedMinutes) * 300 : 0
      },
      status: this.getBlockStatus(currentBlock.totalTokens || 0, tokenLimit, remainingMinutes)
    };
  }

  /**
   * Determine block status and recommendations
   */
  getBlockStatus(usedTokens, limitTokens, remainingMinutes) {
    const usagePercentage = (usedTokens / limitTokens) * 100;
    const burnRate = remainingMinutes > 0 ? usedTokens / (300 - remainingMinutes) : 0;
    const projectedUsage = burnRate * 300;
    const projectedPercentage = (projectedUsage / limitTokens) * 100;
    
    if (usagePercentage >= 95) {
      return {
        level: 'critical',
        message: 'Token limit nearly exhausted! Consider stopping all tasks.',
        canContinue: false
      };
    } else if (usagePercentage >= 80) {
      return {
        level: 'warning',
        message: 'High token usage. Only critical tasks should continue.',
        canContinue: true,
        onlyCritical: true
      };
    } else if (projectedPercentage > 100 && remainingMinutes > 60) {
      return {
        level: 'caution',
        message: `At current rate, will hit limit in ~${Math.floor(limitTokens / burnRate - (300 - remainingMinutes))} minutes.`,
        canContinue: true,
        throttleRecommended: true
      };
    } else {
      return {
        level: 'normal',
        message: 'Token usage within normal parameters.',
        canContinue: true
      };
    }
  }

  /**
   * Check budget status (for compatibility)
   */
  async checkBudgetStatus(dailyLimit = 100, monthlyLimit = 3000) {
    const dailyData = await this.getDailyUsage(1);
    const monthlyData = await this.getMonthlyUsage();
    
    // Get today's usage from the daily array
    const today = this.getCurrentDate();
    const todaysUsage = dailyData.daily?.find(d => d.date.replace(/-/g, '') === today) || {
      totalCost: 0,
      totalTokens: 0,
      modelsUsed: []
    };
    
    // Get current month's usage from the monthly array
    const currentMonth = new Date().toISOString().slice(0, 7);
    const monthlyUsage = monthlyData.monthly?.find(m => m.month === currentMonth) || {
      totalCost: 0,
      totalTokens: 0
    };
    
    return {
      daily: {
        current: todaysUsage.totalCost || 0,
        limit: dailyLimit,
        percentage: ((todaysUsage.totalCost || 0) / dailyLimit) * 100,
        tokens: todaysUsage.totalTokens || 0,
        withinBudget: (todaysUsage.totalCost || 0) < dailyLimit,
        models: todaysUsage.modelsUsed || []
      },
      monthly: {
        current: monthlyUsage.totalCost || 0,
        limit: monthlyLimit,
        percentage: ((monthlyUsage.totalCost || 0) / monthlyLimit) * 100,
        tokens: monthlyUsage.totalTokens || 0,
        withinBudget: (monthlyUsage.totalCost || 0) < monthlyLimit,
        daysRemaining: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - new Date().getDate()
      },
      recommendations: this.generateRecommendations(
        todaysUsage.totalCost || 0,
        dailyLimit,
        monthlyUsage.totalCost || 0,
        monthlyLimit
      )
    };
  }

  /**
   * Generate usage recommendations
   */
  generateRecommendations(dailyCost, dailyLimit, monthlyCost, monthlyLimit) {
    const recommendations = [];
    
    // Daily budget check
    const dailyPercentage = (dailyCost / dailyLimit) * 100;
    if (dailyPercentage > 90) {
      recommendations.push({
        level: 'critical',
        message: 'Daily budget nearly exhausted. Consider pausing non-critical tasks.'
      });
    } else if (dailyPercentage > 75) {
      recommendations.push({
        level: 'warning',
        message: 'Daily usage is high. Monitor closely and prioritize important tasks.'
      });
    }
    
    // Monthly projection
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const daysPassed = new Date().getDate();
    const projectedMonthly = (monthlyCost / daysPassed) * daysInMonth;
    
    if (projectedMonthly > monthlyLimit) {
      recommendations.push({
        level: 'warning',
        message: `At current rate, monthly cost will be $${projectedMonthly.toFixed(2)}, exceeding limit by $${(projectedMonthly - monthlyLimit).toFixed(2)}`
      });
    }
    
    return recommendations;
  }

  /**
   * Format usage report for display
   */
  formatUsageReport(budgetStatus) {
    const { daily, monthly, recommendations } = budgetStatus;
    
    let report = '\n📊 Token Usage Report\n';
    report += '===================\n\n';
    
    // Daily usage
    report += `📅 Daily Usage (Today)\n`;
    report += `   Cost: $${daily.current.toFixed(2)} / $${daily.limit} (${daily.percentage.toFixed(1)}%)\n`;
    report += `   Tokens: ${daily.tokens.toLocaleString()}\n`;
    report += `   Status: ${daily.withinBudget ? '✅ Within budget' : '❌ Over budget'}\n`;
    if (daily.models.length > 0) {
      report += `   Models: ${daily.models.join(', ')}\n`;
    }
    report += '\n';
    
    // Monthly usage
    report += `📆 Monthly Usage\n`;
    report += `   Cost: $${monthly.current.toFixed(2)} / $${monthly.limit} (${monthly.percentage.toFixed(1)}%)\n`;
    report += `   Tokens: ${monthly.tokens.toLocaleString()}\n`;
    report += `   Days remaining: ${monthly.daysRemaining}\n`;
    report += `   Status: ${monthly.withinBudget ? '✅ Within budget' : '❌ Over budget'}\n`;
    report += '\n';
    
    // Recommendations
    if (recommendations.length > 0) {
      report += `💡 Recommendations\n`;
      recommendations.forEach(rec => {
        const icon = rec.level === 'critical' ? '🚨' : '⚠️';
        report += `   ${icon} ${rec.message}\n`;
      });
    } else {
      report += `💡 Recommendations\n`;
      report += `   ✅ Usage is within normal parameters\n`;
    }
    
    return report;
  }
}

// Demo usage
async function demo() {
  console.log('🚀 ccusage Integration Prototype\n');
  
  const monitor = new CcusageMonitor();
  
  try {
    // Check budget status
    console.log('📊 Checking budget status...\n');
    const budgetStatus = await monitor.checkBudgetStatus(150, 3000); // $150/day, $3000/month
    
    // Display formatted report
    console.log(monitor.formatUsageReport(budgetStatus));
    
    // Show billing blocks
    console.log('\n📦 Current Billing Blocks:');
    try {
      const blocks = await monitor.getBillingBlocks();
      if (blocks.blocks && blocks.blocks.length > 0) {
        const currentBlock = blocks.blocks[blocks.blocks.length - 1];
        console.log(`   Sessions in block: ${currentBlock.sessionCount || 'N/A'}`);
        console.log(`   Block cost: $${(currentBlock.totalCost || 0).toFixed(2)}`);
        console.log(`   Started: ${currentBlock.startTime || 'N/A'}`);
      }
    } catch (error) {
      console.log('   Unable to fetch billing blocks:', error.message);
    }
    
    // Export data for dashboard integration
    console.log('\n💾 Exporting data for dashboard...');
    const dashboardData = {
      timestamp: new Date().toISOString(),
      daily: budgetStatus.daily,
      monthly: budgetStatus.monthly,
      recommendations: budgetStatus.recommendations
    };
    
    console.log('✅ Data ready for integration:', JSON.stringify(dashboardData, null, 2));
    
  } catch (error) {
    console.error('❌ Demo failed:', error.message);
    console.log('\n💡 Make sure you have Claude Code installed and have used it today.');
  }
}

// Run demo if executed directly
if (require.main === module) {
  demo();
}

module.exports = CcusageMonitor;