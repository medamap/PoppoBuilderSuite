#!/usr/bin/env node

/**
 * Claude Pro Max20 Plan Usage Monitor Demo
 * 
 * Demonstrates real-time token usage monitoring for 5-hour blocks
 */

const CcusageMonitor = require('./ccusage-prototype');

async function demoMax20() {
  console.log('🚀 Claude Pro Max20 Token Monitor\n');
  
  const monitor = new CcusageMonitor();
  
  try {
    // Get current block status
    console.log('📊 Fetching current 5-hour block status...\n');
    const blockStatus = await monitor.getCurrentBlockStatus();
    
    if (blockStatus) {
      console.log('⏰ Current Block Information');
      console.log('=' .repeat(40));
      console.log(`Start Time: ${new Date(blockStatus.startTime).toLocaleString('ja-JP')} JST`);
      console.log(`End Time: ${new Date(blockStatus.endTime).toLocaleString('ja-JP')} JST`);
      console.log(`Time Remaining: ${blockStatus.remainingTime}`);
      console.log();
      
      console.log('🪙 Token Usage');
      console.log('=' .repeat(40));
      console.log(`Used: ${blockStatus.tokens.used.toLocaleString()} / ${blockStatus.tokens.limit.toLocaleString()} tokens`);
      console.log(`Remaining: ${blockStatus.tokens.remaining.toLocaleString()} tokens`);
      console.log(`Usage: ${blockStatus.tokens.percentage.toFixed(1)}%`);
      
      // Progress bar
      const barLength = 30;
      const filledLength = Math.round((blockStatus.tokens.percentage / 100) * barLength);
      const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
      console.log(`Progress: [${bar}]`);
      console.log();
      
      console.log('📈 Burn Rate Analysis');
      console.log('=' .repeat(40));
      console.log(`Current Rate: ${blockStatus.burnRate.tokensPerMinute.toFixed(1)} tokens/minute`);
      console.log(`Projected Total: ${blockStatus.burnRate.projectedTotal.toLocaleString()} tokens`);
      console.log(`Projected Usage: ${(blockStatus.burnRate.projectedTotal / blockStatus.tokens.limit * 100).toFixed(1)}%`);
      console.log();
      
      console.log('🚦 Status & Recommendations');
      console.log('=' .repeat(40));
      const statusIcon = {
        normal: '🟢',
        caution: '🟡',
        warning: '🟠',
        critical: '🔴'
      }[blockStatus.status.level];
      
      console.log(`Status: ${statusIcon} ${blockStatus.status.level.toUpperCase()}`);
      console.log(`Message: ${blockStatus.status.message}`);
      
      if (blockStatus.status.onlyCritical) {
        console.log('⚠️  Only critical tasks should continue!');
      }
      if (blockStatus.status.throttleRecommended) {
        console.log('⚠️  Consider throttling request rate.');
      }
      if (!blockStatus.status.canContinue) {
        console.log('🛑 STOP: Token limit reached!');
      }
      
      // CCSP Integration recommendations
      console.log('\n💡 CCSP Integration Recommendations');
      console.log('=' .repeat(40));
      
      if (blockStatus.tokens.percentage > 80) {
        console.log('1. Pause all non-critical tasks');
        console.log('2. Queue remaining tasks for next block');
        console.log('3. Send notification about high usage');
      } else if (blockStatus.tokens.percentage > 50 && blockStatus.remainingMinutes < 120) {
        console.log('1. Prioritize important tasks');
        console.log('2. Consider task batching');
        console.log('3. Monitor usage closely');
      } else {
        console.log('1. Continue normal operations');
        console.log('2. Monitor burn rate trends');
      }
      
      // Show when next block starts
      const nextBlockTime = new Date(blockStatus.endTime);
      console.log(`\n⏭️  Next block starts at: ${nextBlockTime.toLocaleString('ja-JP')} JST`);
      
    } else {
      console.log('❌ Could not fetch block status');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Interactive monitoring mode
async function liveMonitor() {
  console.log('🔄 Starting live monitoring mode...\n');
  console.log('Press Ctrl+C to stop\n');
  
  const monitor = new CcusageMonitor();
  
  setInterval(async () => {
    console.clear();
    console.log('🚀 Claude Pro Max20 Live Monitor');
    console.log(`Last Update: ${new Date().toLocaleTimeString('ja-JP')} JST\n`);
    
    try {
      const blockStatus = await monitor.getCurrentBlockStatus();
      
      if (blockStatus) {
        // Simple dashboard
        const percentage = blockStatus.tokens.percentage;
        const barLength = 40;
        const filledLength = Math.round((percentage / 100) * barLength);
        const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
        
        console.log(`Block Progress: [${bar}] ${percentage.toFixed(1)}%`);
        console.log(`Tokens Used: ${blockStatus.tokens.used.toLocaleString()} / ${blockStatus.tokens.limit.toLocaleString()}`);
        console.log(`Time Remaining: ${blockStatus.remainingTime}`);
        console.log(`Burn Rate: ${blockStatus.burnRate.tokensPerMinute.toFixed(1)} tokens/min`);
        
        const statusEmoji = {
          normal: '🟢',
          caution: '🟡', 
          warning: '🟠',
          critical: '🔴'
        }[blockStatus.status.level];
        
        console.log(`\nStatus: ${statusEmoji} ${blockStatus.status.message}`);
      }
    } catch (error) {
      console.log('❌ Update failed:', error.message);
    }
  }, 5000); // Update every 5 seconds
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--live')) {
    liveMonitor();
  } else {
    demoMax20();
  }
}

module.exports = { demoMax20, liveMonitor };