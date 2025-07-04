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
    this.startConnectionMonitor();
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
    
    // 設定ボタンイベント
    const configBtn = document.getElementById('configBtn');
    if (configBtn) {
      configBtn.addEventListener('click', () => this.showConfigUI());
    }
    
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
        this.updateProcessList(message.data.processes, true);
        this.updateStats(message.data.stats);
        break;
        
      case 'process-event':
        this.handleProcessEvent(message.event);
        break;
        
      case 'process-added':
        this.handleProcessAdded(message.process);
        break;
        
      case 'process-updated':
        this.handleProcessUpdated(message.process);
        break;
        
      case 'process-removed':
        this.handleProcessRemoved(message.processId);
        break;
        
      case 'log':
        this.handleLogMessage(message.log);
        break;
        
      case 'notification':
        this.showNotification(message.notification);
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

  updateProcessList(processes, animate = false) {
    const container = this.elements.processListContainer;
    
    if (processes.length === 0) {
      container.innerHTML = '<div class="loading">実行中のプロセスはありません</div>';
      return;
    }
    
    // 既存のプロセスIDを取得
    const existingIds = new Set(
      Array.from(container.querySelectorAll('.process-item'))
        .map(el => el.dataset.processId)
    );
    
    // 新しいプロセスIDを取得
    const newIds = new Set(processes.map(p => p.processId));
    
    // 削除されたプロセスを検出
    if (animate) {
      existingIds.forEach(id => {
        if (!newIds.has(id)) {
          const element = container.querySelector(`[data-process-id="${id}"]`);
          if (element) {
            element.classList.add('process-removing');
            setTimeout(() => element.remove(), 300);
          }
        }
      });
    }
    
    // プロセスリストを更新
    processes.forEach(process => {
      const existingElement = container.querySelector(`[data-process-id="${process.processId}"]`);
      const processHtml = this.createProcessElement(process);
      
      if (existingElement) {
        // 既存要素を更新
        existingElement.outerHTML = processHtml;
        if (animate) {
          const newElement = container.querySelector(`[data-process-id="${process.processId}"]`);
          newElement.classList.add('process-updated');
          setTimeout(() => newElement.classList.remove('process-updated'), 300);
        }
      } else {
        // 新規要素を追加
        const temp = document.createElement('div');
        temp.innerHTML = processHtml;
        const newElement = temp.firstElementChild;
        if (animate) {
          newElement.classList.add('process-added');
          setTimeout(() => newElement.classList.remove('process-added'), 300);
        }
        container.appendChild(newElement);
      }
    });
    
    // プロセスを順序通りに並べ替え
    const sortedElements = processes.map(p => 
      container.querySelector(`[data-process-id="${p.processId}"]`)
    ).filter(Boolean);
    
    sortedElements.forEach(el => container.appendChild(el));
  }
  
  createProcessElement(process) {
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
  
  // 新しいプロセスが追加された時の処理
  handleProcessAdded(process) {
    // プロセスリストに追加
    const container = this.elements.processListContainer;
    const temp = document.createElement('div');
    temp.innerHTML = this.createProcessElement(process);
    const newElement = temp.firstElementChild;
    
    // アニメーション付きで追加
    newElement.classList.add('process-added');
    container.prepend(newElement);
    setTimeout(() => newElement.classList.remove('process-added'), 300);
    
    // 通知を表示
    this.showNotification({
      type: 'info',
      message: `新しいプロセスが開始されました: Issue #${process.issueNumber}`
    });
    
    // ログに追加
    this.addLog(`プロセス開始: ${process.processId} (Issue #${process.issueNumber})`, 'info');
  }
  
  // プロセスが更新された時の処理
  handleProcessUpdated(process) {
    const element = this.elements.processListContainer.querySelector(`[data-process-id="${process.processId}"]`);
    if (element) {
      const newHtml = this.createProcessElement(process);
      element.outerHTML = newHtml;
      
      // 更新されたことを視覚的に示す
      const updatedElement = this.elements.processListContainer.querySelector(`[data-process-id="${process.processId}"]`);
      updatedElement.classList.add('process-updated');
      setTimeout(() => updatedElement.classList.remove('process-updated'), 300);
    }
  }
  
  // プロセスが削除された時の処理
  handleProcessRemoved(processId) {
    const element = this.elements.processListContainer.querySelector(`[data-process-id="${processId}"]`);
    if (element) {
      element.classList.add('process-removing');
      setTimeout(() => element.remove(), 300);
    }
  }
  
  // ログメッセージの処理
  handleLogMessage(log) {
    this.addLog(log.message, log.level || 'info');
  }
  
  // 通知の表示
  showNotification(notification) {
    // 既存の通知要素があれば使用、なければ作成
    let notificationEl = document.getElementById('notification');
    if (!notificationEl) {
      notificationEl = document.createElement('div');
      notificationEl.id = 'notification';
      notificationEl.className = 'notification';
      document.body.appendChild(notificationEl);
    }
    
    // 通知を表示
    notificationEl.className = `notification notification-${notification.type} notification-show`;
    notificationEl.textContent = notification.message;
    
    // 3秒後に非表示
    setTimeout(() => {
      notificationEl.classList.remove('notification-show');
    }, 3000);
  }
  
  // WebSocket再接続
  reconnectWebSocket() {
    if (this.ws.readyState === WebSocket.CLOSED) {
      this.addLog('WebSocket再接続を試みています...', 'info');
      this.connectWebSocket();
    }
  }
  
  // 接続状態の監視
  startConnectionMonitor() {
    setInterval(() => {
      if (this.ws.readyState === WebSocket.CLOSED) {
        this.updateSystemStatus('切断', 'error');
        this.reconnectWebSocket();
      } else if (this.ws.readyState === WebSocket.OPEN) {
        // Pingメッセージを送信して接続確認
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000); // 30秒ごとにチェック
  }
  
  // ログのリアルタイムストリーミング
  startLogStreaming(processId) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'subscribe-logs',
        processId: processId
      }));
    }
  }
  
  stopLogStreaming(processId) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'unsubscribe-logs',
        processId: processId
      }));
    }
  }
  
  showConfigUI() {
    // 他のセクションを非表示
    document.querySelectorAll('.system-status, .process-list, .log-search, .token-usage, .performance-analytics, .realtime-logs').forEach(section => {
      section.style.display = 'none';
    });
    
    // 設定管理セクションを表示
    const configSection = document.querySelector('.config-management-section');
    if (configSection) {
      configSection.style.display = 'block';
      
      // 設定UIを初期化（まだ初期化されていない場合）
      if (!this.configUIInitialized) {
        configUI.init('configContainer');
        this.configUIInitialized = true;
      }
    }
  }
  
  hideConfigUI() {
    // 設定管理セクションを非表示
    document.querySelector('.config-management-section').style.display = 'none';
    
    // 他のセクションを表示
    document.querySelectorAll('.system-status, .process-list, .log-search, .token-usage, .performance-analytics, .realtime-logs').forEach(section => {
      section.style.display = '';
    });
  }
}

