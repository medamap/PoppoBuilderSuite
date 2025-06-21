/**
 * メトリクス収集器
 * 各種SLI指標を収集して保存
 */

const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');

class MetricsCollector extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      dataDir: options.dataDir || path.join(process.cwd(), 'data', 'metrics'),
      retentionDays: options.retentionDays || 30,
      flushInterval: options.flushInterval || 60000,  // 1分ごとに保存
      ...options
    };
    
    this.databaseManager = options.databaseManager || null;
    
    // メトリクスバッファ
    this.metricsBuffer = [];
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
    
    // フラッシュタイマー
    this.flushTimer = null;
    
    // 初期化
    this.initialize();
  }

  /**
   * 初期化
   */
  async initialize() {
    // データディレクトリを作成
    await fs.mkdir(this.options.dataDir, { recursive: true });
    
    // データベーステーブルを作成
    if (this.databaseManager) {
      this.createMetricsTables();
    }
  }

  /**
   * メトリクステーブルを作成
   */
  createMetricsTables() {
    if (!this.databaseManager || !this.databaseManager.db) return;
    
    this.databaseManager.db.exec(`
      CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        metric_name TEXT NOT NULL,
        metric_type TEXT NOT NULL,
        value REAL NOT NULL,
        tags TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      
      CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
      CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(metric_name);
      CREATE INDEX IF NOT EXISTS idx_metrics_type ON metrics(metric_type);
      
      CREATE TABLE IF NOT EXISTS metric_aggregates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        metric_name TEXT NOT NULL,
        window TEXT NOT NULL,
        count INTEGER,
        sum REAL,
        min REAL,
        max REAL,
        avg REAL,
        p50 REAL,
        p95 REAL,
        p99 REAL,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      
      CREATE INDEX IF NOT EXISTS idx_aggregates_timestamp ON metric_aggregates(timestamp);
      CREATE INDEX IF NOT EXISTS idx_aggregates_name ON metric_aggregates(metric_name);
    `);
  }

  /**
   * 収集を開始
   */
  start() {
    // 定期的にメトリクスをフラッシュ
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.options.flushInterval);
    
    // プロセス終了時にフラッシュ
    process.on('SIGINT', () => this.flush());
    process.on('SIGTERM', () => this.flush());
    
    this.emit('started');
  }

  /**
   * 収集を停止
   */
  async stop() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    
    // 最後のフラッシュ
    await this.flush();
    
    this.emit('stopped');
  }

  /**
   * カウンターを増加
   */
  incrementCounter(name, value = 1, tags = {}) {
    const key = this.getMetricKey(name, tags);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);
    
    this.recordMetric({
      timestamp: Date.now(),
      name,
      type: 'counter',
      value: current + value,
      tags
    });
  }

  /**
   * ゲージを設定
   */
  setGauge(name, value, tags = {}) {
    const key = this.getMetricKey(name, tags);
    this.gauges.set(key, value);
    
    this.recordMetric({
      timestamp: Date.now(),
      name,
      type: 'gauge',
      value,
      tags
    });
  }

  /**
   * ヒストグラムに値を記録
   */
  recordHistogram(name, value, tags = {}) {
    const key = this.getMetricKey(name, tags);
    
    if (!this.histograms.has(key)) {
      this.histograms.set(key, []);
    }
    
    this.histograms.get(key).push({
      timestamp: Date.now(),
      value
    });
    
    this.recordMetric({
      timestamp: Date.now(),
      name,
      type: 'histogram',
      value,
      tags
    });
  }

  /**
   * タイミングを記録（ミリ秒）
   */
  recordTiming(name, duration, tags = {}) {
    this.recordHistogram(name, duration, tags);
  }

  /**
   * メトリクスを記録
   */
  recordMetric(metric) {
    this.metricsBuffer.push(metric);
    
    // バッファサイズが大きくなったら即座にフラッシュ
    if (this.metricsBuffer.length >= 1000) {
      this.flush();
    }
  }

  /**
   * 特定のメトリクスを記録
   */
  recordSLIMetrics(type, data) {
    switch (type) {
      case 'health_check':
        this.recordHealthCheckMetrics(data);
        break;
      
      case 'issue_processing':
        this.recordIssueProcessingMetrics(data);
        break;
      
      case 'api_response':
        this.recordAPIResponseMetrics(data);
        break;
      
      case 'agent_task':
        this.recordAgentTaskMetrics(data);
        break;
      
      case 'queue_latency':
        this.recordQueueLatencyMetrics(data);
        break;
    }
  }

  /**
   * ヘルスチェックメトリクスを記録
   */
  recordHealthCheckMetrics(data) {
    const { service, success, duration } = data;
    
    // 成功/失敗をカウント
    this.incrementCounter(`${service}_health_checks`, 1);
    if (success) {
      this.incrementCounter(`successful_health_checks`, 1, { service });
    }
    this.incrementCounter(`total_health_checks`, 1, { service });
    
    // レスポンス時間を記録
    if (duration) {
      this.recordTiming(`health_check_duration`, duration, { service });
    }
  }

  /**
   * Issue処理メトリクスを記録
   */
  recordIssueProcessingMetrics(data) {
    const { issueNumber, success, duration, startDelay } = data;
    
    // 処理数をカウント
    this.incrementCounter('issues_processed_total', 1);
    if (success) {
      this.incrementCounter('issues_processed_successfully', 1);
    }
    
    // 処理時間を記録
    if (duration) {
      this.recordTiming('issue_processing_duration', duration);
    }
    
    // 開始遅延を記録
    if (startDelay) {
      this.recordTiming('issue_processing_start_time', startDelay);
    }
  }

  /**
   * API応答メトリクスを記録
   */
  recordAPIResponseMetrics(data) {
    const { endpoint, method, status, duration } = data;
    
    // リクエスト数をカウント
    this.incrementCounter('api_requests_total', 1, { endpoint, method });
    
    if (status >= 200 && status < 300) {
      this.incrementCounter('api_requests_success', 1, { endpoint, method });
    } else if (status >= 400) {
      this.incrementCounter('api_requests_error', 1, { endpoint, method, status });
    }
    
    // レスポンス時間を記録
    if (duration) {
      this.recordTiming('api_response_duration', duration, { endpoint, method });
    }
  }

  /**
   * エージェントタスクメトリクスを記録
   */
  recordAgentTaskMetrics(data) {
    const { agent, taskType, success, duration } = data;
    
    // タスク数をカウント
    this.incrementCounter('agent_tasks_total', 1, { agent, taskType });
    if (success) {
      this.incrementCounter('agent_tasks_successful', 1, { agent, taskType });
    }
    
    // タスク実行時間を記録
    if (duration) {
      this.recordTiming('agent_task_duration', duration, { agent, taskType });
    }
    
    // エージェントのハートビート
    this.incrementCounter('agent_heartbeats_received', 1, { agent });
  }

  /**
   * キュー遅延メトリクスを記録
   */
  recordQueueLatencyMetrics(data) {
    const { taskType, waitTime, queueSize } = data;
    
    // 待ち時間を記録
    if (waitTime) {
      this.recordTiming('queue_wait_time', waitTime, { taskType });
    }
    
    // キューサイズを記録
    if (queueSize !== undefined) {
      this.setGauge('queue_size', queueSize, { taskType });
    }
  }

  /**
   * メトリクスをフラッシュ
   */
  async flush() {
    if (this.metricsBuffer.length === 0) return;
    
    const metrics = [...this.metricsBuffer];
    this.metricsBuffer = [];
    
    try {
      // データベースに保存
      if (this.databaseManager) {
        await this.saveToDatabase(metrics);
      }
      
      // ファイルに保存（バックアップ）
      await this.saveToFile(metrics);
      
      // 古いデータをクリーンアップ
      await this.cleanup();
      
      this.emit('flushed', { count: metrics.length });
      
    } catch (error) {
      console.error('Error flushing metrics:', error);
      // 失敗した場合はバッファに戻す
      this.metricsBuffer.unshift(...metrics);
    }
  }

  /**
   * データベースに保存
   */
  async saveToDatabase(metrics) {
    if (!this.databaseManager || !this.databaseManager.db) return;
    
    const stmt = this.databaseManager.db.prepare(`
      INSERT INTO metrics (timestamp, metric_name, metric_type, value, tags)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const insertMany = this.databaseManager.db.transaction((metrics) => {
      for (const metric of metrics) {
        stmt.run(
          metric.timestamp,
          metric.name,
          metric.type,
          metric.value,
          JSON.stringify(metric.tags || {})
        );
      }
    });
    
    insertMany(metrics);
  }

  /**
   * ファイルに保存
   */
  async saveToFile(metrics) {
    const date = new Date();
    const filename = `metrics-${date.toISOString().split('T')[0]}.jsonl`;
    const filepath = path.join(this.options.dataDir, filename);
    
    const lines = metrics.map(m => JSON.stringify(m)).join('\n') + '\n';
    await fs.appendFile(filepath, lines);
  }

  /**
   * 古いデータをクリーンアップ
   */
  async cleanup() {
    const cutoff = Date.now() - (this.options.retentionDays * 24 * 60 * 60 * 1000);
    
    // データベースから削除
    if (this.databaseManager && this.databaseManager.db) {
      this.databaseManager.db.prepare(
        'DELETE FROM metrics WHERE timestamp < ?'
      ).run(cutoff);
      
      this.databaseManager.db.prepare(
        'DELETE FROM metric_aggregates WHERE timestamp < ?'
      ).run(cutoff);
    }
    
    // 古いファイルを削除
    const files = await fs.readdir(this.options.dataDir);
    const cutoffDate = new Date(cutoff).toISOString().split('T')[0];
    
    for (const file of files) {
      if (file.startsWith('metrics-') && file < `metrics-${cutoffDate}.jsonl`) {
        await fs.unlink(path.join(this.options.dataDir, file)).catch(() => {});
      }
    }
  }

  /**
   * メトリクスを取得
   */
  async getMetrics(query) {
    const { metric, startTime, endTime, tags } = query;
    
    if (this.databaseManager && this.databaseManager.db) {
      let sql = 'SELECT * FROM metrics WHERE metric_name = ? AND timestamp >= ? AND timestamp <= ?';
      const params = [metric, startTime, endTime];
      
      if (tags) {
        // タグでフィルタリング（簡易実装）
        sql += ' AND tags LIKE ?';
        params.push(`%${JSON.stringify(tags)}%`);
      }
      
      sql += ' ORDER BY timestamp ASC';
      
      const rows = this.databaseManager.db.prepare(sql).all(...params);
      return rows.map(row => ({
        timestamp: row.timestamp,
        value: row.value,
        tags: JSON.parse(row.tags || '{}')
      }));
    }
    
    return [];
  }

  /**
   * 集計データを取得
   */
  async getAggregates(query) {
    const { metric, window, startTime, endTime } = query;
    
    if (this.databaseManager && this.databaseManager.db) {
      const sql = `
        SELECT * FROM metric_aggregates 
        WHERE metric_name = ? AND window = ? AND timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp ASC
      `;
      
      return this.databaseManager.db.prepare(sql).all(metric, window, startTime, endTime);
    }
    
    return [];
  }

  /**
   * メトリクスキーを生成
   */
  getMetricKey(name, tags) {
    const tagStr = Object.keys(tags).sort()
      .map(k => `${k}:${tags[k]}`)
      .join(',');
    return `${name}${tagStr ? `:${tagStr}` : ''}`;
  }

  /**
   * 現在の状態を取得
   */
  getStatus() {
    return {
      bufferSize: this.metricsBuffer.length,
      counters: this.counters.size,
      gauges: this.gauges.size,
      histograms: this.histograms.size
    };
  }
}

module.exports = MetricsCollector;