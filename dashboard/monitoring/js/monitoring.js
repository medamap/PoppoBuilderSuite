/**
 * Monitoring Dashboard Client-side JavaScript
 */

// WebSocket connection
let ws = null;
let reconnectInterval = null;
let reconnectAttempts = 0;

// Charts
let metricsChart = null;
let currentChartType = 'system';

// Current data
let currentMetrics = null;
let activeAlerts = [];
let selectedAlert = null;

// Initialize dashboard
window.addEventListener('DOMContentLoaded', () => {
  initializeWebSocket();
  initializeCharts();
  setupEventListeners();
});

/**
 * Initialize WebSocket connection
 */
function initializeWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  try {
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('WebSocket connected');
      updateConnectionStatus('connected');
      reconnectAttempts = 0;
      
      // Clear any reconnect interval
      if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
      }
    };
    
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected');
      updateConnectionStatus('disconnected');
      attemptReconnect();
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      updateConnectionStatus('disconnected');
    };
    
  } catch (error) {
    console.error('Failed to initialize WebSocket:', error);
    updateConnectionStatus('disconnected');
    attemptReconnect();
  }
}

/**
 * Attempt to reconnect WebSocket
 */
function attemptReconnect() {
  if (reconnectInterval) return;
  
  reconnectInterval = setInterval(() => {
    reconnectAttempts++;
    console.log(`Attempting to reconnect... (attempt ${reconnectAttempts})`);
    updateConnectionStatus('connecting');
    initializeWebSocket();
  }, 5000);
}

/**
 * Handle WebSocket message
 */
function handleWebSocketMessage(message) {
  const { type, data } = message;
  
  switch (type) {
    case 'initial':
      handleInitialData(data);
      break;
      
    case 'update':
      handleUpdate(data);
      break;
      
    case 'metrics':
      handleMetricsUpdate(data);
      break;
      
    case 'alert-triggered':
      handleAlertTriggered(data);
      break;
      
    case 'alert-resolved':
      handleAlertResolved(data);
      break;
      
    case 'history':
      handleHistoryData(data);
      break;
      
    case 'pong':
      // Keep-alive response
      break;
      
    default:
      console.warn('Unknown message type:', type);
  }
}

/**
 * Handle initial data
 */
function handleInitialData(data) {
  const { metrics, alerts, systemInfo } = data;
  
  // Update metrics
  if (metrics) {
    currentMetrics = metrics;
    updateMetricsDisplay(metrics);
    updateCharts(metrics);
  }
  
  // Update alerts
  if (alerts) {
    activeAlerts = alerts;
    updateAlertsDisplay(alerts);
  }
  
  // Update system info
  if (systemInfo) {
    updateSystemInfo(systemInfo);
  }
}

/**
 * Handle periodic update
 */
function handleUpdate(data) {
  const { metrics, alerts } = data;
  
  if (metrics) {
    currentMetrics = metrics;
    updateMetricsDisplay(metrics);
    updateCharts(metrics);
  }
  
  if (alerts) {
    activeAlerts = alerts;
    updateAlertsDisplay(alerts);
  }
}

/**
 * Handle metrics update
 */
function handleMetricsUpdate(metrics) {
  currentMetrics = metrics;
  updateMetricsDisplay(metrics);
  updateCharts(metrics);
}

/**
 * Handle alert triggered
 */
function handleAlertTriggered(alert) {
  // Add to active alerts
  activeAlerts.push(alert);
  updateAlertsDisplay(activeAlerts);
  
  // Show notification
  showNotification(`Alert: ${alert.name}`, alert.description, alert.severity);
}

/**
 * Handle alert resolved
 */
function handleAlertResolved(alert) {
  // Remove from active alerts
  activeAlerts = activeAlerts.filter(a => a.id !== alert.id);
  updateAlertsDisplay(activeAlerts);
  
  // Show notification
  showNotification(`Alert Resolved: ${alert.name}`, 'The alert has been resolved', 'success');
}

/**
 * Initialize charts
 */
function initializeCharts() {
  const ctx = document.getElementById('metricsChart').getContext('2d');
  
  metricsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: []
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
        },
        title: {
          display: false
        }
      },
      scales: {
        x: {
          type: 'time',
          time: {
            tooltipFormat: 'HH:mm:ss',
            displayFormats: {
              second: 'HH:mm:ss',
              minute: 'HH:mm'
            }
          }
        },
        y: {
          beginAtZero: true
        }
      }
    }
  });
}

