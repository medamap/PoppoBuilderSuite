/**
 * CCSP管理ダッシュボード JavaScript
 * 
 * Issue #142: CCSPの高度な制御機能とモニタリング実装
 * リアルタイムモニタリングとインタラクティブ制御
 */

class CCSPDashboard {
  constructor() {
    this.socket = null;
    this.charts = {};
    this.currentTab = 'overview';
    this.data = {
      queue: null,
      usage: null,
      agents: null,
      health: null
    };
    
    this.init();
  }
  
  /**
   * ダッシュボードの初期化
   */
  async init() {
    try {
      // WebSocket接続
      await this.connectWebSocket();
      
      // チャートの初期化
      this.initCharts();
      
      // イベントリスナーの設定
      this.setupEventListeners();
      
      // 初期データの読み込み
      await this.loadInitialData();
      
      console.log('CCSP Dashboard initialized successfully');
    } catch (error) {
      console.error('Failed to initialize dashboard:', error);
      this.showAlert('error', 'ダッシュボードの初期化に失敗しました: ' + error.message);
    }
  }
  
  /**
   * WebSocket接続（オプショナル）
   */
  async connectWebSocket() {
    return new Promise((resolve, reject) => {
      // CCSPが利用できない場合のフォールバック
      this.socket = io('/ccsp', {
        timeout: 3000,
        forceNew: true
      });
      
      this.socket.on('connect', () => {
        console.log('WebSocket connected to CCSP namespace');
        this.updateConnectionStatus(true);
        resolve();
      });
      
      this.socket.on('disconnect', () => {
        console.log('WebSocket disconnected');
        this.updateConnectionStatus(false);
      });
      
      this.socket.on('connect_error', (error) => {
        console.warn('CCSP WebSocket connection failed, falling back to mock data:', error);
        this.updateConnectionStatus(false);
        this.initializeMockData();
        resolve(); // エラーでも解決してフォールバックで動作
      });
      
      // データ更新イベント
      this.socket.on('initialState', (data) => {
        this.handleInitialState(data);
      });
      
      this.socket.on('queueUpdate', (data) => {
        this.handleQueueUpdate(data);
      });
      
      this.socket.on('usageUpdate', (data) => {
        this.handleUsageUpdate(data);
      });
      
      this.socket.on('alert', (alert) => {
        this.handleAlert(alert);
      });
      
      this.socket.on('commandResult', (result) => {
        this.handleCommandResult(result);
      });
      
      // 接続タイムアウト（フォールバックで解決）
      setTimeout(() => {
        if (!this.socket.connected) {
          console.warn('CCSP WebSocket timeout, using mock data');
          this.updateConnectionStatus(false);
          this.initializeMockData();
          resolve();
        }
      }, 3000);
    });
  }
  
  /**
   * 接続状態の更新
   */
  updateConnectionStatus(connected) {
    const indicator = document.getElementById('connectionStatus');
    if (indicator) {
      indicator.style.backgroundColor = connected ? '#4CAF50' : '#f44336';
      indicator.title = connected ? '接続中' : '切断中（モックデータ使用）';
    }
  }
  
  /**
   * モックデータの初期化
   */
  initializeMockData() {
    console.log('Initializing mock data for CCSP dashboard');
    
    // モックキューデータ
    this.data.queue = {
      totalQueueSize: 5,
      isPaused: false,
      queues: {
        urgent: { size: 1, oldestTask: new Date(Date.now() - 300000).toISOString() },
        high: { size: 2, oldestTask: new Date(Date.now() - 600000).toISOString() },
        normal: { size: 2, oldestTask: new Date(Date.now() - 900000).toISOString() },
        low: { size: 0, oldestTask: null },
        scheduled: { size: 0, oldestTask: null }
      }
    };
    
    // モック使用量データ
    this.data.usage = {
      currentWindow: {
        requests: 45,
        requestsPerMinute: 12.5,
        successRate: 0.96,
        averageResponseTime: 1250,
        errorRate: 0.04
      },
      rateLimitInfo: {
        limit: 100,
        remaining: 55,
        resetTime: Date.now() + 3600000
      },
      prediction: {
        prediction: {
          requestsPerMinute: 15.2
        }
      },
      rateLimitPrediction: {
        prediction: {
          minutesToLimit: 120
        },
        recommendation: {
          message: "現在のペースは安全です"
        }
      }
    };
    
    // モックエージェントデータ
    this.data.agents = {
      'CCLA': {
        totalRequests: 234,
        successCount: 225,
        averageResponseTime: 1180,
        lastSeen: new Date().toISOString()
      },
      'CCAG': {
        totalRequests: 156,
        successCount: 148,
        averageResponseTime: 950,
        lastSeen: new Date(Date.now() - 120000).toISOString()
      },
      'PoppoBuilder': {
        totalRequests: 89,
        successCount: 87,
        averageResponseTime: 1350,
        lastSeen: new Date(Date.now() - 300000).toISOString()
      }
    };
    
    // 表示を更新
    this.updateDisplay();
    
    // モックデータの定期更新を開始
    this.startMockDataUpdates();
  }
  
