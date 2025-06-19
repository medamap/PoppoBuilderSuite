/**
 * マルチプロジェクト統合ダッシュボード
 * プロジェクト横断的な情報表示と管理機能
 */

class MultiProjectDashboard {
  constructor() {
    this.projects = new Map();
    this.metrics = null;
    this.refreshInterval = null;
    this.selectedProjects = new Set();
    this.chartInstances = new Map();
  }

  /**
   * 初期化
   */
  async initialize() {
    // イベントリスナーの設定
    this.setupEventListeners();
    
    // 初期データの読み込み
    await this.loadOverview();
    await this.loadProjects();
    
    // 定期更新の開始
    this.startAutoRefresh();
    
    // グラフの初期化
    this.initializeCharts();
  }

  /**
   * イベントリスナーの設定
   */
  setupEventListeners() {
    // プロジェクトフィルタ
    document.getElementById('project-filter')?.addEventListener('change', (e) => {
      this.filterProjects(e.target.value);
    });
    
    // ソート
    document.getElementById('sort-by')?.addEventListener('change', (e) => {
      this.sortProjects(e.target.value);
    });
    
    // 検索
    document.getElementById('search-input')?.addEventListener('input', (e) => {
      this.searchProjects(e.target.value);
    });
    
    // レポート生成
    document.getElementById('generate-report')?.addEventListener('click', () => {
      this.generateReport();
    });
    
    // プロジェクト比較
    document.getElementById('compare-projects')?.addEventListener('click', () => {
      this.compareProjects();
    });
  }

  /**
   * 概要情報を読み込み
   */
  async loadOverview() {
    try {
      const response = await fetch('/api/multi-project/overview');
      const overview = await response.json();
      
      this.updateOverviewDisplay(overview);
      this.updateMetrics(overview.metrics);
      
    } catch (error) {
      console.error('Failed to load overview:', error);
      this.showError('概要情報の読み込みに失敗しました');
    }
  }

  /**
   * プロジェクト一覧を読み込み
   */
  async loadProjects() {
    try {
      const response = await fetch('/api/multi-project/projects');
      const data = await response.json();
      
      this.projects.clear();
      data.projects.forEach(project => {
        this.projects.set(project.id, project);
      });
      
      this.renderProjectList();
      
    } catch (error) {
      console.error('Failed to load projects:', error);
      this.showError('プロジェクト一覧の読み込みに失敗しました');
    }
  }

  /**
   * 概要表示を更新
   */
  updateOverviewDisplay(overview) {
    // 統計情報
    document.getElementById('total-projects').textContent = overview.queue.projectCount;
    document.getElementById('total-tasks').textContent = overview.queue.totalTasks;
    document.getElementById('running-tasks').textContent = overview.queue.runningTasks;
    document.getElementById('scheduling-algorithm').textContent = overview.queue.algorithm;
    
    // メトリクス
    if (overview.metrics) {
      document.getElementById('avg-wait-time').textContent = 
        this.formatDuration(overview.metrics.avgWaitTime);
      document.getElementById('avg-exec-time').textContent = 
        this.formatDuration(overview.metrics.avgExecutionTime);
      document.getElementById('fairness-index').textContent = 
        (overview.metrics.fairnessIndex * 100).toFixed(1) + '%';
    }
    
    // リソース使用状況
    if (overview.resources) {
      this.updateResourceDisplay(overview.resources);
    }
  }

  /**
   * プロジェクトリストを描画
   */
  renderProjectList() {
    const container = document.getElementById('project-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    for (const [projectId, project] of this.projects) {
      const card = this.createProjectCard(project);
      container.appendChild(card);
    }
  }

