const express = require('express');
const DatabaseManager = require('../../../src/database-manager');

const router = express.Router();

// データベースマネージャーのインスタンス
let db;

try {
  db = new DatabaseManager();
} catch (error) {
  console.error('データベース初期化エラー:', error);
}

/**
 * プロセス実行履歴を取得
 * GET /api/analytics/history
 * 
 * クエリパラメータ:
 * - limit: 取得件数 (デフォルト: 100)
 * - offset: オフセット (デフォルト: 0)
 * - taskType: タスクタイプでフィルタ
 * - status: ステータスでフィルタ
 * - startDate: 開始日時 (Unix timestamp)
 * - endDate: 終了日時 (Unix timestamp)
 */
router.get('/history', (req, res) => {
  if (!db) {
    return res.status(503).json({ error: 'データベースが利用できません' });
  }
  
  try {
    const options = {
      limit: parseInt(req.query.limit) || 100,
      offset: parseInt(req.query.offset) || 0,
      taskType: req.query.taskType,
      status: req.query.status,
      startDate: req.query.startDate ? parseInt(req.query.startDate) : null,
      endDate: req.query.endDate ? parseInt(req.query.endDate) : null
    };
    
    const history = db.getProcessHistory(options);
    
    res.json({
      data: history,
      pagination: {
        limit: options.limit,
        offset: options.offset,
        total: history.length
      }
    });
  } catch (error) {
    console.error('履歴取得エラー:', error);
    res.status(500).json({ error: 'データ取得中にエラーが発生しました' });
  }
});

/**
 * タスクタイプ別の統計情報を取得
 * GET /api/analytics/statistics/:taskType
 */
router.get('/statistics/:taskType', (req, res) => {
  if (!db) {
    return res.status(503).json({ error: 'データベースが利用できません' });
  }
  
  try {
    const { taskType } = req.params;
    const startDate = req.query.startDate ? parseInt(req.query.startDate) : null;
    const endDate = req.query.endDate ? parseInt(req.query.endDate) : null;
    
    const stats = db.getTaskTypeStatistics(taskType, startDate, endDate);
    
    res.json({
      taskType,
      statistics: {
        totalCount: stats.total_count,
        successCount: stats.success_count,
        failureCount: stats.failure_count,
        successRate: stats.total_count > 0 
          ? (stats.success_count / stats.total_count * 100).toFixed(2) 
          : 0,
        avgDuration: Math.round(stats.avg_duration || 0),
        minDuration: stats.min_duration || 0,
        maxDuration: stats.max_duration || 0,
        avgCpuUsage: parseFloat((stats.avg_cpu || 0).toFixed(2)),
        avgMemoryUsage: Math.round(stats.avg_memory || 0)
      }
    });
  } catch (error) {
    console.error('統計取得エラー:', error);
    res.status(500).json({ error: 'データ取得中にエラーが発生しました' });
  }
});

/**
 * パフォーマンストレンドを取得
 * GET /api/analytics/trends/:taskType
 * 
 * クエリパラメータ:
 * - metric: メトリクスタイプ (duration_ms, cpu_usage, memory_usage)
 * - days: 過去何日分のデータを取得するか (デフォルト: 7)
 */
router.get('/trends/:taskType', (req, res) => {
  if (!db) {
    return res.status(503).json({ error: 'データベースが利用できません' });
  }
  
  try {
    const { taskType } = req.params;
    const metric = req.query.metric || 'duration_ms';
    const days = parseInt(req.query.days) || 7;
    
    const trends = db.getPerformanceTrends(taskType, metric, days);
    
    res.json({
      taskType,
      metric,
      days,
      data: trends.map(t => ({
        date: t.date,
        avgValue: parseFloat(t.avg_value.toFixed(2)),
        minValue: parseFloat(t.min_value.toFixed(2)),
        maxValue: parseFloat(t.max_value.toFixed(2)),
        count: t.count
      }))
    });
  } catch (error) {
    console.error('トレンド取得エラー:', error);
    res.status(500).json({ error: 'データ取得中にエラーが発生しました' });
  }
});

