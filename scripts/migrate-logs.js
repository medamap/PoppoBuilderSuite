#!/usr/bin/env node

/**
 * ログファイルマイグレーションスクリプト
 * プロジェクトディレクトリ内のログを外部ストレージに移動
 */

const fs = require('fs').promises;
const path = require('path');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

const globalConfig = require('../src/core/global-config');
const storagePaths = require('../src/core/storage-paths');

// カラー出力
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

class LogMigrator {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '..');
    this.stats = {
      filesMoved: 0,
      directoriesMoved: 0,
      bytesMovMd: 0,
      errors: []
    };
  }

  async initialize() {
    // グローバル設定の初期化
    await globalConfig.initialize();
    
    // ストレージパスの初期化
    storagePaths.initialize(globalConfig.config, this.projectRoot);
    
    log('📁 ログマイグレーション設定:', 'blue');
    log(`   プロジェクト: ${storagePaths.projectName}`);
    log(`   移行元: ${this.projectRoot}/logs`);
    log(`   移行先: ${storagePaths.getLogsDir()}`);
    log('');
  }

  async findLogFiles() {
    const logSources = [];
    
    // プロジェクトルートのlogsディレクトリ
    const projectLogsDir = path.join(this.projectRoot, 'logs');
    if (await this.exists(projectLogsDir)) {
      logSources.push({
        source: projectLogsDir,
        target: storagePaths.getLogsDir('app'),
        type: 'directory'
      });
    }
    
    // ルートディレクトリの*.logファイル
    const rootFiles = await fs.readdir(this.projectRoot);
    for (const file of rootFiles) {
      if (file.endsWith('.log')) {
        const filePath = path.join(this.projectRoot, file);
        const stat = await fs.stat(filePath);
        if (stat.isFile()) {
          logSources.push({
            source: filePath,
            target: path.join(storagePaths.getLogsDir('app'), file),
            type: 'file'
          });
        }
      }
    }
    
    // エージェントログ
    const agentsDir = path.join(this.projectRoot, 'agents');
    if (await this.exists(agentsDir)) {
      const agents = await fs.readdir(agentsDir);
      for (const agent of agents) {
        const agentLogsDir = path.join(agentsDir, agent, 'logs');
        if (await this.exists(agentLogsDir)) {
          logSources.push({
            source: agentLogsDir,
            target: storagePaths.getAgentLogPath(agent, '').replace(/\/$/, ''),
            type: 'directory'
          });
        }
      }
    }
    
    return logSources;
  }

  async exists(path) {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  async getSize(path) {
    try {
      const stat = await fs.stat(path);
      if (stat.isDirectory()) {
        const { stdout } = await exec(`du -sb "${path}" | cut -f1`);
        return parseInt(stdout.trim());
      }
      return stat.size;
    } catch {
      return 0;
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async migrateItem(item) {
    try {
      const size = await this.getSize(item.source);
      
      // ターゲットディレクトリの作成
      const targetDir = item.type === 'file' ? path.dirname(item.target) : item.target;
      await fs.mkdir(targetDir, { recursive: true });
      
      // 移動実行
      if (item.type === 'file') {
        await fs.rename(item.source, item.target);
        this.stats.filesMoved++;
      } else {
        // ディレクトリの場合はcpコマンドでコピー後削除
        await exec(`cp -r "${item.source}"/* "${item.target}"/`);
        await fs.rm(item.source, { recursive: true, force: true });
        this.stats.directoriesMoved++;
      }
      
      this.stats.bytesMovMd += size;
      
      const relativePath = path.relative(this.projectRoot, item.source);
      log(`  ✓ ${relativePath} → ${path.relative(this.projectRoot, item.target)} (${this.formatBytes(size)})`, 'green');
    } catch (error) {
      this.stats.errors.push(`${item.source}: ${error.message}`);
      log(`  ✗ ${path.relative(this.projectRoot, item.source)}: ${error.message}`, 'red');
    }
  }

  async createSymlink() {
    const projectLogsDir = path.join(this.projectRoot, 'logs');
    const targetLogsDir = storagePaths.getLogsDir();
    
    try {
      // 既存のlogsディレクトリまたはシンボリックリンクを削除
      if (await this.exists(projectLogsDir)) {
        const stat = await fs.lstat(projectLogsDir);
        if (stat.isSymbolicLink()) {
          await fs.unlink(projectLogsDir);
        } else if (stat.isDirectory()) {
          const files = await fs.readdir(projectLogsDir);
          if (files.length === 0) {
            await fs.rmdir(projectLogsDir);
          } else {
            log(`  ⚠️  ${projectLogsDir} is not empty, skipping symlink creation`, 'yellow');
            return;
          }
        }
      }
      
      // シンボリックリンク作成
      await fs.symlink(targetLogsDir, projectLogsDir, 'dir');
      log(`  ✓ シンボリックリンク作成: logs → ${targetLogsDir}`, 'green');
    } catch (error) {
      log(`  ✗ シンボリックリンク作成失敗: ${error.message}`, 'red');
    }
  }

  async run() {
    try {
      await this.initialize();
      
      // マイグレーション対象の検索
      const items = await this.findLogFiles();
      
      if (items.length === 0) {
        log('✨ マイグレーション対象のログファイルが見つかりません', 'green');
        return;
      }
      
      log(`\n📊 マイグレーション対象:`, 'yellow');
      for (const item of items) {
        const size = await this.getSize(item.source);
        log(`   ${path.relative(this.projectRoot, item.source)} (${this.formatBytes(size)})`);
      }
      
      const totalSize = await items.reduce(async (sum, item) => {
        return (await sum) + (await this.getSize(item.source));
      }, Promise.resolve(0));
      
      log(`\n   合計: ${items.length} 項目, ${this.formatBytes(totalSize)}`, 'yellow');
      
      // 確認
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise(resolve => {
        rl.question('\nマイグレーションを実行しますか？ (y/N): ', resolve);
      });
      rl.close();
      
      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        log('キャンセルされました', 'yellow');
        return;
      }
      
      // マイグレーション実行
      log('\n🚀 マイグレーション開始...', 'blue');
      for (const item of items) {
        await this.migrateItem(item);
      }
      
      // シンボリックリンク作成
      log('\n🔗 シンボリックリンク作成...', 'blue');
      await this.createSymlink();
      
      // 結果表示
      log('\n✅ マイグレーション完了!', 'green');
      log(`   ファイル: ${this.stats.filesMoved} 個`);
      log(`   ディレクトリ: ${this.stats.directoriesMoved} 個`);
      log(`   移動サイズ: ${this.formatBytes(this.stats.bytesMovMd)}`);
      
      if (this.stats.errors.length > 0) {
        log(`\n⚠️  エラー: ${this.stats.errors.length} 件`, 'red');
        this.stats.errors.forEach(err => log(`   - ${err}`, 'red'));
      }
      
    } catch (error) {
      log(`\n❌ エラー: ${error.message}`, 'red');
      process.exit(1);
    }
  }
}

// 実行
if (require.main === module) {
  const migrator = new LogMigrator();
  migrator.run();
}

module.exports = LogMigrator;