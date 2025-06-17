const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * ログ検索・フィルタAPI
 */
class LogSearchAPI {
  constructor(logger) {
    this.logger = logger;
    this.logsDir = path.join(__dirname, '../../../logs');
  }

  /**
   * ログ検索エンドポイントの設定
   */
  setupRoutes(app) {
    // ログ検索API
    app.get('/api/logs/search', async (req, res) => {
      try {
        const {
          keyword = '',
          startDate,
          endDate,
          level,
          processId,
          issueNumber,
          limit = 100,
          offset = 0
        } = req.query;

        const results = await this.searchLogs({
          keyword,
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          level,
          processId,
          issueNumber,
          limit: parseInt(limit),
          offset: parseInt(offset)
        });

        res.json(results);
      } catch (error) {
        this.logger?.error('ログ検索エラー:', error);
        res.status(500).json({ error: 'ログ検索中にエラーが発生しました' });
      }
    });

    // ログファイル一覧API
    app.get('/api/logs/files', (req, res) => {
      try {
        const files = this.getLogFiles();
        res.json({ files });
      } catch (error) {
        this.logger?.error('ログファイル一覧取得エラー:', error);
        res.status(500).json({ error: 'ログファイル一覧の取得に失敗しました' });
      }
    });

    // ログレベル統計API
    app.get('/api/logs/stats', async (req, res) => {
      try {
        const { startDate, endDate } = req.query;
        const stats = await this.getLogStats({
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null
        });
        res.json(stats);
      } catch (error) {
        this.logger?.error('ログ統計取得エラー:', error);
        res.status(500).json({ error: 'ログ統計の取得に失敗しました' });
      }
    });

    // ログエクスポートAPI
    app.get('/api/logs/export', async (req, res) => {
      try {
        const {
          keyword,
          startDate,
          endDate,
          level,
          processId,
          issueNumber,
          format = 'json'
        } = req.query;

        const results = await this.searchLogs({
          keyword,
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          level,
          processId,
          issueNumber,
          limit: 10000 // エクスポート時は制限を大きくする
        });

        if (format === 'csv') {
          const csv = this.convertToCSV(results.logs);
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', 'attachment; filename="logs.csv"');
          res.send(csv);
        } else {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Content-Disposition', 'attachment; filename="logs.json"');
          res.json(results);
        }
      } catch (error) {
        this.logger?.error('ログエクスポートエラー:', error);
        res.status(500).json({ error: 'ログエクスポート中にエラーが発生しました' });
      }
    });
  }

  /**
   * ログファイル一覧を取得
   */
  getLogFiles() {
    const files = fs.readdirSync(this.logsDir)
      .filter(file => file.endsWith('.log'))
      .map(file => {
        const stats = fs.statSync(path.join(this.logsDir, file));
        return {
          name: file,
          size: stats.size,
          modified: stats.mtime
        };
      })
      .sort((a, b) => b.modified - a.modified);

    return files;
  }

  /**
   * ログを検索
   */
  async searchLogs(options) {
    const {
      keyword,
      startDate,
      endDate,
      level,
      processId,
      issueNumber,
      limit,
      offset
    } = options;

    const results = [];
    const files = this.getLogFiles();
    let totalMatches = 0;
    let currentOffset = 0;

    // 各ログファイルを検索
    for (const file of files) {
      const filePath = path.join(this.logsDir, file.name);
      const fileResults = await this.searchInFile(filePath, {
        keyword,
        startDate,
        endDate,
        level,
        processId,
        issueNumber
      });

      for (const log of fileResults) {
        totalMatches++;
        
        if (currentOffset >= offset && results.length < limit) {
          results.push(log);
        }
        
        currentOffset++;
        
        if (results.length >= limit) {
          break;
        }
      }

      if (results.length >= limit) {
        break;
      }
    }

    return {
      logs: results,
      total: totalMatches,
      limit,
      offset,
      hasMore: totalMatches > offset + results.length
    };
  }

  /**
   * 特定のファイル内を検索
   */
  async searchInFile(filePath, filters) {
    return new Promise((resolve, reject) => {
      const results = [];
      const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity
      });

      rl.on('line', (line) => {
        try {
          const log = this.parseLine(line);
          if (!log) return;

          // フィルタリング
          if (filters.keyword && !line.toLowerCase().includes(filters.keyword.toLowerCase())) {
            return;
          }

          if (filters.startDate && log.timestamp < filters.startDate) {
            return;
          }

          if (filters.endDate && log.timestamp > filters.endDate) {
            return;
          }

          if (filters.level && log.level !== filters.level) {
            return;
          }

          if (filters.processId && !log.processId?.includes(filters.processId)) {
            return;
          }

          if (filters.issueNumber && log.issueNumber !== parseInt(filters.issueNumber)) {
            return;
          }

          results.push(log);
        } catch (error) {
          // パースエラーは無視
        }
      });

      rl.on('close', () => {
        resolve(results);
      });

      rl.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * ログ行をパース
   */
  parseLine(line) {
    // PoppoBuilderのログ形式: [YYYY-MM-DD HH:mm:ss] [LEVEL] [ProcessID] Message
    const logPattern = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] \[(\w+)\] (?:\[([^\]]+)\] )?(.+)$/;
    const match = line.match(logPattern);

    if (!match) {
      return null;
    }

    const [, timestamp, level, processId, message] = match;
    
    // Issue番号を抽出
    let issueNumber = null;
    const issueMatch = message.match(/Issue #(\d+)/i) || (processId && processId.match(/issue-(\d+)/i));
    if (issueMatch) {
      issueNumber = parseInt(issueMatch[1]);
    }

    return {
      timestamp: new Date(timestamp),
      level: level.toUpperCase(),
      processId: processId || 'main',
      issueNumber,
      message,
      raw: line
    };
  }

  /**
   * ログ統計を取得
   */
  async getLogStats(options) {
    const { startDate, endDate } = options;
    const stats = {
      levels: {
        ERROR: 0,
        WARN: 0,
        INFO: 0,
        DEBUG: 0
      },
      issues: {},
      processes: {},
      timeline: []
    };

    const files = this.getLogFiles();
    
    for (const file of files) {
      const filePath = path.join(this.logsDir, file.name);
      const fileResults = await this.searchInFile(filePath, {
        startDate,
        endDate
      });

      for (const log of fileResults) {
        // レベル別カウント
        if (stats.levels[log.level]) {
          stats.levels[log.level]++;
        }

        // Issue別カウント
        if (log.issueNumber) {
          stats.issues[log.issueNumber] = (stats.issues[log.issueNumber] || 0) + 1;
        }

        // プロセス別カウント
        stats.processes[log.processId] = (stats.processes[log.processId] || 0) + 1;
      }
    }

    return stats;
  }

  /**
   * CSVに変換
   */
  convertToCSV(logs) {
    const headers = ['Timestamp', 'Level', 'Process ID', 'Issue Number', 'Message'];
    const rows = [headers.join(',')];

    for (const log of logs) {
      const row = [
        log.timestamp.toISOString(),
        log.level,
        log.processId,
        log.issueNumber || '',
        `"${log.message.replace(/"/g, '""')}"`
      ];
      rows.push(row.join(','));
    }

    return rows.join('\n');
  }
}

module.exports = LogSearchAPI;