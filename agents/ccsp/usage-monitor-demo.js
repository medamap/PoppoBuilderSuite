#!/usr/bin/env node

/**
 * Usage Monitor Demo
 * 
 * Demonstrates the flexible usage monitoring system
 */

const UsageMonitorFactory = require('./usage-monitor-factory');

async function demoAllMonitors() {
  console.log('🚀 PoppoBuilder Usage Monitor System Demo\n');
  
  // Test different configurations
  const configs = [
    {
      name: 'Claude API (Pay-as-you-go)',
      config: {
        llmProvider: 'claude',
        claudePlan: 'api',
        budgetLimits: {
          daily: 75,
          monthly: 2000
        }
      }
    },
    {
      name: 'Claude Pro ($20/month)',
      config: {
        llmProvider: 'claude',
        claudePlan: 'pro',
        tokenLimits: {
          pro: 100000
        }
      }
    },
    {
      name: 'Claude Max5 ($100/month)',
      config: {
        llmProvider: 'claude',
        claudePlan: 'max5'
      }
    },
    {
      name: 'Claude Max20 ($200/month)',
      config: {
        llmProvider: 'claude',
        claudePlan: 'max20'
      }
    },
    {
      name: 'Local LLM (Ollama)',
      config: {
        llmProvider: 'ollama',
        llmEndpoint: 'http://localhost:11434',
        localLLM: {
          maxMemoryGB: 32,
          maxConcurrent: 5
        }
      }
    }
  ];
  
  for (const testConfig of configs) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${testConfig.name}`);
    console.log('='.repeat(60));
    
    try {
      const monitor = UsageMonitorFactory.createMonitor(testConfig.config);
      
      // Get plan info
      const planInfo = monitor.getPlanInfo();
      console.log('\n📋 Plan Information:');
      console.log(`  Name: ${planInfo.name}`);
      console.log(`  Type: ${planInfo.type}`);
      console.log(`  Pricing: ${planInfo.pricing}`);
      
      // Get current usage
      console.log('\n📊 Current Usage:');
      const usage = await monitor.getCurrentUsage();
      
      if (usage.type === 'local') {
        console.log(`  CPU: ${usage.resources.cpu.usage.toFixed(1)}%`);
        console.log(`  Memory: ${usage.resources.memory.used.toFixed(1)}/${usage.resources.memory.total.toFixed(1)}GB (${usage.resources.memory.percentage.toFixed(1)}%)`);
        console.log(`  Requests Today: ${usage.metrics.requestsToday}`);
      } else if (usage.type === 'pay-as-you-go') {
        console.log(`  Daily: $${usage.daily.used.toFixed(2)}/$${usage.daily.limit} (${usage.daily.percentage.toFixed(1)}%)`);
        console.log(`  Monthly: $${usage.monthly.used.toFixed(2)}/$${usage.monthly.limit} (${usage.monthly.percentage.toFixed(1)}%)`);
      } else {
        console.log(`  Block: ${usage.tokens.used.toLocaleString()}/${usage.tokens.limit.toLocaleString()} tokens (${usage.tokens.percentage.toFixed(1)}%)`);
        if (usage.block) {
          console.log(`  Time Remaining: ${usage.block.remainingTime}`);
        }
      }
      
      // Check continuation for different priorities
      console.log('\n🚦 Task Continuation Status:');
      const priorities = ['critical', 'high', 'normal', 'low'];
      for (const priority of priorities) {
        const canContinue = await monitor.canContinue(priority);
        const status = canContinue.canContinue ? '✅' : '❌';
        console.log(`  ${priority}: ${status} ${canContinue.reason || 'OK'}`);
      }
      
      // Get recommendations
      const recommendations = await monitor.getRecommendations();
      if (recommendations.length > 0) {
        console.log('\n💡 Recommendations:');
        recommendations.forEach(rec => {
          const icon = rec.level === 'critical' ? '🚨' : rec.level === 'warning' ? '⚠️' : 'ℹ️';
          console.log(`  ${icon} ${rec.message}`);
        });
      }
      
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      if (testConfig.name.includes('Claude') && testConfig.name !== 'Local LLM') {
        console.log('  💡 This monitor requires ccusage to be installed and Claude Code to be used');
      }
    }
  }
  
  // Auto-detection demo
  console.log(`\n\n${'='.repeat(60)}`);
  console.log('Auto-Detection Test');
  console.log('='.repeat(60));
  
  try {
    const detectedPlan = await UsageMonitorFactory.detectPlan();
    console.log(`\n🔍 Detected Claude Plan: ${detectedPlan}`);
    
    // Create monitor with detected plan
    const autoMonitor = UsageMonitorFactory.createMonitor({
      llmProvider: 'claude',
      claudePlan: detectedPlan
    });
    
    const planInfo = autoMonitor.getPlanInfo();
    console.log(`  Created Monitor: ${planInfo.name}`);
    
  } catch (error) {
    console.log('  ❌ Auto-detection failed:', error.message);
  }
}

// Configuration example
function showConfigExample() {
  console.log('\n\n📝 Configuration Example for config.json:\n');
  
  const exampleConfig = {
    ccsp: {
      // ... other CCSP config ...
      
      // Usage monitoring configuration
      usageMonitoring: {
        enabled: true,
        
        // LLM Provider: 'claude' or local LLM name (ollama, lmstudio, etc.)
        llmProvider: 'claude',
        
        // Claude Plan: 'api', 'pro', 'max5', 'max20'
        claudePlan: 'max20',
        
        // Budget limits for API plan
        budgetLimits: {
          daily: 100,
          monthly: 3000
        },
        
        // Token limits (optional, will use defaults)
        tokenLimits: {
          pro: 100000,
          max5: 290000,
          max20: 580000
        },
        
        // Local LLM configuration
        localLLM: {
          endpoint: 'http://localhost:11434',
          maxMemoryGB: 32,
          maxGPUMemoryGB: 8,
          maxConcurrent: 5
        },
        
        // Monitoring behavior
        checkInterval: 60000, // Check usage every minute
        blockTasks: true,     // Block tasks when limits reached
        throttleOnWarning: true, // Throttle when usage is high
        
        // Notifications
        notifications: {
          warningThreshold: 0.8,  // 80% usage
          criticalThreshold: 0.95 // 95% usage
        }
      }
    }
  };
  
  console.log(JSON.stringify(exampleConfig, null, 2));
}

// Main execution
if (require.main === module) {
  demoAllMonitors().then(() => {
    showConfigExample();
  }).catch(error => {
    console.error('Demo failed:', error);
  });
}

module.exports = { demoAllMonitors };