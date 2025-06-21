/**
 * CCSP通知ハンドラー
 * 
 * Issue #142: CCSPの高度な制御機能とモニタリング実装
 * システムイベントの通知機能を提供
 */

const { spawn } = require('child_process');
const Logger = require('../../src/logger');
const fs = require('fs').promises;
const path = require('path');

class NotificationHandler {
  constructor(options = {}) {
    this.logger = new Logger('NotificationHandler');
    this.config = {
      enableGitHub: options.enableGitHub !== false,
      enableSlack: options.enableSlack || false,
      enableEmail: options.enableEmail || false,
      githubRepo: options.githubRepo || 'medamap/PoppoBuilderSuite',
      slackWebhook: options.slackWebhook,
      emailConfig: options.emailConfig,
      ...options
    };
    
    // 通知統計
    this.stats = {
      totalNotifications: 0,
      successCount: 0,
      errorCount: 0,
      byType: {},
      byChannel: {}
    };
    
    // 通知履歴（最近100件）
    this.notificationHistory = [];
    this.maxHistorySize = 100;
    
    this.logger.info('Notification Handler initialized', {
      enableGitHub: this.config.enableGitHub,
      enableSlack: this.config.enableSlack,
      enableEmail: this.config.enableEmail
    });
  }
  
  /**
   * 通知の送信
   * @param {Object} notification - 通知内容
   */
  async notify(notification) {
    const {
      type,
      title,
      message,
      severity = 'info',
      data = {},
      channels = []
    } = notification;
    
    this.stats.totalNotifications++;
    if (!this.stats.byType[type]) {
      this.stats.byType[type] = 0;
    }
    this.stats.byType[type]++;
    
    const notificationId = `notify-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    this.logger.info('Sending notification', {
      notificationId,
      type,
      severity,
      channels: channels.length > 0 ? channels : 'auto'
    });
    
    // 通知履歴に追加
    this.addToHistory({
      id: notificationId,
      type,
      title,
      message,
      severity,
      data,
      timestamp: new Date().toISOString(),
      status: 'pending'
    });
    
    const results = [];
    
    try {
      // チャンネルが指定されていない場合、自動選択
      const targetChannels = channels.length > 0 ? channels : this.selectChannels(type, severity);
      
      // 各チャンネルに送信
      for (const channel of targetChannels) {
        try {
          const result = await this.sendToChannel(channel, {
            ...notification,
            notificationId
          });
          
          results.push({ channel, success: true, result });
          
          if (!this.stats.byChannel[channel]) {
            this.stats.byChannel[channel] = { success: 0, error: 0 };
          }
          this.stats.byChannel[channel].success++;
          
        } catch (error) {
          this.logger.error(`Failed to send notification to ${channel}`, {
            notificationId,
            error: error.message
          });
          
          results.push({ channel, success: false, error: error.message });
          
          if (!this.stats.byChannel[channel]) {
            this.stats.byChannel[channel] = { success: 0, error: 0 };
          }
          this.stats.byChannel[channel].error++;
        }
      }
      
      // 成功した送信があるかチェック
      const hasSuccess = results.some(r => r.success);
      
      if (hasSuccess) {
        this.stats.successCount++;
        this.updateHistoryStatus(notificationId, 'sent');
      } else {
        this.stats.errorCount++;
        this.updateHistoryStatus(notificationId, 'failed');
      }
      
      this.logger.info('Notification sending completed', {
        notificationId,
        results: results.map(r => ({ channel: r.channel, success: r.success }))
      });
      
      return {
        notificationId,
        success: hasSuccess,
        results
      };
      
    } catch (error) {
      this.stats.errorCount++;
      this.updateHistoryStatus(notificationId, 'error');
      
      this.logger.error('Notification sending failed', {
        notificationId,
        error: error.message
      });
      
      throw error;
    }
  }
  
  /**
   * チャンネルの自動選択
   */
  selectChannels(type, severity) {
    const channels = [];
    
    // 重要度に基づいてチャンネルを選択
    switch (severity) {
      case 'critical':
      case 'emergency':
        if (this.config.enableGitHub) channels.push('github');
        if (this.config.enableSlack) channels.push('slack');
        if (this.config.enableEmail) channels.push('email');
        break;
        
      case 'error':
      case 'warning':
        if (this.config.enableGitHub) channels.push('github');
        if (this.config.enableSlack) channels.push('slack');
        break;
        
      default:
        if (this.config.enableGitHub) channels.push('github');
        break;
    }
    
    // 通知タイプに基づく調整
    if (type === 'session_timeout' || type === 'emergency_stop') {
      if (this.config.enableGitHub && !channels.includes('github')) {
        channels.push('github');
      }
    }
    
    return channels.length > 0 ? channels : ['log']; // 最低限ログには出力
  }
  
  /**
   * 特定チャンネルへの送信
   */
  async sendToChannel(channel, notification) {
    switch (channel) {
      case 'github':
        return await this.sendToGitHub(notification);
      case 'slack':
        return await this.sendToSlack(notification);
      case 'email':
        return await this.sendToEmail(notification);
      case 'log':
        return this.sendToLog(notification);
      default:
        throw new Error(`Unknown notification channel: ${channel}`);
    }
  }
  
  /**
   * GitHub Issue作成
   */
  async sendToGitHub(notification) {
    const {
      type,
      title,
      message,
      severity,
      data,
      notificationId
    } = notification;
    
    // GitHub Issue のタイトルと本文を構築
    const issueTitle = title || this.generateGitHubTitle(type, severity);
    const issueBody = this.generateGitHubBody(message, data, notificationId);
    const labels = this.generateGitHubLabels(type, severity);
    
    return new Promise((resolve, reject) => {
      // gh CLI を使用してIssueを作成
      const args = [
        'issue', 'create',
        '--repo', this.config.githubRepo,
        '--title', issueTitle,
        '--body', issueBody,
        '--label', labels.join(',')
      ];
      
      this.logger.debug('Creating GitHub issue', {
        notificationId,
        title: issueTitle,
        labels
      });
      
      const gh = spawn('gh', args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      gh.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      gh.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      gh.on('close', (code) => {
        if (code === 0) {
          const issueUrl = stdout.trim();
          this.logger.info('GitHub issue created', {
            notificationId,
            issueUrl
          });
          resolve({ issueUrl });
        } else {
          const error = stderr || `GitHub CLI exited with code ${code}`;
          reject(new Error(error));
        }
      });
      
      gh.on('error', (error) => {
        reject(new Error(`Failed to start gh CLI: ${error.message}`));
      });
    });
  }
  
  /**
   * GitHub Issue タイトル生成
   */
  generateGitHubTitle(type, severity) {
    const severityEmoji = {
      emergency: '🚨',
      critical: '💥', 
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };
    
    const typeLabels = {
      session_timeout: 'セッションタイムアウト',
      emergency_stop: '緊急停止',
      rate_limit: 'レート制限',
      usage_alert: '使用量アラート',
      error_threshold: 'エラー閾値超過',
      queue_overflow: 'キューオーバーフロー'
    };
    
    const emoji = severityEmoji[severity] || 'ℹ️';
    const typeLabel = typeLabels[type] || type;
    
    return `${emoji} [CCSP] ${typeLabel}`;
  }
  
  /**
   * GitHub Issue 本文生成
   */
  generateGitHubBody(message, data, notificationId) {
    const timestamp = new Date().toISOString();
    
    let body = `## 通知内容\n\n${message}\n\n`;
    
    body += `## 詳細情報\n\n`;
    body += `- **通知ID**: ${notificationId}\n`;
    body += `- **発生時刻**: ${timestamp}\n`;
    
    if (data && Object.keys(data).length > 0) {
      body += `\n## 追加データ\n\n`;
      body += '```json\n';
      body += JSON.stringify(data, null, 2);
      body += '\n```\n';
    }
    
    body += `\n## 対応方法\n\n`;
    body += this.generateRecommendations(data.type || 'unknown');
    
    body += `\n---\n*この通知はCCSPエージェントにより自動生成されました*`;
    
    return body;
  }
  
