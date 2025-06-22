#!/usr/bin/env node

/**
 * Issue #133: Backup Management Script
 * 
 * Command-line interface for backup operations:
 * - Create backups
 * - List backups
 * - Restore backups
 * - Verify backup integrity
 * - Manage retention
 */

const path = require('path');
const { program } = require('commander');
const BackupManager = require('../lib/backup/backup-manager');
const ProductionLogger = require('../lib/utils/production-logger');

// Initialize logger
const logger = new ProductionLogger('BackupScript', {
  enableStructuredLogging: true
});

// Initialize backup manager
const backupManager = new BackupManager({
  backupPath: './backups',
  encryptionEnabled: true,
  compressionEnabled: true,
  retentionDays: 30,
  maxBackups: 10
});

// Helper function to format file size
function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

// Helper function to format duration
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Create backup command
 */
program
  .command('create')
  .description('Create a new backup')
  .option('-t, --type <type>', 'Backup type (full/incremental)', 'full')
  .option('-i, --items <items>', 'Comma-separated list of items to backup')
  .option('--include-logs', 'Include log files in backup')
  .option('--no-compress', 'Disable compression')
  .option('--no-encrypt', 'Disable encryption')
  .option('-m, --metadata <json>', 'Additional metadata as JSON')
  .action(async (options) => {
    try {
      await backupManager.initialize();
      
      console.log('🔄 Creating backup...');
      
      const backupOptions = {
        type: options.type,
        includeLogs: options.includeLogs,
        metadata: options.metadata ? JSON.parse(options.metadata) : {}
      };
      
      if (options.items) {
        backupOptions.items = options.items.split(',').map(i => i.trim());
      }
      
      // Override manager options if specified
      if (!options.compress) {
        backupManager.options.compressionEnabled = false;
      }
      if (!options.encrypt) {
        backupManager.options.encryptionEnabled = false;
      }
      
      const backup = await backupManager.createBackup(backupOptions);
      
      console.log('✅ Backup created successfully!\n');
      console.log(`📦 Backup Details:`);
      console.log(`   ID: ${backup.id}`);
      console.log(`   Type: ${backup.type}`);
      console.log(`   Size: ${formatSize(backup.size)}`);
      console.log(`   Duration: ${formatDuration(backup.duration)}`);
      console.log(`   Items: ${backup.items.join(', ')}`);
      console.log(`   Compressed: ${backup.compressed ? 'Yes' : 'No'}`);
      console.log(`   Encrypted: ${backup.encrypted ? 'Yes' : 'No'}`);
      
      if (backup.compressed && backup.compressionRatio) {
        console.log(`   Compression Ratio: ${(backup.compressionRatio * 100).toFixed(1)}%`);
      }
      
    } catch (error) {
      console.error('❌ Failed to create backup:', error.message);
      process.exit(1);
    }
  });

/**
 * List backups command
 */
program
  .command('list')
  .description('List all backups')
  .option('--json', 'Output in JSON format')
  .option('-l, --limit <number>', 'Limit number of backups shown', '20')
  .action(async (options) => {
    try {
      await backupManager.initialize();
      
      const backups = await backupManager.getBackupList();
      const limit = parseInt(options.limit);
      
      if (options.json) {
        console.log(JSON.stringify(backups.slice(-limit), null, 2));
        return;
      }
      
      console.log('📋 Available Backups\n');
      
      if (backups.length === 0) {
        console.log('No backups found.');
        return;
      }
      
      // Show most recent first
      const displayBackups = backups.slice(-limit).reverse();
      
      displayBackups.forEach((backup, index) => {
        const date = new Date(backup.timestamp);
        const statusIcon = backup.status === 'completed' ? '✅' : 
                          backup.status === 'failed' ? '❌' : '🔄';
        
        console.log(`${index + 1}. ${statusIcon} ${backup.id}`);
        console.log(`   Type: ${backup.type}`);
        console.log(`   Date: ${date.toLocaleString()}`);
        console.log(`   Size: ${formatSize(backup.size || 0)}`);
        console.log(`   Items: ${backup.items ? backup.items.join(', ') : 'N/A'}`);
        
        if (backup.encrypted) console.log(`   🔒 Encrypted`);
        if (backup.compressed) console.log(`   📦 Compressed`);
        
        console.log();
      });
      
      if (backups.length > limit) {
        console.log(`Showing ${limit} of ${backups.length} backups. Use --limit to see more.`);
      }
      
    } catch (error) {
      console.error('❌ Failed to list backups:', error.message);
      process.exit(1);
    }
  });

