#!/usr/bin/env node

/**
 * Issue #133: Disaster Recovery Script
 * 
 * Command-line interface for disaster recovery operations:
 * - Execute recovery
 * - Test recovery process
 * - View recovery history
 * - Manage recovery plans
 */

const path = require('path');
const { program } = require('commander');
const BackupManager = require('../lib/backup/backup-manager');
const DisasterRecovery = require('../lib/backup/disaster-recovery');
const ProductionLogger = require('../lib/utils/production-logger');

// Initialize logger
const logger = new ProductionLogger('DisasterRecoveryScript', {
  enableStructuredLogging: true
});

// Initialize components
const backupManager = new BackupManager({
  backupPath: './backups',
  encryptionEnabled: true,
  compressionEnabled: true
});

const disasterRecovery = new DisasterRecovery({
  rto: 3600000, // 1 hour
  rpo: 86400000, // 24 hours
  autoFailoverEnabled: true,
  testingEnabled: true
});

// Helper function to format duration
function formatDuration(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

// Helper function to format time ago
function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - new Date(timestamp).getTime();
  
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  
  if (days > 0) {
    return `${days}d ${hours}h ago`;
  }
  return `${hours}h ago`;
}

/**
 * Recover command
 */
program
  .command('recover')
  .description('Execute disaster recovery')
  .option('-b, --backup-id <id>', 'Specific backup ID to restore from')
  .option('-t, --type <type>', 'Recovery type (full/partial)', 'full')
  .option('-r, --reason <reason>', 'Reason for recovery')
  .option('--rollback-on-failure', 'Automatically rollback if recovery fails')
  .option('--skip-verification', 'Skip post-recovery verification')
  .option('--confirm', 'Confirm recovery operation')
  .action(async (options) => {
    try {
      if (!options.confirm) {
        console.log('⚠️  Recovery requires confirmation. Use --confirm flag.');
        console.log('\n🚨 WARNING: Recovery will stop all services and restore from backup!');
        process.exit(1);
      }
      
      // Initialize components
      await backupManager.initialize();
      await disasterRecovery.initialize(backupManager);
      
      console.log('🚨 Starting Disaster Recovery Process...\n');
      console.log(`📋 Recovery Configuration:`);
      console.log(`   Type: ${options.type}`);
      console.log(`   RTO: ${formatDuration(disasterRecovery.options.rto)}`);
      console.log(`   RPO: ${formatDuration(disasterRecovery.options.rpo)}`);
      
      if (options.backupId) {
        console.log(`   Backup: ${options.backupId}`);
      } else {
        console.log(`   Backup: Most recent valid backup`);
      }
      
      console.log('\n⏳ Executing recovery plan...\n');
      
      // Set up progress listener
      disasterRecovery.on('recovery-progress', (progress) => {
        const percentage = Math.round(progress.progress * 100);
        console.log(`   [${percentage}%] Completed step: ${progress.step}`);
      });
      
      const recoveryOptions = {
        type: options.type,
        reason: options.reason || 'Manual recovery',
        backupId: options.backupId,
        rollbackOnFailure: options.rollbackOnFailure || false,
        skipVerification: options.skipVerification || false
      };
      
      const recovery = await disasterRecovery.executeRecovery(recoveryOptions);
      
      console.log('\n✅ Recovery completed successfully!\n');
      console.log(`📊 Recovery Summary:`);
      console.log(`   Recovery ID: ${recovery.id}`);
      console.log(`   Duration: ${formatDuration(recovery.duration)}`);
      console.log(`   Backup used: ${recovery.backupId}`);
      console.log(`   Data age: ${formatDuration(recovery.dataAge)}`);
      console.log(`   RTO achieved: ${recovery.rtoAchieved ? 'Yes ✅' : 'No ❌'}`);
      console.log(`   RPO achieved: ${recovery.rpoAchieved ? 'Yes ✅' : 'No ❌'}`);
      
      if (recovery.verification) {
        console.log(`\n🔍 Verification Results:`);
        recovery.verification.checks.forEach(check => {
          const status = check.healthy ? '✅' : '❌';
          console.log(`   ${status} ${check.name}`);
        });
      }
      
    } catch (error) {
      console.error('\n❌ Recovery failed:', error.message);
      process.exit(1);
    }
  });

/**
 * Test command
 */
