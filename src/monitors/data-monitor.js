const fs = require('fs').promises;
const path = require('path');
const sqlite3 = require('sqlite3');
const { promisify } = require('util');
const Logger = require('../logger');

/**
 * データモニター
 * データベースとファイルシステムの整合性を監視
 */
class DataMonitor {
  constructor(config) {
    this.config = config;
    this.logger = new Logger('DataMonitor');
    
    // 監視対象のパス
    this.paths = {
      database: path.join(__dirname, '../../.poppo/poppo.db'),
      configs: [
        path.join(__dirname, '../../config/config.json'),
        path.join(__dirname, '../../.poppo/config.json')
      ],
      logs: path.join(__dirname, '../../logs'),
      queues: [
        path.join(__dirname, '../../logs/running-tasks.json'),
        path.join(__dirname, '../../logs/task-queue.json')
      ]
    };
    
    // しきい値の設定
    this.thresholds = {
      logSize: {
        warning: 100 * 1024 * 1024,   // 100MB
        critical: 500 * 1024 * 1024   // 500MB
      },
      fileAge: {
        warning: 7 * 24 * 60 * 60 * 1000,  // 7日
        critical: 30 * 24 * 60 * 60 * 1000 // 30日
      }
    };
  }
  
  /**
   * データ層のヘルスチェック
   */
  async check() {
    const startTime = Date.now();
    
    try {
      const details = {
        database: await this.checkDatabase(),
        configs: await this.checkConfigs(),
        logs: await this.checkLogs(),
        queues: await this.checkQueues(),
        issues: []
      };
      
      // 問題の検出
      this.detectIssues(details);
      
      // スコアの計算
      const score = this.calculateScore(details);
      
      // ステータスの判定
      const status = score >= 80 ? 'healthy' : score >= 60 ? 'degraded' : 'unhealthy';
      
      return {
        status,
        score,
        details,
        checkDuration: Date.now() - startTime
      };
      
    } catch (error) {
      this.logger.error('データチェックエラー:', error);
      return {
        status: 'error',
        score: 0,
        error: error.message,
        checkDuration: Date.now() - startTime
      };
    }
  }
  
  /**
   * データベースの整合性チェック
   */
  async checkDatabase() {
    const result = {
      exists: false,
      accessible: false,
      integrity: false,
      size: 0,
      tables: [],
      rowCounts: {}
    };
    
    try {
      // ファイルの存在確認
      const stats = await fs.stat(this.paths.database);
      result.exists = true;
      result.size = stats.size;
      
      // データベース接続
      const db = new sqlite3.Database(this.paths.database);
      const dbAll = promisify(db.all.bind(db));
      const dbGet = promisify(db.get.bind(db));
      
      try {
        // アクセス可能性の確認
        await dbAll('SELECT 1');
        result.accessible = true;
        
        // 整合性チェック
        const integrityCheck = await dbAll('PRAGMA integrity_check');
        result.integrity = integrityCheck.length === 1 && integrityCheck[0].integrity_check === 'ok';
        
        // テーブル一覧の取得
        const tables = await dbAll("SELECT name FROM sqlite_master WHERE type='table'");
        result.tables = tables.map(t => t.name);
        
        // 主要テーブルのレコード数を取得
        for (const table of ['process_history', 'error_logs']) {
          if (result.tables.includes(table)) {
            const countResult = await dbGet(`SELECT COUNT(*) as count FROM ${table}`);
            result.rowCounts[table] = countResult.count;
          }
        }
        
      } finally {
        // データベースを閉じる
        await promisify(db.close.bind(db))();
      }
      
    } catch (error) {
      this.logger.error('データベースチェックエラー:', error);
      result.error = error.message;
    }
    
    return result;
  }
  
  /**
   * 設定ファイルの妥当性チェック
   */
  async checkConfigs() {
    const results = {};
    
    for (const configPath of this.paths.configs) {
      const fileName = path.basename(configPath);
      results[fileName] = {
        exists: false,
        valid: false,
        readable: false,
        size: 0
      };
      
      try {
        // ファイルの存在確認
        const stats = await fs.stat(configPath);
        results[fileName].exists = true;
        results[fileName].size = stats.size;
        
        // 読み込みとJSON検証
        const content = await fs.readFile(configPath, 'utf8');
        results[fileName].readable = true;
        
        const config = JSON.parse(content);
        results[fileName].valid = true;
        
        // 基本的な構造チェック
        if (fileName === 'config.json') {
          results[fileName].hasRequiredFields = !!(
            config.github && 
            config.claude && 
            config.language
          );
        }
        
      } catch (error) {
        if (error.code !== 'ENOENT') {
          this.logger.error(`設定ファイルチェックエラー (${fileName}):`, error);
          results[fileName].error = error.message;
        }
      }
    }
    
    return results;
  }
  