/**
 * Restore backup command
 */
program
  .command('restore')
  .description('Restore from a backup')
  .argument('<backup-id>', 'Backup ID to restore')
  .option('-i, --items <items>', 'Comma-separated list of items to restore')
  .option('--skip-verification', 'Skip checksum verification')
  .option('--create-restore-point', 'Create restore point before restoring')
  .option('--dry-run', 'Show what would be restored without making changes')
  .action(async (backupId, options) => {
    try {
      await backupManager.initialize();
      
      // Verify backup exists
      const backup = await backupManager.getBackupDetails(backupId);
      
      console.log(`🔄 Restoring from backup: ${backupId}`);
      console.log(`   Created: ${new Date(backup.timestamp).toLocaleString()}`);
      console.log(`   Type: ${backup.type}`);
      console.log(`   Items: ${backup.items.join(', ')}`);
      
      if (options.dryRun) {
        console.log('\n📋 Dry run - no changes will be made');
        return;
      }
      
      // Confirm restore
      console.log('\n⚠️  Warning: This will overwrite existing data!');
      console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...');
      
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const restoreOptions = {
        skipChecksumVerification: options.skipVerification,
        createRestorePoint: options.createRestorePoint,
        continueOnError: true
      };
      
      if (options.items) {
        restoreOptions.items = options.items.split(',').map(i => i.trim());
      }
      
      const restore = await backupManager.restoreBackup(backupId, restoreOptions);
      
      console.log('\n✅ Restore completed successfully!');
      console.log(`   Duration: ${formatDuration(restore.duration)}`);
      
      if (restoreOptions.createRestorePoint) {
        console.log('   Restore point created');
      }
      
    } catch (error) {
      console.error('❌ Failed to restore backup:', error.message);
      process.exit(1);
    }
  });

/**
 * Verify backup command
 */
program
  .command('verify')
  .description('Verify backup integrity')
  .argument('<backup-id>', 'Backup ID to verify')
  .action(async (backupId) => {
    try {
      await backupManager.initialize();
      
      console.log(`🔍 Verifying backup: ${backupId}`);
      
      const result = await backupManager.verifyBackup(backupId);
      
      if (result.valid) {
        console.log('✅ Backup verification passed!');
        console.log(`   Verified at: ${result.verifiedAt}`);
      } else {
        console.log('❌ Backup verification failed!');
        console.log(`   Error: ${result.error}`);
        process.exit(1);
      }
      
    } catch (error) {
      console.error('❌ Failed to verify backup:', error.message);
      process.exit(1);
    }
  });

/**
 * Delete backup command
 */
program
  .command('delete')
  .description('Delete a backup')
  .argument('<backup-id>', 'Backup ID to delete')
  .option('--confirm', 'Confirm deletion')
  .action(async (backupId, options) => {
    try {
      if (!options.confirm) {
        console.log('⚠️  Delete requires confirmation. Use --confirm flag.');
        process.exit(1);
      }
      
      await backupManager.initialize();
      
      console.log(`🗑️  Deleting backup: ${backupId}`);
      
      const backend = backupManager.storageBackends.get('local');
      const backup = await backupManager.getBackupDetails(backupId);
      
      await backend.delete(backup.path);
      
      // Remove from history
      const index = backupManager.backupHistory.findIndex(b => b.id === backupId);
      if (index > -1) {
        backupManager.backupHistory.splice(index, 1);
        await backupManager.saveBackupHistory();
      }
      
      console.log('✅ Backup deleted successfully');
      
    } catch (error) {
      console.error('❌ Failed to delete backup:', error.message);
      process.exit(1);
    }
  });

