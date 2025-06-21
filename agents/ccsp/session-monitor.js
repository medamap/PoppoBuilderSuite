/**
 * セッション監視モジュール
 * 
 * Claude CLIのセッション状態を監視し、タイムアウト時の自動復旧を管理
 */

const { spawn } = require('child_process');
const EventEmitter = require('events');

class SessionMonitor extends EventEmitter {
  constructor(redis, logger) {
    super();
    this.redis = redis;
    this.logger = logger;
    this.sessionBlocked = false;
    this.issueNumber = null;
    this.checkInterval = null;
    this.blockedRequests = new Map();
    
    // 状態管理キー
    this.stateKey = 'ccsp:session:state';
    this.issueKey = 'ccsp:session:issue';
    
    // 設定
    this.config = {
      issueCheckInterval: 5 * 60 * 1000,  // 5分
      initialCheckDelay: 30 * 1000,       // 30秒
      maxRetries: 3
    };
  }
  
  async initialize() {
    // 既存の状態を復元
    const savedState = await this.redis.get(this.stateKey);
    if (savedState) {
      const state = JSON.parse(savedState);
      this.sessionBlocked = state.blocked;
      this.issueNumber = state.issueNumber;
      
      if (this.sessionBlocked) {
        this.logger.warn('[SessionMonitor] Restored blocked state from previous session');
        this.startIssueMonitoring();
      }
    }
  }
  
  async handleSessionTimeout(error) {
    if (this.sessionBlocked) {
      this.logger.info('[SessionMonitor] Session already blocked');
      return;
    }
    
    this.logger.error('[SessionMonitor] Session timeout detected:', error);
    this.sessionBlocked = true;
    
    // 状態を保存
    await this.saveState();
    
    // セッションタイムアウトイベントを発行
    this.emit('session-timeout', {
      timestamp: new Date().toISOString(),
      error: error.message || error
    });
    
    // Issue作成をリクエスト
    await this.requestIssueCreation();
    
    // Issue監視を開始
    this.startIssueMonitoring();
  }
  
  async requestIssueCreation() {
    const notification = {
      type: 'session-timeout',
      priority: 'urgent',
      timestamp: new Date().toISOString(),
      blockedCount: this.blockedRequests.size,
      message: this.generateIssueBody()
    };
    
    // 通知ハンドラー用のキューに送信
    await this.redis.lpush('ccsp:notifications', JSON.stringify(notification));
    this.logger.info('[SessionMonitor] Issue creation requested');
  }
  
  generateIssueBody() {
    const timestamp = new Date().toISOString();
    const blockedCount = this.blockedRequests.size;
    
    return `## 🚨 緊急対応が必要です

PoppoBuilder Suite (CCSPエージェント) からの自動通知

### 状況
Claude CLIのログインセッションがタイムアウトしました。
すべてのClaude呼び出し処理を一時停止しています。

### 必要なアクション
1. ローカルMac環境にアクセス
2. ターミナルで以下を実行:
   \`\`\`bash
   claude login
   \`\`\`
3. ログイン完了後、**このIssueをクローズ**してください
4. CCSPが自動的に処理を再開します

### 詳細情報
- エラー検出: ${timestamp}
- ブロックされたリクエスト数: ${blockedCount}
- 最後の正常動作: ${this.lastSuccessTime || 'N/A'}

### 自動更新
このIssueは5分ごとに状況を更新します。

---
*このメッセージはCCSPエージェント（パイちゃん）により自動生成されました*`;
  }
  
  startIssueMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    
    // 初回チェックは少し待つ
    setTimeout(() => {
      this.checkIssueStatus();
    }, this.config.initialCheckDelay);
    
    // 定期的なチェック
    this.checkInterval = setInterval(() => {
      this.checkIssueStatus();
    }, this.config.issueCheckInterval);
    