  /**
   * GitHub ラベル生成
   */
  generateGitHubLabels(type, severity) {
    const labels = ['ccsp', 'automated'];
    
    // 重要度ラベル
    switch (severity) {
      case 'emergency':
      case 'critical':
        labels.push('urgent');
        break;
      case 'error':
        labels.push('bug');
        break;
      case 'warning':
        labels.push('enhancement');
        break;
    }
    
    // タイプ別ラベル
    switch (type) {
      case 'session_timeout':
        labels.push('session-timeout', 'requires-manual-action');
        break;
      case 'emergency_stop':
        labels.push('emergency-stop', 'requires-manual-action');
        break;
      case 'rate_limit':
        labels.push('rate-limit');
        break;
      case 'usage_alert':
        labels.push('monitoring');
        break;
    }
    
    return labels;
  }
  
  /**
   * 推奨対応方法の生成
   */
  generateRecommendations(type) {
    switch (type) {
      case 'session_timeout':
        return `1. \`claude login\`を実行してセッションを再開してください\n2. このIssueをクローズしてください\n3. CCSPが自動的に処理を再開します`;
      
      case 'emergency_stop':
        return `1. 原因を調査してください\n2. 必要に応じて設定を調整してください\n3. CCSPエージェントを再起動してください`;
      
      case 'rate_limit':
        return `1. レート制限が解除されるまで待機してください\n2. 必要に応じてスロットリング設定を調整してください`;
      
      case 'usage_alert':
        return `1. 使用量パターンを確認してください\n2. 必要に応じて処理頻度を調整してください`;
      
      default:
        return `1. ログを確認して詳細を調査してください\n2. 必要に応じてCCSPの設定を調整してください`;
    }
  }
  
