const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const GlobalConfig = require('../../../src/core/global-config');
const ConfigLoader = require('../../../src/config-loader');
const MaintenanceMode = require('../../../src/core/maintenance-mode');

/**
 * Configuration Management API
 */
class ConfigAPI {
  constructor(logger) {
    this.logger = logger;
    this.router = express.Router();
    this.setupRoutes();
  }

  setupRoutes() {
    // 現在の設定を取得
    this.router.get('/current', async (req, res) => {
      try {
        // グローバル設定を取得
        const globalConfig = await this.getGlobalConfig();
        
        // プロジェクト設定を取得
        const projectConfig = await this.getProjectConfig();
        
        // 環境変数の影響を含む最終的な設定
        const configLoader = new ConfigLoader();
        const finalConfig = configLoader.loadConfig();
        
        res.json({
          global: globalConfig,
          project: projectConfig,
          final: finalConfig,
          environment: this.getEnvironmentVariables()
        });
      } catch (error) {
        this.logger?.error('設定取得エラー:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // グローバル設定を更新
    this.router.put('/global', async (req, res) => {
      try {
        const updates = req.body;
        
        // メンテナンスモードを有効化
        const maintenance = new MaintenanceMode();
        await maintenance.enable('Configuration update in progress');
        
        // グローバル設定を更新
        await GlobalConfig.update(updates);
        
        res.json({ 
          success: true, 
          message: 'Global configuration updated successfully',
          maintenanceMode: true
        });
      } catch (error) {
        this.logger?.error('グローバル設定更新エラー:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // プロジェクト設定を更新
    this.router.put('/project', async (req, res) => {
      try {
        const updates = req.body;
        const configPath = path.join(process.cwd(), '.poppo', 'config.json');
        
        // 既存の設定を読み込み
        let config = {};
        try {
          const content = await fs.readFile(configPath, 'utf-8');
          config = JSON.parse(content);
        } catch (error) {
          // ファイルが存在しない場合は新規作成
        }
        
        // 設定をマージ
        const updatedConfig = this.deepMerge(config, updates);
        
        // ディレクトリを作成
        await fs.mkdir(path.dirname(configPath), { recursive: true });
        
        // 設定を保存
        await fs.writeFile(configPath, JSON.stringify(updatedConfig, null, 2));
        
        res.json({ 
          success: true, 
          message: 'Project configuration updated successfully'
        });
      } catch (error) {
        this.logger?.error('プロジェクト設定更新エラー:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // 設定のバリデーション
    this.router.post('/validate', async (req, res) => {
      try {
        const config = req.body;
        const errors = this.validateConfig(config);
        
        if (errors.length > 0) {
          res.status(400).json({ valid: false, errors });
        } else {
          res.json({ valid: true });
        }
      } catch (error) {
        this.logger?.error('設定検証エラー:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // 設定のエクスポート
    this.router.get('/export', async (req, res) => {
      try {
        const configLoader = new ConfigLoader();
        const config = configLoader.loadConfig();
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="poppobuilder-config.json"');
        res.send(JSON.stringify(config, null, 2));
      } catch (error) {
        this.logger?.error('設定エクスポートエラー:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // 設定のインポート
    this.router.post('/import', express.json({ limit: '10mb' }), async (req, res) => {
      try {
        const config = req.body;
        const target = req.query.target || 'project'; // 'global' or 'project'
        
        // バリデーション
        const errors = this.validateConfig(config);
        if (errors.length > 0) {
          return res.status(400).json({ valid: false, errors });
        }
        
        // メンテナンスモードを有効化
        const maintenance = new MaintenanceMode();
        await maintenance.enable('Configuration import in progress');
        
        if (target === 'global') {
          await GlobalConfig.update(config);
        } else {
          const configPath = path.join(process.cwd(), '.poppo', 'config.json');
          await fs.mkdir(path.dirname(configPath), { recursive: true });
          await fs.writeFile(configPath, JSON.stringify(config, null, 2));
        }
        
        res.json({ 
          success: true, 
          message: `Configuration imported to ${target} successfully`,
          maintenanceMode: true
        });
      } catch (error) {
        this.logger?.error('設定インポートエラー:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // メンテナンスモードの状態
    this.router.get('/maintenance', async (req, res) => {
      try {
        const maintenance = new MaintenanceMode();
        const status = await maintenance.getStatus();
        res.json(status);
      } catch (error) {
        this.logger?.error('メンテナンスモード確認エラー:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // メンテナンスモードの解除
    this.router.delete('/maintenance', async (req, res) => {
      try {
        const maintenance = new MaintenanceMode();
        await maintenance.disable();
        res.json({ success: true, message: 'Maintenance mode disabled' });
      } catch (error) {
        this.logger?.error('メンテナンスモード解除エラー:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // プロセスの再起動
    this.router.post('/restart', async (req, res) => {
      try {
        const graceful = req.body.graceful !== false;
        
        // 再起動スケジューラーを使用
        const RestartScheduler = require('../../../scripts/restart-scheduler');
        const scheduler = new RestartScheduler(this.logger);
        
        if (graceful) {
          await scheduler.scheduleGracefulRestart();
        } else {
          await scheduler.scheduleRestart();
        }
        
        res.json({ 
          success: true, 
          message: `${graceful ? 'Graceful' : 'Normal'} restart scheduled`
        });
      } catch (error) {
        this.logger?.error('再起動エラー:', error);
        res.status(500).json({ error: error.message });
      }
    });
  }

  async getGlobalConfig() {
    try {
      await GlobalConfig.initialize();
      return GlobalConfig.config;
    } catch (error) {
      return null;
    }
  }

  async getProjectConfig() {
    try {
      const configPath = path.join(process.cwd(), '.poppo', 'config.json');
      const content = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  getEnvironmentVariables() {
    const poppoEnvVars = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('POPPO_') || key === 'GITHUB_TOKEN') {
        // 機密情報をマスク
        if (key.includes('TOKEN') || key.includes('KEY') || key.includes('SECRET')) {
          poppoEnvVars[key] = value ? '***' : undefined;
        } else {
          poppoEnvVars[key] = value;
        }
      }
    }
    return poppoEnvVars;
  }

  validateConfig(config) {
    const errors = [];
    
    // 必須フィールドのチェック
    if (config.github && !config.github.owner) {
      errors.push('github.owner is required');
    }
    if (config.github && !config.github.repo) {
      errors.push('github.repo is required');
    }
    
    // 数値の範囲チェック
    if (config.claude?.maxConcurrent !== undefined) {
      const value = config.claude.maxConcurrent;
      if (typeof value !== 'number' || value < 1 || value > 10) {
        errors.push('claude.maxConcurrent must be between 1 and 10');
      }
    }
    
    if (config.claude?.timeout !== undefined) {
      const value = config.claude.timeout;
      if (typeof value !== 'number' || value < 1000) {
        errors.push('claude.timeout must be at least 1000ms');
      }
    }
    
    // ストレージパスの検証
    if (config.storage?.baseDir) {
      const invalidChars = /[<>:"|?*]/;
      if (invalidChars.test(config.storage.baseDir)) {
        errors.push('storage.baseDir contains invalid characters');
      }
    }
    
    return errors;
  }

  deepMerge(target, source) {
    const output = { ...target };
    
    for (const key in source) {
      if (source[key] instanceof Object && key in target) {
        output[key] = this.deepMerge(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    }
    
    return output;
  }

  getRouter() {
    return this.router;
  }
}

module.exports = ConfigAPI;