program
  .command('test')
  .description('Test disaster recovery process')
  .option('-t, --type <type>', 'Test type (full/partial)', 'full')
  .option('--simulate-disaster', 'Simulate disaster scenario')
  .option('--skip-cleanup', 'Skip cleanup after test')
  .action(async (options) => {
    try {
      // Initialize components
      await backupManager.initialize();
      await disasterRecovery.initialize(backupManager);
      
      console.log('🧪 Starting Recovery Test...\n');
      
      // Set up event listeners
      disasterRecovery.on('recovery-test-started', (test) => {
        console.log(`📋 Test Configuration:`);
        console.log(`   Test ID: ${test.id}`);
        console.log(`   Type: ${test.type}`);
        console.log(`   Simulate disaster: ${options.simulateDisaster ? 'Yes' : 'No'}`);
        console.log();
      });
      
      disasterRecovery.on('recovery-progress', (progress) => {
        const percentage = Math.round(progress.progress * 100);
        console.log(`   [${percentage}%] ${progress.step}`);
      });
      
      const testOptions = {
        type: options.type,
        simulateDisaster: options.simulateDisaster || false,
        skipCleanup: options.skipCleanup || false
      };
      
      const test = await disasterRecovery.testRecovery(testOptions);
      
      console.log('\n✅ Recovery test completed!\n');
      console.log(`📊 Test Results:`);
      console.log(`   Test ID: ${test.id}`);
      console.log(`   Status: ${test.success ? 'PASSED ✅' : 'FAILED ❌'}`);
      console.log(`   Recovery duration: ${formatDuration(test.recoveryDuration)}`);
      console.log(`   RTO achieved: ${test.rtoAchieved ? 'Yes ✅' : 'No ❌'}`);
      console.log(`   RPO achieved: ${test.rpoAchieved ? 'Yes ✅' : 'No ❌'}`);
      
      if (test.verification) {
        console.log(`\n🔍 Verification Results:`);
        test.verification.checks.forEach(check => {
          const status = check.passed ? '✅' : '❌';
          console.log(`   ${status} ${check.name}`);
        });
      }
      
    } catch (error) {
      console.error('\n❌ Recovery test failed:', error.message);
      process.exit(1);
    }
  });

/**
 * History command
 */
program
  .command('history')
  .description('View recovery history')
  .option('-l, --limit <number>', 'Number of recoveries to show', '10')
  .option('--json', 'Output in JSON format')
  .action(async (options) => {
    try {
      // Initialize components
      await backupManager.initialize();
      await disasterRecovery.initialize(backupManager);
      
      const stats = disasterRecovery.getRecoveryStatistics();
      const limit = parseInt(options.limit);
      
      if (options.json) {
        console.log(JSON.stringify({
          statistics: stats,
          history: disasterRecovery.recoveryHistory.slice(-limit)
        }, null, 2));
        return;
      }
      
      console.log('📊 Recovery Statistics\n');
      console.log(`Total recoveries: ${stats.totalRecoveries}`);
      console.log(`Successful: ${stats.successfulRecoveries}`);
      console.log(`Failed: ${stats.failedRecoveries}`);
      
      if (stats.averageRecoveryTime > 0) {
        console.log(`Average recovery time: ${formatDuration(stats.averageRecoveryTime)}`);
        console.log(`RTO achievement rate: ${stats.rtoAchievementRate.toFixed(1)}%`);
        console.log(`RPO achievement rate: ${stats.rpoAchievementRate.toFixed(1)}%`);
      }
      
      if (stats.lastTest) {
        console.log(`\nLast recovery test:`);
        console.log(`   Date: ${new Date(stats.lastTest.timestamp).toLocaleString()}`);
        console.log(`   Status: ${stats.lastTest.success ? 'PASSED' : 'FAILED'}`);
      }
      
      console.log('\n📜 Recovery History\n');
      
      if (disasterRecovery.recoveryHistory.length === 0) {
        console.log('No recovery history found.');
        return;
      }
      
      const displayHistory = disasterRecovery.recoveryHistory.slice(-limit).reverse();
      
      displayHistory.forEach((recovery, index) => {
        const statusIcon = recovery.status === 'completed' ? '✅' : '❌';
        const date = new Date(recovery.startTime);
        
        console.log(`${index + 1}. ${statusIcon} ${recovery.id}`);
        console.log(`   Date: ${date.toLocaleString()}`);
        console.log(`   Type: ${recovery.type}`);
        console.log(`   Reason: ${recovery.reason}`);
        console.log(`   Duration: ${formatDuration(recovery.duration || 0)}`);
        
        if (recovery.backupId) {
          console.log(`   Backup: ${recovery.backupId}`);
        }
        
        if (recovery.rtoAchieved !== undefined) {
          console.log(`   RTO: ${recovery.rtoAchieved ? 'Achieved' : 'Missed'}`);
          console.log(`   RPO: ${recovery.rpoAchieved ? 'Achieved' : 'Missed'}`);
        }
        
        if (recovery.error) {
          console.log(`   Error: ${recovery.error}`);
        }
        
        console.log();
      });
      
    } catch (error) {
      console.error('❌ Failed to get recovery history:', error.message);
      process.exit(1);
    }
  });

/**
 * Plan command
 */
