const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * プロセス管理API
 * - 個別プロセスの停止
 * - 全プロセスの停止
 */
class ProcessAPI {
  constructor(stateManager, independentProcessManager, logger) {
    this.stateManager = stateManager;
    this.independentProcessManager = independentProcessManager;
    this.logger = logger;
    this.router = express.Router();
    
    this.setupRoutes();
  }
  
  /**
   * APIルートの設定
   */
  setupRoutes() {
    // 個別プロセス停止API
    this.router.post('/process/:taskId/stop', express.json(), async (req, res) => {
      const { taskId } = req.params;
      const { force = false } = req.body;
      
      try {
        this.logger?.info(`プロセス停止リクエスト: ${taskId} (force: ${force})`);
        
        // 実行中タスクの確認
        const runningTasks = this.independentProcessManager.getRunningTasks();
        const task = runningTasks[taskId];
        
        if (!task) {
          return res.status(404).json({
            success: false,
            error: `タスク ${taskId} が見つかりません`
          });
        }
        
        // PIDファイルの確認
        const pidFile = path.join(this.independentProcessManager.tempDir, `task-${taskId}.pid`);
        if (!fs.existsSync(pidFile)) {
          return res.status(404).json({
            success: false,
            error: `タスク ${taskId} のPIDファイルが見つかりません`
          });
        }
        
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8'));
        
        // プロセスの停止
        const result = await this.stopProcess(pid, taskId, force);
        
        if (result.success) {
          // タスクを実行中リストから削除
          this.independentProcessManager.removeTask(taskId);
          
          // ステータスを更新
          this.independentProcessManager.updateTaskStatus(taskId, 'stopped', 'ダッシュボードから停止されました');
          
          this.logger?.info(`タスク ${taskId} (PID: ${pid}) を停止しました`);
          
          res.json({
            success: true,
            message: `タスク ${taskId} を停止しました`,
            taskId: taskId,
            pid: pid
          });
        } else {
          res.status(500).json({
            success: false,
            error: result.error
          });
        }
      } catch (error) {
        this.logger?.error(`プロセス停止エラー (${taskId}):`, error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });
    
    // 全プロセス停止API
    this.router.post('/process/stop-all', express.json(), async (req, res) => {
      const { confirm = false, force = false } = req.body;
      
      // 確認フラグのチェック
      if (!confirm) {
        return res.status(400).json({
          success: false,
          error: '確認が必要です。confirm: true を設定してください。'
        });
      }
      
      try {
        this.logger?.info(`全プロセス停止リクエスト (force: ${force})`);
        
        // 実行中タスクの取得
        const runningTasks = this.independentProcessManager.getRunningTasks();
        const taskIds = Object.keys(runningTasks);
        
        if (taskIds.length === 0) {
          return res.json({
            success: true,
            message: '実行中のタスクはありません',
            stoppedCount: 0
          });
        }
        
        const results = {
          success: [],
          failed: []
        };
        
        // 各タスクを順番に停止（依存関係を考慮）
        for (const taskId of taskIds) {
          const task = runningTasks[taskId];
          const pidFile = path.join(this.independentProcessManager.tempDir, `task-${taskId}.pid`);
          
          if (fs.existsSync(pidFile)) {
            const pid = parseInt(fs.readFileSync(pidFile, 'utf8'));
            const result = await this.stopProcess(pid, taskId, force);
            
            if (result.success) {
              results.success.push({ taskId, pid });
              this.independentProcessManager.removeTask(taskId);
              this.independentProcessManager.updateTaskStatus(taskId, 'stopped', '全プロセス停止により停止されました');
            } else {
              results.failed.push({ taskId, error: result.error });
            }
          } else {
            results.failed.push({ taskId, error: 'PIDファイルが見つかりません' });
          }
        }
        
        this.logger?.info(`全プロセス停止完了: 成功=${results.success.length}, 失敗=${results.failed.length}`);
        
        res.json({
          success: true,
          message: `${results.success.length}個のタスクを停止しました`,
          stoppedCount: results.success.length,
          failedCount: results.failed.length,
          results: results
        });
      } catch (error) {
        this.logger?.error('全プロセス停止エラー:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });
  }
  
  /**
   * プロセスを安全に停止
   * @param {number} pid プロセスID
   * @param {string} taskId タスクID
   * @param {boolean} force 強制終了フラグ
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async stopProcess(pid, taskId, force = false) {
    try {
      // プロセスの存在確認
      if (!this.isProcessRunning(pid)) {
        return { success: false, error: 'プロセスが既に停止しています' };
      }
      
      // まずSIGTERMを送信
      process.kill(pid, 'SIGTERM');
      
      // 5秒待機してプロセスが終了するか確認
      let killed = false;
      for (let i = 0; i < 50; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!this.isProcessRunning(pid)) {
          killed = true;
          break;
        }
      }
      
      // 強制終了が必要な場合
      if (!killed && force) {
        process.kill(pid, 'SIGKILL');
        // さらに2秒待機
        for (let i = 0; i < 20; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          if (!this.isProcessRunning(pid)) {
            killed = true;
            break;
          }
        }
      }
      
      if (!killed) {
        return { 
          success: false, 
          error: 'プロセスが終了しませんでした。force: true で強制終了できます。' 
        };
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  /**
   * プロセスが実行中かチェック
   * @param {number} pid プロセスID
   * @returns {boolean}
   */
  isProcessRunning(pid) {
    try {
      process.kill(pid, 0); // シグナル0は存在チェック
      return true;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Expressルーターを取得
   * @returns {express.Router}
   */
  getRouter() {
    return this.router;
  }
}

module.exports = ProcessAPI;