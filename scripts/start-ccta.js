#!/usr/bin/env node

/**
 * CCTA (Code Change Test Agent) 起動スクリプト
 */

const CCTAAgent = require('../agents/ccta');
const Logger = require('../src/logger');
const path = require('path');
const fs = require('fs').promises;

// 設定の読み込み
async function loadConfig() {
  try {
    const configPath = path.join(__dirname, '..', 'config', 'config.json');
    const configData = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(configData);
    
    // CCTA固有の設定
    const cctaConfig = {
      ...config.agents?.ccta,
      frameworks: process.env.CCTA_FRAMEWORKS?.split(',') || config.agents?.ccta?.frameworks || ['jest'],
      coverageThreshold: {
        global: {
          branches: parseInt(process.env.CCTA_COVERAGE_BRANCHES) || config.agents?.ccta?.coverageThreshold?.global?.branches || 80,
          functions: parseInt(process.env.CCTA_COVERAGE_FUNCTIONS) || config.agents?.ccta?.coverageThreshold?.global?.functions || 80,
          lines: parseInt(process.env.CCTA_COVERAGE_LINES) || config.agents?.ccta?.coverageThreshold?.global?.lines || 80,
          statements: parseInt(process.env.CCTA_COVERAGE_STATEMENTS) || config.agents?.ccta?.coverageThreshold?.global?.statements || 80
        }
      },
      performanceThreshold: {
        loadTime: parseInt(process.env.CCTA_PERF_LOAD_TIME) || config.agents?.ccta?.performanceThreshold?.loadTime || 3000,
        memoryUsage: parseInt(process.env.CCTA_PERF_MEMORY) || config.agents?.ccta?.performanceThreshold?.memoryUsage || 100,
        bundleSize: parseInt(process.env.CCTA_PERF_BUNDLE_SIZE) || config.agents?.ccta?.performanceThreshold?.bundleSize || 500
      },
      autoFix: process.env.CCTA_AUTO_FIX === 'true' || config.agents?.ccta?.autoFix || false,
      timeout: parseInt(process.env.CCTA_TIMEOUT) || config.agents?.ccta?.timeout || 300000
    };
    
    return { config, cctaConfig };
  } catch (error) {
    console.error('設定ファイルの読み込みに失敗しました:', error);
    process.exit(1);
  }
}

// メイン処理
async function main() {
  console.log('🧪 CCTA (Code Change Test Agent) を起動しています...');
  console.log('愛称: クーちゃん');
  
  // 設定の読み込み
  const { config, cctaConfig } = await loadConfig();
  
  // ログディレクトリの作成
  const logsDir = path.join(__dirname, '..', 'logs');
  await fs.mkdir(logsDir, { recursive: true });
  
  // ロガーの初期化
  const logger = new Logger(logsDir, {
    serviceName: 'ccta',
    logLevel: process.env.LOG_LEVEL || 'INFO'
  });
  
  // CCTAエージェントの初期化
  const agent = new CCTAAgent(cctaConfig);
  agent.logger = logger;
  
  try {
    await agent.initialize();
    
    // 実行モードの判定
    const mode = process.argv[2] || 'daemon';
    
    if (mode === 'once') {
      // 単発実行モード
      console.log('単発実行モードで起動しました');
      
      // タスクの取得（例: 環境変数から）
      const task = {
        id: process.env.TASK_ID || `test-${Date.now()}`,
        type: process.env.TASK_TYPE || 'full_test',
        issueNumber: process.env.ISSUE_NUMBER,
        prNumber: process.env.PR_NUMBER
      };
      
      const result = await agent.processTask(task);
      console.log('テスト実行完了:', result.success ? '成功' : '失敗');
      
      if (!result.success) {
        process.exit(1);
      }
    } else {
      // デーモンモード
      console.log('デーモンモードで起動しました');
      console.log('Ctrl+C で終了します');
      
      // 定期的なフルテスト実行（例: 1時間ごと）
      setInterval(async () => {
        logger.info('定期フルテストを実行します');
        
        const task = {
          id: `scheduled-${Date.now()}`,
          type: 'full_test'
        };
        
        try {
          await agent.processTask(task);
        } catch (error) {
          logger.error('定期テストエラー:', error);
        }
      }, 3600000); // 1時間
      
      // サンプルタスクの実行（デモ用）
      if (process.env.DEMO_MODE === 'true') {
        setTimeout(async () => {
          logger.info('デモタスクを実行します');
          
          const demoTask = {
            id: 'demo-001',
            type: 'full_test',
            coverage: true
          };
          
          const result = await agent.processTask(demoTask);
          logger.info('デモタスク完了:', result);
        }, 5000);
      }
    }
    
    // エージェント情報の表示
    console.log('\n📊 エージェント情報:');
    const info = agent.getInfo();
    console.log(`- ニックネーム: ${info.nickname}`);
    console.log(`- 説明: ${info.description}`);
    console.log(`- 機能: ${info.capabilities.join(', ')}`);
    console.log(`- フレームワーク: ${info.config.frameworks.join(', ')}`);
    console.log(`- カバレッジ閾値: ${JSON.stringify(info.config.coverageThreshold.global)}`);
    
  } catch (error) {
    logger.error('エージェント起動エラー:', error);
    console.error('エージェントの起動に失敗しました:', error);
    process.exit(1);
  }
  
  // グレースフルシャットダウン
  process.on('SIGTERM', async () => {
    console.log('\nシャットダウン信号を受信しました...');
    await agent.shutdown();
    process.exit(0);
  });
  
  process.on('SIGINT', async () => {
    console.log('\n終了します...');
    await agent.shutdown();
    process.exit(0);
  });
}

// エラーハンドリング
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// 実行
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});