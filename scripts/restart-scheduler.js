#!/usr/bin/env node

/**
 * PoppoBuilder再起動スケジューラー
 * dogfooding時の自己再起動問題を解決するための二段ロケット方式
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class RestartScheduler {
  constructor() {
    this.flagFile = path.join(process.cwd(), '.poppo', 'restart-flag.json');
    this.logFile = path.join(process.cwd(), 'logs', `restart-${new Date().toISOString().split('T')[0]}.log`);
    this.pollInterval = 5000; // 5秒間隔でチェック
  }

  /**
   * ログ出力
   */
  log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} [RestartScheduler] ${message}\n`;
    
    console.log(logMessage.trim());
    
    // ログファイルに記録
    try {
      fs.appendFileSync(this.logFile, logMessage);
    } catch (error) {
      console.warn('ログ書き込みエラー:', error.message);
    }
  }

  /**
   * 再起動フラグをチェック
   */
  checkRestartFlag() {
    try {
      if (fs.existsSync(this.flagFile)) {
        const flagData = JSON.parse(fs.readFileSync(this.flagFile, 'utf-8'));
        const now = Date.now();
        
        if (flagData.restartAt && now >= flagData.restartAt) {
          this.log(`再起動フラグ検出: ${new Date(flagData.restartAt).toISOString()}`);
          this.executeRestart(flagData);
          return true;
        }
      }
    } catch (error) {
      this.log(`フラグチェックエラー: ${error.message}`);
    }
    return false;
  }

  /**
   * PoppoBuilderを再起動
   */
  executeRestart(flagData) {
    this.log('PoppoBuilder再起動を開始...');

    try {
      // 再起動フラグを削除
      fs.unlinkSync(this.flagFile);
      this.log('再起動フラグを削除しました');

      // 既存のPoppoBuilderプロセスを終了
      this.killExistingProcesses();

      // 少し待機
      setTimeout(() => {
        this.log('新しいPoppoBuilderプロセスを起動...');
        
        // 新しいプロセスを起動
        const child = spawn('npm', ['start'], {
          detached: true,
          stdio: 'ignore',
          cwd: process.cwd()
        });
        
        child.unref();
        this.log(`新しいプロセス起動完了 (PID: ${child.pid})`);
        
        // タスク情報をログに記録
        if (flagData.completedTask) {
          this.log(`完了タスク: Issue #${flagData.completedTask.issueNumber} - ${flagData.completedTask.title}`);
        }

      }, 2000);

    } catch (error) {
      this.log(`再起動エラー: ${error.message}`);
    }
  }

  /**
   * 既存のPoppoBuilderプロセスを終了
   */
  killExistingProcesses() {
    try {
      const { execSync } = require('child_process');
      const processes = execSync('ps aux | grep "PoppoBuilder-Main" | grep -v grep').toString();
      
      if (processes.trim()) {
        const lines = processes.trim().split('\n');
        for (const line of lines) {
          const pid = line.trim().split(/\s+/)[1];
          if (pid && pid !== process.pid.toString()) {
            process.kill(parseInt(pid), 'SIGTERM');
            this.log(`既存プロセス終了: PID ${pid}`);
          }
        }
      }
    } catch (error) {
      // プロセスが見つからない場合は正常
      this.log('既存プロセスが見つかりませんでした');
    }
  }

  /**
   * 監視ループ開始
   */
  start() {
    this.log('PoppoBuilder再起動スケジューラーを開始しました');
    this.log(`監視間隔: ${this.pollInterval / 1000}秒`);
    this.log(`フラグファイル: ${this.flagFile}`);

    const checkLoop = () => {
      try {
        if (this.checkRestartFlag()) {
          // 再起動実行後は終了
          this.log('再起動完了。スケジューラーを終了します。');
          process.exit(0);
        }
      } catch (error) {
        this.log(`チェックループエラー: ${error.message}`);
      }

      setTimeout(checkLoop, this.pollInterval);
    };

    checkLoop();
  }

  /**
   * 再起動フラグを設定（外部から呼び出し用）
   */
  static scheduleRestart(delaySeconds = 30, taskInfo = null) {
    const flagFile = path.join(process.cwd(), '.poppo', 'restart-flag.json');
    const restartAt = Date.now() + (delaySeconds * 1000);

    // .poppoディレクトリを確保
    const poppoDir = path.dirname(flagFile);
    if (!fs.existsSync(poppoDir)) {
      fs.mkdirSync(poppoDir, { recursive: true });
    }

    const flagData = {
      restartAt,
      scheduledAt: Date.now(),
      delaySeconds,
      completedTask: taskInfo
    };

    fs.writeFileSync(flagFile, JSON.stringify(flagData, null, 2));
    
    const restartTime = new Date(restartAt).toISOString();
    console.log(`🚀 PoppoBuilder再起動を${delaySeconds}秒後にスケジュールしました: ${restartTime}`);
    
    return flagData;
  }
}

// コマンドライン実行時
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--oneshot')) {
    // ワンショット方式: 指定秒数後に1回だけ再起動
    const delaySeconds = parseInt(args[args.indexOf('--oneshot') + 1]) || 30;
    
    console.log(`🚀 ワンショット再起動スケジューラー: ${delaySeconds}秒後に再起動`);
    
    setTimeout(() => {
      const scheduler = new RestartScheduler();
      scheduler.log('ワンショット再起動を実行...');
      scheduler.executeRestart({
        oneshot: true,
        delaySeconds,
        scheduledAt: new Date().toISOString()
      });
    }, delaySeconds * 1000);
    
  } else {
    // 従来の常駐方式（フラグファイル監視）
    const scheduler = new RestartScheduler();
    
    // プロセス終了時のクリーンアップ
    process.on('SIGINT', () => {
      scheduler.log('SIGINT受信。スケジューラーを終了します。');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      scheduler.log('SIGTERM受信。スケジューラーを終了します。');
      process.exit(0);
    });

    scheduler.start();
  }
}

module.exports = RestartScheduler;