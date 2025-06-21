const Logger = require('./logger');

/**
 * アラートマネージャー
 * ヘルスチェックのアラートを管理し、通知を送信
 */
class AlertManager {
  constructor(notificationManager) {
    this.notificationManager = notificationManager;
    this.logger = new Logger('AlertManager');
    
    // アラート履歴（スロットリング用）
    this.alertHistory = new Map();
    
    // アラートルール
    this.rules = {
      throttle: 300000, // デフォルト5分
      aggregation: 60000, // 1分間の集約ウィンドウ
      maxAlertsPerWindow: 10 // ウィンドウあたりの最大アラート数
    };
    
    // 保留中のアラート（集約用）
    this.pendingAlerts = [];
    this.aggregationTimer = null;
    
    // エスカレーション設定
    this.escalation = {
      enabled: true,
      levels: [
        { severity: 'info', channels: ['log'] },
        { severity: 'warning', channels: ['log', 'discord'] },
        { severity: 'critical', channels: ['log', 'discord', 'pushover'] }
      ]
    };
  }
  
  /**
   * アラートの送信
   */
  async sendAlert(alert) {
    try {
      // アラートの正規化
      alert = this.normalizeAlert(alert);
      
      // スロットリングチェック
      if (this.shouldThrottle(alert)) {
        this.logger.debug(`アラート「${alert.type}」はスロットリングされました`);
        return { sent: false, reason: 'throttled' };
      }
      
      // 集約対象かチェック
      if (this.shouldAggregate(alert)) {
        this.addToAggregation(alert);
        return { sent: false, reason: 'aggregated' };
      }
      
      // 即座に送信
      return await this.dispatchAlert(alert);
      
    } catch (error) {
      this.logger.error('アラート送信エラー:', error);
      return { sent: false, error: error.message };
    }
  }
  
  /**
   * アラートの正規化
   */
  normalizeAlert(alert) {
    return {
      id: `${alert.type}_${Date.now()}`,
      type: alert.type || 'unknown',
      severity: alert.severity || 'info',
      title: alert.title || 'システムアラート',
      message: alert.message || '',
      details: alert.details || {},
      timestamp: new Date().toISOString(),
      source: 'health-check'
    };
  }
  
  /**
   * スロットリングのチェック
   */
  shouldThrottle(alert) {
    const key = `${alert.type}_${alert.severity}`;
    const lastSent = this.alertHistory.get(key);
    
    if (!lastSent) {
      return false;
    }
    
    const timeSinceLastAlert = Date.now() - lastSent;
    const throttleTime = alert.throttle || this.rules.throttle;
    
    return timeSinceLastAlert < throttleTime;
  }
  
  /**
   * 集約対象かチェック
   */
  shouldAggregate(alert) {
    // criticalアラートは集約しない
    if (alert.severity === 'critical') {
      return false;
    }
    
    // 同じタイプのアラートが短期間に複数ある場合は集約
    const recentAlerts = this.pendingAlerts.filter(
      a => a.type === alert.type && 
      Date.now() - new Date(a.timestamp).getTime() < this.rules.aggregation
    );
    
    return recentAlerts.length > 0;
  }
  
  /**
   * アラートを集約リストに追加
   */
  addToAggregation(alert) {
    this.pendingAlerts.push(alert);
    
    // 集約タイマーが動いていない場合は開始
    if (!this.aggregationTimer) {
      this.aggregationTimer = setTimeout(() => {
        this.flushAggregatedAlerts();
      }, this.rules.aggregation);
    }
  }
  
  /**
   * 集約されたアラートを送信
   */
  async flushAggregatedAlerts() {
    if (this.pendingAlerts.length === 0) {
      this.aggregationTimer = null;
      return;
    }
    
    // タイプ別にグループ化
    const grouped = this.groupAlertsByType(this.pendingAlerts);
    
    // グループごとに集約アラートを作成
    for (const [type, alerts] of Object.entries(grouped)) {
      const aggregatedAlert = this.createAggregatedAlert(type, alerts);
      await this.dispatchAlert(aggregatedAlert);
    }
    
    // クリア
    this.pendingAlerts = [];
    this.aggregationTimer = null;
  }
  
  /**
   * アラートをタイプ別にグループ化
   */
  groupAlertsByType(alerts) {
    const grouped = {};
    
    for (const alert of alerts) {
      if (!grouped[alert.type]) {
        grouped[alert.type] = [];
      }
      grouped[alert.type].push(alert);
    }
    
    return grouped;
  }
  
  /**
   * 集約アラートの作成
   */
  createAggregatedAlert(type, alerts) {
    const count = alerts.length;
    const severities = alerts.map(a => a.severity);
    const maxSeverity = this.getMaxSeverity(severities);
    
    // 詳細情報の集約
    const details = {
      count,
      firstOccurrence: alerts[0].timestamp,
      lastOccurrence: alerts[alerts.length - 1].timestamp,
      samples: alerts.slice(0, 3).map(a => ({
        message: a.message,
        timestamp: a.timestamp
      }))
    };
    
    return {
      id: `aggregated_${type}_${Date.now()}`,
      type: `aggregated_${type}`,
      severity: maxSeverity,
      title: `${this.getAlertTypeLabel(type)} (${count}件)`,
      message: `${count}件の${this.getAlertTypeLabel(type)}が発生しました`,
      details,
      timestamp: new Date().toISOString(),
      source: 'health-check',
      aggregated: true
    };
  }
  