/**
 * パフォーマンスサマリーを生成
 * POST /api/analytics/summary/generate
 * 
 * ボディ:
 * - periodType: 'daily', 'weekly', 'monthly'
 */
router.post('/summary/generate', (req, res) => {
  if (!db) {
    return res.status(503).json({ error: 'データベースが利用できません' });
  }
  
  try {
    const { periodType = 'daily' } = req.body;
    
    if (!['daily', 'weekly', 'monthly'].includes(periodType)) {
      return res.status(400).json({ error: '不正な期間タイプです' });
    }
    
    const summaries = db.generatePerformanceSummary(periodType);
    
    res.json({
      periodType,
      generatedAt: new Date().toISOString(),
      summaries
    });
  } catch (error) {
    console.error('サマリー生成エラー:', error);
    res.status(500).json({ error: 'サマリー生成中にエラーが発生しました' });
  }
});

/**
 * データアーカイブを実行
 * POST /api/analytics/archive
 * 
 * ボディ:
 * - daysToKeep: 保持する日数 (デフォルト: 30)
 */
router.post('/archive', (req, res) => {
  if (!db) {
    return res.status(503).json({ error: 'データベースが利用できません' });
  }
  
  try {
    const { daysToKeep = 30 } = req.body;
    
    if (daysToKeep < 7) {
      return res.status(400).json({ error: '最低7日間はデータを保持する必要があります' });
    }
    
    const result = db.archiveOldData(daysToKeep);
    
    res.json({
      success: true,
      archived: result.archived,
      archiveFile: result.file
    });
  } catch (error) {
    console.error('アーカイブエラー:', error);
    res.status(500).json({ error: 'アーカイブ中にエラーが発生しました' });
  }
});

/**
 * レポートをエクスポート
 * GET /api/analytics/export
 * 
 * クエリパラメータ:
 * - format: 'csv' または 'json' (デフォルト: 'json')
 * - type: 'history' または 'summary'
 * - startDate: 開始日時
 * - endDate: 終了日時
 */
router.get('/export', (req, res) => {
  if (!db) {
    return res.status(503).json({ error: 'データベースが利用できません' });
  }
  
  try {
    const { format = 'json', type = 'history' } = req.query;
    const startDate = req.query.startDate ? parseInt(req.query.startDate) : null;
    const endDate = req.query.endDate ? parseInt(req.query.endDate) : null;
    
    let data;
    
    if (type === 'history') {
      data = db.getProcessHistory({ 
        limit: 10000, 
        offset: 0,
        startDate,
        endDate
      });
    } else if (type === 'summary') {
      // 全タスクタイプの統計を取得
      const taskTypes = db.db.prepare(
        'SELECT DISTINCT task_type FROM process_history'
      ).all();
      
      data = taskTypes.map(({ task_type }) => ({
        taskType: task_type,
        ...db.getTaskTypeStatistics(task_type, startDate, endDate)
      }));
    } else {
      return res.status(400).json({ error: '不正なエクスポートタイプです' });
    }
    
    if (format === 'csv') {
      const csvContent = convertToCSV(data);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=poppo-${type}-${Date.now()}.csv`);
      res.send(csvContent);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=poppo-${type}-${Date.now()}.json`);
      res.json(data);
    }
  } catch (error) {
    console.error('エクスポートエラー:', error);
    res.status(500).json({ error: 'エクスポート中にエラーが発生しました' });
  }
});

/**
 * JSONデータをCSV形式に変換
 */
function convertToCSV(data) {
  if (!data || data.length === 0) return '';
  
  const headers = Object.keys(data[0]);
  const csvHeaders = headers.join(',');
  
  const csvRows = data.map(row => {
    return headers.map(header => {
      const value = row[header];
      // 値に改行やカンマが含まれる場合はダブルクォートで囲む
      if (value && (value.toString().includes(',') || value.toString().includes('\n'))) {
        return `"${value.toString().replace(/"/g, '""')}"`;
      }
      return value || '';
    }).join(',');
  });
  
  return [csvHeaders, ...csvRows].join('\n');
}

// クリーンアップ処理
process.on('SIGINT', () => {
  if (db) {
    db.close();
  }
});

module.exports = router;