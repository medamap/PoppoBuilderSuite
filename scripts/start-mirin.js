#!/usr/bin/env node

/**
 * MirinOrphanManager スタンドアロン起動スクリプト
 * 毎時3分・33分に実行されるcronジョブとして設定する
 */

const fs = require('fs');
const path = require('path');
const GitHubClient = require('../src/github-client');
const StatusManager = require('../src/status-manager');
const MirinOrphanManager = require('../src/mirin-orphan-manager');
const Logger = require('../src/logger');

// 設定ファイルを読み込み
const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../config/config.json'), 'utf-8')
);

// ロガーの初期化
const logger = new Logger(
  path.join(__dirname, '../logs'),
  config.logRotation || {}
);

console.log('🎋 MirinOrphanManager を起動します...');
logger.info('MirinOrphanManager 起動開始');

// 各コンポーネントを初期化
const githubClient = new GitHubClient(config.github);
const statusManager = new StatusManager('state/issue-status.json', logger);
const mirinOrphanManager = new MirinOrphanManager(
  githubClient,
  statusManager,
  {
    checkInterval: 30 * 60 * 1000, // 30分
    heartbeatTimeout: 5 * 60 * 1000, // 5分
    requestsDir: 'state/requests',
    requestCheckInterval: 5000 // 5秒
  },
  logger
);

// 初期化と実行
async function run() {
  try {
    // StatusManager を初期化
    await statusManager.initialize();
    logger.info('StatusManager 初期化完了');
    
    // MirinOrphanManager を初期化
    await mirinOrphanManager.initialize();
    logger.info('MirinOrphanManager 初期化完了');
    
    // 単発実行モード（cron用）
    if (process.argv.includes('--once')) {
      logger.info('単発実行モード');
      
      // 孤児チェックを実行
      await mirinOrphanManager.checkOrphanedIssues();
      
      // ラベル同期を実行
      await mirinOrphanManager.syncWithStatusManager();
      
      // ラベル更新リクエストを処理
      await mirinOrphanManager.processLabelRequests();
      
      logger.info('MirinOrphanManager 実行完了');
      process.exit(0);
    } else {
      // 継続実行モード（デバッグ用）
      mirinOrphanManager.start();
      
      // プロセス終了時のクリーンアップ
      process.on('SIGINT', () => {
        logger.info('MirinOrphanManager を停止します...');
        mirinOrphanManager.stop();
        statusManager.cleanup();
        logger.close();
        process.exit(0);
      });
      
      logger.info('MirinOrphanManager 継続実行モードで起動しました');
    }
  } catch (error) {
    logger.error('MirinOrphanManager 実行エラー:', error);
    console.error('エラー:', error.message);
    process.exit(1);
  }
}

// 実行
run();