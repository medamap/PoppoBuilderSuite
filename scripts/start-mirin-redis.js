#!/usr/bin/env node

/**
 * MirinRedisAmbassador起動スクリプト
 * Redis大使として状態管理を一元化
 */

const { MirinRedisAmbassador } = require('../src/mirin-redis-ambassador');
const GitHubClient = require('../src/github-client');
const Logger = require('../src/logger');
const path = require('path');
const fs = require('fs').promises;

// 設定ファイルの読み込み
async function loadConfig() {
  const configPath = path.join(__dirname, '..', 'config', 'config.json');
  const configData = await fs.readFile(configPath, 'utf8');
  return JSON.parse(configData);
}

// シグナルハンドラの設定
function setupSignalHandlers(mirin) {
  const handleShutdown = async (signal) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    await mirin.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGHUP', () => handleShutdown('SIGHUP'));

  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    handleShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    handleShutdown('unhandledRejection');
  });
}

// メイン処理
async function main() {
  console.log('🎋 MirinRedisAmbassador起動準備中...\n');

  try {
    // 設定読み込み
    const config = await loadConfig();
    
    // ログディレクトリ作成
    const logDir = path.join(__dirname, '..', 'logs');
    await fs.mkdir(logDir, { recursive: true });
    
    // Logger初期化
    const logger = new Logger(logDir, {
      prefix: 'mirin-redis',
      level: config.logLevel || 'INFO'
    });

    // GitHub API認証情報確認
    const githubToken = process.env.GITHUB_TOKEN || config.github?.token;
    if (!githubToken) {
      logger.warn('⚠️  GITHUB_TOKEN not found. GitHub label updates will be disabled.');
    }

    // GitHubClient初期化（トークンがある場合のみ）
    let githubClient = null;
    if (githubToken) {
      githubClient = new GitHubClient(githubToken, logger);
      logger.info('✅ GitHub API client initialized');
    }

    // Redis設定
    const redisConfig = {
      host: process.env.REDIS_HOST || config.redis?.host || '127.0.0.1',
      port: process.env.REDIS_PORT || config.redis?.port || 6379,
      password: process.env.REDIS_PASSWORD || config.redis?.password,
      db: process.env.REDIS_DB || config.redis?.db || 0,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        logger.warn(`Redis connection retry #${times} after ${delay}ms`);
        return delay;
      }
    };

    // MirinRedisAmbassador初期化
    const mirin = new MirinRedisAmbassador({
      redis: redisConfig,
      github: githubClient,
      logger: logger,
      heartbeatInterval: config.mirin?.heartbeatInterval || 30000,
      orphanCheckInterval: config.mirin?.orphanCheckInterval || 300000
    });

    // シグナルハンドラ設定
    setupSignalHandlers(mirin);

    // イベントリスナー設定
    mirin.on('initialized', () => {
      logger.info('🎉 MirinRedisAmbassador is ready to serve!');
      logger.info('📊 Configuration:');
      logger.info(`   - Redis: ${redisConfig.host}:${redisConfig.port}`);
      logger.info(`   - Heartbeat interval: ${mirin.options.heartbeatInterval}ms`);
      logger.info(`   - Orphan check interval: ${mirin.options.orphanCheckInterval}ms`);
      logger.info(`   - GitHub integration: ${githubClient ? 'Enabled' : 'Disabled'}`);
    });

    mirin.on('shutdown', () => {
      logger.info('👋 MirinRedisAmbassador shutdown complete');
    });

    // 初期化実行
    await mirin.initialize();

    // 統計情報の定期表示（開発時に便利）
    if (process.env.MIRIN_DEBUG === 'true') {
      setInterval(async () => {
        try {
          const stats = await mirin.listProcessingIssues({});
          logger.debug(`📊 Processing Issues: ${stats.count}`);
        } catch (error) {
          logger.error('Failed to get stats:', error);
        }
      }, 60000); // 1分ごと
    }

    // プロセスを継続
    logger.info('🏃 MirinRedisAmbassador is running...');
    logger.info('Press Ctrl+C to stop\n');

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// 実行
main().catch((error) => {
  console.error('❌ Startup failed:', error);
  process.exit(1);
});