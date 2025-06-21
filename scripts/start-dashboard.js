#!/usr/bin/env node

/**
 * ダッシュボードサーバー起動スクリプト
 * 
 * PoppoBuilderダッシュボードとCCSP管理ダッシュボードを起動
 */

const path = require('path');
const DashboardServer = require('../dashboard/server/index');
const Logger = require('../src/logger');
const ProcessStateManager = require('../src/process-state-manager');

// 設定
const config = {
  dashboard: {
    enabled: true,
    port: 3001,
    host: 'localhost',
    updateInterval: 5000
  }
};

async function startDashboard() {
  const logger = new Logger('DashboardStarter');
  
  try {
    logger.info('ダッシュボードサーバーを起動しています...');
    
    // ProcessStateManagerを初期化
    const processStateManager = new ProcessStateManager(logger);
    
    // ダッシュボードサーバーを作成
    const dashboardServer = new DashboardServer(
      config,
      processStateManager,
      logger,
      null, // healthCheckManager
      null, // independentProcessManager
      null  // ccspAgent
    );
    
    // ダッシュボードサーバーを起動
    dashboardServer.start();
    
    logger.info(`📊 ダッシュボードが起動しました: http://${config.dashboard.host}:${config.dashboard.port}`);
    logger.info(`🚀 CCSPダッシュボード: http://${config.dashboard.host}:${config.dashboard.port}/ccsp`);
    
    // シグナルハンドラー
    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down dashboard...');
      dashboardServer.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down dashboard...');
      dashboardServer.stop();
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('ダッシュボード起動エラー:', error);
    process.exit(1);
  }
}

// エントリーポイント
if (require.main === module) {
  startDashboard().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { startDashboard };