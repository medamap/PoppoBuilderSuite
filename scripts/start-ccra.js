#!/usr/bin/env node

const CCRAAgent = require('../agents/ccra');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

/**
 * CCRA (Code Change Review Agent) スタートアップスクリプト
 */

// 設定の読み込み
const config = {
  repository: process.env.GITHUB_REPOSITORY || 'medamap/PoppoBuilderSuite',
  checkInterval: parseInt(process.env.CCRA_CHECK_INTERVAL) || 300000, // 5分
  pollingInterval: parseInt(process.env.CCRA_POLLING_INTERVAL) || 5000,
  heartbeatInterval: parseInt(process.env.CCRA_HEARTBEAT_INTERVAL) || 30000,
  reviewCriteria: {
    minCoverage: parseInt(process.env.CCRA_MIN_COVERAGE) || 80,
    maxComplexity: parseInt(process.env.CCRA_MAX_COMPLEXITY) || 10,
    maxFileLength: parseInt(process.env.CCRA_MAX_FILE_LENGTH) || 500,
    maxDuplication: parseInt(process.env.CCRA_MAX_DUPLICATION) || 5
  },
  excludePatterns: process.env.CCRA_EXCLUDE_PATTERNS ? 
    process.env.CCRA_EXCLUDE_PATTERNS.split(',') : [
      '**/node_modules/**',
      '**/test/**',
      '**/tests/**',
      '**/*.test.js',
      '**/*.spec.js'
    ]
};

// エージェントの初期化
const agent = new CCRAAgent(config);

// グレースフルシャットダウンの設定
let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`\n${signal} シグナルを受信しました。グレースフルシャットダウンを開始します...`);
  
  try {
    await agent.shutdown();
    console.log('CCRA エージェントが正常に停止しました');
    process.exit(0);
  } catch (error) {
    console.error('シャットダウンエラー:', error);
    process.exit(1);
  }
}

// シグナルハンドラーの設定
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// 未処理のエラーハンドリング
process.on('unhandledRejection', (reason, promise) => {
  console.error('未処理のPromise拒否:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('未処理の例外:', error);
  shutdown('UNCAUGHT_EXCEPTION');
});

// メイン処理
async function main() {
  console.log('=================================');
  console.log(' CCRA (Code Change Review Agent) ');
  console.log('=================================');
  console.log(`リポジトリ: ${config.repository}`);
  console.log(`チェック間隔: ${config.checkInterval / 1000}秒`);
  console.log(`環境: ${process.env.NODE_ENV || 'development'}`);
  console.log('');
  
  try {
    // 環境変数チェック
    if (!process.env.GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN環境変数が設定されていません');
    }
    
    if (!process.env.CLAUDE_API_KEY) {
      console.warn('警告: CLAUDE_API_KEY環境変数が設定されていません。一部機能が制限されます。');
    }
    
    // エージェントの初期化
    console.log('エージェントを初期化中...');
    await agent.initialize();
    
    console.log('');
    console.log('✅ CCRA エージェントが正常に起動しました');
    console.log('PRレビューの監視を開始します...');
    console.log('');
    console.log('停止するには Ctrl+C を押してください');
    
  } catch (error) {
    console.error('起動エラー:', error.message);
    process.exit(1);
  }
}

// 起動
main();