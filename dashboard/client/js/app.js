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
      processDetailContent: document.getElementById('processDetailContent'),
      // ログ検索関連
      searchKeyword: document.getElementById('searchKeyword'),
      searchLevel: document.getElementById('searchLevel'),
      searchIssueNumber: document.getElementById('searchIssueNumber'),
      searchStartDate: document.getElementById('searchStartDate'),
      searchEndDate: document.getElementById('searchEndDate'),
      searchBtn: document.getElementById('searchBtn'),
      clearSearchBtn: document.getElementById('clearSearchBtn'),
      exportBtn: document.getElementById('exportBtn'),
      searchResults: document.getElementById('searchResults')
    };
  }

  bindEvents() {
    this.elements.refreshBtn.addEventListener('click', () => this.refresh());
    this.elements.stopAllBtn.addEventListener('click', () => this.stopAllProcesses());
    
    // ログ検索関連イベント
    this.elements.searchBtn.addEventListener('click', () => this.searchLogs());
    this.elements.clearSearchBtn.addEventListener('click', () => this.clearSearch());
    this.elements.exportBtn.addEventListener('click', () => this.exportLogs());
    
    // Enterキーで検索実行
    this.elements.searchKeyword.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') this.searchLogs();
    });
    this.elements.searchIssueNumber.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') this.searchLogs();
    });
    
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
    // フィルタリングチェック
    if (this.logFilter && !this.logFilter(message)) {
      return;
    }
    
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
    
    try {
      const response = await fetch(`/api/process/${processId}/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ force: false })
      });
      
      const result = await response.json();
      
      if (response.ok && result.success) {
        this.addLog(`✅ タスク ${processId} を停止しました`, 'success');
        // プロセスリストを更新
        this.fetchProcesses();
      } else {
        this.addLog(`❌ プロセス停止エラー: ${result.error || 'Unknown error'}`, 'error');
        // 強制終了を提案
        if (result.error && result.error.includes('force')) {
          if (confirm('プロセスが終了しません。強制終了しますか？')) {
            const forceResponse = await fetch(`/api/process/${processId}/stop`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ force: true })
            });
            
            const forceResult = await forceResponse.json();
            if (forceResponse.ok && forceResult.success) {
              this.addLog(`✅ タスク ${processId} を強制終了しました`, 'success');
              this.fetchProcesses();
            } else {
              this.addLog(`❌ 強制終了も失敗しました: ${forceResult.error}`, 'error');
            }
          }
        }
      }
    } catch (error) {
      this.addLog(`❌ ネットワークエラー: ${error.message}`, 'error');
    }
  }

  async stopAllProcesses() {
    if (!confirm('すべてのプロセスを停止しますか？')) {
      return;
    }
    
    try {
      const response = await fetch('/api/process/stop-all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ confirm: true, force: false })
      });
      
      const result = await response.json();
      
      if (response.ok && result.success) {
        this.addLog(`✅ ${result.stoppedCount}個のタスクを停止しました`, 'success');
        if (result.failedCount > 0) {
          this.addLog(`⚠️ ${result.failedCount}個のタスクの停止に失敗しました`, 'warning');
          // 失敗したタスクの詳細を表示
          if (result.results && result.results.failed) {
            result.results.failed.forEach(task => {
              this.addLog(`  - ${task.taskId}: ${task.error}`, 'error');
            });
          }
        }
        // プロセスリストを更新
        this.fetchProcesses();
      } else {
        this.addLog(`❌ 全プロセス停止エラー: ${result.error || 'Unknown error'}`, 'error');
      }
    } catch (error) {
      this.addLog(`❌ ネットワークエラー: ${error.message}`, 'error');
    }
  }

  refresh() {
    this.addLog('データを更新しています...', 'info');
    this.loadInitialData();
  }

  async searchLogs() {
    const params = new URLSearchParams();
    
    const keyword = this.elements.searchKeyword.value.trim();
    if (keyword) params.append('keyword', keyword);
    
    const level = this.elements.searchLevel.value;
    if (level) params.append('level', level);
    
    const issueNumber = this.elements.searchIssueNumber.value;
    if (issueNumber) params.append('issueNumber', issueNumber);
    
    const startDate = this.elements.searchStartDate.value;
    if (startDate) params.append('startDate', startDate);
    
    const endDate = this.elements.searchEndDate.value;
    if (endDate) params.append('endDate', endDate);
    
    params.append('limit', '100');
    
    try {
      this.addLog('ログを検索中...', 'info');
      const response = await fetch(`${this.apiUrl}/logs/search?${params}`);
      const result = await response.json();
      
      this.displaySearchResults(result);
      this.addLog(`${result.total}件のログが見つかりました`, 'info');
    } catch (error) {
      this.addLog('ログ検索に失敗しました', 'error');
      console.error('Failed to search logs:', error);
    }
  }
  
  displaySearchResults(result) {
    const statsDiv = this.elements.searchResults.querySelector('.search-stats');
    const listDiv = this.elements.searchResults.querySelector('.search-result-list');
    
    // 統計情報を表示
    statsDiv.innerHTML = `
      検索結果: ${result.logs.length}件 / 全${result.total}件
      ${result.hasMore ? ' (さらに結果があります)' : ''}
    `;
    
    // 検索結果を表示
    if (result.logs.length === 0) {
      listDiv.innerHTML = '<div class="loading">該当するログが見つかりませんでした</div>';
      return;
    }
    
    listDiv.innerHTML = result.logs.map(log => {
      const timestamp = new Date(log.timestamp).toLocaleString('ja-JP');
      return `
        <div class="search-result-item">
          <div class="search-result-header">
            <span class="search-result-timestamp">${timestamp}</span>
            <span class="search-result-level level-${log.level}">${log.level}</span>
          </div>
          <div class="search-result-meta">
            <span>プロセス: ${log.processId}</span>
            ${log.issueNumber ? `<span>Issue: #${log.issueNumber}</span>` : ''}
          </div>
          <div class="search-result-message">${this.escapeHtml(log.message)}</div>
        </div>
      `;
    }).join('');
    
    // リアルタイムフィルタリングのセットアップ
    this.setupRealtimeFiltering();
  }
  
  clearSearch() {
    this.elements.searchKeyword.value = '';
    this.elements.searchLevel.value = '';
    this.elements.searchIssueNumber.value = '';
    this.elements.searchStartDate.value = '';
    this.elements.searchEndDate.value = '';
    
    const statsDiv = this.elements.searchResults.querySelector('.search-stats');
    const listDiv = this.elements.searchResults.querySelector('.search-result-list');
    statsDiv.innerHTML = '';
    listDiv.innerHTML = '';
    
    this.addLog('検索条件をクリアしました', 'info');
  }
  
  async exportLogs() {
    const params = new URLSearchParams();
    
    const keyword = this.elements.searchKeyword.value.trim();
    if (keyword) params.append('keyword', keyword);
    
    const level = this.elements.searchLevel.value;
    if (level) params.append('level', level);
    
    const issueNumber = this.elements.searchIssueNumber.value;
    if (issueNumber) params.append('issueNumber', issueNumber);
    
    const startDate = this.elements.searchStartDate.value;
    if (startDate) params.append('startDate', startDate);
    
    const endDate = this.elements.searchEndDate.value;
    if (endDate) params.append('endDate', endDate);
    
    // エクスポート形式を選択（CSV or JSON）
    const format = confirm('CSV形式でエクスポートしますか？\n（キャンセルを押すとJSON形式）') ? 'csv' : 'json';
    params.append('format', format);
    
    try {
      this.addLog(`ログを${format.toUpperCase()}形式でエクスポート中...`, 'info');
      const response = await fetch(`${this.apiUrl}/logs/export?${params}`);
      
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `logs_${new Date().toISOString().split('T')[0]}.${format}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        this.addLog('ログのエクスポートが完了しました', 'info');
      } else {
        throw new Error('Export failed');
      }
    } catch (error) {
      this.addLog('ログのエクスポートに失敗しました', 'error');
      console.error('Failed to export logs:', error);
    }
  }
  
  setupRealtimeFiltering() {
    // WebSocketメッセージをフィルタリング
    if (this.filterInterval) {
      clearInterval(this.filterInterval);
    }
    
    const keyword = this.elements.searchKeyword.value.toLowerCase();
    const level = this.elements.searchLevel.value;
    const issueNumber = this.elements.searchIssueNumber.value;
    
    if (keyword || level || issueNumber) {
      // フィルタが設定されている場合、リアルタイムログも同じ条件でフィルタ
      this.logFilter = (message) => {
        if (keyword && !message.toLowerCase().includes(keyword)) return false;
        if (level && !message.includes(`[${level}]`)) return false;
        if (issueNumber && !message.includes(`Issue #${issueNumber}`)) return false;
        return true;
      };
    } else {
      this.logFilter = null;
    }
  }
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// アプリケーションの初期化
let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new DashboardApp();
});