/**
 * Clean command - remove old backups
 */
program
  .command('clean')
  .description('Remove old backups based on retention policy')
  .option('--dry-run', 'Show what would be deleted without making changes')
  .action(async (options) => {
    try {
      await backupManager.initialize();
      
      console.log('🧹 Cleaning old backups...');
      console.log(`   Retention: ${backupManager.options.retentionDays} days`);
      console.log(`   Max backups: ${backupManager.options.maxBackups}`);
      
      if (options.dryRun) {
        console.log('\n📋 Dry run - no changes will be made\n');
        
        const cutoffTime = Date.now() - (backupManager.options.retentionDays * 24 * 60 * 60 * 1000);
        const oldBackups = backupManager.backupHistory.filter(b => 
          new Date(b.timestamp).getTime() < cutoffTime &&
          b.type !== 'restore-point'
        );
        
        if (oldBackups.length === 0) {
          console.log('No backups to clean.');
        } else {
          console.log(`Would delete ${oldBackups.length} backup(s):`);
          oldBackups.forEach(b => {
            console.log(`   - ${b.id} (${new Date(b.timestamp).toLocaleDateString()})`);
          });
        }
      } else {
        await backupManager.cleanOldBackups();
        console.log('✅ Cleanup completed');
      }
      
    } catch (error) {
      console.error('❌ Failed to clean backups:', error.message);
      process.exit(1);
    }
  });

/**
 * Info command - show backup system information
 */
program
  .command('info')
  .description('Show backup system information')
  .action(async () => {
    try {
      await backupManager.initialize();
      
      const backups = backupManager.backupHistory;
      const totalSize = backups.reduce((sum, b) => sum + (b.size || 0), 0);
      const successful = backups.filter(b => b.status === 'completed').length;
      const failed = backups.filter(b => b.status === 'failed').length;
      
      console.log('📊 Backup System Information\n');
      console.log('Configuration:');
      console.log(`   Backup path: ${backupManager.options.backupPath}`);
      console.log(`   Encryption: ${backupManager.options.encryptionEnabled ? 'Enabled' : 'Disabled'}`);
      console.log(`   Compression: ${backupManager.options.compressionEnabled ? 'Enabled' : 'Disabled'}`);
      console.log(`   Retention: ${backupManager.options.retentionDays} days`);
      console.log(`   Max backups: ${backupManager.options.maxBackups}`);
      
      console.log('\nStatistics:');
      console.log(`   Total backups: ${backups.length}`);
      console.log(`   Successful: ${successful}`);
      console.log(`   Failed: ${failed}`);
      console.log(`   Total size: ${formatSize(totalSize)}`);
      
      if (backupManager.lastFullBackup) {
        console.log(`\nLast full backup:`);
        console.log(`   ID: ${backupManager.lastFullBackup.id}`);
        console.log(`   Date: ${new Date(backupManager.lastFullBackup.timestamp).toLocaleString()}`);
      }
      
      if (backupManager.lastIncrementalBackup) {
        console.log(`\nLast incremental backup:`);
        console.log(`   ID: ${backupManager.lastIncrementalBackup.id}`);
        console.log(`   Date: ${new Date(backupManager.lastIncrementalBackup.timestamp).toLocaleString()}`);
      }
      
    } catch (error) {
      console.error('❌ Failed to get backup info:', error.message);
      process.exit(1);
    }
  });

// Parse command line arguments
program
  .name('backup')
  .description('PoppoBuilder Backup Management Tool')
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