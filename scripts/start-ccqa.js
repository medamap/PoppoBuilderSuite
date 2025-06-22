#!/usr/bin/env node

/**
 * CCQA エージェント起動スクリプト
 */

const CCQAAgent = require('../agents/ccqa');
const Logger = require('../src/logger');

const logger = new Logger('CCQA-Launcher');

async function startCCQAAgent() {
  try {
    logger.info('CCQA エージェントを起動しています...');
    
    // 設定の読み込み
    const config = {
      runTests: process.env.CCQA_RUN_TESTS !== 'false',
      checkQuality: process.env.CCQA_CHECK_QUALITY !== 'false',
      scanSecurity: process.env.CCQA_SCAN_SECURITY !== 'false',
      analyzePerformance: process.env.CCQA_ANALYZE_PERFORMANCE !== 'false',
      
      thresholds: {
        coverage: parseInt(process.env.CCQA_COVERAGE_THRESHOLD) || 80,
        complexity: parseInt(process.env.CCQA_COMPLEXITY_THRESHOLD) || 20,
        duplicateRatio: parseInt(process.env.CCQA_DUPLICATE_RATIO_THRESHOLD) || 5,
        securityLevel: process.env.CCQA_SECURITY_LEVEL || 'high',
        performanceRegressionThreshold: parseInt(process.env.CCQA_PERF_REGRESSION_THRESHOLD) || 10
      },
      
      testConfig: {
        runners: (process.env.CCQA_TEST_RUNNERS || 'jest,mocha').split(','),
        timeout: parseInt(process.env.CCQA_TEST_TIMEOUT) || 60000
      },
      
      qualityConfig: {
        linters: (process.env.CCQA_LINTERS || 'eslint').split(','),
        formatters: (process.env.CCQA_FORMATTERS || 'prettier').split(',')
      }
    };
    
    // エージェントのインスタンス作成
    const agent = new CCQAAgent(config);
    
    // 初期化
    await agent.initialize();
    
    logger.info('CCQA エージェントが起動しました');
    
    // シャットダウンハンドラー
    process.on('SIGINT', async () => {
      logger.info('シャットダウンシグナルを受信しました');
      await agent.shutdown();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      logger.info('終了シグナルを受信しました');
      await agent.shutdown();
      process.exit(0);
    });
    
    // プロセスを生かし続ける
    process.stdin.resume();
    
  } catch (error) {
    logger.error(`CCQA エージェントの起動に失敗しました: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// エージェントを起動
startCCQAAgent();