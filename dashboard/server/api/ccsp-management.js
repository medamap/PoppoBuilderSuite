/**
 * CCSP Management API
 * Provides REST endpoints for managing CCSP agent operations
 */

const express = require('express');
const router = express.Router();

// CCSPコンポーネントのインスタンスを取得（実際の実装では適切に注入）
let queueManager = null;
let rateLimitPredictor = null;
let usageAnalytics = null;

// コンポーネントを設定するヘルパー関数
function setCCSPComponents(components) {
  queueManager = components.queueManager;
  rateLimitPredictor = components.rateLimitPredictor;
  usageAnalytics = components.usageAnalytics;
}

/**
 * キュー管理エンドポイント
 */

// キューの状態を取得
router.get('/queue/status', (req, res) => {
  try {
    if (!queueManager) {
      return res.status(503).json({ error: 'Queue manager not available' });
    }
    
    const status = queueManager.getQueueStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// キューを一時停止
router.post('/queue/pause', async (req, res) => {
  try {
    if (!queueManager) {
      return res.status(503).json({ error: 'Queue manager not available' });
    }
    
    const { reason = 'Manual pause via API' } = req.body;
    await queueManager.pause(reason);
    
    res.json({ 
      status: 'paused',
      reason,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// キューを再開
router.post('/queue/resume', async (req, res) => {
  try {
    if (!queueManager) {
      return res.status(503).json({ error: 'Queue manager not available' });
    }
    
    await queueManager.resume();
    
    res.json({ 
      status: 'resumed',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// キューをクリア
router.delete('/queue/clear', async (req, res) => {
  try {
    if (!queueManager) {
      return res.status(503).json({ error: 'Queue manager not available' });
    }
    
    const { priority } = req.query;
    await queueManager.clearQueue(priority);
    
    res.json({ 
      status: 'cleared',
      priority: priority || 'all',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// タスクをキューに追加
router.post('/queue/enqueue', async (req, res) => {
  try {
    if (!queueManager) {
      return res.status(503).json({ error: 'Queue manager not available' });
    }
    
    const { task, priority = 'normal', scheduleAt } = req.body;
    
    if (!task || !task.id) {
      return res.status(400).json({ error: 'Task with id is required' });
    }
    
    const enrichedTask = await queueManager.enqueue(task, priority, scheduleAt);
    
    res.json({
      status: 'enqueued',
      task: enrichedTask
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 統計情報エンドポイント
 */

// 使用量統計を取得
router.get('/stats/usage', (req, res) => {
  try {
    if (!usageAnalytics) {
      return res.status(503).json({ error: 'Usage analytics not available' });
    }
    
    const { period = 'realtime', count = 10 } = req.query;
    const stats = usageAnalytics.getStatistics(period, parseInt(count));
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// エージェント別統計を取得
router.get('/stats/agents', (req, res) => {
  try {
    if (!usageAnalytics) {
      return res.status(503).json({ error: 'Usage analytics not available' });
    }
    
    const { agentId } = req.query;
    const stats = usageAnalytics.getAgentStatistics(agentId);
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// エラー統計を取得
router.get('/stats/errors', (req, res) => {
  try {
    if (!usageAnalytics) {
      return res.status(503).json({ error: 'Usage analytics not available' });
    }
    
    const analysis = usageAnalytics.getErrorAnalysis();
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 使用パターンを取得
router.get('/stats/patterns', async (req, res) => {
  try {
    if (!usageAnalytics) {
      return res.status(503).json({ error: 'Usage analytics not available' });
    }
    
    const patterns = await usageAnalytics.analyzePatterns();
    res.json(patterns);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 制御エンドポイント
 */

// スロットリング設定
router.post('/throttle', async (req, res) => {
  try {
    if (!queueManager) {
      return res.status(503).json({ error: 'Queue manager not available' });
    }
    
    const { delay } = req.body;
    
    if (typeof delay !== 'number' || delay < 0) {
      return res.status(400).json({ error: 'Valid delay (ms) is required' });
    }
    
    await queueManager.setThrottle(delay);
    
    res.json({ 
      status: 'updated',
      throttleDelay: delay,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 同時実行数設定
router.post('/concurrency', async (req, res) => {
  try {
    if (!queueManager) {
      return res.status(503).json({ error: 'Queue manager not available' });
    }
    
    const { count } = req.body;
    
    if (typeof count !== 'number' || count < 1) {
      return res.status(400).json({ error: 'Valid count (>= 1) is required' });
    }
    
    await queueManager.setConcurrency(count);
    
    res.json({ 
      status: 'updated',
      maxConcurrent: count,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 優先度設定
router.post('/priority/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { priority } = req.body;
    
    // 実装は実際のタスク管理システムに依存
    res.json({ 
      status: 'updated',
      taskId,
      priority,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * レート制限予測エンドポイント
 */

// レート制限の状態を取得
router.get('/rate-limit/status', (req, res) => {
  try {
    if (!rateLimitPredictor) {
      return res.status(503).json({ error: 'Rate limit predictor not available' });
    }
    
    const status = rateLimitPredictor.getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 使用パターン分析を取得
router.get('/rate-limit/pattern', (req, res) => {
  try {
    if (!rateLimitPredictor) {
      return res.status(503).json({ error: 'Rate limit predictor not available' });
    }
    
    const pattern = rateLimitPredictor.analyzeUsagePattern();
    res.json(pattern);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ヘルスチェック
 */
router.get('/health', (req, res) => {
  const health = {
    status: 'ok',
    components: {
      queueManager: queueManager ? 'available' : 'unavailable',
      rateLimitPredictor: rateLimitPredictor ? 'available' : 'unavailable',
      usageAnalytics: usageAnalytics ? 'available' : 'unavailable'
    },
    timestamp: new Date().toISOString()
  };
  
  const allAvailable = Object.values(health.components).every(status => status === 'available');
  
  if (!allAvailable) {
    health.status = 'degraded';
    res.status(503).json(health);
  } else {
    res.json(health);
  }
});

// エクスポート
module.exports = {
  router,
  setCCSPComponents
};