    this.logger.info('[SessionMonitor] Issue monitoring started');
  }
  
  async checkIssueStatus() {
    if (!this.issueNumber) {
      // Issue番号がまだない場合は、通知システムから取得を試みる
      const issueInfo = await this.redis.get(this.issueKey);
      if (issueInfo) {
        this.issueNumber = JSON.parse(issueInfo).number;
      } else {
        this.logger.warn('[SessionMonitor] Issue number not yet available');
        return;
      }
    }
    
    // Issue状態チェックをリクエスト
    const checkRequest = {
      type: 'check-issue',
      issueNumber: this.issueNumber,
      requestId: `check-${Date.now()}`
    };
    
    await this.redis.lpush('ccsp:notifications', JSON.stringify(checkRequest));
    
    // レスポンスを待つ（タイムアウト付き）
    const response = await this.waitForResponse(checkRequest.requestId, 30000);
    
    if (response && response.closed) {
      this.logger.info('[SessionMonitor] Issue has been closed, attempting login check');
      await this.attemptLoginCheck();
    } else {
      this.logger.info('[SessionMonitor] Issue still open, waiting...');
      await this.updateIssueComment();
    }
  }
  
  async waitForResponse(requestId, timeout) {
    const startTime = Date.now();
    const responseKey = `ccsp:response:${requestId}`;
    
    while (Date.now() - startTime < timeout) {
      const response = await this.redis.get(responseKey);
      if (response) {
        await this.redis.del(responseKey);
        return JSON.parse(response);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return null;
  }
  
  async attemptLoginCheck() {
    this.logger.info('[SessionMonitor] Checking Claude login status...');
    
    try {
      // claude --version を実行してログイン状態を確認
      const result = await this.executeCommand('claude', ['--version']);
      
      if (result.success) {
        this.logger.info('[SessionMonitor] Login check successful!');
        await this.handleLoginSuccess();
      } else {
        this.logger.error('[SessionMonitor] Login check failed:', result.error);
        await this.handleLoginFailure();
      }
    } catch (error) {
      this.logger.error('[SessionMonitor] Login check error:', error);
      await this.handleLoginFailure();
    }
  }
  
  async executeCommand(command, args) {
    return new Promise((resolve) => {
      const process = spawn(command, args);
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      process.on('exit', (code) => {
        const output = stdout.trim();
        
        // セッションエラーチェック
        if (output.includes('Invalid API key') || 
            output.includes('Please run /login')) {
          resolve({ success: false, error: 'SESSION_TIMEOUT' });
        } else if (code === 0) {
          resolve({ success: true, output });
        } else {
          resolve({ success: false, error: stderr || output });
        }
      });
      
      process.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });
    });
  }
  
  async handleLoginSuccess() {
    this.logger.info('[SessionMonitor] Session restored successfully!');
    
    // セッションブロックを解除
    this.sessionBlocked = false;
    this.lastSuccessTime = new Date().toISOString();
    
    // 状態を保存
    await this.saveState();
    
    // Issue監視を停止
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    // 復旧イベントを発行
    this.emit('session-restored', {
      timestamp: new Date().toISOString(),
      blockedRequestsCount: this.blockedRequests.size
    });
    
    // ブロックされたリクエストをクリア
    this.blockedRequests.clear();
  }
  
  async handleLoginFailure() {
    this.logger.warn('[SessionMonitor] Login still failing, reopening issue');
    
    // Issue再オープンをリクエスト
    const reopenRequest = {
      type: 'reopen-issue',
      issueNumber: this.issueNumber,
      message: 'ログインチェックに失敗しました。引き続き手動でのログインが必要です。'
    };
    
    await this.redis.lpush('ccsp:notifications', JSON.stringify(reopenRequest));
  }
  
  async updateIssueComment() {
    const updateRequest = {
      type: 'update-issue',
      issueNumber: this.issueNumber,
      message: this.generateUpdateComment()
    };
    
    await this.redis.lpush('ccsp:notifications', JSON.stringify(updateRequest));
  }
  
  generateUpdateComment() {
    const waitingTime = this.sessionBlocked ? 
      Math.round((Date.now() - new Date(this.blockedAt).getTime()) / 1000 / 60) : 0;
    
    return `## 状況更新

- 現在時刻: ${new Date().toISOString()}
- 待機時間: ${waitingTime}分
- ブロック中のリクエスト: ${this.blockedRequests.size}

まだログイン待機中です... 🕐`;
  }
  
  async saveState() {
    const state = {
      blocked: this.sessionBlocked,
      issueNumber: this.issueNumber,
      blockedAt: this.blockedAt || new Date().toISOString(),
      lastCheck: new Date().toISOString()
    };
    
    await this.redis.set(this.stateKey, JSON.stringify(state));
  }
  
  addBlockedRequest(requestId, request) {
    this.blockedRequests.set(requestId, {
      ...request,
      blockedAt: new Date().toISOString()
    });
  }
  
  isBlocked() {
    return this.sessionBlocked;
  }
  
  async shutdown() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    
    // 状態を保存
    await this.saveState();
    
    this.logger.info('[SessionMonitor] Shutdown complete');
  }
}

module.exports = SessionMonitor;