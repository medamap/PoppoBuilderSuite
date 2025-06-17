const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class DatabaseManager {
  constructor(dbPath = null) {
    this.dbPath = dbPath || path.join(process.cwd(), 'data', 'poppo-history.db');
    
    // データベースディレクトリが存在しない場合は作成
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    
    this.initializeDatabase();
    this.prepareStatements();
  }
  
  initializeDatabase() {
    // プロセス実行履歴テーブル
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS process_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        process_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        issue_number INTEGER,
        title TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        status TEXT NOT NULL,
        exit_code INTEGER,
        error_message TEXT,
        error_stack TEXT,
        duration_ms INTEGER,
        cpu_usage REAL,
        memory_usage INTEGER,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      
      CREATE INDEX IF NOT EXISTS idx_process_history_process_id ON process_history(process_id);
      CREATE INDEX IF NOT EXISTS idx_process_history_task_type ON process_history(task_type);
      CREATE INDEX IF NOT EXISTS idx_process_history_issue_number ON process_history(issue_number);
      CREATE INDEX IF NOT EXISTS idx_process_history_started_at ON process_history(started_at);
      CREATE INDEX IF NOT EXISTS idx_process_history_status ON process_history(status);
    `);
    
    // パフォーマンスメトリクステーブル
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS performance_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        process_id TEXT NOT NULL,
        metric_type TEXT NOT NULL,
        metric_value REAL NOT NULL,
        recorded_at INTEGER NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_performance_metrics_process_id ON performance_metrics(process_id);
      CREATE INDEX IF NOT EXISTS idx_performance_metrics_metric_type ON performance_metrics(metric_type);
      CREATE INDEX IF NOT EXISTS idx_performance_metrics_recorded_at ON performance_metrics(recorded_at);
    `);
    
    // 統計サマリーテーブル
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS performance_summary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_type TEXT NOT NULL,
        period_type TEXT NOT NULL, -- 'daily', 'weekly', 'monthly'
        period_start INTEGER NOT NULL,
        period_end INTEGER NOT NULL,
        total_count INTEGER NOT NULL,
        success_count INTEGER NOT NULL,
        failure_count INTEGER NOT NULL,
        avg_duration_ms REAL,
        min_duration_ms INTEGER,
        max_duration_ms INTEGER,
        avg_cpu_usage REAL,
        avg_memory_usage INTEGER,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      
      CREATE INDEX IF NOT EXISTS idx_performance_summary_task_type ON performance_summary(task_type);
      CREATE INDEX IF NOT EXISTS idx_performance_summary_period ON performance_summary(period_type, period_start);
    `);
    
    // データアーカイブテーブル
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS archive_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        archived_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        archive_file TEXT NOT NULL,
        records_count INTEGER NOT NULL,
        date_from INTEGER NOT NULL,
        date_to INTEGER NOT NULL
      );
    `);
  }
  
  prepareStatements() {
    // プロセス履歴の挿入
    this.insertProcessStmt = this.db.prepare(`
      INSERT INTO process_history (
        process_id, task_type, issue_number, title, started_at, 
        status, cpu_usage, memory_usage
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    // プロセス履歴の更新
    this.updateProcessStmt = this.db.prepare(`
      UPDATE process_history
      SET ended_at = ?, status = ?, exit_code = ?, error_message = ?, 
          error_stack = ?, duration_ms = ?, cpu_usage = ?, memory_usage = ?
      WHERE process_id = ? AND ended_at IS NULL
    `);
    
    // メトリクスの挿入
    this.insertMetricStmt = this.db.prepare(`
      INSERT INTO performance_metrics (process_id, metric_type, metric_value, recorded_at)
      VALUES (?, ?, ?, ?)
    `);
  }
  
  // プロセス開始時の記録
  recordProcessStart(processInfo) {
    const { processId, taskType, issueNumber, title, cpuUsage = 0, memoryUsage = 0 } = processInfo;
    const startedAt = Date.now();
    
    this.insertProcessStmt.run(
      processId,
      taskType,
      issueNumber || null,
      title || null,
      startedAt,
      'running',
      cpuUsage,
      memoryUsage
    );
    
    return { processId, startedAt };
  }
  
  // プロセス終了時の記録
  recordProcessEnd(processId, endInfo) {
    const { status, exitCode, error, cpuUsage = 0, memoryUsage = 0 } = endInfo;
    const endedAt = Date.now();
    
    // 開始時刻を取得して経過時間を計算
    const startInfo = this.db.prepare(
      'SELECT started_at FROM process_history WHERE process_id = ? AND ended_at IS NULL'
    ).get(processId);
    
    if (!startInfo) {
      throw new Error(`プロセス ${processId} の開始記録が見つかりません`);
    }
    
    const durationMs = endedAt - startInfo.started_at;
    
    this.updateProcessStmt.run(
      endedAt,
      status,
      exitCode || null,
      error ? error.message : null,
      error ? error.stack : null,
      durationMs,
      cpuUsage,
      memoryUsage,
      processId
    );
    
    return { processId, endedAt, durationMs };
  }
  
  // メトリクスの記録
  recordMetric(processId, metricType, metricValue) {
    const recordedAt = Date.now();
    this.insertMetricStmt.run(processId, metricType, metricValue, recordedAt);
  }
  
  // タスクタイプ別の統計を取得
  getTaskTypeStatistics(taskType, startDate = null, endDate = null) {
    let query = `
      SELECT 
        COUNT(*) as total_count,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as failure_count,
        AVG(duration_ms) as avg_duration,
        MIN(duration_ms) as min_duration,
        MAX(duration_ms) as max_duration,
        AVG(cpu_usage) as avg_cpu,
        AVG(memory_usage) as avg_memory
      FROM process_history
      WHERE task_type = ?
    `;
    
    const params = [taskType];
    
    if (startDate) {
      query += ' AND started_at >= ?';
      params.push(startDate);
    }
    
    if (endDate) {
      query += ' AND started_at <= ?';
      params.push(endDate);
    }
    
    return this.db.prepare(query).get(...params);
  }
  
  // 実行履歴を取得
  getProcessHistory(options = {}) {
    const { limit = 100, offset = 0, taskType, status, startDate, endDate } = options;
    let query = 'SELECT * FROM process_history WHERE 1=1';
    const params = [];
    
    if (taskType) {
      query += ' AND task_type = ?';
      params.push(taskType);
    }
    
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    
    if (startDate) {
      query += ' AND started_at >= ?';
      params.push(startDate);
    }
    
    if (endDate) {
      query += ' AND started_at <= ?';
      params.push(endDate);
    }
    
    query += ' ORDER BY started_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    return this.db.prepare(query).all(...params);
  }
  
  // パフォーマンストレンドを取得
  getPerformanceTrends(taskType, metricType, days = 7) {
    const startDate = Date.now() - (days * 24 * 60 * 60 * 1000);
    
    const query = `
      SELECT 
        DATE(started_at/1000, 'unixepoch') as date,
        AVG(${metricType}) as avg_value,
        MIN(${metricType}) as min_value,
        MAX(${metricType}) as max_value,
        COUNT(*) as count
      FROM process_history
      WHERE task_type = ? AND started_at >= ?
      GROUP BY DATE(started_at/1000, 'unixepoch')
      ORDER BY date ASC
    `;
    
    return this.db.prepare(query).all(taskType, startDate);
  }
  
  // 統計サマリーを生成
  generatePerformanceSummary(periodType = 'daily') {
    const now = Date.now();
    let periodStart;
    
    switch (periodType) {
      case 'daily':
        periodStart = now - (24 * 60 * 60 * 1000);
        break;
      case 'weekly':
        periodStart = now - (7 * 24 * 60 * 60 * 1000);
        break;
      case 'monthly':
        periodStart = now - (30 * 24 * 60 * 60 * 1000);
        break;
      default:
        throw new Error('不正な期間タイプ: ' + periodType);
    }
    
    // タスクタイプごとの統計を集計
    const taskTypes = this.db.prepare(
      'SELECT DISTINCT task_type FROM process_history WHERE started_at >= ?'
    ).all(periodStart);
    
    const summaryStmt = this.db.prepare(`
      INSERT INTO performance_summary (
        task_type, period_type, period_start, period_end,
        total_count, success_count, failure_count,
        avg_duration_ms, min_duration_ms, max_duration_ms,
        avg_cpu_usage, avg_memory_usage
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const summaries = [];
    
    for (const { task_type } of taskTypes) {
      const stats = this.getTaskTypeStatistics(task_type, periodStart, now);
      
      summaryStmt.run(
        task_type,
        periodType,
        periodStart,
        now,
        stats.total_count,
        stats.success_count,
        stats.failure_count,
        stats.avg_duration,
        stats.min_duration,
        stats.max_duration,
        stats.avg_cpu,
        stats.avg_memory
      );
      
      summaries.push({ task_type, ...stats });
    }
    
    return summaries;
  }
  
  // 古いデータをアーカイブ
  archiveOldData(daysToKeep = 30) {
    const cutoffDate = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    
    // アーカイブ対象のデータを取得
    const oldData = this.db.prepare(
      'SELECT * FROM process_history WHERE started_at < ?'
    ).all(cutoffDate);
    
    if (oldData.length === 0) {
      return { archived: 0 };
    }
    
    // アーカイブファイルに保存
    const archiveFile = path.join(
      path.dirname(this.dbPath),
      `archive-${new Date().toISOString().split('T')[0]}.json`
    );
    
    fs.writeFileSync(archiveFile, JSON.stringify(oldData, null, 2));
    
    // アーカイブ記録を保存
    const dateFrom = Math.min(...oldData.map(d => d.started_at));
    const dateTo = Math.max(...oldData.map(d => d.started_at));
    
    this.db.prepare(`
      INSERT INTO archive_history (archive_file, records_count, date_from, date_to)
      VALUES (?, ?, ?, ?)
    `).run(archiveFile, oldData.length, dateFrom, dateTo);
    
    // 古いデータを削除
    const deleteStmt = this.db.prepare('DELETE FROM process_history WHERE started_at < ?');
    const result = deleteStmt.run(cutoffDate);
    
    // メトリクスも削除
    this.db.prepare('DELETE FROM performance_metrics WHERE recorded_at < ?').run(cutoffDate);
    
    // データベースを最適化
    this.db.exec('VACUUM');
    
    return { archived: result.changes, file: archiveFile };
  }
  
  // データベースを閉じる
  close() {
    this.db.close();
  }
}

module.exports = DatabaseManager;