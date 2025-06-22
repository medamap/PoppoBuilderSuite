#!/usr/bin/env node

/**
 * プロジェクトディレクトリクリーンアップスクリプト
 * ランタイムファイルとゴミファイルを安全に削除します
 */

const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

// カラー出力
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

// クリーンアップ対象
const CLEANUP_TARGETS = {
  directories: [
    'logs',
    'state',
    'temp',
    'test-results',
    'test/test-state',
    'data/ccla',
    'reports',
    'backups',
    'DashboardStarter',
    'TemplateManager'
  ],
  patterns: [
    '*.tmp',
    '*.tmp.*',
    '*.lock',
    '*.pid',
    '*.log',
    '*.cache',
    '*.swp',
    '*.swo',
    '*~',
    '.DS_Store',
    'Thumbs.db',
    'npm-debug.log*',
    'yarn-error.log*',
    'nohup.out'
  ],
  stateFiles: [
    'state/*.json.backup-*',
    'state/*.json.migrated-*',
    'state/*.json.tmp.*',
    'state/poppo-cron.lock',
    'state/poppo-node.lock',
    'state/requests/label-update-*.json'
  ]
};

class ProjectCleaner {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '..');
    this.backupDir = path.join(this.projectRoot, '.cleanup-backup-' + Date.now());
    this.dryRun = false;
    this.verbose = false;
    this.interactive = true;
    this.stats = {
      filesDeleted: 0,
      directoriesDeleted: 0,
      bytesFreed: 0,
      errors: []
    };
  }

  log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
  }

  async prompt(question) {
    if (!this.interactive) return true;
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    return new Promise(resolve => {
      rl.question(`${question} (y/N): `, answer => {
        rl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });
  }

  async getSize(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  async backup(filePath) {
    try {
      const relativePath = path.relative(this.projectRoot, filePath);
      const backupPath = path.join(this.backupDir, relativePath);
      const backupDirPath = path.dirname(backupPath);
      
      await fs.mkdir(backupDirPath, { recursive: true });
      await fs.copyFile(filePath, backupPath);
      
      if (this.verbose) {
        this.log(`  Backed up: ${relativePath}`, 'blue');
      }
    } catch (error) {
      this.stats.errors.push(`Failed to backup ${filePath}: ${error.message}`);
    }
  }

  async deleteFile(filePath) {
    try {
      const size = await this.getSize(filePath);
      
      if (!this.dryRun) {
        await this.backup(filePath);
        await fs.unlink(filePath);
      }
      
      this.stats.filesDeleted++;
      this.stats.bytesFreed += size;
      
      if (this.verbose) {
        const relativePath = path.relative(this.projectRoot, filePath);
        this.log(`  Deleted: ${relativePath} (${this.formatBytes(size)})`, 'green');
      }
    } catch (error) {
      this.stats.errors.push(`Failed to delete ${filePath}: ${error.message}`);
    }
  }

  async deleteDirectory(dirPath) {
    try {
      const exists = await fs.access(dirPath).then(() => true).catch(() => false);
      if (!exists) return;
      
      if (!this.dryRun) {
        // バックアップ
        const relativePath = path.relative(this.projectRoot, dirPath);
        const backupPath = path.join(this.backupDir, relativePath);
        await fs.mkdir(path.dirname(backupPath), { recursive: true });
        await exec(`cp -r "${dirPath}" "${backupPath}"`);
        
        // 削除
        await fs.rm(dirPath, { recursive: true, force: true });
      }
      
      this.stats.directoriesDeleted++;
      
      if (this.verbose) {
        const relativePath = path.relative(this.projectRoot, dirPath);
        this.log(`  Deleted directory: ${relativePath}`, 'green');
      }
    } catch (error) {
      this.stats.errors.push(`Failed to delete directory ${dirPath}: ${error.message}`);
    }
  }

  async findFiles(pattern) {
    try {
      const { stdout } = await exec(`find "${this.projectRoot}" -name "${pattern}" -type f ! -path "*/node_modules/*" ! -path "*/.git/*" 2>/dev/null`);
      return stdout.trim().split('\n').filter(f => f);
    } catch {
      return [];
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async scan() {
    this.log('\n🔍 Scanning for files to clean up...', 'blue');
    
    const filesToDelete = [];
    const directoriesToDelete = [];
    
    // ディレクトリスキャン
    for (const dir of CLEANUP_TARGETS.directories) {
      const fullPath = path.join(this.projectRoot, dir);
      const exists = await fs.access(fullPath).then(() => true).catch(() => false);
      if (exists) {
        directoriesToDelete.push(fullPath);
      }
    }
    
    // ファイルパターンスキャン
    for (const pattern of CLEANUP_TARGETS.patterns) {
      const files = await this.findFiles(pattern);
      filesToDelete.push(...files);
    }
    
    // state関連ファイル
    for (const pattern of CLEANUP_TARGETS.stateFiles) {
      const files = await this.findFiles(path.basename(pattern));
      filesToDelete.push(...files.filter(f => f.includes('state/')));
    }
    
    return { filesToDelete: [...new Set(filesToDelete)], directoriesToDelete };
  }

  async clean() {
    const { filesToDelete, directoriesToDelete } = await this.scan();
    
    const totalItems = filesToDelete.length + directoriesToDelete.length;
    if (totalItems === 0) {
      this.log('\n✨ Project is already clean!', 'green');
      return;
    }
    
    this.log(`\n📊 Found ${totalItems} items to clean:`, 'yellow');
    this.log(`   - ${filesToDelete.length} files`, 'yellow');
    this.log(`   - ${directoriesToDelete.length} directories`, 'yellow');
    
    if (this.dryRun) {
      this.log('\n🔍 DRY RUN MODE - No files will be deleted', 'blue');
    }
    
    const proceed = await this.prompt('\nProceed with cleanup?');
    if (!proceed) {
      this.log('\n❌ Cleanup cancelled', 'red');
      return;
    }
    
    if (!this.dryRun) {
      this.log(`\n📦 Creating backup at: ${this.backupDir}`, 'blue');
    }
    
    // ファイル削除
    if (filesToDelete.length > 0) {
      this.log('\n🗑️  Deleting files...', 'yellow');
      for (const file of filesToDelete) {
        await this.deleteFile(file);
      }
    }
    
    // ディレクトリ削除
    if (directoriesToDelete.length > 0) {
      this.log('\n🗑️  Deleting directories...', 'yellow');
      for (const dir of directoriesToDelete) {
        await this.deleteDirectory(dir);
      }
    }
    
    // 結果表示
    this.log('\n✅ Cleanup completed!', 'green');
    this.log(`   - Files deleted: ${this.stats.filesDeleted}`, 'green');
    this.log(`   - Directories deleted: ${this.stats.directoriesDeleted}`, 'green');
    this.log(`   - Space freed: ${this.formatBytes(this.stats.bytesFreed)}`, 'green');
    
    if (this.stats.errors.length > 0) {
      this.log(`\n⚠️  ${this.stats.errors.length} errors occurred:`, 'red');
      this.stats.errors.forEach(err => this.log(`   - ${err}`, 'red'));
    }
    
    if (!this.dryRun) {
      this.log(`\n💾 Backup saved to: ${this.backupDir}`, 'blue');
      this.log('   You can restore files from here if needed', 'blue');
    }
  }

  async run() {
    // コマンドライン引数解析
    const args = process.argv.slice(2);
    this.dryRun = args.includes('--dry-run') || args.includes('-d');
    this.verbose = args.includes('--verbose') || args.includes('-v');
    this.interactive = !args.includes('--yes') && !args.includes('-y');
    
    if (args.includes('--help') || args.includes('-h')) {
      this.showHelp();
      return;
    }
    
    this.log('🧹 PoppoBuilder Project Cleaner', 'blue');
    this.log('================================\n', 'blue');
    
    await this.clean();
  }

  showHelp() {
    console.log(`
PoppoBuilder Project Cleaner

Usage: node scripts/cleanup-project.js [options]

Options:
  -d, --dry-run     Show what would be deleted without actually deleting
  -v, --verbose     Show detailed information about each file
  -y, --yes         Skip confirmation prompts
  -h, --help        Show this help message

This script will clean up:
  - Log files and directories
  - State and temporary files
  - Test results and cache files
  - Lock and PID files
  - Incorrectly created directories

All deleted files are backed up before removal.
`);
  }
}

// 実行
if (require.main === module) {
  const cleaner = new ProjectCleaner();
  cleaner.run().catch(error => {
    console.error('❌ Error:', error.message);
    process.exit(1);
  });
}

module.exports = ProjectCleaner;