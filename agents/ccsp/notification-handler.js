/**
 * 通知処理モジュール
 * 
 * セッションタイムアウト時のGitHub Issue作成と管理を担当
 */

const { spawn } = require('child_process');

class NotificationHandler {
  constructor(redis, logger) {
    this.redis = redis;
    this.logger = logger;
    
    // セッションタイムアウト用のIssue情報
    this.sessionTimeoutIssue = {
      number: null,
      title: '🚨 [緊急] Claude ログインセッションタイムアウト',
      labels: ['urgent', 'session-timeout', 'requires-manual-action']
    };
    
    // 通知キュー
    this.notificationQueue = 'ccsp:notifications';
    this.processing = false;
  }
  
  async startProcessing() {
    if (this.processing) return;
    
    this.processing = true;
    this.logger.info('[NotificationHandler] Started processing notifications');
    
    while (this.processing) {
      try {
        // ブロッキングでキューから取得（1秒タイムアウト）
        const result = await this.redis.blpop(this.notificationQueue, 1);
        
        if (result) {
          const [, data] = result;
          const notification = JSON.parse(data);
          await this.handleNotification(notification);
        }
      } catch (error) {
        this.logger.error('[NotificationHandler] Error processing notification:', error);
      }
    }
  }
  
  async handleNotification(notification) {
    this.logger.info('[NotificationHandler] Processing notification:', notification.type);
    
    switch (notification.type) {
      case 'session-timeout':
        await this.handleSessionTimeout(notification);
        break;
        
      case 'check-issue':
        await this.checkIssueStatus(notification);
        break;
        
      case 'update-issue':
        await this.updateIssue(notification);
        break;
        
      case 'reopen-issue':
        await this.reopenIssue(notification);
        break;
        
      default:
        this.logger.warn('[NotificationHandler] Unknown notification type:', notification.type);
    }
  }
  
  async handleSessionTimeout(notification) {
    try {
      // 既存のIssueを確認
      const existingIssue = await this.findExistingIssue();
      
      if (existingIssue && existingIssue.state === 'open') {
        // 既存のオープンIssueにコメントを追加
        this.sessionTimeoutIssue.number = existingIssue.number;
        await this.addCommentToIssue(existingIssue.number, 
          '## 🔄 セッションタイムアウトが再度発生しました\n\n' + notification.message);
      } else if (existingIssue && existingIssue.state === 'closed') {
        // クローズされたIssueを再オープン
        this.sessionTimeoutIssue.number = existingIssue.number;
        await this.reopenIssue({ issueNumber: existingIssue.number });
      } else {
        // 新規Issue作成
        await this.createNewIssue(notification);
      }
      
      // Issue情報を保存
      await this.redis.set('ccsp:session:issue', JSON.stringify({
        number: this.sessionTimeoutIssue.number,
        createdAt: new Date().toISOString()
      }));
      
    } catch (error) {
      this.logger.error('[NotificationHandler] Failed to handle session timeout:', error);
    }
  }
  
  async findExistingIssue() {
    try {
      // ghコマンドで既存のIssueを検索
      const result = await this.executeGhCommand([
        'issue', 'list',
        '--repo', 'medamap/PoppoBuilderSuite',
        '--label', 'session-timeout',
        '--json', 'number,title,state',
        '--limit', '1'
      ]);
      
      if (result.success && result.output) {
        const issues = JSON.parse(result.output);
        return issues.length > 0 ? issues[0] : null;
      }
    } catch (error) {
      this.logger.error('[NotificationHandler] Failed to find existing issue:', error);
    }
    
    return null;
  }
  
  async createNewIssue(notification) {
    try {
      const result = await this.executeGhCommand([
        'issue', 'create',
        '--repo', 'medamap/PoppoBuilderSuite',
        '--title', this.sessionTimeoutIssue.title,
        '--body', notification.message,
        '--label', this.sessionTimeoutIssue.labels.join(',')
      ]);
      
      if (result.success && result.output) {
        // Issue番号を抽出（通常は URL が返される）
        const match = result.output.match(/\/(\d+)$/);
        if (match) {
          this.sessionTimeoutIssue.number = parseInt(match[1]);
          this.logger.info('[NotificationHandler] Created new issue #' + this.sessionTimeoutIssue.number);
        }
      }
    } catch (error) {
      this.logger.error('[NotificationHandler] Failed to create issue:', error);
    }
  }
  
  async checkIssueStatus(notification) {
    try {
      const result = await this.executeGhCommand([
        'issue', 'view',
        notification.issueNumber,
        '--repo', 'medamap/PoppoBuilderSuite',
        '--json', 'state,closed'
      ]);
      
      if (result.success && result.output) {
        const issue = JSON.parse(result.output);
        const response = {
          closed: issue.state === 'closed' || issue.closed,
          state: issue.state
        };
        
        // レスポンスを保存
        await this.redis.set(
          `ccsp:response:${notification.requestId}`,
          JSON.stringify(response),
          'EX', 60  // 1分で期限切れ
        );
      }
    } catch (error) {
      this.logger.error('[NotificationHandler] Failed to check issue status:', error);
    }
  }
  
  async updateIssue(notification) {
    try {
      await this.addCommentToIssue(notification.issueNumber, notification.message);
    } catch (error) {
      this.logger.error('[NotificationHandler] Failed to update issue:', error);
    }
  }
  
  async reopenIssue(notification) {
    try {
      const result = await this.executeGhCommand([
        'issue', 'reopen',
        notification.issueNumber,
        '--repo', 'medamap/PoppoBuilderSuite'
      ]);
      
      if (result.success) {
        this.logger.info('[NotificationHandler] Reopened issue #' + notification.issueNumber);
        
        if (notification.message) {
          await this.addCommentToIssue(notification.issueNumber, notification.message);
        }
      }
    } catch (error) {
      this.logger.error('[NotificationHandler] Failed to reopen issue:', error);
    }
  }
  
  async addCommentToIssue(issueNumber, message) {
    try {
      const result = await this.executeGhCommand([
        'issue', 'comment',
        issueNumber,
        '--repo', 'medamap/PoppoBuilderSuite',
        '--body', message
      ]);
      
      if (result.success) {
        this.logger.info('[NotificationHandler] Added comment to issue #' + issueNumber);
      }
    } catch (error) {
      this.logger.error('[NotificationHandler] Failed to add comment:', error);
    }
  }
  
  async executeGhCommand(args) {
    return new Promise((resolve) => {
      const process = spawn('gh', args);
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      process.on('exit', (code) => {
        if (code === 0) {
          resolve({ success: true, output: stdout.trim() });
        } else {
          resolve({ success: false, error: stderr || stdout });
        }
      });
      
      process.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });
    });
  }
  
  stopProcessing() {
    this.processing = false;
    this.logger.info('[NotificationHandler] Stopped processing notifications');
  }
}

module.exports = NotificationHandler;