  /**
   * アラートの送信実行
   */
  async dispatchAlert(alert) {
    try {
      // エスカレーションレベルに基づいてチャンネルを決定
      const channels = this.getChannelsForSeverity(alert.severity);
      
      // 履歴を更新
      const key = `${alert.type}_${alert.severity}`;
      this.alertHistory.set(key, Date.now());
      
      // 通知マネージャーが利用可能な場合
      if (this.notificationManager) {
        const results = [];
        
        for (const channel of channels) {
          if (channel === 'log') {
            // ログ出力
            this.logAlert(alert);
            results.push({ channel: 'log', success: true });
          } else {
            // 外部通知
            try {
              await this.notificationManager.send(
                this.formatNotification(alert),
                channel
              );
              results.push({ channel, success: true });
            } catch (error) {
              this.logger.error(`${channel}への通知送信失敗:`, error);
              results.push({ channel, success: false, error: error.message });
            }
          }
        }
        
        return {
          sent: true,
          channels: results
        };
      } else {
        // 通知マネージャーがない場合はログのみ
        this.logAlert(alert);
        return {
          sent: true,
          channels: [{ channel: 'log', success: true }]
        };
      }
      
    } catch (error) {
      this.logger.error('アラート送信実行エラー:', error);
      return {
        sent: false,
        error: error.message
      };
    }
  }
  
  /**
   * 重要度に基づいてチャンネルを取得
   */
  getChannelsForSeverity(severity) {
    if (!this.escalation.enabled) {
      return ['log'];
    }
    
    const level = this.escalation.levels.find(l => l.severity === severity);
    return level ? level.channels : ['log'];
  }
  
  /**
   * 通知用にアラートをフォーマット
   */
  formatNotification(alert) {
    const emoji = {
      info: 'ℹ️',
      warning: '⚠️',
      critical: '🚨'
    };
    
    let message = `${emoji[alert.severity] || '📢'} **${alert.title}**\n\n`;
    message += `${alert.message}\n`;
    
    if (alert.details && Object.keys(alert.details).length > 0) {
      message += '\n**詳細:**\n';
      
      if (alert.aggregated && alert.details.samples) {
        message += `発生回数: ${alert.details.count}回\n`;
        message += `期間: ${alert.details.firstOccurrence} 〜 ${alert.details.lastOccurrence}\n`;
        message += '\nサンプル:\n';
        for (const sample of alert.details.samples) {
          message += `• ${sample.message} (${sample.timestamp})\n`;
        }
      } else {
        for (const [key, value] of Object.entries(alert.details)) {
          if (typeof value === 'object') {
            message += `${key}: ${JSON.stringify(value, null, 2)}\n`;
          } else {
            message += `${key}: ${value}\n`;
          }
        }
      }
    }
    
    message += `\n時刻: ${alert.timestamp}`;
    
    return {
      title: alert.title,
      message,
      priority: alert.severity === 'critical' ? 'high' : 
                alert.severity === 'warning' ? 'normal' : 'low'
    };
  }
  
  /**
   * アラートをログに記録
   */
  logAlert(alert) {
    const logMessage = `[${alert.severity.toUpperCase()}] ${alert.title}: ${alert.message}`;
    
    switch (alert.severity) {
      case 'critical':
        this.logger.error(logMessage, alert.details);
        break;
      case 'warning':
        this.logger.warn(logMessage, alert.details);
        break;
      default:
        this.logger.info(logMessage, alert.details);
    }
  }
  
  /**
   * 最大の重要度を取得
   */
  getMaxSeverity(severities) {
    const order = ['info', 'warning', 'critical'];
    let maxIndex = 0;
    
    for (const severity of severities) {
      const index = order.indexOf(severity);
      if (index > maxIndex) {
        maxIndex = index;
      }
    }
    
    return order[maxIndex];
  }
  
  /**
   * アラートタイプのラベルを取得
   */
  getAlertTypeLabel(type) {
    const labels = {
      health_status_change: '健全性ステータス変更',
      health_score_drop: '健全性スコア低下',
      memory_high: 'メモリ使用率上昇',
      disk_full: 'ディスク容量不足',
      process_unresponsive: 'プロセス無応答',
      api_error: 'API接続エラー',
      database_error: 'データベースエラー'
    };
    
    return labels[type] || type;
  }
  
  /**
   * アラート履歴のクリア
   */
  clearHistory() {
    this.alertHistory.clear();
    this.pendingAlerts = [];
    
    if (this.aggregationTimer) {
      clearTimeout(this.aggregationTimer);
      this.aggregationTimer = null;
    }
  }
  
  /**
   * 統計情報の取得
   */
  getStatistics() {
    const stats = {
      totalAlerts: 0,
      byType: {},
      bySeverity: {
        info: 0,
        warning: 0,
        critical: 0
      },
      recentAlerts: []
    };
    
    // 履歴から統計を集計
    for (const [key, timestamp] of this.alertHistory.entries()) {
      const [type, severity] = key.split('_');
      
      stats.totalAlerts++;
      stats.byType[type] = (stats.byType[type] || 0) + 1;
      stats.bySeverity[severity]++;
      
      // 最近のアラート（1時間以内）
      if (Date.now() - timestamp < 3600000) {
        stats.recentAlerts.push({
          type,
          severity,
          timestamp: new Date(timestamp).toISOString()
        });
      }
    }
    
    // 保留中のアラートも含める
    stats.pendingAlerts = this.pendingAlerts.length;
    
    return stats;
  }
}

module.exports = AlertManager;