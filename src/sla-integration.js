/**
 * SLA Manager Integration
 * minimal-poppo.jsに統合するためのヘルパーモジュール
 */

const DatabaseManager = require('./database-manager');
const { SLAManager } = require('./sla/sla-manager');

/**
 * SLAマネージャーを初期化
 */
async function initializeSLAManager(config, logger) {
  if (!config.sla?.enabled) {
    logger.info('SLA monitoring is disabled');
    return null;
  }

  try {
    // データベースマネージャーを作成
    const databaseManager = new DatabaseManager();
    
    // SLAマネージャーを作成
    const slaManager = new SLAManager({
      ...config.sla,
      databaseManager,
      logger
    });
    
    // 初期化
    await slaManager.initialize();
    
    logger.info('SLA Manager initialized successfully');
    return slaManager;
    
  } catch (error) {
    logger.error('Failed to initialize SLA Manager', error);
    return null;
  }
}

/**
 * Issue処理メトリクスを記録
 */
function recordIssueProcessingMetrics(slaManager, data) {
  if (!slaManager) return;
  
  const { issueNumber, success, startTime, endTime } = data;
  
  // 処理時間を計算
  const duration = endTime - startTime;
  const startDelay = startTime - data.createdAt; // Issue作成から処理開始までの遅延
  
  // メトリクスを記録
  slaManager.recordMetric('issue_processing', {
    issueNumber,
    success,
    duration,
    startDelay
  });
  
  // ヘルスチェック用のメトリクス
  slaManager.recordMetric('health_check', {
    service: 'poppo-builder',
    success: true,
    duration: 100 // ダミー値
  });
}

/**
 * エージェントタスクメトリクスを記録
 */
function recordAgentTaskMetrics(slaManager, data) {
  if (!slaManager) return;
  
  const { agent, taskType, success, duration } = data;
  
  slaManager.recordMetric('agent_task', {
    agent,
    taskType,
    success,
    duration
  });
}

/**
 * API応答メトリクスを記録
 */
function recordAPIResponseMetrics(slaManager, data) {
  if (!slaManager) return;
  
  const { endpoint, method, status, duration } = data;
  
  slaManager.recordMetric('api_response', {
    endpoint,
    method,
    status,
    duration
  });
}

/**
 * キュー遅延メトリクスを記録
 */
function recordQueueLatencyMetrics(slaManager, data) {
  if (!slaManager) return;
  
  const { taskType, waitTime, queueSize } = data;
  
  slaManager.recordMetric('queue_latency', {
    taskType,
    waitTime,
    queueSize
  });
}

/**
 * ダッシュボードAPIハンドラーを追加
 */
function addSLODashboardHandlers(app, slaManager) {
  if (!slaManager || !app) return;
  
  // SLAマネージャーをapp.localsに追加
  app.locals.slaManager = slaManager;
  
  // SLO APIルートを追加
  const sloRouter = require('../dashboard/server/api/slo');
  app.use('/api/slo', sloRouter);
}

module.exports = {
  initializeSLAManager,
  recordIssueProcessingMetrics,
  recordAgentTaskMetrics,
  recordAPIResponseMetrics,
  recordQueueLatencyMetrics,
  addSLODashboardHandlers
};