/**
 * パフォーマンス分析機能
 */
class AnalyticsManager {
  constructor() {
    this.chart = null;
    this.initializeEventListeners();
    this.loadStatistics('claude-cli');
  }
  
  initializeEventListeners() {
    // タブ切り替え
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.target.dataset.tab;
        this.switchTab(tab);
      });
    });
    
    // 統計情報タブ
    document.getElementById('refreshStatsBtn').addEventListener('click', () => {
      const taskType = document.getElementById('statsTaskType').value;
      this.loadStatistics(taskType);
    });
    
    // トレンドタブ
    document.getElementById('refreshTrendsBtn').addEventListener('click', () => {
      const taskType = document.getElementById('trendsTaskType').value;
      const metric = document.getElementById('trendsMetric').value;
      const days = document.getElementById('trendsDays').value;
      this.loadTrends(taskType, metric, days);
    });
    
    // 履歴タブ
    document.getElementById('refreshHistoryBtn').addEventListener('click', () => {
      this.loadHistory();
    });
    
    document.getElementById('exportHistoryBtn').addEventListener('click', () => {
      this.exportHistory();
    });
  }
  
  switchTab(tabName) {
    // タブボタンの切り替え
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    
    // タブコンテンツの切り替え
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.id === `${tabName}Tab`);
    });
    
    // 初回ロード
    if (tabName === 'trends' && !this.chart) {
      this.loadTrends('claude-cli', 'duration_ms', 7);
    } else if (tabName === 'history') {
      this.loadHistory();
    }
  }
  
  async loadStatistics(taskType) {
    const container = document.getElementById('statsContainer');
    container.innerHTML = '<div class="loading">統計データを読み込み中...</div>';
    
    try {
      const response = await fetch(`/api/analytics/statistics/${taskType}`);
      if (!response.ok) throw new Error('統計データの取得に失敗しました');
      
      const data = await response.json();
      this.renderStatistics(data.statistics);
    } catch (error) {
      console.error('統計データ取得エラー:', error);
      container.innerHTML = `<div class="error">エラー: ${error.message}</div>`;
    }
  }
  
  renderStatistics(stats) {
    const container = document.getElementById('statsContainer');
    container.innerHTML = `
      <div class="stat-card">
        <h4>総実行数</h4>
        <div class="value">${stats.totalCount}</div>
      </div>
      <div class="stat-card">
        <h4>成功率</h4>
        <div class="value">${stats.successRate}<span class="unit">%</span></div>
      </div>
      <div class="stat-card">
        <h4>平均実行時間</h4>
        <div class="value">${this.formatDuration(stats.avgDuration)}</div>
      </div>
      <div class="stat-card">
        <h4>最短実行時間</h4>
        <div class="value">${this.formatDuration(stats.minDuration)}</div>
      </div>
      <div class="stat-card">
        <h4>最長実行時間</h4>
        <div class="value">${this.formatDuration(stats.maxDuration)}</div>
      </div>
      <div class="stat-card">
        <h4>平均メモリ使用量</h4>
        <div class="value">${stats.avgMemoryUsage}<span class="unit">MB</span></div>
      </div>
    `;
  }
  
  async loadTrends(taskType, metric, days) {
    try {
      const response = await fetch(`/api/analytics/trends/${taskType}?metric=${metric}&days=${days}`);
      if (!response.ok) throw new Error('トレンドデータの取得に失敗しました');
      
      const data = await response.json();
      this.renderTrendsChart(data);
    } catch (error) {
      console.error('トレンドデータ取得エラー:', error);
    }
  }
  
  renderTrendsChart(data) {
    const ctx = document.getElementById('trendsCanvas').getContext('2d');
    
    // 既存のチャートを破棄
    if (this.chart) {
      this.chart.destroy();
    }
    
    const labels = data.data.map(d => d.date);
    const avgValues = data.data.map(d => d.avgValue);
    const minValues = data.data.map(d => d.minValue);
    const maxValues = data.data.map(d => d.maxValue);
    
    const metricLabels = {
      duration_ms: '実行時間 (秒)',
      memory_usage: 'メモリ使用量 (MB)',
      cpu_usage: 'CPU使用率 (%)'
    };
    
    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: '平均',
            data: avgValues,
            borderColor: 'rgb(75, 192, 192)',
            backgroundColor: 'rgba(75, 192, 192, 0.2)',
            tension: 0.1
          },
          {
            label: '最小',
            data: minValues,
            borderColor: 'rgb(54, 162, 235)',
            backgroundColor: 'rgba(54, 162, 235, 0.2)',
            tension: 0.1
          },
          {
            label: '最大',
            data: maxValues,
            borderColor: 'rgb(255, 99, 132)',
            backgroundColor: 'rgba(255, 99, 132, 0.2)',
            tension: 0.1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: `${data.taskType} - ${metricLabels[data.metric]} (過去${data.days}日間)`
          },
          legend: {
            position: 'top'
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: function(value) {
                if (data.metric === 'duration_ms') {
                  return (value / 1000).toFixed(1) + 's';
                }
                return value;
              }
            }
          }
        }
      }
    });
  }
  
  async loadHistory() {
    const container = document.getElementById('historyContainer');
    container.innerHTML = '<div class="loading">実行履歴を読み込み中...</div>';
    
    const taskType = document.getElementById('historyTaskType').value;
    const status = document.getElementById('historyStatus').value;
    
    try {
      let url = '/api/analytics/history?limit=100';
      if (taskType) url += `&taskType=${taskType}`;
      if (status) url += `&status=${status}`;
      
      const response = await fetch(url);
      if (!response.ok) throw new Error('履歴データの取得に失敗しました');
      
      const data = await response.json();
      this.renderHistory(data.data);
    } catch (error) {
      console.error('履歴データ取得エラー:', error);
      container.innerHTML = `<div class="error">エラー: ${error.message}</div>`;
    }
  }
  
  renderHistory(history) {
    const container = document.getElementById('historyContainer');
    
    if (history.length === 0) {
      container.innerHTML = '<div class="no-data">履歴データがありません</div>';
      return;
    }
    
    const tableHtml = `
      <table class="history-table">
        <thead>
          <tr>
            <th>開始時刻</th>
            <th>タスクタイプ</th>
            <th>Issue #</th>
            <th>ステータス</th>
            <th>実行時間</th>
            <th>メモリ</th>
          </tr>
        </thead>
        <tbody>
          ${history.map(item => `
            <tr>
              <td>${new Date(item.started_at).toLocaleString('ja-JP')}</td>
              <td>${item.task_type}</td>
              <td>${item.issue_number || '-'}</td>
              <td><span class="history-status status-${item.status}">${item.status}</span></td>
              <td>${this.formatDuration(item.duration_ms)}</td>
              <td>${item.memory_usage || 0} MB</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    
    container.innerHTML = tableHtml;
  }
  
  async exportHistory() {
    const format = confirm('CSV形式でエクスポートしますか？\n（キャンセルでJSON形式）') ? 'csv' : 'json';
    
    try {
      const response = await fetch(`/api/analytics/export?format=${format}&type=history`);
      if (!response.ok) throw new Error('エクスポートに失敗しました');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `poppo-history-${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('エクスポートエラー:', error);
      alert('エクスポートに失敗しました: ' + error.message);
    }
  }
  
  formatDuration(ms) {
    if (!ms) return '-';
    
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) {
      return `${seconds}秒`;
    }
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes < 60) {
      return `${minutes}分${remainingSeconds}秒`;
    }
    
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}時間${remainingMinutes}分`;
  }
}

// ページ読み込み時に初期化
document.addEventListener('DOMContentLoaded', () => {
  window.analyticsManager = new AnalyticsManager();
});