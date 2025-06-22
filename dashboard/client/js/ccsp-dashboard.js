/**
 * CCSP Dashboard Client-side JavaScript
 * Handles UI interactions and real-time updates
 */

(function() {
  'use strict';

  // API基底URL
  const API_BASE = '/api/ccsp';
  
  // グローバル変数
  let charts = {};
  let updateInterval = null;
  let isPolling = true;
  
  // 初期化
  document.addEventListener('DOMContentLoaded', function() {
    initializeEventHandlers();
    initializeCharts();
    startPolling();
  });
  
  /**
   * イベントハンドラーの初期化
   */
  function initializeEventHandlers() {
    // 更新ボタン
    document.getElementById('refreshBtn').addEventListener('click', refreshDashboard);
    
    // 一時停止/再開ボタン
    document.getElementById('pauseBtn').addEventListener('click', pauseQueue);
    document.getElementById('resumeBtn').addEventListener('click', resumeQueue);
    
    // タブ切り替え
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', switchTab);
    });
    
    // 優先度フィルター
    document.getElementById('priorityFilter').addEventListener('change', filterQueues);
    
    // キュークリアボタン
    document.getElementById('clearQueueBtn').addEventListener('click', clearQueue);
    
    // 制御パネル
    document.getElementById('setThrottleBtn').addEventListener('click', setThrottle);
    document.getElementById('setConcurrencyBtn').addEventListener('click', setConcurrency);
    document.getElementById('setQueueLimitBtn').addEventListener('click', setQueueLimit);
  }
  
  /**
   * チャートの初期化
   */
  function initializeCharts() {
    // 5分間チャート
    const ctx5m = document.getElementById('last5MinutesChart').getContext('2d');
    charts.last5Minutes = new Chart(ctx5m, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'トークン',
          data: [],
          borderColor: '#3498db',
          backgroundColor: 'rgba(52, 152, 219, 0.1)',
          yAxisID: 'y-tokens'
        }, {
          label: 'リクエスト',
          data: [],
          borderColor: '#e74c3c',
          backgroundColor: 'rgba(231, 76, 60, 0.1)',
          yAxisID: 'y-requests'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            display: true,
            title: {
              display: true,
              text: '時間'
            }
          },
          'y-tokens': {
            type: 'linear',
            display: true,
            position: 'left',
            title: {
              display: true,
              text: 'トークン'
            }
          },
          'y-requests': {
            type: 'linear',
            display: true,
            position: 'right',
            title: {
              display: true,
              text: 'リクエスト'
            },
            grid: {
              drawOnChartArea: false
            }
          }
        }
      }
    });
    
    // 60分間チャート
    const ctx60m = document.getElementById('last60MinutesChart').getContext('2d');
    charts.last60Minutes = new Chart(ctx60m, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'トークン',
          data: [],
          borderColor: '#3498db',
          backgroundColor: 'rgba(52, 152, 219, 0.1)'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false
      }
    });
    
    // 時間別パターンチャート
    const ctxHourly = document.getElementById('hourlyPatternChart').getContext('2d');
    charts.hourlyPattern = new Chart(ctxHourly, {
      type: 'bar',
      data: {
        labels: Array.from({length: 24}, (_, i) => `${i}:00`),
        datasets: [{
          label: '平均トークン使用量',
          data: new Array(24).fill(0),
          backgroundColor: '#3498db'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    });
  }
  
  /**
   * ポーリングの開始
   */
  function startPolling() {
    // 初回更新
    refreshDashboard();
    
    // 定期更新（5秒ごと）
    updateInterval = setInterval(() => {
      if (isPolling) {
        refreshDashboard();
      }
    }, 5000);
  }
  
  /**
   * ダッシュボードの更新
   */
  async function refreshDashboard() {
    try {
      // レート制限状態を更新
      await updateRateLimitStatus();
      
      // キュー状態を更新
      await updateQueueStatus();
      
      // 統計情報を更新
      await updateStatistics();
      
    } catch (error) {
      console.error('Dashboard refresh error:', error);
    }
  }
  
  /**
   * レート制限状態の更新
   */
  async function updateRateLimitStatus() {
    try {
      const response = await fetch(`${API_BASE}/rate-limit/status`);
      const data = await response.json();
      
      // トークン使用率
      const tokenPercent = data.utilization.tokens;
      const tokenProgress = document.getElementById('tokenProgress');
      tokenProgress.style.width = `${Math.min(tokenPercent, 100)}%`;
      tokenProgress.className = getProgressClass(tokenPercent);
      
      document.getElementById('tokenUsage').textContent = 
        `${formatNumber(data.predictions.tokensPerMinute * 60)} / ${formatNumber(100000)}`;
      document.getElementById('tokenPercent').textContent = `${tokenPercent.toFixed(1)}%`;
      
      // リクエスト使用率
      const requestPercent = data.utilization.requests;
      const requestProgress = document.getElementById('requestProgress');
      requestProgress.style.width = `${Math.min(requestPercent, 100)}%`;
      requestProgress.className = getProgressClass(requestPercent);
      
      document.getElementById('requestUsage').textContent = 
        `${Math.round(data.predictions.requestsPerMinute * 60)} / 50`;
      document.getElementById('requestPercent').textContent = `${requestPercent.toFixed(1)}%`;
      
      // 予測
      document.getElementById('tokenLimitTime').textContent = 
        formatTime(data.predictions.timeToTokenLimit);
      document.getElementById('requestLimitTime').textContent = 
        formatTime(data.predictions.timeToRequestLimit);
      document.getElementById('recommendedDelay').textContent = 
        `${data.recommendations.delay}ms`;
      
      // 推奨アクション
      const actionDiv = document.getElementById('recommendedAction');
      actionDiv.textContent = data.recommendations.action.replace('_', ' ');
      actionDiv.className = `action-${data.recommendations.action.toLowerCase().replace('_', '-')}`;
      
    } catch (error) {
      console.error('Rate limit status update error:', error);
    }
  }
  
  /**
   * キュー状態の更新
   */
  async function updateQueueStatus() {
    try {
      const response = await fetch(`${API_BASE}/queue/status`);
      const data = await response.json();
      
      let totalSize = 0;
      
      // 各優先度のキュー状態を更新
      Object.entries(data.queues).forEach(([priority, info]) => {
        const queueItem = document.querySelector(`.queue-item[data-priority="${priority}"]`);
        if (queueItem) {
          queueItem.querySelector('.queue-count').textContent = info.size;
          
          const oldest = info.oldest ? formatTimestamp(info.oldest) : '-';
          const newest = info.newest ? formatTimestamp(info.newest) : '-';
          
          queueItem.querySelector('.oldest').textContent = `最古: ${oldest}`;
          queueItem.querySelector('.newest').textContent = `最新: ${newest}`;
          
          totalSize += info.size;
        }
      });
      
      // 合計を更新
      document.getElementById('totalQueueSize').textContent = totalSize;
      
      // 一時停止状態を反映
      if (data.paused) {
        document.getElementById('pauseBtn').style.display = 'none';
        document.getElementById('resumeBtn').style.display = 'inline-block';
      } else {
        document.getElementById('pauseBtn').style.display = 'inline-block';
        document.getElementById('resumeBtn').style.display = 'none';
      }
      
    } catch (error) {
      console.error('Queue status update error:', error);
    }
  }
  
  /**
   * 統計情報の更新
   */
  async function updateStatistics() {
    const activeTab = document.querySelector('.tab-btn.active').dataset.tab;
    
    switch (activeTab) {
      case 'realtime':
        await updateRealtimeStats();
        break;
      case 'agents':
        await updateAgentStats();
        break;
      case 'errors':
        await updateErrorStats();
        break;
      case 'patterns':
        await updatePatternStats();
        break;
    }
  }
  
  /**
   * リアルタイム統計の更新
   */
  async function updateRealtimeStats() {
    try {
      const response = await fetch(`${API_BASE}/stats/usage?period=realtime`);
      const data = await response.json();
      
      // 現在の統計
      document.getElementById('currentTokens').textContent = formatNumber(data.current.tokens);
      document.getElementById('currentRequests').textContent = data.current.requests;
      document.getElementById('currentLatency').textContent = 
        Math.round(data.current.avgLatency || 0);
      
      // 5分間チャートを更新
      updateChart(charts.last5Minutes, data.last5Minutes);
      
      // 60分間チャートを更新
      updateChart(charts.last60Minutes, data.last60Minutes);
      
    } catch (error) {
      console.error('Realtime stats update error:', error);
    }
  }
  
  /**
   * エージェント別統計の更新
   */
  async function updateAgentStats() {
    try {
      const response = await fetch(`${API_BASE}/stats/agents`);
      const agents = await response.json();
      
      const tbody = document.getElementById('agentsTableBody');
      tbody.innerHTML = '';
      
      agents.forEach(agent => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${agent.agentId}</td>
          <td>${formatNumber(agent.totalTokens)}</td>
          <td>${agent.totalRequests}</td>
          <td>${agent.totalErrors}</td>
          <td>${Math.round(agent.avgLatency || 0)}ms</td>
          <td>${formatTimestamp(agent.lastSeen)}</td>
        `;
        tbody.appendChild(row);
      });
      
    } catch (error) {
      console.error('Agent stats update error:', error);
    }
  }
  
  /**
   * エラー統計の更新
   */
  async function updateErrorStats() {
    try {
      const response = await fetch(`${API_BASE}/stats/errors`);
      const data = await response.json();
      
      // サマリーを更新
      document.getElementById('totalErrors').textContent = data.summary.total;
      document.getElementById('errorTypes').textContent = data.summary.types;
      document.getElementById('affectedAgents').textContent = data.summary.affectedAgents;
      
      // 最近のエラーリストを更新
      const errorList = document.getElementById('recentErrors');
      errorList.innerHTML = '';
      
      data.recent.forEach(error => {
        const errorItem = document.createElement('div');
        errorItem.className = 'error-item';
        errorItem.innerHTML = `
          <div><strong>${error.type}</strong> - ${error.agentId}</div>
          <div>${error.message}</div>
          <div class="error-time">${formatTimestamp(error.timestamp)}</div>
        `;
        errorList.appendChild(errorItem);
      });
      
    } catch (error) {
      console.error('Error stats update error:', error);
    }
  }
  
  /**
   * パターン統計の更新
   */
  async function updatePatternStats() {
    try {
      const response = await fetch(`${API_BASE}/stats/patterns`);
      const data = await response.json();
      
      // ピーク時間
      const peakHours = document.getElementById('peakHours');
      peakHours.innerHTML = '';
      data.peakHours.forEach(hour => {
        const span = document.createElement('span');
        span.className = 'hour';
        span.textContent = `${hour}:00`;
        peakHours.appendChild(span);
      });
      
      // 静かな時間
      const quietHours = document.getElementById('quietHours');
      quietHours.innerHTML = '';
      data.quietHours.forEach(hour => {
        const span = document.createElement('span');
        span.className = 'hour';
        span.textContent = `${hour}:00`;
        quietHours.appendChild(span);
      });
      
      // トレンド
      const trendDiv = document.getElementById('usageTrend');
      trendDiv.textContent = getTrendSymbol(data.trend);
      trendDiv.className = `trend-indicator ${data.trend}`;
      
      // 時間別パターンチャートを更新
      if (data.hourlyPattern) {
        charts.hourlyPattern.data.datasets[0].data = data.hourlyPattern;
        charts.hourlyPattern.update();
      }
      
    } catch (error) {
      console.error('Pattern stats update error:', error);
    }
  }
  
  /**
   * タブ切り替え
   */
  function switchTab(event) {
    const targetTab = event.target.dataset.tab;
    
    // タブボタンのアクティブ状態を更新
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // タブコンテンツの表示を更新
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.remove('active');
    });
    document.getElementById(`${targetTab}Tab`).classList.add('active');
    
    // 統計情報を更新
    updateStatistics();
  }
  
  /**
   * キューフィルター
   */
  function filterQueues() {
    const filter = document.getElementById('priorityFilter').value;
    
    document.querySelectorAll('.queue-item').forEach(item => {
      if (filter === 'all' || item.dataset.priority === filter || item.classList.contains('queue-total')) {
        item.style.display = 'block';
      } else {
        item.style.display = 'none';
      }
    });
  }
  
  /**
   * キューの一時停止
   */
  async function pauseQueue() {
    try {
      const response = await fetch(`${API_BASE}/queue/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Manual pause from dashboard' })
      });
      
      if (response.ok) {
        await refreshDashboard();
      }
    } catch (error) {
      console.error('Queue pause error:', error);
    }
  }
  
  /**
   * キューの再開
   */
  async function resumeQueue() {
    try {
      const response = await fetch(`${API_BASE}/queue/resume`, {
        method: 'POST'
      });
      
      if (response.ok) {
        await refreshDashboard();
      }
    } catch (error) {
      console.error('Queue resume error:', error);
    }
  }
  
  /**
   * キューのクリア
   */
  async function clearQueue() {
    const priority = document.getElementById('priorityFilter').value;
    const confirm = window.confirm(`${priority === 'all' ? '全て' : priority}のキューをクリアしますか？`);
    
    if (!confirm) return;
    
    try {
      const url = priority === 'all' 
        ? `${API_BASE}/queue/clear`
        : `${API_BASE}/queue/clear?priority=${priority}`;
        
      const response = await fetch(url, { method: 'DELETE' });
      
      if (response.ok) {
        await refreshDashboard();
      }
    } catch (error) {
      console.error('Queue clear error:', error);
    }
  }
  
  /**
   * スロットリング設定
   */
  async function setThrottle() {
    const delay = parseInt(document.getElementById('throttleDelay').value);
    
    try {
      const response = await fetch(`${API_BASE}/throttle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delay })
      });
      
      if (response.ok) {
        alert(`スロットリング遅延を ${delay}ms に設定しました`);
      }
    } catch (error) {
      console.error('Set throttle error:', error);
    }
  }
  
  /**
   * 同時実行数設定
   */
  async function setConcurrency() {
    const count = parseInt(document.getElementById('concurrency').value);
    
    try {
      const response = await fetch(`${API_BASE}/concurrency`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count })
      });
      
      if (response.ok) {
        alert(`同時実行数を ${count} に設定しました`);
      }
    } catch (error) {
      console.error('Set concurrency error:', error);
    }
  }
  
  /**
   * キューサイズ制限設定
   */
  async function setQueueLimit() {
    const limit = parseInt(document.getElementById('queueSizeLimit').value);
    
    // 実際のAPIはキューマネージャーの実装に依存
    alert(`キューサイズ制限を ${limit} に設定しました（未実装）`);
  }
  
  /**
   * ヘルパー関数
   */
  
  function getProgressClass(percent) {
    if (percent >= 90) return 'progress-fill danger';
    if (percent >= 70) return 'progress-fill warning';
    return 'progress-fill';
  }
  
  function formatNumber(num) {
    return new Intl.NumberFormat('ja-JP').format(Math.round(num));
  }
  
  function formatTime(seconds) {
    if (seconds === Infinity || seconds === null) return '∞';
    if (seconds <= 0) return '0秒';
    
    if (seconds < 60) return `${Math.round(seconds)}秒`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}分`;
    return `${Math.round(seconds / 3600)}時間`;
  }
  
  function formatTimestamp(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ja-JP');
  }
  
  function getTrendSymbol(trend) {
    switch (trend) {
      case 'increasing': return '↗ 増加中';
      case 'decreasing': return '↘ 減少中';
      default: return '→ 安定';
    }
  }
  
  function updateChart(chart, data) {
    if (!data || data.length === 0) return;
    
    const labels = data.map((_, i) => `${i + 1}分前`).reverse();
    const tokens = data.map(d => d.tokens || 0).reverse();
    const requests = data.map(d => d.requests || 0).reverse();
    
    chart.data.labels = labels;
    chart.data.datasets[0].data = tokens;
    
    if (chart.data.datasets[1]) {
      chart.data.datasets[1].data = requests;
    }
    
    chart.update();
  }
  
  // クリーンアップ
  window.addEventListener('beforeunload', () => {
    if (updateInterval) {
      clearInterval(updateInterval);
    }
  });
  
})();