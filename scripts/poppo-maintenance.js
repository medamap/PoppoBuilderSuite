#!/usr/bin/env node

/**
 * PoppoBuilder メンテナンスモード管理CLI
 */

const MaintenanceMode = require('../src/core/maintenance-mode');

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

class MaintenanceCLI {
  constructor() {
    this.maintenance = new MaintenanceMode();
  }

  async run() {
    const args = process.argv.slice(2);
    const command = args[0];

    try {
      switch (command) {
        case 'start':
          await this.start(args.slice(1));
          break;
        case 'stop':
          await this.stop();
          break;
        case 'status':
          await this.status();
          break;
        case 'extend':
          await this.extend(args[1]);
          break;
        case 'help':
        default:
          this.showHelp();
      }
    } catch (error) {
      log(`❌ エラー: ${error.message}`, 'red');
      process.exit(1);
    }
  }

  async start(args) {
    // 引数解析
    let reason = 'System maintenance';
    let duration = '10m';
    let allowedProcesses = ['dashboard', 'monitor'];

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--reason' || args[i] === '-r') {
        reason = args[++i];
      } else if (args[i] === '--duration' || args[i] === '-d') {
        duration = args[++i];
      } else if (args[i] === '--allow' || args[i] === '-a') {
        allowedProcesses = args[++i].split(',');
      } else if (!args[i].startsWith('-')) {
        // 第一引数を理由として扱う
        reason = args[i];
      }
    }

    // 確認
    log('\n🚧 メンテナンスモードを開始します:', 'yellow');
    log(`   理由: ${reason}`);
    log(`   予想時間: ${duration}`);
    log(`   許可プロセス: ${allowedProcesses.join(', ')}`);
    log('');

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise(resolve => {
      rl.question('続行しますか？ (y/N): ', resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      log('キャンセルされました', 'yellow');
      return;
    }

    await this.maintenance.start({
      reason,
      expectedDuration: duration,
      allowedProcesses
    });
  }

  async stop() {
    const status = await this.maintenance.status();
    if (!status) {
      log('メンテナンスモードは有効ではありません', 'yellow');
      return;
    }

    log('\n現在のメンテナンス状態:', 'blue');
    log(`   理由: ${status.reason}`);
    log(`   経過時間: ${status.elapsed}`);
    log('');

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise(resolve => {
      rl.question('メンテナンスモードを終了しますか？ (y/N): ', resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      log('キャンセルされました', 'yellow');
      return;
    }

    await this.maintenance.stop();
  }

  async status() {
    const status = await this.maintenance.status();
    
    if (!status) {
      log('✅ メンテナンスモードは無効です', 'green');
      log('   システムは通常稼働中です');
      return;
    }

    log('\n🚧 メンテナンスモード有効', 'yellow');
    log(`   理由: ${status.reason}`);
    log(`   開始時刻: ${status.startedAt}`);
    log(`   経過時間: ${status.elapsed}`);
    log(`   予想時間: ${status.expectedDuration}`);
    log(`   許可プロセス: ${status.allowedProcesses.join(', ')}`);
    log(`   開始者: PID ${status.pid} @ ${status.hostname}`);
  }

  async extend(duration) {
    if (!duration) {
      log('❌ 延長時間を指定してください (例: 30m, 1h)', 'red');
      return;
    }

    const status = await this.maintenance.status();
    if (!status) {
      log('❌ メンテナンスモードが有効ではありません', 'red');
      return;
    }

    await this.maintenance.extend(duration);
  }

  showHelp() {
    console.log(`
PoppoBuilder メンテナンスモード管理

使用方法: poppo maintenance <command> [options]

コマンド:
  start [reason]     メンテナンスモードを開始
    -r, --reason     理由を指定
    -d, --duration   予想時間を指定 (例: 30m, 1h)
    -a, --allow      許可するプロセス (カンマ区切り)
    
  stop              メンテナンスモードを終了
  
  status            現在の状態を表示
  
  extend <time>     メンテナンス時間を延長
  
  help              このヘルプを表示

例:
  poppo maintenance start "ストレージパス変更のため" -d 30m
  poppo maintenance start --reason "緊急メンテナンス" --duration 1h --allow dashboard,monitor,cli
  poppo maintenance extend 30m
  poppo maintenance stop
`);
  }
}

// 実行
if (require.main === module) {
  const cli = new MaintenanceCLI();
  cli.run();
}

module.exports = MaintenanceCLI;