/**
 * Update metrics display
 */
function updateMetricsDisplay(metrics) {
  if (!metrics) return;
  
  // Update system metrics
  if (metrics.system) {
    const cpu = metrics.system.cpu?.usage || 0;
    const memory = metrics.system.memory?.usagePercent || 0;
    
    updateMetric('cpuUsage', `${Math.round(cpu)}%`, cpu);
    updateMetric('memoryUsage', `${Math.round(memory)}%`, memory);
  }
  
  // Update business metrics
  if (metrics.business) {
    const { issues, performance } = metrics.business;
    
    if (issues) {
      document.getElementById('issuesProcessed').textContent = issues.processed || 0;
      document.getElementById('successRate').textContent = `${Math.round(issues.successRate || 0)}%`;
      document.getElementById('queueSize').textContent = issues.queueSize || 0;
    }
    
    if (performance) {
      const avgTime = performance.avgProcessingTime || 0;
      document.getElementById('avgProcessingTime').textContent = `${avgTime.toFixed(1)}s`;
    }
  }
  
  // Update health score
  updateHealthScore(metrics);
}

/**
 * Update metric display with bar
 */
function updateMetric(elementId, value, percentage) {
  document.getElementById(elementId).textContent = value;
  
  const bar = document.getElementById(elementId.replace('Usage', 'Bar'));
  if (bar) {
    bar.style.width = `${percentage}%`;
    
    // Change color based on percentage
    bar.classList.remove('warning', 'danger');
    if (percentage > 90) {
      bar.classList.add('danger');
    } else if (percentage > 75) {
      bar.classList.add('warning');
    }
  }
}

/**
 * Update health score
 */
function updateHealthScore(metrics) {
  let score = 100;
  let status = 'healthy';
  
  // Calculate based on metrics
  if (metrics.system) {
    const cpu = metrics.system.cpu?.usage || 0;
    const memory = metrics.system.memory?.usagePercent || 0;
    
    if (cpu > 80) score -= 10;
    if (cpu > 90) score -= 10;
    if (memory > 80) score -= 10;
    if (memory > 90) score -= 10;
  }
  
  // Deduct for active alerts
  const criticalAlerts = activeAlerts.filter(a => a.severity === 'critical').length;
  const warningAlerts = activeAlerts.filter(a => a.severity === 'warning').length;
  
  score -= criticalAlerts * 20;
  score -= warningAlerts * 10;
  
  score = Math.max(0, Math.min(100, score));
  
  // Determine status
  if (score < 60 || criticalAlerts > 0) {
    status = 'critical';
  } else if (score < 80 || warningAlerts > 2) {
    status = 'warning';
  }
  
  // Update display
  const scoreElement = document.querySelector('.score-value');
  const statusBadge = document.querySelector('.status-badge');
  const scoreCircle = document.querySelector('.score-circle');
  
  scoreElement.textContent = score;
  statusBadge.textContent = status.charAt(0).toUpperCase() + status.slice(1);
  statusBadge.className = `status-badge ${status}`;
  
  // Update score circle
  const degrees = (score / 100) * 360;
  scoreCircle.style.background = `conic-gradient(var(--success-color) ${degrees}deg, var(--background) 0deg)`;
}

/**
 * Update alerts display
 */
function updateAlertsDisplay(alerts) {
  const container = document.getElementById('alertsContainer');
  
  // Update alert counts
  const criticalCount = alerts.filter(a => a.severity === 'critical').length;
  const warningCount = alerts.filter(a => a.severity === 'warning').length;
  
  document.getElementById('activeAlerts').textContent = alerts.length;
  document.getElementById('criticalAlerts').textContent = `${criticalCount} Critical`;
  document.getElementById('warningAlerts').textContent = `${warningCount} Warning`;
  
  // Update alerts list
  if (alerts.length === 0) {
    container.innerHTML = '<div class="no-alerts">No active alerts</div>';
    return;
  }
  
  container.innerHTML = alerts.map(alert => `
    <div class="alert-item ${alert.severity}" onclick="showAlertDetails('${alert.id}')">
      <div class="alert-header">
        <span class="alert-name">${alert.name}</span>
        <span class="alert-time">${formatTime(alert.timestamp)}</span>
      </div>
      <div class="alert-description">${alert.description}</div>
    </div>
  `).join('');
}

/**
 * Update system info
 */
