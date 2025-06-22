/**
 * Usage Monitor Factory
 * 
 * Creates appropriate usage monitor based on configuration
 */

const ClaudeAPIMonitor = require('./monitors/claude-api-monitor');
const ClaudeProMonitor = require('./monitors/claude-pro-monitor');
const ClaudeMaxMonitor = require('./monitors/claude-max-monitor');
const LocalLLMMonitor = require('./monitors/local-llm-monitor');
const AdaptiveMonitor = require('./monitors/adaptive-monitor');

class UsageMonitorFactory {
  /**
   * Create usage monitor based on configuration
   * @param {Object} config - CCSP configuration
   * @returns {UsageMonitorInterface} Appropriate monitor instance
   */
  static createMonitor(config) {
    const llmProvider = config.llmProvider || 'claude';
    const plan = config.claudePlan || 'api'; // api, pro, max5, max20
    
    // Local LLM takes precedence
    if (llmProvider !== 'claude') {
      return new LocalLLMMonitor({
        provider: llmProvider,
        endpoint: config.llmEndpoint,
        ...config.localLLM
      });
    }
    
    // Use adaptive monitor if requested or plan is unknown
    if (plan === 'adaptive' || plan === 'auto') {
      return new AdaptiveMonitor(config.adaptiveMonitor || {});
    }
    
    // Claude-based monitors
    switch (plan.toLowerCase()) {
      case 'api':
        return new ClaudeAPIMonitor({
          dailyBudget: config.budgetLimits?.daily || 50,
          monthlyBudget: config.budgetLimits?.monthly || 1500,
          ...config.apiMonitor
        });
        
      case 'pro':
        return new ClaudeProMonitor({
          tokenLimit: config.tokenLimits?.pro || 29024, // 1/20 of Max20
          ...config.proMonitor
        });
        
      case 'max5':
        return new ClaudeMaxMonitor({
          plan: 'max5',
          tokenLimit: config.tokenLimits?.max5 || 145118, // 1/4 of Max20
          ...config.maxMonitor
        });
        
      case 'max20':
        return new ClaudeMaxMonitor({
          plan: 'max20',
          tokenLimit: config.tokenLimits?.max20 || 580472, // Confirmed by ccusage
          ...config.maxMonitor
        });
        
      default:
        console.warn(`Unknown Claude plan: ${plan}, defaulting to API monitor`);
        return new ClaudeAPIMonitor(config.apiMonitor || {});
    }
  }
  
  /**
   * Get available monitor types
   * @returns {Array} List of available monitor types
   */
  static getAvailableTypes() {
    return [
      {
        id: 'api',
        name: 'Claude API',
        description: 'Traditional pay-as-you-go API usage',
        requiresCcusage: true
      },
      {
        id: 'pro',
        name: 'Claude Pro ($20/month)',
        description: 'Basic subscription with 5-hour blocks',
        requiresCcusage: true
      },
      {
        id: 'max5', 
        name: 'Claude Max5 ($100/month)',
        description: 'Enhanced subscription with 5x tokens',
        requiresCcusage: true
      },
      {
        id: 'max20',
        name: 'Claude Max20 ($200/month)',
        description: 'Premium subscription with 10x tokens',
        requiresCcusage: true
      },
      {
        id: 'local',
        name: 'Local LLM',
        description: 'Self-hosted models (Ollama, etc.)',
        requiresCcusage: false
      }
    ];
  }
  
  /**
   * Detect plan from ccusage data
   * @returns {Promise<string>} Detected plan type
   */
  static async detectPlan() {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      
      // Try to get recent block data
      const { stdout } = await execAsync('npx ccusage@latest blocks --recent --json --limit 1');
      const data = JSON.parse(stdout);
      
      if (data.blocks && data.blocks.length > 0) {
        const block = data.blocks[0];
        const maxTokens = block.assumedLimit || 0;
        
        // Estimate based on token limits
        if (maxTokens > 500000) return 'max20';
        if (maxTokens > 250000) return 'max5';
        if (maxTokens > 50000) return 'pro';
      }
      
      // Check if there's cost data (indicates API usage)
      const { stdout: dailyOut } = await execAsync('npx ccusage@latest daily --json --limit 1');
      const dailyData = JSON.parse(dailyOut);
      
      if (dailyData.daily && dailyData.daily[0] && dailyData.daily[0].totalCost > 0) {
        return 'api';
      }
      
    } catch (error) {
      console.warn('Could not auto-detect Claude plan:', error.message);
    }
    
    return 'api'; // Default to API
  }
}

module.exports = UsageMonitorFactory;