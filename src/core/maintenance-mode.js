/**
 * メンテナンスモード管理
 * システムの設定変更時に新規プロセスの起動をブロック
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class MaintenanceMode {
  constructor() {
    this.lockPath = path.join(os.homedir(), '.poppobuilder', 'maintenance.lock');
  }

  /**
   * メンテナンスモードの開始
   * @param {Object} options - メンテナンスオプション
   * @param {string} options.reason - メンテナンスの理由
   * @param {string} options.expectedDuration - 予想所要時間
   * @param {Array} options.allowedProcesses - 起動を許可するプロセス
   */
  async start(options = {}) {
    const maintenance = {
      enabled: true,
      reason: options.reason || 'System maintenance',
      startedAt: new Date().toISOString(),
      expectedDuration: options.expectedDuration || '10m',
      allowedProcesses: options.allowedProcesses || ['dashboard', 'monitor'],
      pid: process.pid,
      hostname: os.hostname()
    };

    // ディレクトリ作成
    await fs.mkdir(path.dirname(this.lockPath), { recursive: true });
    
    // ロックファイル作成
    await fs.writeFile(this.lockPath, JSON.stringify(maintenance, null, 2));
    
    console.log('🚧 メンテナンスモードを開始しました');
    console.log(`   理由: ${maintenance.reason}`);
    console.log(`   予想時間: ${maintenance.expectedDuration}`);
    
    return maintenance;
  }

  /**
   * メンテナンスモードの終了
   */
  async stop() {
    try {
      await fs.unlink(this.lockPath);
      console.log('✅ メンテナンスモードを終了しました');
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('ℹ️  メンテナンスモードは既に終了しています');
        return false;
      }
      throw error;
    }
  }

  /**
   * メンテナンスモードのチェック
   * @param {string} processName - チェックするプロセス名
   * @returns {Object|null} メンテナンス情報またはnull
   */
  async check(processName = null) {
    try {
      const data = await fs.readFile(this.lockPath, 'utf8');
      const maintenance = JSON.parse(data);
      
      // メンテナンスモードが有効でない場合
      if (!maintenance.enabled) {
        return null;
      }
      
      // 許可されたプロセスの場合
      if (processName && maintenance.allowedProcesses?.includes(processName)) {
        return null;
      }
      
      return maintenance;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * メンテナンスモードの状態取得
   */
  async status() {
    try {
      const data = await fs.readFile(this.lockPath, 'utf8');
      const maintenance = JSON.parse(data);
      
      // 経過時間の計算
      const startTime = new Date(maintenance.startedAt);
      const now = new Date();
      const elapsed = Math.floor((now - startTime) / 1000);
      const elapsedMinutes = Math.floor(elapsed / 60);
      const elapsedSeconds = elapsed % 60;
      
      return {
        ...maintenance,
        elapsed: `${elapsedMinutes}m ${elapsedSeconds}s`,
        elapsedSeconds: elapsed
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * プロセス起動時のチェック（スタティックメソッド）
   * @param {string} processName - プロセス名
   * @param {boolean} exitOnMaintenance - メンテナンス時に終了するか
   */
  static async checkAndBlock(processName = null, exitOnMaintenance = true) {
    const maintenance = new MaintenanceMode();
    const status = await maintenance.check(processName);
    
    if (status) {
      console.log('🚧 システムはメンテナンスモード中です');
      console.log(`   理由: ${status.reason}`);
      console.log(`   開始時刻: ${status.startedAt}`);
      console.log(`   予想時間: ${status.expectedDuration}`);
      
      if (exitOnMaintenance) {
        console.log('❌ プロセスを終了します');
        process.exit(0);
      }
      
      return true;
    }
    
    return false;
  }

  /**
   * メンテナンスモードの延長
   * @param {string} additionalDuration - 追加時間
   */
  async extend(additionalDuration) {
    const status = await this.status();
    if (!status) {
      throw new Error('メンテナンスモードが有効ではありません');
    }
    
    status.expectedDuration = this.addDuration(status.expectedDuration, additionalDuration);
    await fs.writeFile(this.lockPath, JSON.stringify(status, null, 2));
    
    console.log(`⏱️  メンテナンス時間を延長しました: ${status.expectedDuration}`);
    return status;
  }

  /**
   * 時間の加算（簡易実装）
   */
  addDuration(current, additional) {
    const parseTime = (str) => {
      const match = str.match(/(\d+)([mh])/);
      if (!match) return 0;
      const [, value, unit] = match;
      return unit === 'h' ? parseInt(value) * 60 : parseInt(value);
    };
    
    const currentMinutes = parseTime(current);
    const additionalMinutes = parseTime(additional);
    const totalMinutes = currentMinutes + additionalMinutes;
    
    if (totalMinutes >= 60) {
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    
    return `${totalMinutes}m`;
  }

  /**
   * WebSocketでの通知用メッセージ生成
   */
  getNotificationMessage(action = 'started') {
    const messages = {
      started: {
        type: 'maintenance-started',
        title: 'メンテナンスモード開始',
        message: 'システムはメンテナンスモードに入りました',
        level: 'warning'
      },
      stopped: {
        type: 'maintenance-stopped',
        title: 'メンテナンスモード終了',
        message: 'システムは通常稼働に戻りました',
        level: 'success'
      },
      extended: {
        type: 'maintenance-extended',
        title: 'メンテナンス時間延長',
        message: 'メンテナンス時間が延長されました',
        level: 'info'
      }
    };
    
    return messages[action] || messages.started;
  }
}

module.exports = MaintenanceMode;