  /**
   * Slack通知（将来の実装用）
   */
  async sendToSlack(notification) {
    // TODO: Slack Webhook実装
    throw new Error('Slack notifications not implemented yet');
  }
  
  /**
   * Email通知（将来の実装用）
   */
  async sendToEmail(notification) {
    // TODO: Email実装
    throw new Error('Email notifications not implemented yet');
  }
  
  /**
   * ログ出力
   */
  sendToLog(notification) {
    const {
      type,
      title,
      message,
      severity,
      notificationId
    } = notification;
    
    const logLevel = severity === 'error' || severity === 'critical' ? 'error' : 
                    severity === 'warning' ? 'warn' : 'info';
    
    this.logger[logLevel]('Notification sent to log', {
      notificationId,
      type,
      title,
      message
    });
    
    return { logged: true };
  }
  
  /**
   * 通知履歴への追加
   */
  addToHistory(notification) {
    this.notificationHistory.unshift(notification);
    
    // 履歴サイズの制限
    if (this.notificationHistory.length > this.maxHistorySize) {
      this.notificationHistory = this.notificationHistory.slice(0, this.maxHistorySize);
    }
  }
  
  /**
   * 通知状態の更新
   */
  updateHistoryStatus(notificationId, status) {
    const notification = this.notificationHistory.find(n => n.id === notificationId);
    if (notification) {
      notification.status = status;
      notification.updatedAt = new Date().toISOString();
    }
  }
  
  /**
   * 通知履歴の取得
   */
  getHistory(limit = 50) {
    return this.notificationHistory.slice(0, limit);
  }
  
  /**
   * 統計情報の取得
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalNotifications > 0 ? 
        (this.stats.successCount / this.stats.totalNotifications) : 0,
      errorRate: this.stats.totalNotifications > 0 ? 
        (this.stats.errorCount / this.stats.totalNotifications) : 0
    };
  }
  
  /**
   * 統計情報のリセット
   */
  resetStats() {
    this.stats = {
      totalNotifications: 0,
      successCount: 0,
      errorCount: 0,
      byType: {},
      byChannel: {}
    };
    
    this.logger.info('Notification statistics reset');
  }
  
  /**
   * 設定の更新
   */
  updateConfig(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig
    };
    
    this.logger.info('Notification config updated', newConfig);
  }
  
  /**
   * クリーンアップ
   */
  async shutdown() {
    this.logger.info('Notification Handler shutting down', this.getStats());
  }
}

module.exports = NotificationHandler;