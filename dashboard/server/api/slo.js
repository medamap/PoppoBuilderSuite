/**
 * SLO Dashboard API
 * SLO監視データをダッシュボードに提供
 */

const express = require('express');
const router = express.Router();

/**
 * 現在のSLO状態を取得
 */
router.get('/status', async (req, res) => {
  try {
    const slaManager = req.app.locals.slaManager;
    
    if (!slaManager) {
      return res.status(503).json({
        error: 'SLA Manager not available'
      });
    }
    
    const status = slaManager.getSLOStatus();
    res.json(status);
    
  } catch (error) {
    console.error('Error getting SLO status:', error);
    res.status(500).json({
      error: 'Failed to get SLO status'
    });
  }
});

/**
 * SLOメトリクスの時系列データを取得
 */
router.get('/metrics/:sloKey', async (req, res) => {
  try {
    const { sloKey } = req.params;
    const { startTime, endTime, resolution = '1h' } = req.query;
    
    const slaManager = req.app.locals.slaManager;
    
    if (!slaManager || !slaManager.metricsCollector) {
      return res.status(503).json({
        error: 'Metrics collector not available'
      });
    }
    
    // 時間範囲のデフォルト値
    const end = endTime ? new Date(endTime) : new Date();
    const start = startTime ? new Date(startTime) : new Date(end - 24 * 60 * 60 * 1000); // 24時間前
    
    // メトリクス名を決定
    const [type, metric] = sloKey.split(':');
    let metricName;
    
    switch (type) {
      case 'availability':
        metricName = `${metric}_availability`;
        break;
      case 'performance':
        metricName = metric.replace('-', '_');
        break;
      case 'success_rate':
        metricName = `${metric}_success_rate`;
        break;
      default:
        metricName = sloKey;
    }
    
    // メトリクスを取得
    const metrics = await slaManager.metricsCollector.getMetrics({
      metric: metricName,
      startTime: start.getTime(),
      endTime: end.getTime()
    });
    
    // 解像度に応じて集計
    const aggregated = aggregateMetrics(metrics, resolution);
    
    res.json({
      sloKey,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      resolution,
      data: aggregated
    });
    
  } catch (error) {
    console.error('Error getting SLO metrics:', error);
    res.status(500).json({
      error: 'Failed to get SLO metrics'
    });
  }
});

/**
 * エラーバジェットの履歴を取得
 */
router.get('/error-budget/:sloKey', async (req, res) => {
  try {
    const { sloKey } = req.params;
    const { days = 30 } = req.query;
    
    const slaManager = req.app.locals.slaManager;
    
    if (!slaManager) {
      return res.status(503).json({
        error: 'SLA Manager not available'
      });
    }
    
    const errorBudgets = slaManager.getSLOStatus()?.errorBudgets || {};
    const currentBudget = errorBudgets[sloKey];
    
    if (!currentBudget) {
      return res.status(404).json({
        error: 'Error budget not found for SLO'
      });
    }
    
    // 履歴データを取得（実装は簡略化）
    const history = await getErrorBudgetHistory(slaManager, sloKey, days);
    
    res.json({
      sloKey,
      current: currentBudget,
      history
    });
    
  } catch (error) {
    console.error('Error getting error budget:', error);
    res.status(500).json({
      error: 'Failed to get error budget'
    });
  }
});

/**
 * SLOレポートを取得
 */
router.get('/report/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { startDate, endDate } = req.query;
    
    const slaManager = req.app.locals.slaManager;
    
    if (!slaManager) {
      return res.status(503).json({
        error: 'SLA Manager not available'
      });
    }
    
    const report = await slaManager.generateReport(
      type,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined
    );
    
    res.json(report);
    
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({
      error: 'Failed to generate report'
    });
  }
});

/**
 * SLOアラートの履歴を取得
 */
router.get('/alerts', async (req, res) => {
  try {
    const { limit = 50, offset = 0, severity } = req.query;
    
    const slaManager = req.app.locals.slaManager;
    
    if (!slaManager || !slaManager.databaseManager) {
      return res.status(503).json({
        error: 'Database not available'
      });
    }
    
    // アラート履歴を取得（実際のテーブルが必要）
    const alerts = await getAlertHistory(
      slaManager.databaseManager,
      { limit: parseInt(limit), offset: parseInt(offset), severity }
    );
    
    res.json({
      alerts,
      total: alerts.length,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
  } catch (error) {
    console.error('Error getting alerts:', error);
    res.status(500).json({
      error: 'Failed to get alerts'
    });
  }
});

/**
 * ダッシュボード用の統合データを取得
 */
router.get('/dashboard', async (req, res) => {
  try {
    const slaManager = req.app.locals.slaManager;
    
    if (!slaManager) {
      return res.status(503).json({
        error: 'SLA Manager not available'
      });
    }
    
    const dashboardData = await slaManager.getDashboardData();
    res.json(dashboardData);
    
  } catch (error) {
    console.error('Error getting dashboard data:', error);
    res.status(500).json({
      error: 'Failed to get dashboard data'
    });
  }
});

/**
 * メトリクスを集計
 */
function aggregateMetrics(metrics, resolution) {
  if (metrics.length === 0) return [];
  
  const resolutionMs = parseResolution(resolution);
  const aggregated = new Map();
  
  for (const metric of metrics) {
    const bucket = Math.floor(metric.timestamp / resolutionMs) * resolutionMs;
    
    if (!aggregated.has(bucket)) {
      aggregated.set(bucket, {
        timestamp: bucket,
        values: [],
        count: 0,
        sum: 0
      });
    }
    
    const agg = aggregated.get(bucket);
    agg.values.push(metric.value);
    agg.count++;
    agg.sum += metric.value;
  }
  
  // 各バケットの統計を計算
  const result = [];
  for (const [timestamp, agg] of aggregated) {
    const sorted = agg.values.sort((a, b) => a - b);
    result.push({
      timestamp: new Date(timestamp).toISOString(),
      avg: agg.sum / agg.count,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
      count: agg.count
    });
  }
  
  return result.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

/**
 * 解像度をパース
 */
function parseResolution(resolution) {
  const match = resolution.match(/^(\d+)([mhd])$/);
  if (!match) return 3600000; // デフォルト1時間
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  switch (unit) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 3600000;
  }
}

/**
 * エラーバジェット履歴を取得（仮実装）
 */
async function getErrorBudgetHistory(slaManager, sloKey, days) {
  // 実際にはデータベースから履歴を取得
  const history = [];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  
  for (let i = days; i >= 0; i--) {
    const timestamp = now - (i * dayMs);
    history.push({
      timestamp: new Date(timestamp).toISOString(),
      consumed: Math.random() * 0.3, // 仮のデータ
      remaining: 1 - Math.random() * 0.3
    });
  }
  
  return history;
}

/**
 * アラート履歴を取得（仮実装）
 */
async function getAlertHistory(databaseManager, options) {
  // 実際にはデータベースから取得
  return [
    {
      id: 1,
      timestamp: new Date().toISOString(),
      type: 'slo_violation',
      severity: 'critical',
      slo: 'availability:poppo-builder',
      message: 'SLO violation: availability:poppo-builder is at 98.5% (target: 99.5%)',
      resolved: false
    }
  ];
}

module.exports = router;