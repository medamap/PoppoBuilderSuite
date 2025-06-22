const fs = require('fs').promises;
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { spawn } = require('child_process');

class TestEnvironment {
  constructor() {
    this.tempDir = path.join(__dirname, '../temp');
    this.processes = [];
    this.db = null;
  }

  /**
   * テスト環境の初期化
   */
  async setup() {
    console.log('🔧 E2Eテスト環境をセットアップ中...');
    
    // 一時ディレクトリの作成
    await this.createTempDirectories();
    
    // テスト用データベースの初期化
    await this.initializeDatabase();
    
    // テスト用設定ファイルのコピー
    await this.copyTestConfigs();
    
    console.log('✅ E2Eテスト環境のセットアップ完了');
  }

  /**
   * テスト環境のクリーンアップ
   */
  async teardown() {
    console.log('🧹 E2Eテスト環境をクリーンアップ中...');
    
    // 全プロセスの停止
    await this.stopAllProcesses();
    
    // データベースのクローズ
    if (this.db) {
      await new Promise((resolve) => this.db.close(resolve));
    }
    
    // 一時ファイルの削除
    await this.cleanupTempFiles();
    
    console.log('✅ E2Eテスト環境のクリーンアップ完了');
  }

  /**
   * 一時ディレクトリの作成
   */
  async createTempDirectories() {
    const dirs = [
      this.tempDir,
      path.join(this.tempDir, 'logs'),
      path.join(this.tempDir, 'claude-sessions'),
      path.join(this.tempDir, 'data'),
      path.join(this.tempDir, '.poppo')
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * テスト用データベースの初期化
   */
  async initializeDatabase() {
    const dbPath = path.join(this.tempDir, 'test.db');
    
    // 既存のDBファイルを削除
    try {
      await fs.unlink(dbPath);
    } catch (err) {
      // ファイルが存在しない場合は無視
    }

    this.db = new sqlite3.Database(dbPath);

    // テーブルの作成
    const schemas = [
      // プロセス履歴テーブル
      `CREATE TABLE IF NOT EXISTS process_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        issue_number INTEGER,
        status TEXT NOT NULL,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ended_at DATETIME,
        duration_ms INTEGER,
        memory_peak_mb REAL,
        cpu_usage_percent REAL,
        error_message TEXT,
        error_stack TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // 監査ログテーブル
      `CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        action TEXT NOT NULL,
        resource TEXT,
        resource_id TEXT,
        result TEXT NOT NULL,
        metadata TEXT,
        ip_address TEXT,
        user_agent TEXT,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        checksum TEXT
      )`,
      
      // ヘルスメトリクステーブル
      `CREATE TABLE IF NOT EXISTS health_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metric_name TEXT NOT NULL,
        metric_value REAL NOT NULL,
        monitor_type TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    for (const schema of schemas) {
      await new Promise((resolve, reject) => {
        this.db.run(schema, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  /**
   * テスト用設定ファイルのコピー
   */
  async copyTestConfigs() {
    // テスト用config.json
    const testConfig = {
      language: {
        primary: 'ja',
        secondary: 'en'
      },
      claude: {
        apiKey: 'test-claude-api-key',
        model: 'claude-3-haiku-20240307',
        maxConcurrent: 2,
        timeout: 5000
      },
      github: {
        token: 'test-github-token',
        webhookSecret: 'test-webhook-secret'
      },
      dashboard: {
        port: 4001,
        password: 'test-password'
      },
      logging: {
        level: 'debug',
        format: 'json'
      },
      database: {
        path: './test/e2e/temp/test.db'
      },
      security: {
        jwtSecret: 'test-jwt-secret',
        sessionSecret: 'test-session-secret'
      }
    };

    const configPath = path.join(this.tempDir, 'config.json');
    await fs.writeFile(configPath, JSON.stringify(testConfig, null, 2));

    // .poppo/config.json
    const poppoConfig = {
      language: 'ja',
      timezone: 'Asia/Tokyo'
    };

    const poppoConfigPath = path.join(this.tempDir, '.poppo', 'config.json');
    await fs.writeFile(poppoConfigPath, JSON.stringify(poppoConfig, null, 2));
  }

  /**
   * プロセスの起動
   */
  async startProcess(command, args = [], options = {}) {
    const defaultOptions = {
      cwd: path.join(__dirname, '../../..'),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        CONFIG_PATH: path.join(this.tempDir, 'config.json'),
        DB_PATH: path.join(this.tempDir, 'test.db'),
        LOG_DIR: path.join(this.tempDir, 'logs')
      }
    };

    const finalOptions = { ...defaultOptions, ...options };
    const proc = spawn(command, args, finalOptions);

    // プロセスの出力を記録
    proc.stdout.on('data', (data) => {
      console.log(`[${command}] ${data.toString().trim()}`);
    });

    proc.stderr.on('data', (data) => {
      console.error(`[${command}] ERROR: ${data.toString().trim()}`);
    });

    this.processes.push(proc);
    return proc;
  }

  /**
   * 全プロセスの停止
   */
  async stopAllProcesses() {
    for (const proc of this.processes) {
      if (!proc.killed) {
        proc.kill('SIGTERM');
        // プロセスが終了するまで待機
        await new Promise((resolve) => {
          proc.on('exit', resolve);
          // タイムアウト設定
          setTimeout(() => {
            if (!proc.killed) {
              proc.kill('SIGKILL');
            }
            resolve();
          }, 5000);
        });
      }
    }
    this.processes = [];
  }

  /**
   * 一時ファイルのクリーンアップ
   */
  async cleanupTempFiles() {
    try {
      await fs.rm(this.tempDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`一時ファイルのクリーンアップ中にエラー: ${err.message}`);
    }
  }

  /**
   * テストデータの挿入
   */
  async insertTestData(table, data) {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = values.map(() => '?').join(', ');
    
    const query = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
    
    return new Promise((resolve, reject) => {
      this.db.run(query, values, function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  /**
   * プロセスが起動するまで待機
   */
  async waitForProcess(proc, readyPattern, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('プロセスの起動がタイムアウトしました'));
      }, timeout);

      const checkOutput = (data) => {
        const output = data.toString();
        if (readyPattern.test(output)) {
          clearTimeout(timer);
          proc.stdout.removeListener('data', checkOutput);
          resolve();
        }
      };

      proc.stdout.on('data', checkOutput);
    });
  }

  /**
   * HTTPエンドポイントが利用可能になるまで待機
   */
  async waitForEndpoint(url, timeout = 30000) {
    const axios = require('axios');
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        await axios.get(url);
        return;
      } catch (err) {
        // エンドポイントがまだ利用できない
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    throw new Error(`エンドポイント ${url} が利用可能になりませんでした`);
  }
}

module.exports = TestEnvironment;