// アプリケーションの初期化
let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new DashboardApp();
  
  // トークン使用量セクションの初期化
  updateTokenUsage();
  
  // トークン使用量ボタンのイベントハンドラ
  document.getElementById('refreshTokenUsageBtn')?.addEventListener('click', updateTokenUsage);
  document.getElementById('viewCCSPDashboardBtn')?.addEventListener('click', () => {
    window.open('/dashboard/ccsp/', '_blank');
  });
  
  // 定期的にトークン使用量を更新（5分ごと）
  setInterval(updateTokenUsage, 5 * 60 * 1000);
});

// トークン使用量の更新
async function updateTokenUsage() {
  try {
    const response = await fetch('/api/token-usage/usage');
    const data = await response.json();
    
    // 統計情報を更新
    document.getElementById('tokenToday').textContent = formatTokenCount(data.today);
    document.getElementById('tokenWeek').textContent = formatTokenCount(data.week);
    document.getElementById('tokenMonth').textContent = formatTokenCount(data.month);
    document.getElementById('tokenTotal').textContent = formatTokenCount(data.total);
    
    // グラフを更新
    updateTokenUsageChart(data.history);
  } catch (error) {
    console.error('Error updating token usage:', error);
    // エラー時はダッシュを表示
    document.getElementById('tokenToday').textContent = '-';
    document.getElementById('tokenWeek').textContent = '-';
    document.getElementById('tokenMonth').textContent = '-';
    document.getElementById('tokenTotal').textContent = '-';
  }
}

// トークン数をフォーマット
function formatTokenCount(count) {
  if (count === 0) return '0';
  if (count < 1000) return count.toString();
  if (count < 1000000) return (count / 1000).toFixed(1) + 'K';
  return (count / 1000000).toFixed(1) + 'M';
}

// トークン使用量チャートの更新
let tokenUsageChart = null;
function updateTokenUsageChart(history) {
  const ctx = document.getElementById('tokenUsageChart');
  if (!ctx) return;
  
  const labels = history.map(h => {
    const date = new Date(h.date);
    return (date.getMonth() + 1) + '/' + date.getDate();
  });
  const data = history.map(h => h.tokens);
  
  if (tokenUsageChart) {
    tokenUsageChart.data.labels = labels;
    tokenUsageChart.data.datasets[0].data = data;
    tokenUsageChart.update();
  } else {
    tokenUsageChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'トークン使用量',
          data: data,
          borderColor: '#3498db',
          backgroundColor: 'rgba(52, 152, 219, 0.1)',
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                return 'トークン: ' + context.parsed.y.toLocaleString();
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: function(value) {
                return formatTokenCount(value);
              }
            }
          }
        }
      }
    });
  }
}