  /**
   * プロジェクトカードを作成
   */
  createProjectCard(project) {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.dataset.projectId = project.id;
    
    const statusClass = project.status.active ? 'active' : 'idle';
    const healthClass = project.status.health.status;
    
    card.innerHTML = `
      <div class="project-header">
        <div class="project-title">
          <input type="checkbox" class="project-select" value="${project.id}">
          <h3>${project.name}</h3>
          <span class="project-priority">優先度: ${project.priority}</span>
        </div>
        <div class="project-status">
          <span class="status-indicator ${statusClass}"></span>
          <span class="health-indicator ${healthClass}">${project.status.health.score}</span>
        </div>
      </div>
      
      <div class="project-stats">
        <div class="stat-item">
          <span class="stat-label">キュー</span>
          <span class="stat-value">${project.statistics.currentQueued}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">実行中</span>
          <span class="stat-value">${project.statistics.currentRunning}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">完了</span>
          <span class="stat-value">${project.statistics.completedTasks}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">失敗</span>
          <span class="stat-value">${project.statistics.failedTasks}</span>
        </div>
      </div>
      
      <div class="project-resources">
        ${this.createResourceBars(project.resources)}
      </div>
      
      <div class="project-actions">
        <button class="btn-small" onclick="multiProjectDashboard.viewProjectDetails('${project.id}')">
          詳細
        </button>
        <button class="btn-small" onclick="multiProjectDashboard.editProjectConfig('${project.id}')">
          設定
        </button>
      </div>
    `;
    
    // チェックボックスのイベント
    card.querySelector('.project-select').addEventListener('change', (e) => {
      if (e.target.checked) {
        this.selectedProjects.add(project.id);
      } else {
        this.selectedProjects.delete(project.id);
      }
      this.updateCompareButton();
    });
    
    return card;
  }

  /**
   * リソースバーを作成
   */
  createResourceBars(resources) {
    if (!resources) return '<div class="no-data">リソース情報なし</div>';
    
    return `
      <div class="resource-bar">
        <label>CPU</label>
        <div class="progress">
          <div class="progress-bar" style="width: ${resources.cpu.percentage}%"></div>
        </div>
        <span>${resources.cpu.percentage.toFixed(1)}%</span>
      </div>
      <div class="resource-bar">
        <label>メモリ</label>
        <div class="progress">
          <div class="progress-bar" style="width: ${resources.memory.percentage}%"></div>
        </div>
        <span>${resources.memory.percentage.toFixed(1)}%</span>
      </div>
      <div class="resource-bar">
        <label>並行数</label>
        <div class="progress">
          <div class="progress-bar" style="width: ${resources.concurrent.percentage}%"></div>
        </div>
        <span>${resources.concurrent.used}/${resources.concurrent.quota}</span>
      </div>
    `;
  }

  /**
   * プロジェクト詳細を表示
   */
  async viewProjectDetails(projectId) {
    try {
      const response = await fetch(`/api/multi-project/project/${projectId}`);
      const project = await response.json();
      
      this.showProjectDetailModal(project);
      
    } catch (error) {
      console.error('Failed to load project details:', error);
      this.showError('プロジェクト詳細の読み込みに失敗しました');
    }
  }