function updateSystemInfo(info) {
  const container = document.getElementById('systemInfo');
  
  const formatMemory = (bytes) => {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(2)} GB`;
  };
  
  const formatUptime = (seconds) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  };
  
  container.innerHTML = `
    <div class="info-item">
      <span class="info-label">Hostname:</span>
      <span class="info-value">${info.hostname}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Platform:</span>
      <span class="info-value">${info.platform}</span>
    </div>
    <div class="info-item">
      <span class="info-label">CPUs:</span>
      <span class="info-value">${info.cpus}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Total Memory:</span>
      <span class="info-value">${formatMemory(info.totalMemory)}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Node Version:</span>
      <span class="info-value">${info.nodeVersion}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Uptime:</span>
      <span class="info-value">${formatUptime(info.uptime)}</span>
    </div>
  `;
}

/**
 * Update charts
 */
function updateCharts(metrics) {
  if (!metricsChart || !metrics) return;
  
  const timestamp = new Date(metrics.timestamp);
  
  // Add new data point
  metricsChart.data.labels.push(timestamp);
  
  // Keep only last 50 points
  if (metricsChart.data.labels.length > 50) {
    metricsChart.data.labels.shift();
  }
  
  // Update datasets based on current chart type
  updateChartDatasets(currentChartType, metrics);
  
  metricsChart.update('none'); // Update without animation
}

/**
 * Update chart datasets
 */
function updateChartDatasets(type, metrics) {
  let datasets = [];
  
  switch (type) {
    case 'system':
      if (metrics.system) {
        datasets = [
          {
            label: 'CPU Usage (%)',
            data: [],
            borderColor: 'rgb(255, 99, 132)',
            backgroundColor: 'rgba(255, 99, 132, 0.1)',
            tension: 0.4
          },
          {
            label: 'Memory Usage (%)',
            data: [],
            borderColor: 'rgb(54, 162, 235)',
            backgroundColor: 'rgba(54, 162, 235, 0.1)',
            tension: 0.4
          }
        ];
        
        // Populate data
        datasets[0].data.push(metrics.system.cpu?.usage || 0);
        datasets[1].data.push(metrics.system.memory?.usagePercent || 0);
      }
      break;
      
    case 'application':
      if (metrics.application) {
        datasets = [
          {
            label: 'Requests',
            data: [],
            borderColor: 'rgb(75, 192, 192)',
            backgroundColor: 'rgba(75, 192, 192, 0.1)',
            tension: 0.4
          },
          {
            label: 'Errors',
            data: [],
            borderColor: 'rgb(255, 99, 132)',
            backgroundColor: 'rgba(255, 99, 132, 0.1)',
            tension: 0.4
          }
        ];
        
        // Populate data
        datasets[0].data.push(metrics.application.requests?.total || 0);
        datasets[1].data.push(metrics.application.requests?.errors || 0);
      }
      break;
      
    case 'business':
      if (metrics.business) {
        datasets = [
          {
            label: 'Queue Size',
            data: [],
            borderColor: 'rgb(153, 102, 255)',
            backgroundColor: 'rgba(153, 102, 255, 0.1)',
            tension: 0.4
          },
          {
            label: 'Success Rate (%)',
            data: [],
            borderColor: 'rgb(75, 192, 192)',
            backgroundColor: 'rgba(75, 192, 192, 0.1)',
            tension: 0.4,
            yAxisID: 'y1'
          }
        ];
        
        // Populate data
        datasets[0].data.push(metrics.business.issues?.queueSize || 0);
        datasets[1].data.push(metrics.business.issues?.successRate || 0);
      }
      break;
  }
  
  // Update chart datasets
  if (metricsChart.data.datasets.length === 0) {
    metricsChart.data.datasets = datasets;
  } else {
    // Append data to existing datasets
    datasets.forEach((dataset, index) => {
      if (metricsChart.data.datasets[index]) {
        metricsChart.data.datasets[index].data.push(dataset.data[0]);
        
        // Keep only last 50 points
        if (metricsChart.data.datasets[index].data.length > 50) {
          metricsChart.data.datasets[index].data.shift();
        }
      }
    });
  }
}

/**
 * Switch chart type
 */
function switchChart(type) {
  currentChartType = type;
  
  // Update tab buttons
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');
  
  // Clear chart data
  metricsChart.data.labels = [];
  metricsChart.data.datasets = [];
  metricsChart.update();
  
  // Request history for new chart type
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'getHistory',
      data: {
        period: '1h',
        type: type
      }
    }));
  }
}

/**
 * Update connection status
 */
function updateConnectionStatus(status) {
  const statusElement = document.getElementById('connectionStatus');
  const statusText = statusElement.querySelector('.status-text');
  
  statusElement.className = `connection-status ${status}`;
  
  switch (status) {
    case 'connected':
      statusText.textContent = 'Connected';
      break;
    case 'disconnected':
      statusText.textContent = 'Disconnected';
      break;
    case 'connecting':
      statusText.textContent = 'Connecting...';
      break;
  }
}

/**
 * Show alert details
 */
function showAlertDetails(alertId) {
  const alert = activeAlerts.find(a => a.id === alertId);
  if (!alert) return;
  
  selectedAlert = alert;
  
  const detailsElement = document.getElementById('alertDetails');
  detailsElement.innerHTML = `
    <div class="alert-detail-item">
      <span class="alert-detail-label">Alert ID:</span>
      <span class="alert-detail-value">${alert.id}</span>
    </div>
    <div class="alert-detail-item">
      <span class="alert-detail-label">Rule ID:</span>
      <span class="alert-detail-value">${alert.ruleId}</span>
    </div>
    <div class="alert-detail-item">
      <span class="alert-detail-label">Severity:</span>
      <span class="alert-detail-value">${alert.severity}</span>
    </div>
    <div class="alert-detail-item">
      <span class="alert-detail-label">Triggered At:</span>
      <span class="alert-detail-value">${new Date(alert.timestamp).toLocaleString()}</span>
    </div>
    <div class="alert-detail-item">
      <span class="alert-detail-label">Value:</span>
      <span class="alert-detail-value">${alert.value || 'N/A'}</span>
    </div>
    <div class="alert-detail-item">
      <span class="alert-detail-label">Description:</span>
      <span class="alert-detail-value">${alert.description}</span>
    </div>
  `;
  
  const modal = document.getElementById('alertModal');
  modal.classList.add('show');
}

/**
 * Close alert modal
 */
function closeAlertModal() {
  const modal = document.getElementById('alertModal');
  modal.classList.remove('show');
  selectedAlert = null;
}

/**
 * Suppress alert
 */
async function suppressAlert() {
  if (!selectedAlert) return;
  
  try {
    const response = await fetch(`/api/alerts/${selectedAlert.ruleId}/suppress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        duration: 3600000 // 1 hour
      })
    });
    
    if (response.ok) {
      showNotification('Alert Suppressed', `Alert rule ${selectedAlert.ruleId} has been suppressed for 1 hour`, 'success');
      closeAlertModal();
    } else {
      throw new Error('Failed to suppress alert');
    }
  } catch (error) {
    console.error('Failed to suppress alert:', error);
    showNotification('Error', 'Failed to suppress alert', 'error');
  }
}