program
  .command('plan')
  .description('View or manage recovery plan')
  .option('--show', 'Show current recovery plan')
  .option('--validate', 'Validate recovery plan')
  .action(async (options) => {
    try {
      // Initialize components
      await backupManager.initialize();
      await disasterRecovery.initialize(backupManager);
      
      if (options.validate) {
        console.log('🔍 Validating recovery plan...\n');
        
        // Check each step
        let valid = true;
        disasterRecovery.recoveryPlan.steps.forEach((step, index) => {
          console.log(`${index + 1}. ${step.name}`);
          
          if (!step.actions || step.actions.length === 0) {
            console.log(`   ⚠️  No actions defined`);
            valid = false;
          } else {
            console.log(`   ✅ ${step.actions.length} actions`);
          }
          
          if (step.timeout) {
            console.log(`   ⏱️  Timeout: ${formatDuration(step.timeout)}`);
          }
          
          console.log(`   🔒 Critical: ${step.critical ? 'Yes' : 'No'}`);
          console.log();
        });
        
        if (valid) {
          console.log('✅ Recovery plan is valid');
        } else {
          console.log('⚠️  Recovery plan has warnings');
        }
        
      } else {
        // Show plan
        console.log('📋 Current Recovery Plan\n');
        console.log(`Name: ${disasterRecovery.recoveryPlan.name}`);
        console.log(`Version: ${disasterRecovery.recoveryPlan.version}`);
        console.log(`Steps: ${disasterRecovery.recoveryPlan.steps.length}`);
        console.log();
        
        disasterRecovery.recoveryPlan.steps.forEach((step, index) => {
          console.log(`${index + 1}. ${step.name} (${step.id})`);
          console.log(`   Critical: ${step.critical ? 'Yes' : 'No'}`);
          console.log(`   Timeout: ${formatDuration(step.timeout)}`);
          console.log(`   Actions:`);
          step.actions.forEach(action => {
            console.log(`     - ${action}`);
          });
          console.log();
        });
      }
      
    } catch (error) {
      console.error('❌ Failed to manage recovery plan:', error.message);
      process.exit(1);
    }
  });

/**
 * Health command
 */
program
  .command('health')
  .description('Check system health and recovery readiness')
  .action(async (options) => {
    try {
      // Initialize components
      await backupManager.initialize();
      await disasterRecovery.initialize(backupManager);
      
      console.log('🏥 System Health Check\n');
      
      // Check each health checker
      let allHealthy = true;
      
      for (const [name, checker] of disasterRecovery.healthCheckers.entries()) {
        try {
          const result = await checker.check();
          const status = result.healthy ? '✅' : '❌';
          console.log(`${status} ${checker.name}`);
          
          if (result.details) {
            Object.entries(result.details).forEach(([key, value]) => {
              console.log(`   ${key}: ${JSON.stringify(value)}`);
            });
          }
          
          if (!result.healthy) {
            allHealthy = false;
          }
        } catch (error) {
          console.log(`❌ ${checker.name}`);
          console.log(`   Error: ${error.message}`);
          allHealthy = false;
        }
      }
      
      // Check backups
      console.log('\n📦 Backup Status');
      const backups = await backupManager.getBackupList();
      const validBackups = [];
      
      for (const backup of backups.slice(-3)) { // Check last 3 backups
        const verification = await backupManager.verifyBackup(backup.id);
        if (verification.valid) {
          validBackups.push(backup);
        }
      }
      
      console.log(`   Total backups: ${backups.length}`);
      console.log(`   Valid recent backups: ${validBackups.length}`);
      
      if (validBackups.length > 0) {
        const latest = validBackups[0];
        console.log(`   Latest valid backup: ${formatTimeAgo(latest.timestamp)}`);
      }
      
      // Recovery readiness
      console.log('\n🚀 Recovery Readiness');
      const rtoStatus = disasterRecovery.options.rto ? '✅' : '❌';
      const rpoStatus = disasterRecovery.options.rpo ? '✅' : '❌';
      const backupStatus = validBackups.length > 0 ? '✅' : '❌';
      
      console.log(`   ${rtoStatus} RTO configured: ${formatDuration(disasterRecovery.options.rto)}`);
      console.log(`   ${rpoStatus} RPO configured: ${formatDuration(disasterRecovery.options.rpo)}`);
      console.log(`   ${backupStatus} Valid backups available`);
      console.log(`   ${allHealthy ? '✅' : '❌'} System health`);
      
      const ready = allHealthy && validBackups.length > 0;
      console.log(`\n${ready ? '✅' : '❌'} System is ${ready ? '' : 'NOT '}ready for recovery`);
      
      if (!ready) {
        process.exit(1);
      }
      
    } catch (error) {
      console.error('❌ Health check failed:', error.message);
      process.exit(1);
    }
  });

// Parse command line arguments
program
  .name('disaster-recovery')
  .description('PoppoBuilder Disaster Recovery Tool')
  .version('1.0.0');

program.parse();

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught exception:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});