  /**
   * プロジェクト詳細モーダルを表示
   */
  showProjectDetailModal(project) {
    const modal = document.getElementById('project-detail-modal');
    if (!modal) return;
    
    // タイトル
    modal.querySelector('.modal-title').textContent = project.name;
    
    // 基本情報
    const info = modal.querySelector('.project-info');
    info.innerHTML = `
      <div class="info-group">
        <h4>基本情報</h4>
        <dl>
          <dt>プロジェクトID</dt>
          <dd>${project.id}</dd>
          <dt>パス</dt>
          <dd>${project.path}</dd>
          <dt>優先度</dt>
          <dd>${project.priority}</dd>
          <dt>登録日時</dt>
          <dd>${new Date(project.registeredAt).toLocaleString()}</dd>
          <dt>最終活動</dt>
          <dd>${new Date(project.lastActivity).toLocaleString()}</dd>
        </dl>
      </div>
      
      <div class="info-group">
        <h4>統計情報</h4>
        <dl>
          <dt>総タスク数</dt>
          <dd>${project.statistics.totalTasks}</dd>
          <dt>完了タスク</dt>
          <dd>${project.statistics.completedTasks}</dd>
          <dt>失敗タスク</dt>
          <dd>${project.statistics.failedTasks}</dd>
          <dt>平均実行時間</dt>
          <dd>${this.formatDuration(project.statistics.averageExecutionTime)}</dd>
          <dt>平均待機時間</dt>
          <dd>${this.formatDuration(project.statistics.averageWaitTime)}</dd>
        </dl>
      </div>
    `;
    
    // 実行中のタスク
    const runningTasks = modal.querySelector('.running-tasks');
    if (project.tasks.running.length > 0) {
      runningTasks.innerHTML = `
        <h4>実行中のタスク</h4>
        <table class="task-table">
          <thead>
            <tr>
              <th>Issue #</th>
              <th>優先度</th>
              <th>開始時刻</th>
              <th>経過時間</th>
            </tr>
          </thead>
          <tbody>
            ${project.tasks.running.map(task => `
              <tr>
                <td>${task.issueNumber}</td>
                <td>${task.priority}</td>
                <td>${new Date(task.startedAt).toLocaleTimeString()}</td>
                <td>${this.formatDuration(task.duration)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } else {
      runningTasks.innerHTML = '<p>実行中のタスクはありません</p>';
    }
    
    // キュー内のタスク
    const queuedTasks = modal.querySelector('.queued-tasks');
    if (project.tasks.queued.length > 0) {
      queuedTasks.innerHTML = `
        <h4>待機中のタスク (最大100件)</h4>
        <table class="task-table">
          <thead>
            <tr>
              <th>Issue #</th>
              <th>優先度</th>
              <th>実効優先度</th>
              <th>エンキュー時刻</th>
              <th>待機時間</th>
            </tr>
          </thead>
          <tbody>
            ${project.tasks.queued.map(task => `
              <tr>
                <td>${task.issueNumber}</td>
                <td>${task.priority}</td>
                <td>${task.effectivePriority}</td>
                <td>${new Date(task.enqueuedAt).toLocaleTimeString()}</td>
                <td>${this.formatDuration(task.waitTime)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } else {
      queuedTasks.innerHTML = '<p>待機中のタスクはありません</p>';
    }
    
    // モーダルを表示
    modal.style.display = 'block';
  }

  /**
   * プロジェクト設定を編集
   */
  async editProjectConfig(projectId) {
    const project = this.projects.get(projectId);
    if (!project) return;
    
    // 設定編集モーダルを表示
    const modal = document.getElementById('config-edit-modal');
    if (!modal) return;
    
    modal.querySelector('.modal-title').textContent = `${project.name} - 設定`;
    
    // 現在の設定を表示
    const configForm = modal.querySelector('#config-form');
    configForm.innerHTML = `
      <div class="form-group">
        <label>優先度</label>
        <input type="number" name="priority" value="${project.priority}" min="0" max="100">
      </div>
      
      <div class="form-group">
        <label>最大並行実行数</label>
        <input type="number" name="maxConcurrent" value="${project.config?.maxConcurrent || 3}" min="1" max="10">
      </div>
      
      <div class="form-group">
        <label>CPU割り当て</label>
        <input type="text" name="cpu" value="${project.config?.resourceQuota?.cpu || '1000m'}" placeholder="例: 1000m, 2">
      </div>
      
      <div class="form-group">
        <label>メモリ割り当て</label>
        <input type="text" name="memory" value="${project.config?.resourceQuota?.memory || '1Gi'}" placeholder="例: 1Gi, 512Mi">
      </div>
      
      <div class="form-group">
        <label>シェアウェイト</label>
        <input type="number" name="shareWeight" value="${project.config?.shareWeight || 1.0}" min="0.1" max="10" step="0.1">
      </div>
      
      <div class="form-actions">
        <button type="submit" class="btn-primary">保存</button>
        <button type="button" class="btn-secondary" onclick="this.closest('.modal').style.display='none'">キャンセル</button>
      </div>
    `;
    
    // フォーム送信イベント
    configForm.onsubmit = async (e) => {
      e.preventDefault();
      await this.saveProjectConfig(projectId, new FormData(configForm));
      modal.style.display = 'none';
    };
    
    modal.style.display = 'block';
  }

  /**
   * プロジェクト設定を保存
   */
  async saveProjectConfig(projectId, formData) {
    try {
      const config = {
        priority: parseInt(formData.get('priority')),
        maxConcurrent: parseInt(formData.get('maxConcurrent')),
        resourceQuota: {
          cpu: formData.get('cpu'),
          memory: formData.get('memory'),
          maxConcurrent: parseInt(formData.get('maxConcurrent'))
        },
        shareWeight: parseFloat(formData.get('shareWeight'))
      };
      
      const response = await fetch(`/api/multi-project/project/${projectId}/config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(config)
      });
      
      if (response.ok) {
        this.showSuccess('設定を更新しました');
        await this.loadProjects();
      } else {
        throw new Error('設定の更新に失敗しました');
      }
      
    } catch (error) {
      console.error('Failed to save config:', error);
      this.showError('設定の保存に失敗しました');
    }
  }

  /**
   * プロジェクト比較
   */
  async compareProjects() {
    if (this.selectedProjects.size < 2) {
      this.showError('比較するプロジェクトを2つ以上選択してください');
      return;
    }
    
    try {
      const projectIds = Array.from(this.selectedProjects).join(',');
      const response = await fetch(`/api/multi-project/comparison?projectIds=${projectIds}`);
      const comparison = await response.json();
      
      this.showComparisonModal(comparison);
      
    } catch (error) {
      console.error('Failed to compare projects:', error);
      this.showError('プロジェクト比較に失敗しました');
    }
  }

  /**
   * 比較モーダルを表示
   */
  showComparisonModal(comparison) {
    const modal = document.getElementById('comparison-modal');
    if (!modal) return;
    
    const content = modal.querySelector('.comparison-content');
    
    // 比較テーブルを作成
    const projects = Object.entries(comparison.projects);
    
    content.innerHTML = `
      <h3>プロジェクト比較</h3>
      <table class="comparison-table">
        <thead>
          <tr>
            <th>項目</th>
            ${projects.map(([id, p]) => `<th>${p.name}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>優先度</td>
            ${projects.map(([id, p]) => `<td>${p.priority}</td>`).join('')}
          </tr>
          <tr>
            <td>スループット</td>
            ${projects.map(([id, p]) => `<td>${p.throughput}</td>`).join('')}
          </tr>
          <tr>
            <td>平均実行時間</td>
            ${projects.map(([id, p]) => `<td>${this.formatDuration(p.avgExecutionTime)}</td>`).join('')}
          </tr>
          <tr>
            <td>平均待機時間</td>
            ${projects.map(([id, p]) => `<td>${this.formatDuration(p.avgWaitTime)}</td>`).join('')}
          </tr>
          <tr>
            <td>成功率</td>
            ${projects.map(([id, p]) => `<td>${p.successRate.toFixed(1)}%</td>`).join('')}
          </tr>
          <tr>
            <td>リソース効率</td>
            ${projects.map(([id, p]) => `<td>${p.resourceEfficiency.toFixed(1)}</td>`).join('')}
          </tr>
        </tbody>
      </table>
      
      <h4>ランキング</h4>
      ${Object.entries(comparison.rankings).map(([metric, ranking]) => `
        <div class="ranking-section">
          <h5>${this.getMetricLabel(metric)}</h5>
          <ol>
            ${ranking.map(item => `
              <li>${comparison.projects[item.id].name} - ${this.formatMetricValue(metric, item.value)}</li>
            `).join('')}
          </ol>
        </div>
      `).join('')}
    `;
    
    modal.style.display = 'block';
  }

  /**
   * レポートを生成
   */
  async generateReport() {
    try {
      const modal = document.getElementById('report-modal');
      if (!modal) return;
      
      // レポート設定フォームを表示
      modal.querySelector('.modal-content').innerHTML = `
        <h3>レポート生成</h3>
        <form id="report-form">
          <div class="form-group">
            <label>レポートタイプ</label>
            <select name="type">
              <option value="summary">サマリー</option>
              <option value="detailed">詳細</option>
              <option value="analytics">分析</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>形式</label>
            <select name="format">
              <option value="json">JSON</option>
              <option value="markdown">Markdown</option>
              <option value="csv">CSV</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>期間</label>
            <select name="period">
              <option value="hour">1時間</option>
              <option value="day">1日</option>
              <option value="week">1週間</option>
              <option value="month">1ヶ月</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>
              <input type="checkbox" name="includeDetails" value="true">
              詳細情報を含める
            </label>
          </div>
          
          <div class="form-actions">
            <button type="submit" class="btn-primary">生成</button>
            <button type="button" class="btn-secondary" onclick="this.closest('.modal').style.display='none'">キャンセル</button>
          </div>
        </form>
      `;
      
      modal.style.display = 'block';
      
      // フォーム送信イベント
      document.getElementById('report-form').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        
        const params = {
          type: formData.get('type'),
          format: formData.get('format'),
          period: formData.get('period'),
          includeDetails: formData.get('includeDetails') === 'true'
        };
        
        // 選択されたプロジェクトがある場合
        if (this.selectedProjects.size > 0) {
          params.projectIds = Array.from(this.selectedProjects).join(',');
        }
        
        await this.downloadReport(params);
        modal.style.display = 'none';
      };
      
    } catch (error) {
      console.error('Failed to generate report:', error);
      this.showError('レポート生成に失敗しました');
    }
  }

  /**
   * レポートをダウンロード
   */
  async downloadReport(params) {
    try {
      const response = await fetch('/api/multi-project/report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(params)
      });
      
      if (!response.ok) {
        throw new Error('レポート生成に失敗しました');
      }
      
      // ファイル名を決定
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const extension = params.format === 'markdown' ? 'md' : params.format;
      const filename = `poppo-report-${timestamp}.${extension}`;
      
      // ダウンロード
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      this.showSuccess('レポートをダウンロードしました');
      
    } catch (error) {
      console.error('Failed to download report:', error);
      this.showError('レポートのダウンロードに失敗しました');
    }
  }

  /**
   * グラフを初期化
   */
  initializeCharts() {
    // リソース使用率グラフ
    this.initializeResourceChart();
    
    // タスク処理グラフ
    this.initializeTaskChart();
    
    // プロジェクト別パフォーマンスグラフ
    this.initializePerformanceChart();
  }

  /**
   * リソース使用率グラフを初期化
   */
  initializeResourceChart() {
    const ctx = document.getElementById('resource-chart')?.getContext('2d');
    if (!ctx) return;
    
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'CPU使用率',
          data: [],
          borderColor: 'rgb(75, 192, 192)',
          tension: 0.1
        }, {
          label: 'メモリ使用率',
          data: [],
          borderColor: 'rgb(255, 99, 132)',
          tension: 0.1
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true,
            max: 100
          }
        }
      }
    });
    
