#!/usr/bin/env node

/**
 * PoppoBuilder バックアップ管理CLI
 * 
 * 使用方法:
 *   poppo-backup create [options]     - バックアップを作成
 *   poppo-backup list                 - バックアップ一覧を表示
 *   poppo-backup restore <backup-id>  - バックアップから復元
 *   poppo-backup verify <backup-id>   - バックアップを検証
 *   poppo-backup delete <backup-id>   - バックアップを削除
 */

const path = require('path');
const fs = require('fs').promises;
const BackupManager = require('../src/backup-manager');
const Logger = require('../src/logger');

// カラー出力用
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

// コマンドライン引数の解析
const args = process.argv.slice(2);
const command = args[0];

// 設定の読み込み
async function loadConfig() {
  try {
    const configPath = path.join(__dirname, '..', 'config', 'config.json');
    const configContent = await fs.readFile(configPath, 'utf8');
    return JSON.parse(configContent);
  } catch (error) {
    console.error('設定ファイルの読み込みに失敗しました:', error.message);
    return {};
  }
}

// ヘルプの表示
function showHelp() {
  console.log(`
${colors.bright}PoppoBuilder バックアップ管理ツール${colors.reset}

${colors.cyan}使用方法:${colors.reset}
  poppo-backup create [options]     バックアップを作成
  poppo-backup list                 バックアップ一覧を表示
  poppo-backup restore <backup-id>  バックアップから復元
  poppo-backup verify <backup-id>   バックアップを検証
  poppo-backup delete <backup-id>   バックアップを削除
  poppo-backup help                 このヘルプを表示

${colors.cyan}createオプション:${colors.reset}
  --name <name>         バックアップ名を指定
  --targets <targets>   バックアップ対象を指定 (カンマ区切り)
                       例: config,database,logs,agents,state,security
  --compress            アーカイブを圧縮 (デフォルト: true)
  --encrypt             バックアップを暗号化
  --incremental         増分バックアップを作成

${colors.cyan}restoreオプション:${colors.reset}
  --targets <targets>   リストア対象を指定 (カンマ区切り)
  --dry-run            実際のリストアを行わずに確認のみ
  --skip-backup        リストア前のバックアップをスキップ

${colors.cyan}例:${colors.reset}
  # 完全バックアップを作成
  poppo-backup create --name "daily-backup"

  # 設定とデータベースのみバックアップ
  poppo-backup create --targets config,database

  # バックアップ一覧を表示
  poppo-backup list

  # 特定のバックアップから復元
  poppo-backup restore backup-2025-06-19T12-00-00-000Z-abc123

  # ドライランモードでリストア内容を確認
  poppo-backup restore backup-id --dry-run
  `);
}

// バックアップ作成
async function createBackup(options = {}) {
  const config = await loadConfig();
  const logger = new Logger(path.join(__dirname, '..', 'logs'));
  const backupManager = new BackupManager(config.backup, logger);

  try {
    console.log(`${colors.cyan}バックアップを作成しています...${colors.reset}`);
    
    // コマンドラインオプションの処理
    const backupOptions = {};
    
    for (let i = 1; i < args.length; i++) {
      switch (args[i]) {
        case '--name':
          backupOptions.name = args[++i];
          break;
        case '--targets':
          const targets = args[++i].split(',');
          backupOptions.targets = {};
          targets.forEach(t => backupOptions.targets[t.trim()] = true);
          break;
        case '--compress':
          config.backup.storage.compress = true;
          break;
        case '--encrypt':
          config.backup.storage.encrypt = true;
          break;
        case '--incremental':
          config.backup.incremental = true;
          break;
      }
    }

    const result = await backupManager.createBackup(backupOptions);
    
    console.log(`${colors.green}✓ バックアップが完了しました${colors.reset}`);
    console.log(`  ID: ${colors.bright}${result.id}${colors.reset}`);
    console.log(`  サイズ: ${formatSize(result.size)}`);
    console.log(`  実行時間: ${result.duration}ms`);
    console.log(`  対象: ${Object.keys(result.targets).join(', ')}`);
    
  } catch (error) {
    console.error(`${colors.red}✗ バックアップ作成中にエラーが発生しました:${colors.reset}`, error.message);
    process.exit(1);
  }
}

// バックアップ一覧
async function listBackups() {
  const config = await loadConfig();
  const logger = new Logger(path.join(__dirname, '..', 'logs'));
  const backupManager = new BackupManager(config.backup, logger);

  try {
    const backups = await backupManager.listBackups();
    
    if (backups.length === 0) {
      console.log(`${colors.yellow}バックアップが見つかりません${colors.reset}`);
      return;
    }

    console.log(`${colors.cyan}バックアップ一覧:${colors.reset}`);
    console.log('─'.repeat(80));
    
    // ヘッダー
    console.log(
      padEnd('ID', 40) +
      padEnd('日時', 20) +
      padEnd('タイプ', 10) +
      padEnd('サイズ', 10)
    );
    console.log('─'.repeat(80));
    
    // バックアップリスト
    for (const backup of backups) {
      console.log(
        padEnd(backup.id, 40) +
        padEnd(formatDate(backup.timestamp), 20) +
        padEnd(backup.type || 'manual', 10) +
        padEnd(formatSize(backup.size), 10)
      );
    }
    
    console.log('─'.repeat(80));
    console.log(`合計: ${backups.length} 件のバックアップ`);
    
  } catch (error) {
    console.error(`${colors.red}✗ バックアップ一覧の取得中にエラーが発生しました:${colors.reset}`, error.message);
    process.exit(1);
  }
}