  /**
   * ログディレクトリのチェック
   */
  async checkLogs() {
    const result = {
      exists: false,
      totalSize: 0,
      fileCount: 0,
      oldestFile: null,
      largestFile: null,
      corrupted: []
    };
    
    try {
      // ディレクトリの存在確認
      const stats = await fs.stat(this.paths.logs);
      result.exists = stats.isDirectory();
      
      // ログファイルの一覧取得
      const files = await fs.readdir(this.paths.logs);
      const logFiles = files.filter(f => f.endsWith('.log'));
      result.fileCount = logFiles.length;
      
      let oldestTime = Date.now();
      let largestSize = 0;
      
      // 各ログファイルをチェック
      for (const file of logFiles) {
        const filePath = path.join(this.paths.logs, file);
        
        try {
          const fileStats = await fs.stat(filePath);
          result.totalSize += fileStats.size;
          
          // 最古のファイル
          if (fileStats.mtime < oldestTime) {
            oldestTime = fileStats.mtime;
            result.oldestFile = {
              name: file,
              age: Date.now() - fileStats.mtime,
              size: fileStats.size
            };
          }
          
          // 最大のファイル
          if (fileStats.size > largestSize) {
            largestSize = fileStats.size;
            result.largestFile = {
              name: file,
              size: fileStats.size
            };
          }
          
          // 破損チェック（0バイトファイル）
          if (fileStats.size === 0) {
            result.corrupted.push(file);
          }
          
        } catch (error) {
          this.logger.error(`ログファイルチェックエラー (${file}):`, error);
          result.corrupted.push(file);
        }
      }
      
    } catch (error) {
      this.logger.error('ログディレクトリチェックエラー:', error);
      result.error = error.message;
    }
    
    return result;
  }
  
  /**
   * キューファイルのチェック
   */
  async checkQueues() {
    const results = {};
    
    for (const queuePath of this.paths.queues) {
      const fileName = path.basename(queuePath);
      results[fileName] = {
        exists: false,
        valid: false,
        size: 0,
        itemCount: 0
      };
      
      try {
        // ファイルの存在確認
        const stats = await fs.stat(queuePath);
        results[fileName].exists = true;
        results[fileName].size = stats.size;
        
        // JSON検証とアイテム数カウント
        const content = await fs.readFile(queuePath, 'utf8');
        const data = JSON.parse(content);
        results[fileName].valid = true;
        
        if (Array.isArray(data)) {
          results[fileName].itemCount = data.length;
        } else if (typeof data === 'object') {
          results[fileName].itemCount = Object.keys(data).length;
        }
        
      } catch (error) {
        if (error.code !== 'ENOENT') {
          this.logger.error(`キューファイルチェックエラー (${fileName}):`, error);
          results[fileName].error = error.message;
        }
      }
    }
    
    return results;
  }
  
  /**
   * 問題の検出
   */
  detectIssues(details) {
    // データベースの問題
    if (!details.database.exists) {
      details.issues.push('データベースファイルが存在しません');
    } else if (!details.database.accessible) {
      details.issues.push('データベースにアクセスできません');
    } else if (!details.database.integrity) {
      details.issues.push('データベースの整合性に問題があります');
    }
    
    // 設定ファイルの問題
    for (const [file, info] of Object.entries(details.configs)) {
      if (!info.exists && file === 'config.json') {
        details.issues.push(`必須設定ファイル${file}が存在しません`);
      } else if (info.exists && !info.valid) {
        details.issues.push(`設定ファイル${file}が無効です`);
      }
    }
    
    // ログの問題
    if (details.logs.totalSize > this.thresholds.logSize.critical) {
      const sizeMB = Math.round(details.logs.totalSize / 1024 / 1024);
      details.issues.push(`ログファイルの合計サイズが大きすぎます（${sizeMB}MB）`);
    } else if (details.logs.totalSize > this.thresholds.logSize.warning) {
      const sizeMB = Math.round(details.logs.totalSize / 1024 / 1024);
      details.issues.push(`ログファイルのサイズが増加しています（${sizeMB}MB）`);
    }
    
    if (details.logs.oldestFile && details.logs.oldestFile.age > this.thresholds.fileAge.critical) {
      const days = Math.floor(details.logs.oldestFile.age / (24 * 60 * 60 * 1000));
      details.issues.push(`${days}日以上前のログファイルが残っています`);
    }
    
    if (details.logs.corrupted.length > 0) {
      details.issues.push(`${details.logs.corrupted.length}個の破損したログファイルがあります`);
    }
    
    // キューの問題
    for (const [file, info] of Object.entries(details.queues)) {
      if (info.exists && !info.valid) {
        details.issues.push(`キューファイル${file}が破損しています`);
      }
    }
  }
  
  /**
   * データ層のスコア計算
   */
  calculateScore(details) {
    let score = 100;
    
    // データベースの問題によるスコア減少
    if (!details.database.exists || !details.database.accessible) {
      score -= 40;
    } else if (!details.database.integrity) {
      score -= 30;
    }
    
    // 設定ファイルの問題によるスコア減少
    const configIssues = Object.values(details.configs).filter(c => c.exists && !c.valid).length;
    score -= configIssues * 15;
    
    // ログの問題によるスコア減少
    if (details.logs.totalSize > this.thresholds.logSize.critical) {
      score -= 20;
    } else if (details.logs.totalSize > this.thresholds.logSize.warning) {
      score -= 10;
    }
    
    if (details.logs.oldestFile && details.logs.oldestFile.age > this.thresholds.fileAge.critical) {
      score -= 15;
    } else if (details.logs.oldestFile && details.logs.oldestFile.age > this.thresholds.fileAge.warning) {
      score -= 8;
    }
    
    score -= details.logs.corrupted.length * 5;
    
    // キューの問題によるスコア減少
    const queueIssues = Object.values(details.queues).filter(q => q.exists && !q.valid).length;
    score -= queueIssues * 10;
    
    // スコアを0-100の範囲に制限
    return Math.max(0, Math.min(100, score));
  }
}

module.exports = DataMonitor;