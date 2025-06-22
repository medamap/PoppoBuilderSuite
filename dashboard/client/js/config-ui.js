/**
 * Configuration Management UI
 */
class ConfigUI {
  constructor() {
    this.container = null;
    this.config = null;
    this.isInMaintenanceMode = false;
  }

  async init(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error('Container not found:', containerId);
      return;
    }

    await this.loadConfig();
    this.render();
    this.attachEventListeners();
  }

  async loadConfig() {
    try {
      const response = await fetch('/api/config/current');
      if (!response.ok) throw new Error('Failed to load config');
      this.config = await response.json();
    } catch (error) {
      console.error('Error loading config:', error);
      this.showError('設定の読み込みに失敗しました');
    }
  }

  render() {
    this.container.innerHTML = `
      <div class="config-management">
        <div class="config-header">
          <h2>設定管理</h2>
          <div class="config-actions">
            <button id="exportConfig" class="btn btn-secondary">
              <i class="icon-download"></i> エクスポート
            </button>
            <button id="importConfig" class="btn btn-secondary">
              <i class="icon-upload"></i> インポート
            </button>
            <button id="restartServices" class="btn btn-warning">
              <i class="icon-refresh"></i> サービス再起動
            </button>
          </div>
        </div>

        <div id="maintenanceAlert" class="alert alert-warning" style="display: none;">
          <strong>メンテナンスモード中</strong>
          <p>設定変更のため、システムはメンテナンスモードです。</p>
          <button id="exitMaintenance" class="btn btn-sm btn-primary">
            メンテナンスモードを解除
          </button>
        </div>

        <div class="config-tabs">
          <button class="tab-button active" data-tab="global">グローバル設定</button>
          <button class="tab-button" data-tab="project">プロジェクト設定</button>
          <button class="tab-button" data-tab="environment">環境変数</button>
          <button class="tab-button" data-tab="storage">ストレージ設定</button>
        </div>

        <div class="config-content">
          <div id="global-tab" class="tab-content active">
            ${this.renderGlobalConfig()}
          </div>
          <div id="project-tab" class="tab-content">
            ${this.renderProjectConfig()}
          </div>
          <div id="environment-tab" class="tab-content">
            ${this.renderEnvironmentVariables()}
          </div>
          <div id="storage-tab" class="tab-content">
            ${this.renderStorageConfig()}
          </div>
        </div>

        <input type="file" id="configFileInput" accept=".json" style="display: none;">
      </div>
    `;

    // メンテナンスモードのチェック
    this.checkMaintenanceMode();
  }

  renderGlobalConfig() {
    const config = this.config?.global || {};
    return `
      <div class="config-section">
        <h3>グローバル設定</h3>
        <form id="globalConfigForm">
          <div class="form-group">
            <label>ベースディレクトリ</label>
            <input type="text" name="storage.baseDir" 
                   value="${config.storage?.baseDir || '~/.poppobuilder'}" 
                   class="form-control">
            <small>ログ、状態ファイル、一時ファイルの保存先</small>
          </div>

          <div class="form-group">
            <label>ログ保持期間</label>
            <input type="text" name="storage.logs.retention" 
                   value="${config.storage?.logs?.retention || '30d'}" 
                   class="form-control">
            <small>例: 30d, 7d, 3m</small>
          </div>

          <div class="form-group">
            <label>最大ログサイズ</label>
            <input type="text" name="storage.logs.maxSize" 
                   value="${config.storage?.logs?.maxSize || '1GB'}" 
                   class="form-control">
            <small>例: 1GB, 500MB, 100MB</small>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary">保存</button>
            <button type="button" class="btn btn-secondary" onclick="configUI.loadConfig()">
              リセット
            </button>
          </div>
        </form>
      </div>
    `;
  }

  renderProjectConfig() {
    const config = this.config?.project || this.config?.final || {};
    return `
      <div class="config-section">
        <h3>プロジェクト設定</h3>
        <form id="projectConfigForm">
          <fieldset>
            <legend>GitHub設定</legend>
            <div class="form-group">
              <label>オーナー</label>
              <input type="text" name="github.owner" 
                     value="${config.github?.owner || ''}" 
                     class="form-control" required>
            </div>
            <div class="form-group">
              <label>リポジトリ</label>
              <input type="text" name="github.repo" 
                     value="${config.github?.repo || ''}" 
                     class="form-control" required>
            </div>
          </fieldset>

          <fieldset>
            <legend>Claude設定</legend>
            <div class="form-group">
              <label>最大並行実行数</label>
              <input type="number" name="claude.maxConcurrent" 
                     value="${config.claude?.maxConcurrent || 3}" 
                     min="1" max="10" class="form-control">
            </div>
            <div class="form-group">
              <label>タイムアウト (ms)</label>
              <input type="number" name="claude.timeout" 
                     value="${config.claude?.timeout || 120000}" 
                     min="10000" step="1000" class="form-control">
            </div>
            <div class="form-group">
              <label>最大リトライ回数</label>
              <input type="number" name="claude.maxRetries" 
                     value="${config.claude?.maxRetries || 3}" 
                     min="0" max="10" class="form-control">
            </div>
          </fieldset>

          <fieldset>
            <legend>言語設定</legend>
            <div class="form-group">
              <label>プライマリ言語</label>
              <select name="language.primary" class="form-control">
                <option value="ja" ${config.language?.primary === 'ja' ? 'selected' : ''}>日本語</option>
                <option value="en" ${config.language?.primary === 'en' ? 'selected' : ''}>English</option>
              </select>
            </div>
          </fieldset>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary">保存</button>
            <button type="button" class="btn btn-secondary" onclick="configUI.loadConfig()">
              リセット
            </button>
          </div>
        </form>
      </div>
    `;
  }

  renderEnvironmentVariables() {
    const env = this.config?.environment || {};
    const envHtml = Object.entries(env).map(([key, value]) => {
      const isSensitive = key.includes('TOKEN') || key.includes('KEY') || key.includes('SECRET');
      return `
        <tr>
          <td><code>${key}</code></td>
          <td>
            ${isSensitive ? 
              `<span class="text-muted">${value || '(not set)'}</span>` : 
              `<code>${value || ''}</code>`}
          </td>
          <td>
            ${isSensitive ? 
              '<span class="badge badge-warning">機密情報</span>' : 
              '<span class="badge badge-info">公開可能</span>'}
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="config-section">
        <h3>環境変数</h3>
        <p class="text-muted">PoppoBuilderに影響を与える環境変数の一覧です。</p>
        
        <table class="table">
          <thead>
            <tr>
              <th>変数名</th>
              <th>値</th>
              <th>タイプ</th>
            </tr>
          </thead>
          <tbody>
            ${envHtml || '<tr><td colspan="3" class="text-center">環境変数が設定されていません</td></tr>'}
          </tbody>
        </table>

        <div class="alert alert-info">
          <p><strong>ヒント:</strong> 環境変数は設定ファイルより優先されます。</p>
          <p>例: <code>export POPPO_LANGUAGE_PRIMARY=en</code></p>
        </div>
      </div>
    `;
  }

  renderStorageConfig() {
    const storagePaths = this.config?.final?.storage || {};
    const globalConfig = this.config?.global?.storage || {};
    
    return `
      <div class="config-section">
        <h3>ストレージ設定</h3>
        
        <div class="storage-info">
          <h4>現在のストレージパス</h4>
          <table class="table">
            <tr>
              <td>ベースディレクトリ</td>
              <td><code>${globalConfig.baseDir || '~/.poppobuilder'}</code></td>
            </tr>
            <tr>
              <td>ログディレクトリ</td>
              <td><code>${globalConfig.baseDir || '~/.poppobuilder'}/logs</code></td>
            </tr>
            <tr>
              <td>状態ファイル</td>
              <td><code>${globalConfig.baseDir || '~/.poppobuilder'}/state</code></td>
            </tr>
            <tr>
              <td>一時ファイル</td>
              <td><code>${globalConfig.baseDir || '~/.poppobuilder'}/temp</code></td>
            </tr>
          </table>
        </div>

        <form id="storageConfigForm" class="mt-4">
          <div class="form-group">
            <label>外部ストレージパス</label>
            <input type="text" id="externalStoragePath" 
                   placeholder="/Volumes/ExternalSSD/poppobuilder" 
                   class="form-control">
            <small>外部SSDなどの別のストレージを使用する場合に指定</small>
          </div>

          <div class="form-group">
            <label>
              <input type="checkbox" id="enableCompression" 
                     ${globalConfig.logs?.compress ? 'checked' : ''}>
              ログファイルの圧縮を有効化
            </label>
          </div>

          <div class="form-group">
            <label>
              <input type="checkbox" id="enableAutoCleanup" 
                     ${globalConfig.logs?.autoCleanup !== false ? 'checked' : ''}>
              古いファイルの自動削除を有効化
            </label>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary">ストレージ設定を更新</button>
            <button type="button" class="btn btn-secondary" id="migrateStorage">
              <i class="icon-move"></i> ストレージを移行
            </button>
          </div>
        </form>
      </div>
    `;
  }

  attachEventListeners() {
    // タブ切り替え
    document.querySelectorAll('.tab-button').forEach(button => {
      button.addEventListener('click', (e) => {
        const tab = e.target.dataset.tab;
        this.switchTab(tab);
      });
    });

    // グローバル設定フォーム
    const globalForm = document.getElementById('globalConfigForm');
    if (globalForm) {
      globalForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveGlobalConfig(new FormData(globalForm));
      });
    }

    // プロジェクト設定フォーム
    const projectForm = document.getElementById('projectConfigForm');
    if (projectForm) {
      projectForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveProjectConfig(new FormData(projectForm));
      });
    }

    // ストレージ設定フォーム
    const storageForm = document.getElementById('storageConfigForm');
    if (storageForm) {
      storageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveStorageConfig();
      });
    }

    // エクスポートボタン
    document.getElementById('exportConfig')?.addEventListener('click', () => {
      this.exportConfig();
    });

    // インポートボタン
    document.getElementById('importConfig')?.addEventListener('click', () => {
      document.getElementById('configFileInput').click();
    });

    // ファイル選択
    document.getElementById('configFileInput')?.addEventListener('change', (e) => {
      this.importConfig(e.target.files[0]);
    });

    // 再起動ボタン
    document.getElementById('restartServices')?.addEventListener('click', () => {
      this.restartServices();
    });

    // メンテナンスモード解除
    document.getElementById('exitMaintenance')?.addEventListener('click', () => {
      this.exitMaintenanceMode();
    });

    // ストレージ移行
    document.getElementById('migrateStorage')?.addEventListener('click', () => {
      this.migrateStorage();
    });
  }

  switchTab(tab) {
    // タブボタンの切り替え
    document.querySelectorAll('.tab-button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // タブコンテンツの切り替え
    document.querySelectorAll('.tab-content').forEach(content => {
      const contentTab = content.id.replace('-tab', '');
      content.classList.toggle('active', contentTab === tab);
    });
  }

  async saveGlobalConfig(formData) {
    try {
      const config = this.formDataToObject(formData);
      
      const response = await fetch('/api/config/global', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });

      if (!response.ok) throw new Error('Failed to save config');
      
      const result = await response.json();
      this.showSuccess('グローバル設定を保存しました');
      
      if (result.maintenanceMode) {
        this.isInMaintenanceMode = true;
        this.showMaintenanceAlert();
      }
    } catch (error) {
      console.error('Error saving global config:', error);
      this.showError('設定の保存に失敗しました');
    }
  }

  async saveProjectConfig(formData) {
    try {
      const config = this.formDataToObject(formData);
      
      const response = await fetch('/api/config/project', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });

      if (!response.ok) throw new Error('Failed to save config');
      
      this.showSuccess('プロジェクト設定を保存しました');
      await this.loadConfig();
    } catch (error) {
      console.error('Error saving project config:', error);
      this.showError('設定の保存に失敗しました');
    }
  }

  async saveStorageConfig() {
    try {
      const externalPath = document.getElementById('externalStoragePath').value;
      const enableCompression = document.getElementById('enableCompression').checked;
      const enableAutoCleanup = document.getElementById('enableAutoCleanup').checked;

      const config = {
        storage: {
          baseDir: externalPath || '~/.poppobuilder',
          logs: {
            compress: enableCompression,
            autoCleanup: enableAutoCleanup
          }
        }
      };

      const response = await fetch('/api/config/global', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });

      if (!response.ok) throw new Error('Failed to save storage config');
      
      const result = await response.json();
      this.showSuccess('ストレージ設定を保存しました');
      
      if (result.maintenanceMode) {
        this.isInMaintenanceMode = true;
        this.showMaintenanceAlert();
      }
    } catch (error) {
      console.error('Error saving storage config:', error);
      this.showError('ストレージ設定の保存に失敗しました');
    }
  }

  async exportConfig() {
    try {
      const response = await fetch('/api/config/export');
      if (!response.ok) throw new Error('Failed to export config');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'poppobuilder-config.json';
      a.click();
      window.URL.revokeObjectURL(url);
      
      this.showSuccess('設定をエクスポートしました');
    } catch (error) {
      console.error('Error exporting config:', error);
      this.showError('設定のエクスポートに失敗しました');
    }
  }

  async importConfig(file) {
    if (!file) return;

    try {
      const text = await file.text();
      const config = JSON.parse(text);

      // バリデーション
      const validateResponse = await fetch('/api/config/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });

      const validation = await validateResponse.json();
      if (!validation.valid) {
        this.showError(`設定が無効です: ${validation.errors.join(', ')}`);
        return;
      }

      // インポート先を選択
      const target = confirm('グローバル設定としてインポートしますか？\n' +
                            'OKを押すとグローバル設定、キャンセルを押すとプロジェクト設定として保存されます。') 
                            ? 'global' : 'project';

      const response = await fetch(`/api/config/import?target=${target}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });

      if (!response.ok) throw new Error('Failed to import config');
      
      const result = await response.json();
      this.showSuccess('設定をインポートしました');
      
      if (result.maintenanceMode) {
        this.isInMaintenanceMode = true;
        this.showMaintenanceAlert();
      }
      
      await this.loadConfig();
      this.render();
    } catch (error) {
      console.error('Error importing config:', error);
      this.showError('設定のインポートに失敗しました');
    }
  }

  async restartServices() {
    if (!confirm('サービスを再起動しますか？\n実行中のタスクは完了を待ってから再起動されます。')) {
      return;
    }

    try {
      const response = await fetch('/api/config/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graceful: true })
      });

      if (!response.ok) throw new Error('Failed to restart services');
      
      this.showSuccess('サービスの再起動をスケジュールしました');
    } catch (error) {
      console.error('Error restarting services:', error);
      this.showError('サービスの再起動に失敗しました');
    }
  }

  async checkMaintenanceMode() {
    try {
      const response = await fetch('/api/config/maintenance');
      if (!response.ok) return;
      
      const status = await response.json();
      this.isInMaintenanceMode = status.enabled;
      
      if (this.isInMaintenanceMode) {
        this.showMaintenanceAlert();
      }
    } catch (error) {
      console.error('Error checking maintenance mode:', error);
    }
  }

  async exitMaintenanceMode() {
    try {
      const response = await fetch('/api/config/maintenance', {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to exit maintenance mode');
      
      this.isInMaintenanceMode = false;
      document.getElementById('maintenanceAlert').style.display = 'none';
      this.showSuccess('メンテナンスモードを解除しました');
    } catch (error) {
      console.error('Error exiting maintenance mode:', error);
      this.showError('メンテナンスモードの解除に失敗しました');
    }
  }

  async migrateStorage() {
    const newPath = document.getElementById('externalStoragePath').value;
    if (!newPath) {
      this.showError('移行先のパスを入力してください');
      return;
    }

    if (!confirm(`ストレージを以下のパスに移行しますか？\n${newPath}\n\n※ この操作には時間がかかる場合があります。`)) {
      return;
    }

    this.showInfo('ストレージ移行を開始しました。しばらくお待ちください...');
    
    // TODO: 実際の移行処理は別途実装が必要
    // npm run migrate:logs などのコマンドを呼び出す
  }

  showMaintenanceAlert() {
    const alert = document.getElementById('maintenanceAlert');
    if (alert) {
      alert.style.display = 'block';
    }
  }

  formDataToObject(formData) {
    const obj = {};
    for (const [key, value] of formData.entries()) {
      const keys = key.split('.');
      let current = obj;
      
      for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]]) {
          current[keys[i]] = {};
        }
        current = current[keys[i]];
      }
      
      // 数値の変換
      const numValue = Number(value);
      current[keys[keys.length - 1]] = !isNaN(numValue) && value !== '' ? numValue : value;
    }
    return obj;
  }

  showSuccess(message) {
    this.showNotification(message, 'success');
  }

  showError(message) {
    this.showNotification(message, 'error');
  }

  showInfo(message) {
    this.showNotification(message, 'info');
  }

  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.classList.add('fade-out');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }
}

// グローバルインスタンス
const configUI = new ConfigUI();