const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs');
const path = require('path');
const DatabaseManager = require('../src/database-manager');

describe('DatabaseManager', () => {
  let db;
  const testDbPath = path.join(__dirname, 'test-db.db');
  
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // テスト用データベースを作成
    db = new DatabaseManager(testDbPath);
  });
  
  afterEach(() => {
    // データベースを閉じて削除
    if (db) {
      db.close();
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });
  
  describe('初期化', () => {
    it('データベースファイルが作成される', () => {
      expect(fs.existsSync(testDbPath)).to.be.true;
    });
    
    it('必要なテーブルが作成される', () => {
      const tables = db.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      const tableNames = tables.map(t => t.name);
      
      expect(tableNames).to.include('process_history');
      expect(tableNames).to.include('performance_metrics');
      expect(tableNames).to.include('performance_summary');
      expect(tableNames).to.include('archive_history');
    });
  });
  
  describe('プロセス記録', () => {
    it('プロセス開始を記録できる', () => {
      const processInfo = {
        processId: 'test-process-1',
        taskType: 'claude-cli',
        issueNumber: 123,
        title: 'Test Issue',
        cpuUsage: 10,
        memoryUsage: 256
      };
      
      const result = db.recordProcessStart(processInfo);
      
      expect(result.processId).to.equal('test-process-1');
      expect(result.startedAt).to.be.a('number');
      
      // データベースから確認
      const record = db.db.prepare('SELECT * FROM process_history WHERE process_id = ?')
        .get('test-process-1');
      
      expect(record).to.exist;
      expect(record.task_type).to.equal('claude-cli');
      expect(record.issue_number).to.equal(123);
      expect(record.status).to.equal('running');
    });
    
    it('プロセス終了を記録できる', () => {
      // まず開始を記録
      db.recordProcessStart({
        processId: 'test-process-2',
        taskType: 'issue-process'
      });
      
      // 終了を記録
      const endInfo = {
        status: 'success',
        exitCode: 0,
        cpuUsage: 15,
        memoryUsage: 512
      };
      
      const result = db.recordProcessEnd('test-process-2', endInfo);
      
      expect(result.processId).to.equal('test-process-2');
      expect(result.durationMs).to.be.a('number');
      expect(result.durationMs).to.be.at.least(0);
      
      // データベースから確認
      const record = db.db.prepare('SELECT * FROM process_history WHERE process_id = ?')
        .get('test-process-2');
      
      expect(record.status).to.equal('success');
      expect(record.exit_code).to.be.oneOf([0, null]); // exitCodeは省略可能なので
      expect(record.duration_ms).to.be.a('number');
      expect(record.duration_ms).to.be.at.least(0);
    });
    
    it('エラー情報を記録できる', () => {
      db.recordProcessStart({
        processId: 'test-process-3',
        taskType: 'comment-process'
      });
      
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at Test.fn';
      
      db.recordProcessEnd('test-process-3', {
        status: 'error',
        exitCode: 1,
        error: error
      });
      
      const record = db.db.prepare('SELECT * FROM process_history WHERE process_id = ?')
        .get('test-process-3');
      
      expect(record.status).to.equal('error');
      expect(record.error_message).to.equal('Test error');
      expect(record.error_stack).to.include('Error: Test error');
    });
  });
  
  describe('メトリクス記録', () => {
    it('メトリクスを記録できる', () => {
      db.recordMetric('test-process-4', 'cpu_usage', 25.5);
      db.recordMetric('test-process-4', 'memory_usage', 1024);
      
      const metrics = db.db.prepare(
        'SELECT * FROM performance_metrics WHERE process_id = ? ORDER BY metric_type'
      ).all('test-process-4');
      
      expect(metrics).to.have.lengthOf(2);
      expect(metrics[0].metric_type).to.equal('cpu_usage');
      expect(metrics[0].metric_value).to.equal(25.5);
      expect(metrics[1].metric_type).to.equal('memory_usage');
      expect(metrics[1].metric_value).to.equal(1024);
    });
  });
  
  describe('統計取得', () => {
    beforeEach(() => {
    sandbox = sinon.createSandbox();
      // テストデータを挿入
      const processes = [
        { processId: 'p1', taskType: 'claude-cli', status: 'success', duration: 5000 },
        { processId: 'p2', taskType: 'claude-cli', status: 'success', duration: 8000 },
        { processId: 'p3', taskType: 'claude-cli', status: 'error', duration: 3000 },
        { processId: 'p4', taskType: 'issue-process', status: 'success', duration: 10000 }
      ];
      
      processes.forEach(p => {
        db.recordProcessStart({
          processId: p.processId,
          taskType: p.taskType
        });
        
        // 少し待機してから終了
        const startTime = Date.now() - p.duration;
        db.db.prepare('UPDATE process_history SET started_at = ? WHERE process_id = ?')
          .run(startTime, p.processId);
        
        db.recordProcessEnd(p.processId, {
          status: p.status,
          exitCode: p.status === 'success' ? 0 : 1
        });
      });
    });
    
    it('タスクタイプ別の統計を取得できる', () => {
      const stats = db.getTaskTypeStatistics('claude-cli');
      
      expect(stats.total_count).to.equal(3);
      expect(stats.success_count).to.equal(2);
      expect(stats.failure_count).to.equal(1);
      expect(stats.avg_duration).to.be.closeTo(5333, 100); // (5000+8000+3000)/3
    });
    
    it('日付範囲で統計をフィルタできる', () => {
      const now = Date.now();
      const yesterday = now - 24 * 60 * 60 * 1000;
      const tomorrow = now + 24 * 60 * 60 * 1000;
      
      const stats = db.getTaskTypeStatistics('claude-cli', yesterday, tomorrow);
      expect(stats.total_count).to.equal(3);
      
      const oldStats = db.getTaskTypeStatistics('claude-cli', 0, yesterday);
      expect(oldStats.total_count).to.equal(0);
    });
  });
  
  describe('履歴取得', () => {
    beforeEach(() => {
    sandbox = sinon.createSandbox();
      // テストデータを挿入
      for (let i = 1; i <= 5; i++) {
        db.recordProcessStart({
          processId: `history-${i}`,
          taskType: i % 2 === 0 ? 'claude-cli' : 'issue-process',
          issueNumber: i
        });
        
        db.recordProcessEnd(`history-${i}`, {
          status: i === 3 ? 'error' : 'success',
          exitCode: i === 3 ? 1 : 0
        });
      }
    });
    
    it('プロセス履歴を取得できる', () => {
      const history = db.getProcessHistory({ limit: 3 });
      
      expect(history).to.have.lengthOf(3);
      expect(history[0].process_id).to.equal('history-5'); // 最新から
    });
    
    it('タスクタイプでフィルタできる', () => {
      const history = db.getProcessHistory({ taskType: 'claude-cli' });
      
      expect(history.every(h => h.task_type === 'claude-cli')).to.be.true;
    });
    
    it('ステータスでフィルタできる', () => {
      const history = db.getProcessHistory({ status: 'error' });
      
      expect(history).to.have.lengthOf(1);
      expect(history[0].process_id).to.equal('history-3');
    });
  });
  
  describe('パフォーマンストレンド', () => {
    it('トレンドデータを取得できる', () => {
      // 複数日のデータを挿入
      const baseTime = Date.now();
      for (let day = 0; day < 3; day++) {
        for (let i = 0; i < 3; i++) {
          const processId = `trend-${day}-${i}`;
          const startTime = baseTime - (day * 24 * 60 * 60 * 1000);
          
          db.db.prepare(`
            INSERT INTO process_history (
              process_id, task_type, started_at, ended_at, 
              status, duration_ms
            ) VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            processId,
            'claude-cli',
            startTime,
            startTime + 5000 + (i * 1000),
            'success',
            5000 + (i * 1000)
          );
        }
      }
      
      const trends = db.getPerformanceTrends('claude-cli', 'duration_ms', 7);
      
      expect(trends).to.have.length.at.least(1);
      expect(trends[0]).to.have.property('date');
      expect(trends[0]).to.have.property('avg_value');
      expect(trends[0]).to.have.property('count');
    });
  });
  
  describe('サマリー生成', () => {
    it('パフォーマンスサマリーを生成できる', () => {
      // テストデータを挿入
      for (let i = 0; i < 5; i++) {
        db.recordProcessStart({
          processId: `summary-${i}`,
          taskType: 'claude-cli'
        });
        
        db.recordProcessEnd(`summary-${i}`, {
          status: 'success',
          exitCode: 0
        });
      }
      
      const summaries = db.generatePerformanceSummary('daily');
      
      expect(summaries).to.be.an('array');
      expect(summaries.length).to.be.at.least(1);
      
      const claudeSummary = summaries.find(s => s.task_type === 'claude-cli');
      expect(claudeSummary).to.exist;
      expect(claudeSummary.total_count).to.equal(5);
    });
  });
  
  describe('アーカイブ', () => {
    it('古いデータをアーカイブできる', () => {
      // 35日前のデータを挿入
      const oldTime = Date.now() - (35 * 24 * 60 * 60 * 1000);
      
      db.db.prepare(`
        INSERT INTO process_history (
          process_id, task_type, started_at, status
        ) VALUES (?, ?, ?, ?)
      `).run('old-process', 'claude-cli', oldTime, 'success');
      
      // 新しいデータも挿入
      db.recordProcessStart({
        processId: 'new-process',
        taskType: 'claude-cli'
      });
      
      const result = db.archiveOldData(30);
      
      expect(result.archived).to.equal(1);
      expect(result.file).to.include('archive-');
      
      // アーカイブファイルが存在することを確認
      expect(fs.existsSync(result.file)).to.be.true;
      
      // 古いデータが削除されたことを確認
      const remaining = db.db.prepare('SELECT COUNT(*) as count FROM process_history').get();
      expect(remaining.count).to.equal(1);
      
      // クリーンアップ
      if (fs.existsSync(result.file)) {
        fs.unlinkSync(result.file);
      }
    });
  });
});