// バックアップからリストア
async function restoreBackup(backupId) {
  if (!backupId) {
    console.error(`${colors.red}✗ バックアップIDを指定してください${colors.reset}`);
    process.exit(1);
  }

  const config = await loadConfig();
  const logger = new Logger(path.join(__dirname, '..', 'logs'));
  const backupManager = new BackupManager(config.backup, logger);

  try {
    // コマンドラインオプションの処理
    const restoreOptions = {};
    
    for (let i = 2; i < args.length; i++) {
      switch (args[i]) {
        case '--targets':
          const targets = args[++i].split(',');
          restoreOptions.targets = {};
          targets.forEach(t => restoreOptions.targets[t.trim()] = true);
          break;
        case '--dry-run':
          restoreOptions.dryRun = true;
          break;
        case '--skip-backup':
          restoreOptions.skipBackup = true;
          break;
      }
    }

    if (restoreOptions.dryRun) {
      console.log(`${colors.yellow}ドライランモード: 実際のリストアは実行されません${colors.reset}`);
    } else {
      // 確認プロンプト
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise(resolve => {
        readline.question(
          `${colors.yellow}警告: リストアを実行すると現在のデータが上書きされます。続行しますか？ (yes/no): ${colors.reset}`,
          resolve
        );
      });
      readline.close();

      if (answer.toLowerCase() !== 'yes') {
        console.log('リストアをキャンセルしました');
        return;
      }
    }

    console.log(`${colors.cyan}リストアを開始しています...${colors.reset}`);
    const result = await backupManager.restore(backupId, restoreOptions);
    
    if (result.success) {
      console.log(`${colors.green}✓ リストアが完了しました${colors.reset}`);
      console.log(`  バックアップID: ${result.backupId}`);
      console.log(`  実行時間: ${result.duration}ms`);
      console.log(`  対象: ${result.targets.join(', ')}`);
    }
    
  } catch (error) {
    console.error(`${colors.red}✗ リストア中にエラーが発生しました:${colors.reset}`, error.message);
    process.exit(1);
  }
}

// バックアップの検証
async function verifyBackup(backupId) {
  if (!backupId) {
    console.error(`${colors.red}✗ バックアップIDを指定してください${colors.reset}`);
    process.exit(1);
  }

  const config = await loadConfig();
  const logger = new Logger(path.join(__dirname, '..', 'logs'));
  const backupManager = new BackupManager(config.backup, logger);

  try {
    console.log(`${colors.cyan}バックアップを検証しています...${colors.reset}`);
    const result = await backupManager.verifyBackup(backupId);
    
    if (result.valid) {
      console.log(`${colors.green}✓ バックアップは有効です${colors.reset}`);
      console.log(`  バックアップID: ${result.backupId}`);
      console.log(`  作成日時: ${formatDate(result.timestamp)}`);
      console.log(`  チェックサム: ${result.checksum.actual}`);
    } else {
      console.log(`${colors.red}✗ バックアップが無効です${colors.reset}`);
      console.log(`  バックアップID: ${result.backupId}`);
      if (result.error) {
        console.log(`  エラー: ${result.error}`);
      } else {
        console.log(`  期待されるチェックサム: ${result.checksum.expected}`);
        console.log(`  実際のチェックサム: ${result.checksum.actual}`);
      }
    }
    
  } catch (error) {
    console.error(`${colors.red}✗ 検証中にエラーが発生しました:${colors.reset}`, error.message);
    process.exit(1);
  }
}

// バックアップの削除
async function deleteBackup(backupId) {
  if (!backupId) {
    console.error(`${colors.red}✗ バックアップIDを指定してください${colors.reset}`);
    process.exit(1);
  }

  const config = await loadConfig();
  const backupPath = path.join(config.backup?.storage?.path || './backups');

  try {
    // 確認プロンプト
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise(resolve => {
      readline.question(
        `${colors.yellow}バックアップ「${backupId}」を削除しますか？ (yes/no): ${colors.reset}`,
        resolve
      );
    });
    readline.close();

    if (answer.toLowerCase() !== 'yes') {
      console.log('削除をキャンセルしました');
      return;
    }

    // バックアップの削除
    const directPath = path.join(backupPath, backupId);
    const archivePath = path.join(backupPath, `${backupId}.tar.gz`);
    
    if (await fileExists(directPath)) {
      await fs.rm(directPath, { recursive: true });
    } else if (await fileExists(archivePath)) {
      await fs.unlink(archivePath);
    } else {
      throw new Error('バックアップが見つかりません');
    }

    console.log(`${colors.green}✓ バックアップを削除しました: ${backupId}${colors.reset}`);
    
  } catch (error) {
    console.error(`${colors.red}✗ 削除中にエラーが発生しました:${colors.reset}`, error.message);
    process.exit(1);
  }
}

// ヘルパー関数

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

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

function formatDate(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function padEnd(str, length) {
  return str.padEnd(length, ' ');
}

// メイン処理
async function main() {
  switch (command) {
    case 'create':
      await createBackup();
      break;
    case 'list':
      await listBackups();
      break;
    case 'restore':
      await restoreBackup(args[1]);
      break;
    case 'verify':
      await verifyBackup(args[1]);
      break;
    case 'delete':
      await deleteBackup(args[1]);
      break;
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    default:
      console.error(`${colors.red}✗ 不明なコマンド: ${command}${colors.reset}`);
      showHelp();
      process.exit(1);
  }
}

// エラーハンドリング
process.on('unhandledRejection', (error) => {
  console.error(`${colors.red}✗ 予期しないエラーが発生しました:${colors.reset}`, error);
  process.exit(1);
});

// 実行
main().catch(error => {
  console.error(`${colors.red}✗ エラー:${colors.reset}`, error.message);
  process.exit(1);
});