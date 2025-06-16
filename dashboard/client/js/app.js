/**
 * PoppoBuilder Dashboard Client
 */

class DashboardApp {
  constructor() {
    this.ws = null;
    this.processes = {};
    this.apiUrl = `http://${window.location.hostname}:3001/api`;
    this.wsUrl = `ws://${window.location.hostname}:3001`;
    
    this.initializeElements();
    this.bindEvents();
    this.connectWebSocket();
    this.loadInitialData();
  }

  initializeElements() {
    this.elements = {
      refreshBtn: document.getElementById('refreshBtn'),
      stopAllBtn: document.getElementById('stopAllBtn'),
      systemStatus: document.getElementById('systemStatus'),
      runningCount: document.getElementById('runningCount'),
      completedCount: document.getElementById('completedCount'),
      errorCount: document.getElementById('errorCount'),
      totalCount: document.getElementById('totalCount'),
      processListContainer: document.getElementById('processListContainer'),
      logContainer: document.getElementById('logContainer'),
      processDetailModal: document.getElementById('processDetailModal'),
      processDetailContent: document.getElementById('processDetailContent')
    };
  }

  bindEvents() {
    this.elements.refreshBtn.addEventListener('click', () => this.refresh());
    this.elements.stopAllBtn.addEventListener('click', () => this.stopAllProcesses());
    
    // モーダル閉じる
    const closeBtn = this.elements.processDetailModal.querySelector('.close');
    closeBtn.addEventListener('click', () => this.closeModal());
    
    window.addEventListener('click', (event) => {
      if (event.target === this.elements.processDetailModal) {
        this.closeModal();
      }
    });
  }

  connectWebSocket() {
    this.ws = new WebSocket(this.wsUrl);
    
    this.ws.onopen = () => {
      this.addLog('ダッシュボードサーバーに接続しました', 'info');
      this.updateSystemStatus('正常稼働中', 'ok');
    };
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleWebSocketMessage(message);
    };
    
    this.ws.onclose = () => {
      this.addLog('ダッシュボードサーバーから切断されました', 'warning');
      this.updateSystemStatus('切断', 'error');
      
      // 5秒後に再接続を試みる
      setTimeout(() => this.connectWebSocket(), 5000);
    };
    
