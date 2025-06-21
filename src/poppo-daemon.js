#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const GlobalQueueManager = require('./global-queue-manager');
const ProjectManager = require('./project-manager');
const ProcessManager = require('./process-manager');
const { createLogger } = require('./logger');
const express = require('express');
const http = require('http');
const ConfigWatcher = require('./config-watcher');

/**
 * PoppoBuilderデーモン
 * システム常駐プロセスとしてグローバルキューとプロジェクトを管理
 */
class PoppoDaemon {
  constructor() {
    this.logger = createLogger('PoppoDaemon');
    this.config = this.loadConfig();
    
    // コンポーネント
    this.globalQueue = null;
    this.projectManager = null;
    this.workers = new Map(); // プロジェクトごとのワーカープロセス
    this.apiServer = null;
    this.configWatcher = null;
    
    // 状態
    this.isRunning = false;
    this.shutdownRequested = false;
  }
  
  /**
   * 設定を読み込み
   */
  loadConfig() {
    try {
      const configPath = path.join(__dirname, '..', 'config', 'daemon-config.json');
      const configData = require(configPath);
      return {
        port: process.env.POPPO_DAEMON_PORT || configData.port || 3003,
        host: process.env.POPPO_DAEMON_HOST || configData.host || 'localhost',
        dataDir: process.env.POPPO_DATA_DIR || configData.dataDir || path.join(process.env.HOME, '.poppo-builder'),
        maxWorkers: configData.maxWorkers || 10,
        workerTimeout: configData.workerTimeout || 3600000, // 1時間
        pollInterval: configData.pollInterval || 5000,
        ...configData
      };
    } catch (error) {
      // デフォルト設定を使用
      return {
        port: 3003,
        host: 'localhost',
        dataDir: path.join(process.env.HOME, '.poppo-builder'),
        maxWorkers: 10,
        workerTimeout: 3600000,
        pollInterval: 5000
      };
    }
  }
  
  /**
   * デーモンを初期化
   */
  async initialize() {
    try {
      this.logger.info('PoppoBuilderデーモンを初期化しています...');
      
      // データディレクトリを作成
      await fs.mkdir(this.config.dataDir, { recursive: true });
      
      // PIDファイルを作成
      await this.createPidFile();
      
      // グローバルキューマネージャーを初期化
      this.globalQueue = new GlobalQueueManager({
        dataDir: this.config.dataDir,
        maxQueueSize: this.config.maxQueueSize || 1000,
        pollInterval: this.config.pollInterval
      });
      await this.globalQueue.initialize();
      
      // プロジェクトマネージャーを初期化
      this.projectManager = new ProjectManager(this.globalQueue);
      
      // APIサーバーを初期化
      await this.initializeApiServer();
      
      // シグナルハンドラーを設定
      this.setupSignalHandlers();
      
      this.logger.info('デーモンの初期化が完了しました');
      
    } catch (error) {
      this.logger.error('デーモンの初期化に失敗しました:', error);
      throw error;
    }
  }
  
  /**
   * PIDファイルを作成
   */
  async createPidFile() {
    const pidFile = path.join(this.config.dataDir, 'poppo-daemon.pid');
    await fs.writeFile(pidFile, process.pid.toString());
    this.logger.info('PIDファイルを作成しました', { pid: process.pid, path: pidFile });
  }
  
  /**
   * PIDファイルを削除
   */
  async removePidFile() {
    try {
      const pidFile = path.join(this.config.dataDir, 'poppo-daemon.pid');
      await fs.unlink(pidFile);
      this.logger.info('PIDファイルを削除しました');
    } catch (error) {
      // エラーは無視
    }
  }
  