/**
 * Export metrics
 */
function exportMetrics() {
  const modal = document.getElementById('exportModal');
  modal.classList.add('show');
}

/**
 * Close export modal
 */
function closeExportModal() {
  const modal = document.getElementById('exportModal');
  modal.classList.remove('show');
}

/**
 * Perform export
 */
async function performExport() {
  const format = document.querySelector('input[name="format"]:checked').value;
  const period = document.getElementById('exportPeriod').value;
  
  try {
    const response = await fetch(`/api/export/metrics?format=${format}&period=${period}`);
    
    if (response.ok) {
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `metrics.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      closeExportModal();
      showNotification('Export Complete', 'Metrics exported successfully', 'success');
    } else {
      throw new Error('Failed to export metrics');
    }
  } catch (error) {
    console.error('Failed to export metrics:', error);
    showNotification('Export Failed', 'Failed to export metrics', 'error');
  }
}

/**
 * Refresh dashboard
 */
function refreshDashboard() {
  location.reload();
}

/**
 * Show notification
 */
function showNotification(title, message, type = 'info') {
  // Simple notification implementation
  // In production, use a proper notification library
  console.log(`[${type.toUpperCase()}] ${title}: ${message}`);
}

/**
 * Format time
 */
function formatTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  
  if (diff < 60000) {
    return 'Just now';
  } else if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}m ago`;
  } else if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}h ago`;
  } else {
    return new Date(timestamp).toLocaleDateString();
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Send ping every 30 seconds to keep connection alive
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000);
  
  // Modal close on outside click
  window.onclick = (event) => {
    if (event.target.classList.contains('modal')) {
      event.target.classList.remove('show');
    }
  };
}