    this.ws.onerror = (error) => {
      this.addLog('WebSocket接続エラー', 'error');
      console.error('WebSocket error:', error);
    };
  }

  handleWebSocketMessage(message) {
    switch (message.type) {
      case 'initial':
        this.updateProcessList(message.data.processes);
        this.updateStats(message.data.stats);
        break;
        
      case 'update':
        this.updateProcessList(message.data.processes);
        this.updateStats(message.data.stats);
        break;
        
      case 'process-event':
        this.handleProcessEvent(message.event);
        break;
    }
  }

  handleProcessEvent(event) {
    const timestamp = new Date(event.timestamp).toLocaleTimeString('ja-JP');
    
    switch (event.type) {
      case 'start':
        this.addLog(`[${timestamp}] プロセス開始: ${event.processId} (Issue #${event.issueNumber})`, 'info');
        break;
        
      case 'end':
        this.addLog(`[${timestamp}] プロセス終了: ${event.processId} - ${event.status}`, 
          event.status === 'completed' ? 'info' : 'error');
        break;
        
      case 'output':
        this.addLog(`[${timestamp}] ${event.processId}: ${event.output}`, 'info');
        break;
    }
  }

  async loadInitialData() {
    try {
      const response = await fetch(`${this.apiUrl}/processes`);
      const processes = await response.json();
      this.updateProcessList(processes);
      
      const statsResponse = await fetch(`${this.apiUrl}/system/stats`);
      const stats = await statsResponse.json();
      this.updateStats(stats);
    } catch (error) {
      this.addLog('初期データの読み込みに失敗しました', 'error');
      console.error('Failed to load initial data:', error);
    }
  }

  updateProcessList(processes) {
    const container = this.elements.processListContainer;
    
    if (processes.length === 0) {
      container.innerHTML = '<div class="loading">実行中のプロセスはありません</div>';
      return;
    }
    
    container.innerHTML = processes.map(process => {
      const elapsedTime = this.formatElapsedTime(process.metrics.elapsedTime);
      const statusClass = `status-${process.status}`;
      
      return `
        <div class="process-item" data-process-id="${process.processId}">
          <div class="process-id">#${process.issueNumber}</div>
          <div class="process-type">${process.type}</div>
          <div class="process-status ${statusClass}">${this.getStatusText(process.status)}</div>
          <div class="process-metrics">CPU: ${process.metrics.cpuUsage}%</div>
          <div class="process-metrics">MEM: ${process.metrics.memoryUsage}MB</div>
          <div class="process-time">${elapsedTime}</div>
          <div class="process-output">${process.lastOutput || '...'}</div>
          <div class="process-actions">
            <button class="btn btn-small btn-primary" onclick="app.showProcessDetail('${process.processId}')">詳細</button>
            ${process.status === 'running' ? 
              `<button class="btn btn-small btn-danger" onclick="app.stopProcess('${process.processId}')">停止</button>` : 
              ''}
          </div>
        </div>
      `;
    }).join('');
  }

  updateStats(stats) {
    this.elements.runningCount.textContent = stats.running || 0;
    this.elements.completedCount.textContent = stats.completed || 0;
    this.elements.errorCount.textContent = stats.error || 0;
    this.elements.totalCount.textContent = stats.total || 0;
    
    // システム状態の更新
    if (stats.error > 0) {
      this.updateSystemStatus('エラーあり', 'error');
    } else if (stats.running > 0) {
      this.updateSystemStatus('処理中', 'ok');
    } else {
      this.updateSystemStatus('待機中', 'ok');
    }
  }

  updateSystemStatus(text, status) {
    this.elements.systemStatus.textContent = text;
    this.elements.systemStatus.className = `status-indicator status-${status}`;
  }

  formatElapsedTime(seconds) {
    if (seconds < 60) {
      return `${seconds}秒`;
    } else if (seconds < 3600) {
      return `${Math.floor(seconds / 60)}分`;
    } else {
      return `${Math.floor(seconds / 3600)}時間`;
    }
  }

  getStatusText(status) {
    const statusMap = {
      'running': '実行中',
      'completed': '完了',
      'error': 'エラー',
      'timeout': 'タイムアウト',
      'killed': '停止'
    };
    return statusMap[status] || status;
  }

  addLog(message, level = 'info') {
    const timestamp = new Date().toLocaleTimeString('ja-JP');
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    logEntry.innerHTML = `
      <span class="log-timestamp">[${timestamp}]</span>
      <span class="log-level-${level}">${message}</span>
    `;
    
    this.elements.logContainer.appendChild(logEntry);
    this.elements.logContainer.scrollTop = this.elements.logContainer.scrollHeight;
    
    // 最大1000行まで保持
    while (this.elements.logContainer.children.length > 1000) {
      this.elements.logContainer.removeChild(this.elements.logContainer.firstChild);
    }
  }

  async showProcessDetail(processId) {
    try {
      const response = await fetch(`${this.apiUrl}/processes/${processId}`);
      const process = await response.json();
      
      const content = `
        <div class="process-detail">
          <h3>プロセスID: ${process.processId}</h3>
          <p><strong>Issue番号:</strong> #${process.issueNumber}</p>
          <p><strong>タイプ:</strong> ${process.type}</p>
          <p><strong>状態:</strong> ${this.getStatusText(process.status)}</p>
          <p><strong>開始時刻:</strong> ${new Date(process.startTime).toLocaleString('ja-JP')}</p>
          ${process.endTime ? `<p><strong>終了時刻:</strong> ${new Date(process.endTime).toLocaleString('ja-JP')}</p>` : ''}
          <p><strong>経過時間:</strong> ${this.formatElapsedTime(process.metrics.elapsedTime)}</p>
          <p><strong>CPU使用率:</strong> ${process.metrics.cpuUsage}%</p>
          <p><strong>メモリ使用量:</strong> ${process.metrics.memoryUsage}MB</p>
          <h4>最新の出力:</h4>
          <pre>${process.lastOutput || 'なし'}</pre>
        </div>
      `;
      
      this.elements.processDetailContent.innerHTML = content;
      this.elements.processDetailModal.style.display = 'block';
    } catch (error) {
      this.addLog(`プロセス詳細の取得に失敗しました: ${processId}`, 'error');
      console.error('Failed to load process detail:', error);
    }
  }

  closeModal() {
    this.elements.processDetailModal.style.display = 'none';
  }

  async stopProcess(processId) {
    if (!confirm(`プロセス ${processId} を停止しますか？`)) {
      return;
    }
    
    this.addLog(`プロセス停止機能は未実装です: ${processId}`, 'warning');
    // TODO: プロセス停止APIの実装
  }

  async stopAllProcesses() {
    if (!confirm('すべてのプロセスを停止しますか？')) {
      return;
    }
    
    this.addLog('全プロセス停止機能は未実装です', 'warning');
    // TODO: 全プロセス停止APIの実装
  }

  refresh() {
    this.addLog('データを更新しています...', 'info');
    this.loadInitialData();
  }
}

// アプリケーションの初期化
let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new DashboardApp();
});