  /**
   * APIサーバーを初期化
   */
  async initializeApiServer() {
    const app = express();
    app.use(express.json());
    
    // ヘルスチェックエンドポイント
    app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        daemon: {
          pid: process.pid,
          uptime: process.uptime(),
          memory: process.memoryUsage()
        },
        queue: this.globalQueue.getQueueStatus(),
        workers: this.workers.size
      });
    });
    
    // プロジェクト登録API
    app.post('/api/projects/register', async (req, res) => {
      try {
        const { path: projectPath } = req.body;
        if (!projectPath) {
          return res.status(400).json({ error: 'プロジェクトパスが必要です' });
        }
        
        const project = await this.projectManager.autoDetectProject(projectPath);
        res.json({ success: true, project });
        
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // プロジェクト一覧API
    app.get('/api/projects', async (req, res) => {
      try {
        const projects = await this.projectManager.getAllProjectsStatus();
        res.json({ projects });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // タスクエンキューAPI
    app.post('/api/queue/enqueue', async (req, res) => {
      try {
        const task = await this.globalQueue.enqueueTask(req.body);
        res.json({ success: true, task });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // キューステータスAPI
    app.get('/api/queue/status', (req, res) => {
      res.json(this.globalQueue.getQueueStatus());
    });
    
    // 次のタスクを取得API
    app.post('/api/queue/next', async (req, res) => {
      try {
        const { projectId } = req.body;
        if (!projectId) {
          return res.status(400).json({ error: 'プロジェクトIDが必要です' });
        }
        
        const task = await this.globalQueue.getNextTask(projectId);
        if (task) {
          res.json({ task });
        } else {
          res.status(404).json({ error: 'タスクがありません' });
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // タスク完了API
    app.post('/api/queue/complete/:taskId', async (req, res) => {
      try {
        const task = await this.globalQueue.completeTask(req.params.taskId, req.body.result);
        res.json({ success: true, task });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // タスク失敗API
    app.post('/api/queue/fail/:taskId', async (req, res) => {
      try {
        const task = await this.globalQueue.failTask(req.params.taskId, req.body.error);
        res.json({ success: true, task });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // ワーカーステータスAPI
    app.get('/api/workers', (req, res) => {
      const workers = [];
      for (const [projectId, worker] of this.workers) {
        workers.push({
          projectId,
          pid: worker.pid,
          status: worker.status,
          startedAt: worker.startedAt,
          lastActivity: worker.lastActivity
        });
      }
      res.json({ workers });
    });
    
    // デーモンシャットダウンAPI
    app.post('/api/shutdown', async (req, res) => {
      this.logger.info('シャットダウンリクエストを受信しました');
      res.json({ success: true, message: 'シャットダウンを開始します' });
      
      // 非同期でシャットダウン
      setTimeout(() => this.shutdown(), 100);
    });
    
    // サーバーを起動
    this.apiServer = http.createServer(app);
    await new Promise((resolve, reject) => {
      this.apiServer.listen(this.config.port, this.config.host, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    
    this.logger.info('APIサーバーを起動しました', {
      host: this.config.host,
      port: this.config.port
    });
  }
  
  /**
   * シグナルハンドラーを設定
   */
  setupSignalHandlers() {
    process.on('SIGINT', () => this.handleSignal('SIGINT'));
    process.on('SIGTERM', () => this.handleSignal('SIGTERM'));
    process.on('SIGHUP', () => this.handleSignal('SIGHUP'));
    
    process.on('uncaughtException', (error) => {
      this.logger.error('キャッチされない例外:', error);
      this.shutdown();
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('未処理のPromise拒否:', reason);
    });
  }
  
  /**
   * シグナルを処理
   */
  handleSignal(signal) {
    this.logger.info(`シグナル ${signal} を受信しました`);
    
    switch (signal) {
      case 'SIGINT':
      case 'SIGTERM':
        this.shutdown();
        break;
      case 'SIGHUP':
        // 設定の再読み込み
        this.reloadConfig();
        break;
    }
  }
  
  /**
   * 設定を再読み込み
   */
  async reloadConfig() {
    this.logger.info('設定の再読み込みを開始します...');
    
    try {
      // ConfigWatcherが有効な場合は手動再読み込みを実行
      if (this.configWatcher) {
        const result = await this.configWatcher.reload();
        if (result.success) {
          this.config = result.config;
          this.logger.info('ConfigWatcherを使用して設定を再読み込みしました');
          
          // 再起動が必要な設定変更の通知
          if (result.restartRequired) {
            this.logger.warn('一部の設定変更にはデーモンの再起動が必要です');
          }
        } else {
          throw new Error(result.error);
        }
      } else {
        // ConfigWatcherが無効な場合は手動で設定を再読み込み
        const newConfig = this.loadConfig();
        
        // 即座に反映可能な設定を更新
        this.updateHotReloadableConfigs(this.config, newConfig);
        
        this.config = newConfig;
        this.logger.info('設定ファイルから設定を再読み込みしました');
      }
      
      // グローバルキューとプロジェクトマネージャーの設定を更新
      if (this.globalQueue) {
        this.globalQueue.updateConfig(this.config);
      }
      if (this.projectManager) {
        this.projectManager.updateConfig(this.config);
      }
      
      // ワーカーに設定変更を通知
      for (const [projectId, worker] of this.workers) {
        if (worker.process && !worker.process.killed) {
          worker.process.send({ type: 'reload-config', config: this.config });
        }
      }
      
      this.logger.info('設定の再読み込みが完了しました');
      
    } catch (error) {
      this.logger.error('設定の再読み込みに失敗しました:', error);
    }
  }
  
  /**
   * ホットリロード可能な設定を更新
   */
  updateHotReloadableConfigs(oldConfig, newConfig) {
    // ログレベルの更新
    if (oldConfig.logLevel !== newConfig.logLevel) {
      this.logger.setLevel(newConfig.logLevel);
      this.logger.info(`ログレベルを変更: ${oldConfig.logLevel} → ${newConfig.logLevel}`);
    }
    
    // ポーリング間隔の更新
    if (oldConfig.pollInterval !== newConfig.pollInterval) {
      this.logger.info(`ポーリング間隔を変更: ${oldConfig.pollInterval} → ${newConfig.pollInterval}`);
    }
    
    // ワーカータイムアウトの更新
    if (oldConfig.workerTimeout !== newConfig.workerTimeout) {
      this.logger.info(`ワーカータイムアウトを変更: ${oldConfig.workerTimeout} → ${newConfig.workerTimeout}`);
    }
  }

  /**
   * ワーカープロセスを起動
   */
  async startWorker(projectId) {
    const project = this.globalQueue.projects.get(projectId);
    if (!project) {
      throw new Error(`プロジェクト ${projectId} が見つかりません`);
    }
    
    if (this.workers.has(projectId)) {
      this.logger.warn('ワーカーは既に起動しています', { projectId });
      return;
    }
    
    if (this.workers.size >= this.config.maxWorkers) {
      this.logger.warn('最大ワーカー数に達しています', { max: this.config.maxWorkers });
      return;
    }
    
    const workerScript = path.join(__dirname, 'poppo-worker.js');
    const worker = spawn('node', [workerScript, projectId], {
      cwd: project.path,
      env: {
        ...process.env,
        POPPO_PROJECT_ID: projectId,
        POPPO_PROJECT_PATH: project.path,
        POPPO_DAEMON_URL: `http://${this.config.host}:${this.config.port}`
      },
      detached: false
    });
    
    const workerInfo = {
      pid: worker.pid,
      process: worker,
      projectId,
      status: 'running',
      startedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString()
    };
    
    this.workers.set(projectId, workerInfo);
    
    // ワーカーの出力を処理
    worker.stdout.on('data', (data) => {
      this.logger.info(`[Worker ${projectId}] ${data.toString().trim()}`);
      workerInfo.lastActivity = new Date().toISOString();
    });
    
    worker.stderr.on('data', (data) => {
      this.logger.error(`[Worker ${projectId}] ${data.toString().trim()}`);
    });
    
    worker.on('exit', (code, signal) => {
      this.logger.info(`ワーカーが終了しました`, { projectId, code, signal });
      this.workers.delete(projectId);
      
      // 異常終了の場合は再起動を試みる
      if (code !== 0 && !this.shutdownRequested) {
        setTimeout(() => {
          this.startWorker(projectId).catch(error => {
            this.logger.error('ワーカーの再起動に失敗しました:', error);
          });
        }, 5000);
      }
    });
    
    this.logger.info('ワーカーを起動しました', { projectId, pid: worker.pid });
  }
  
  /**
   * ワーカープロセスを停止
   */
  async stopWorker(projectId) {
    const workerInfo = this.workers.get(projectId);
    if (!workerInfo) {
      return;
    }
    
    this.logger.info('ワーカーを停止します', { projectId, pid: workerInfo.pid });
    
    // SIGTERMを送信
    workerInfo.process.kill('SIGTERM');
    
    // 一定時間待っても終了しない場合はSIGKILL
    setTimeout(() => {
      if (this.workers.has(projectId)) {
        this.logger.warn('ワーカーが応答しません。強制終了します', { projectId });
        workerInfo.process.kill('SIGKILL');
      }
    }, 10000);
  }
  
  /**
   * すべてのワーカーを停止
   */
  async stopAllWorkers() {
    const promises = [];
    for (const projectId of this.workers.keys()) {
      promises.push(this.stopWorker(projectId));
    }
    await Promise.all(promises);
  }
  
  /**
   * タスクを処理するプロジェクトを選択
   */
  async selectProjectForTask() {
    // キューにタスクがあるプロジェクトを優先度順に処理
    const tasksByProject = this.globalQueue.getTasksByProject();
    const projects = Array.from(this.globalQueue.projects.values())
      .filter(p => tasksByProject[p.id]?.queued > 0)
      .sort((a, b) => b.priority - a.priority);
    
    for (const project of projects) {
      // ワーカーが起動していない場合は起動
      if (!this.workers.has(project.id)) {
        await this.startWorker(project.id);
        return project.id;
      }
      
      // ワーカーがアイドル状態の場合
      const worker = this.workers.get(project.id);
      const idleTime = Date.now() - new Date(worker.lastActivity).getTime();
      if (idleTime > 30000) { // 30秒以上アイドル
        return project.id;
      }
    }
    
    return null;
  }
  
  /**
   * メインループ
   */
  async mainLoop() {
    while (!this.shutdownRequested) {
      try {
        // キューの状態をチェック
        await this.globalQueue.performMaintenance();
        
        // タスクを処理するプロジェクトを選択
        const projectId = await this.selectProjectForTask();
        if (projectId) {
          this.logger.debug('タスクを処理するプロジェクトを選択しました', { projectId });
        }
        
        // アイドルワーカーをチェック
        const now = Date.now();
        for (const [projectId, worker] of this.workers) {
          const idleTime = now - new Date(worker.lastActivity).getTime();
          if (idleTime > this.config.workerTimeout) {
            this.logger.info('アイドルワーカーを停止します', { projectId, idleTime });
            await this.stopWorker(projectId);
          }
        }
        
        // リソース最適化（1分ごと）
        if (Date.now() % 60000 < this.config.pollInterval) {
          await this.projectManager.optimizeResourceAllocation();
        }
        
      } catch (error) {
        this.logger.error('メインループエラー:', error);
      }
      
      // ポーリング間隔で待機
      await new Promise(resolve => setTimeout(resolve, this.config.pollInterval));
    }
  }
  
  /**
   * デーモンを開始
   */
  async start() {
    try {
      await this.initialize();
      
      this.isRunning = true;
      await this.globalQueue.start();
      
      this.logger.info('PoppoBuilderデーモンを開始しました', {
        pid: process.pid,
        config: this.config
      });
      
      // メインループを開始
      await this.mainLoop();
      
    } catch (error) {
      this.logger.error('デーモンの開始に失敗しました:', error);
      await this.shutdown();
      process.exit(1);
    }
  }
  
  /**
   * デーモンをシャットダウン
   */
  async shutdown() {
    if (this.shutdownRequested) {
      return;
    }
    
    this.shutdownRequested = true;
    this.logger.info('デーモンのシャットダウンを開始します...');
    
    try {
      // APIサーバーを停止
      if (this.apiServer) {
        await new Promise((resolve) => this.apiServer.close(resolve));
      }
      
      // すべてのワーカーを停止
      await this.stopAllWorkers();
      
      // グローバルキューを停止
      if (this.globalQueue) {
        await this.globalQueue.stop();
      }
      
      // PIDファイルを削除
      await this.removePidFile();
      
      this.logger.info('デーモンのシャットダウンが完了しました');
      process.exit(0);
      
    } catch (error) {
      this.logger.error('シャットダウン中にエラーが発生しました:', error);
      process.exit(1);
    }
  }
}

// メインエントリポイント
if (require.main === module) {
  const daemon = new PoppoDaemon();
  daemon.start().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = PoppoDaemon;