  /**
   * モックデータの定期更新
   */
  startMockDataUpdates() {
    setInterval(() => {
      if (!this.socket || !this.socket.connected) {
        // モックデータを少しずつ変更
        if (this.data.usage && this.data.usage.currentWindow) {
          this.data.usage.currentWindow.requestsPerMinute += (Math.random() - 0.5) * 2;
          this.data.usage.currentWindow.averageResponseTime += (Math.random() - 0.5) * 100;
          this.data.usage.currentWindow.successRate = Math.max(0.8, Math.min(1.0, 
            this.data.usage.currentWindow.successRate + (Math.random() - 0.5) * 0.02));
        }
        
        this.updateUsageDisplay();
        this.updateCharts();
      }
    }, 5000);
  }
  
  /**
   * チャートの初期化
   */
  initCharts() {
    // 使用量推移チャート
    const usageCtx = document.getElementById('usageChart').getContext('2d');
    this.charts.usage = new Chart(usageCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'API使用数/分',
          data: [],
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
          tension: 0.1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true
          }
        },
        plugins: {
          legend: {
            display: false
          }
        }
      }
    });
    
    // パフォーマンスチャート
    const perfCtx = document.getElementById('performanceChart').getContext('2d');
    this.charts.performance = new Chart(perfCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: '平均応答時間 (ms)',
          data: [],
          borderColor: 'rgb(255, 99, 132)',
          backgroundColor: 'rgba(255, 99, 132, 0.2)',
          tension: 0.1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true
          }
        },
        plugins: {
          legend: {
            display: false
          }
        }
      }
    });
    
    // エラー率チャート
    const errorCtx = document.getElementById('errorChart').getContext('2d');
    this.charts.error = new Chart(errorCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'エラー率 (%)',
          data: [],
          borderColor: 'rgb(255, 159, 64)',
          backgroundColor: 'rgba(255, 159, 64, 0.2)',
          tension: 0.1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            max: 100
          }
        },
        plugins: {
          legend: {
            display: false
          }
        }
      }
    });
  }
  
  /**
   * イベントリスナーの設定
   */
  setupEventListeners() {
    // 統計情報の購読開始
    this.socket.emit('subscribeStats', 5000); // 5秒間隔
    
    // ページを離れる時に購読停止
    window.addEventListener('beforeunload', () => {
      if (this.socket) {
        this.socket.emit('unsubscribeStats');
      }
    });
  }
  
  /**
   * 初期データの読み込み
   */
  async loadInitialData() {
    try {
      const [queueData, usageData, agentData] = await Promise.all([
        this.fetchAPI('/api/ccsp/queue/status').catch(() => null),
        this.fetchAPI('/api/ccsp/stats/usage').catch(() => null),
        this.fetchAPI('/api/ccsp/stats/agents').catch(() => null)
      ]);
      
      if (queueData && usageData && agentData) {
        this.data.queue = queueData.data;
        this.data.usage = usageData.data;
        this.data.agents = agentData.data;
        this.updateDisplay();
      } else {
        console.warn('CCSP API not available, using mock data');
        this.initializeMockData();
      }
    } catch (error) {
      console.warn('Failed to load initial data, using mock data:', error);
      this.initializeMockData();
    }
  }
  
  /**
   * API呼び出し
   */
  async fetchAPI(endpoint, options = {}) {
    const response = await fetch(endpoint, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    
    return await response.json();
  }
  
  /**
   * 初期状態の処理
   */
  handleInitialState(data) {
    this.data = { ...this.data, ...data };
    this.updateDisplay();
  }
  
  /**
   * キュー更新の処理
   */
  handleQueueUpdate(data) {
    this.data.queue = data;
    this.updateQueueDisplay();
  }
  
  /**
   * 使用量更新の処理
   */
  handleUsageUpdate(data) {
    this.data.usage = data;
    this.updateUsageDisplay();
    this.updateCharts();
  }
  
  /**
   * アラートの処理
   */
  handleAlert(alert) {
    const type = alert.severity === 'critical' ? 'danger' : 
                 alert.severity === 'high' ? 'warning' : 'info';
    
    this.showAlert(type, `${alert.type}: ${JSON.stringify(alert.data)}`);
  }
  
  /**
   * コマンド結果の処理
   */
  handleCommandResult(result) {
    const type = result.success ? 'success' : 'danger';
    const message = result.success ? 
      `${result.action} が正常に実行されました` : 
      `${result.action} の実行に失敗しました: ${result.error}`;
    
    this.showAlert(type, message);
    
    // ボタン状態の更新
    this.updateButtonStates();
  }
  
  /**
   * 表示の更新
   */
  updateDisplay() {
    this.updateQueueDisplay();
    this.updateUsageDisplay();
    this.updateAgentDisplay();
    this.updatePredictionDisplay();
  }
  
  /**
   * キュー表示の更新
   */
  updateQueueDisplay() {
    if (!this.data.queue) return;
    
    const queue = this.data.queue;
    
    // キュー統計の更新
    document.getElementById('totalTasks').textContent = queue.totalQueueSize || 0;
    document.getElementById('urgentTasks').textContent = queue.queues?.urgent?.size || 0;
    document.getElementById('highTasks').textContent = queue.queues?.high?.size || 0;
    document.getElementById('normalTasks').textContent = queue.queues?.normal?.size || 0;
    document.getElementById('lowTasks').textContent = queue.queues?.low?.size || 0;
    document.getElementById('scheduledTasks').textContent = queue.queues?.scheduled?.size || 0;
    
    // キューリストの更新（キュー管理タブ）
    this.updateQueueList();
    
    // ボタン状態の更新
    this.updateButtonStates();
  }
  
  /**
   * 使用量表示の更新
   */
  updateUsageDisplay() {
    if (!this.data.usage) return;
    
    const usage = this.data.usage;
    const current = usage.currentWindow || {};
    
    document.getElementById('currentUsage').textContent = 
      `${current.requests || 0} / ${usage.rateLimitInfo?.limit || 'N/A'}`;
    
    document.getElementById('successRate').textContent = 
      `${((current.successRate || 0) * 100).toFixed(1)}%`;
    
    document.getElementById('avgResponseTime').textContent = 
      `${(current.averageResponseTime || 0).toFixed(0)}ms`;
    
    document.getElementById('requestsPerMinute').textContent = 
      `${(current.requestsPerMinute || 0).toFixed(1)}`;
    
    // レート制限まての時間
    if (usage.rateLimitPrediction && usage.rateLimitPrediction.prediction) {
      const minutes = usage.rateLimitPrediction.prediction.minutesToLimit;
      document.getElementById('timeToLimit').textContent = 
        minutes < 60 ? `${minutes.toFixed(0)}分` : `${(minutes / 60).toFixed(1)}時間`;
    } else {
      document.getElementById('timeToLimit').textContent = 'N/A';
    }
  }
  
  /**
   * エージェント表示の更新
   */
  updateAgentDisplay() {
    if (!this.data.agents) return;
    
    const agentList = document.getElementById('agentList');
    if (!agentList) return;
    
    agentList.innerHTML = '';
    
    Object.entries(this.data.agents).forEach(([agentName, stats]) => {
      const agentCard = document.createElement('div');
      agentCard.className = 'agent-card';
      
      agentCard.innerHTML = `
        <div class="agent-name">${agentName}</div>
        <div class="agent-stats">
          <div>総リクエスト: ${stats.totalRequests || 0}</div>
          <div>成功率: ${((stats.successCount || 0) / (stats.totalRequests || 1) * 100).toFixed(1)}%</div>
          <div>平均応答時間: ${(stats.averageResponseTime || 0).toFixed(0)}ms</div>
          <div>最終実行: ${stats.lastSeen ? new Date(stats.lastSeen).toLocaleTimeString() : 'N/A'}</div>
        </div>
      `;
      
      agentList.appendChild(agentCard);
    });
  }
  
  /**
   * 予測表示の更新
   */
  updatePredictionDisplay() {
    if (!this.data.usage) return;
    
    const prediction = this.data.usage.prediction;
    const rateLimitPrediction = this.data.usage.rateLimitPrediction;
    
    if (prediction && prediction.prediction) {
      document.getElementById('prediction30min').textContent = 
        `${prediction.prediction.requestsPerMinute.toFixed(1)} req/min`;
    }
    
    if (rateLimitPrediction && rateLimitPrediction.prediction) {
      const minutes = rateLimitPrediction.prediction.minutesToLimit;
      document.getElementById('limitPrediction').textContent = 
        minutes < 60 ? `${minutes.toFixed(0)}分後` : `${(minutes / 60).toFixed(1)}時間後`;
    }
    
    if (rateLimitPrediction && rateLimitPrediction.recommendation) {
      const rec = rateLimitPrediction.recommendation;
      document.getElementById('recommendation').textContent = rec.message;
    }
  }
  
  /**
   * キューリストの更新
   */
  updateQueueList() {
    const queueList = document.getElementById('queueList');
    if (!queueList || !this.data.queue) return;
    
    queueList.innerHTML = '';
    
    // 各優先度のキューからタスクを表示（実際の実装では制限する）
    const priorities = ['urgent', 'high', 'normal', 'low', 'scheduled'];
    let totalShown = 0;
    const maxShow = 20;
    
    priorities.forEach(priority => {
      if (totalShown >= maxShow) return;
      
      const queueInfo = this.data.queue.queues[priority];
      if (queueInfo && queueInfo.size > 0) {
        // 実際のタスクデータがない場合のサンプル表示
        for (let i = 0; i < Math.min(queueInfo.size, maxShow - totalShown); i++) {
          const taskItem = document.createElement('div');
          taskItem.className = `queue-item ${priority}`;
          
          taskItem.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong>Task #${i + 1}</strong> (${priority})
                <div style="font-size: 0.9em; color: #666;">
                  ${queueInfo.oldestTask ? `登録: ${new Date(queueInfo.oldestTask).toLocaleTimeString()}` : ''}
                </div>
              </div>
              <button class="btn btn-secondary btn-sm" onclick="removeTask('task-${priority}-${i}')">
                削除
              </button>
            </div>
          `;
          
          queueList.appendChild(taskItem);
          totalShown++;
        }
      }
    });
    
    if (totalShown === 0) {
      queueList.innerHTML = '<div style="text-align: center; color: #666; padding: 2rem;">キューは空です</div>';
    }
  }
  
  /**
   * チャートの更新
   */
  updateCharts() {
    if (!this.data.usage) return;
    
    const now = new Date();
    const timeLabel = now.toLocaleTimeString();
    
    // 使用量チャート
    const usageChart = this.charts.usage;
    const usage = this.data.usage.currentWindow || {};
    
    usageChart.data.labels.push(timeLabel);
    usageChart.data.datasets[0].data.push(usage.requestsPerMinute || 0);
    
    // 過去20ポイントのみ保持
    if (usageChart.data.labels.length > 20) {
      usageChart.data.labels.shift();
      usageChart.data.datasets[0].data.shift();
    }
    
    usageChart.update('none');
    
    // パフォーマンスチャート
    const perfChart = this.charts.performance;
    perfChart.data.labels.push(timeLabel);
    perfChart.data.datasets[0].data.push(usage.averageResponseTime || 0);
    
    if (perfChart.data.labels.length > 20) {
      perfChart.data.labels.shift();
      perfChart.data.datasets[0].data.shift();
    }
    
    perfChart.update('none');
    
    // エラー率チャート
    const errorChart = this.charts.error;
    errorChart.data.labels.push(timeLabel);
    errorChart.data.datasets[0].data.push((usage.errorRate || 0) * 100);
    
    if (errorChart.data.labels.length > 20) {
      errorChart.data.labels.shift();
      errorChart.data.datasets[0].data.shift();
    }
    
    errorChart.update('none');
  }
  
  /**
   * ボタン状態の更新
   */
  updateButtonStates() {
    const isPaused = this.data.queue?.isPaused;
    
    document.getElementById('resumeBtn').disabled = !isPaused;
    document.getElementById('pauseBtn').disabled = isPaused;
  }
  
  /**
   * アラートの表示
   */
  showAlert(type, message, duration = 5000) {
    const alertContainer = document.getElementById('alertContainer');
    
    const alert = document.createElement('div');
    alert.className = `alert alert-${type} show`;
    alert.innerHTML = `
      <strong>${type === 'danger' ? 'エラー' : type === 'warning' ? '警告' : type === 'success' ? '成功' : '情報'}:</strong>
      ${message}
      <button type="button" style="float: right; background: none; border: none; font-size: 1.2em; cursor: pointer;" onclick="this.parentElement.remove()">×</button>
    `;
    
    alertContainer.appendChild(alert);
    
    // 自動削除
    setTimeout(() => {
      if (alert.parentElement) {
        alert.remove();
      }
    }, duration);
  }
}

// グローバル関数（HTML側から呼び出し）
let dashboard;

window.addEventListener('DOMContentLoaded', () => {
  dashboard = new CCSPDashboard();
});

// 制御関数
async function pauseQueue() {
  try {
    await dashboard.fetchAPI('/api/ccsp/queue/pause', { method: 'POST' });
    dashboard.showAlert('success', 'キューを一時停止しました');
  } catch (error) {
    dashboard.showAlert('warning', 'CCSP未接続のためモック動作: キューを一時停止しました');
    if (dashboard.data.queue) {
      dashboard.data.queue.isPaused = true;
      dashboard.updateButtonStates();
    }
  }
}

async function resumeQueue() {
  try {
    await dashboard.fetchAPI('/api/ccsp/queue/resume', { method: 'POST' });
    dashboard.showAlert('success', 'キューを再開しました');
  } catch (error) {
    dashboard.showAlert('warning', 'CCSP未接続のためモック動作: キューを再開しました');
    if (dashboard.data.queue) {
      dashboard.data.queue.isPaused = false;
      dashboard.updateButtonStates();
    }
  }
}

async function emergencyStop() {
  if (!confirm('緊急停止を実行しますか？すべての処理が停止されます。')) {
    return;
  }
  
  try {
    await dashboard.fetchAPI('/api/ccsp/control/emergency-stop', { 
      method: 'POST',
      body: JSON.stringify({ reason: 'Manual emergency stop from dashboard' }),
      headers: { 'Content-Type': 'application/json' }
    });
    dashboard.showAlert('warning', '緊急停止を実行しました');
  } catch (error) {
    dashboard.showAlert('warning', 'CCSP未接続のためモック動作: 緊急停止を実行しました');
  }
}

async function clearQueue() {
  if (!confirm('キューをクリアしますか？すべての待機中タスクが削除されます。')) {
    return;
  }
  
  try {
    await dashboard.fetchAPI('/api/ccsp/queue/clear', { method: 'DELETE' });
    dashboard.showAlert('success', 'キューをクリアしました');
  } catch (error) {
    dashboard.showAlert('warning', 'CCSP未接続のためモック動作: キューをクリアしました');
    if (dashboard.data.queue) {
      // モックでキューをクリア
      Object.keys(dashboard.data.queue.queues).forEach(priority => {
        dashboard.data.queue.queues[priority].size = 0;
      });
      dashboard.data.queue.totalQueueSize = 0;
      dashboard.updateQueueDisplay();
    }
  }
}

async function removeTask(taskId) {
  try {
    await dashboard.fetchAPI(`/api/ccsp/queue/task/${taskId}`, { method: 'DELETE' });
    dashboard.showAlert('success', 'タスクを削除しました');
  } catch (error) {
    dashboard.showAlert('danger', 'タスクの削除に失敗しました: ' + error.message);
  }
}

async function refreshData() {
  try {
    await dashboard.loadInitialData();
    dashboard.showAlert('success', 'データを更新しました');
  } catch (error) {
    dashboard.showAlert('danger', 'データの更新に失敗しました: ' + error.message);
  }
}

// タブ切り替え
function switchTab(tabName) {
  // タブの切り替え
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  
  document.querySelector(`[onclick="switchTab('${tabName}')"]`).classList.add('active');
  document.getElementById(tabName).classList.add('active');
  
  dashboard.currentTab = tabName;
  
  // タブに応じたデータ更新
  if (tabName === 'agents') {
    dashboard.updateAgentDisplay();
  }
}