    this.chartInstances.set('resource', chart);
  }

  /**
   * タスク処理グラフを初期化
   */
  initializeTaskChart() {
    const ctx = document.getElementById('task-chart')?.getContext('2d');
    if (!ctx) return;
    
    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{
          label: '完了',
          data: [],
          backgroundColor: 'rgba(75, 192, 192, 0.5)'
        }, {
          label: '失敗',
          data: [],
          backgroundColor: 'rgba(255, 99, 132, 0.5)'
        }, {
          label: 'キュー',
          data: [],
          backgroundColor: 'rgba(255, 206, 86, 0.5)'
        }]
      },
      options: {
        responsive: true,
        scales: {
          x: {
            stacked: true
          },
          y: {
            stacked: true,
            beginAtZero: true
          }
        }
      }
    });
    
    this.chartInstances.set('task', chart);
  }

  /**
   * パフォーマンスグラフを初期化
   */
  initializePerformanceChart() {
    const ctx = document.getElementById('performance-chart')?.getContext('2d');
    if (!ctx) return;
    
    const chart = new Chart(ctx, {
      type: 'radar',
      data: {
        labels: ['スループット', '実行時間', '待機時間', '成功率', 'リソース効率'],
        datasets: []
      },
      options: {
        responsive: true,
        scales: {
          r: {
            beginAtZero: true
          }
        }
      }
    });
    
    this.chartInstances.set('performance', chart);
  }

  /**
   * グラフデータを更新
   */
  updateCharts(data) {
    // リソース使用率の更新
    const resourceChart = this.chartInstances.get('resource');
    if (resourceChart && data.resourceUtilization) {
      const latest = data.resourceUtilization.slice(-20); // 最新20件
      resourceChart.data.labels = latest.map(u => 
        new Date(u.timestamp).toLocaleTimeString()
      );
      resourceChart.data.datasets[0].data = latest.map(u => 
        (u.cpu / 8) * 100 // 8コアと仮定
      );
      resourceChart.data.datasets[1].data = latest.map(u => 
        (u.memory / (16 * 1024 * 1024 * 1024)) * 100 // 16GBと仮定
      );
      resourceChart.update();
    }
    
    // タスク処理の更新
    const taskChart = this.chartInstances.get('task');
    if (taskChart && data.projects) {
      const projects = Object.entries(data.projects).slice(0, 10); // 最大10プロジェクト
      taskChart.data.labels = projects.map(([id, p]) => p.name);
      taskChart.data.datasets[0].data = projects.map(([id, p]) => p.tasks.completed);
      taskChart.data.datasets[1].data = projects.map(([id, p]) => p.tasks.failed);
      taskChart.data.datasets[2].data = projects.map(([id, p]) => p.tasks.queued);
      taskChart.update();
    }
  }

  /**
   * フィルタリング
   */
  filterProjects(filter) {
    const cards = document.querySelectorAll('.project-card');
    
    cards.forEach(card => {
      const project = this.projects.get(card.dataset.projectId);
      if (!project) return;
      
      let show = true;
      
      switch (filter) {
        case 'active':
          show = project.status.active;
          break;
        case 'idle':
          show = !project.status.active;
          break;
        case 'healthy':
          show = project.status.health.status === 'healthy';
          break;
        case 'warning':
          show = project.status.health.status === 'warning';
          break;
        case 'critical':
          show = project.status.health.status === 'critical';
          break;
      }
      
      card.style.display = show ? 'block' : 'none';
    });
  }

  /**
   * ソート
   */
  sortProjects(sortBy) {
    const container = document.getElementById('project-list');
    if (!container) return;
    
    const cards = Array.from(container.querySelectorAll('.project-card'));
    
    cards.sort((a, b) => {
      const projectA = this.projects.get(a.dataset.projectId);
      const projectB = this.projects.get(b.dataset.projectId);
      
      if (!projectA || !projectB) return 0;
      
      switch (sortBy) {
        case 'name':
          return projectA.name.localeCompare(projectB.name);
        case 'priority':
          return projectB.priority - projectA.priority;
        case 'tasks':
          return projectB.statistics.currentQueued - projectA.statistics.currentQueued;
        case 'health':
          return projectB.status.health.score - projectA.status.health.score;
        default:
          return 0;
      }
    });
    
    // 再配置
    cards.forEach(card => container.appendChild(card));
  }

  /**
   * 検索
   */
  searchProjects(query) {
    const cards = document.querySelectorAll('.project-card');
    const lowerQuery = query.toLowerCase();
    
    cards.forEach(card => {
      const project = this.projects.get(card.dataset.projectId);
      if (!project) return;
      
      const matches = 
        project.name.toLowerCase().includes(lowerQuery) ||
        project.id.toLowerCase().includes(lowerQuery) ||
        project.path.toLowerCase().includes(lowerQuery);
      
      card.style.display = matches ? 'block' : 'none';
    });
  }

  /**
   * 自動更新を開始
   */
  startAutoRefresh() {
    this.refreshInterval = setInterval(async () => {
      await this.loadOverview();
      // グラフの更新も行う
      if (this.metrics) {
        this.updateCharts(this.metrics);
      }
    }, 5000); // 5秒ごと
  }

  /**
   * 自動更新を停止
   */
  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  /**
   * メトリクスを更新
   */
  async updateMetrics(metrics) {
    this.metrics = metrics;
    
    // KPIの表示
    if (metrics.kpis) {
      document.getElementById('overall-efficiency').textContent = 
        metrics.kpis.overallEfficiency.toFixed(1) + ' タスク/分';
      document.getElementById('resource-utilization').textContent = 
        metrics.kpis.resourceUtilization.toFixed(1) + '%';
      document.getElementById('task-success-rate').textContent = 
        metrics.kpis.taskSuccessRate.toFixed(1) + '%';
      document.getElementById('scheduling-fairness').textContent = 
        metrics.kpis.schedulingFairness.toFixed(1) + '%';
    }
  }

  /**
   * 比較ボタンの状態を更新
   */
  updateCompareButton() {
    const button = document.getElementById('compare-projects');
    if (button) {
      button.disabled = this.selectedProjects.size < 2;
      button.textContent = `比較 (${this.selectedProjects.size})`;
    }
  }

  /**
   * 時間をフォーマット
   */
  formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}秒`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}分`;
    return `${(ms / 3600000).toFixed(1)}時間`;
  }

  /**
   * メトリクスラベルを取得
   */
  getMetricLabel(metric) {
    const labels = {
      throughput: 'スループット',
      avgExecutionTime: '平均実行時間',
      avgWaitTime: '平均待機時間',
      successRate: '成功率',
      resourceEfficiency: 'リソース効率'
    };
    return labels[metric] || metric;
  }

  /**
   * メトリクス値をフォーマット
   */
  formatMetricValue(metric, value) {
    switch (metric) {
      case 'avgExecutionTime':
      case 'avgWaitTime':
        return this.formatDuration(value);
      case 'successRate':
        return `${value.toFixed(1)}%`;
      case 'resourceEfficiency':
        return value.toFixed(1);
      default:
        return value;
    }
  }

  /**
   * エラー表示
   */
  showError(message) {
    const notification = document.createElement('div');
    notification.className = 'notification error';
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.remove();
    }, 5000);
  }

  /**
   * 成功表示
   */
  showSuccess(message) {
    const notification = document.createElement('div');
    notification.className = 'notification success';
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.remove();
    }, 3000);
  }
}

// グローバルインスタンス
const multiProjectDashboard = new MultiProjectDashboard();

// ページ読み込み時に初期化
document.addEventListener('DOMContentLoaded', () => {
  multiProjectDashboard.initialize();
});

// ページ離脱時にクリーンアップ
window.addEventListener('beforeunload', () => {
  multiProjectDashboard.stopAutoRefresh();
});