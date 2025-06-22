const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const ConfigWatcher = require('../src/config-watcher');

// テスト用のモックロガー
class MockLogger {
  constructor() {
    this.logs = {
      info: [],
      warn: [],
      error: [],
      debug: []
    };
  }

  info(...args) { this.logs.info.push(args); }
  warn(...args) { this.logs.warn.push(args); }
  error(...args) { this.logs.error.push(args); }
  debug(...args) { this.logs.debug.push(args); }
  
  clear() {
    Object.keys(this.logs).forEach(level => {
      this.logs[level] = [];
    });
  }
}

describe('ConfigWatcher', () => {
  let configWatcher;
  let mockLogger;
  let sandbox;
  let testConfigPath;
  let originalConfig;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockLogger = new MockLogger();
    configWatcher = new ConfigWatcher(mockLogger);
    
    // テスト用の設定ファイルパス
    testConfigPath = path.join(__dirname, '..', 'config', 'config.json');
    
    // 元の設定をバックアップ
    if (fs.existsSync(testConfigPath)) {
      originalConfig = fs.readFileSync(testConfigPath, 'utf-8');
    }
  });

  afterEach(() => {
    // ConfigWatcherを停止
    if (configWatcher) {
      configWatcher.stop();
    }
    
    // 元の設定を復元
    if (originalConfig) {
      fs.writeFileSync(testConfigPath, originalConfig);
    }
    
    mockLogger.clear();
  });

  describe('初期化', () => {
    it('ConfigWatcherインスタンスを作成できる', () => {
      expect(configWatcher).to.be.instanceOf(ConfigWatcher);
      expect(configWatcher).to.be.instanceOf(EventEmitter);
    });

    it('監視対象のパスを正しく取得できる', () => {
      const paths = configWatcher._getWatchPaths();
      expect(paths).to.be.an('array');
      expect(paths.length).to.be.greaterThan(0);
      
      // システムデフォルト設定が含まれていることを確認
      const hasDefaultConfig = paths.some(p => p.includes('config/defaults.json'));
      expect(hasDefaultConfig).to.be.true;
    });

    it('start()で初期設定を読み込める', () => {
      configWatcher.start();
      
      expect(configWatcher.isInitialized).to.be.true;
      expect(configWatcher.currentConfig).to.be.an('object');
      expect(mockLogger.logs.info.length).to.be.greaterThan(0);
    });
  });

  describe('設定の変更検出', () => {
    it('設定の変更を検出できる', () => {
      const oldConfig = {
        logLevel: 'info',
        timeout: 1000,
        nested: {
          value: 'old'
        }
      };
      
      const newConfig = {
        logLevel: 'debug',
        timeout: 1000,
        nested: {
          value: 'new'
        }
      };
      
      const changes = configWatcher._detectChanges(oldConfig, newConfig);
      
      expect(changes).to.be.an('array');
      expect(changes).to.have.lengthOf(2);
      
      const logLevelChange = changes.find(c => c.path === 'logLevel');
      expect(logLevelChange).to.exist;
      expect(logLevelChange.oldValue).to.equal('info');
      expect(logLevelChange.newValue).to.equal('debug');
      
      const nestedChange = changes.find(c => c.path === 'nested.value');
      expect(nestedChange).to.exist;
      expect(nestedChange.oldValue).to.equal('old');
      expect(nestedChange.newValue).to.equal('new');
    });

    it('変更がない場合は空の配列を返す', () => {
      const config = {
        logLevel: 'info',
        timeout: 1000
      };
      
      const changes = configWatcher._detectChanges(config, config);
      expect(changes).to.be.an('array');
      expect(changes).to.have.lengthOf(0);
    });
  });

  describe('設定の分類', () => {
    it('ホットリロード可能な設定を正しく分類できる', () => {
      const changes = [
        { path: 'logLevel', oldValue: 'info', newValue: 'debug' },
        { path: 'claude.timeout', oldValue: 1000, newValue: 2000 },
        { path: 'port', oldValue: 3000, newValue: 3001 }
      ];
      
      const classified = configWatcher._classifyChanges(changes);
      
      expect(classified.hotReloadable).to.have.lengthOf(2);
      expect(classified.restartRequired).to.have.lengthOf(1);
      expect(classified.partialReloadable).to.have.lengthOf(0);
      
      expect(classified.hotReloadable[0].path).to.equal('logLevel');
      expect(classified.restartRequired[0].path).to.equal('port');
    });

    it('設定項目のホットリロード可否を判定できる', () => {
      expect(configWatcher.isHotReloadable('logLevel')).to.be.true;
      expect(configWatcher.isHotReloadable('claude.timeout')).to.be.true;
      expect(configWatcher.isHotReloadable('port')).to.be.false;
    });

    it('設定項目の再起動必要性を判定できる', () => {
      expect(configWatcher.requiresRestart('port')).to.be.true;
      expect(configWatcher.requiresRestart('dashboard.port')).to.be.true;
      expect(configWatcher.requiresRestart('logLevel')).to.be.false;
    });
  });

  describe('イベント処理', () => {
    it('設定更新時にconfig-updatedイベントが発火する', (done) => {
      configWatcher.on('config-updated', ({ newConfig, changes }) => {
        expect(newConfig).to.be.an('object');
        expect(changes).to.be.an('array');
        done();
      });
      
      // 手動で設定変更をシミュレート
      configWatcher.currentConfig = { logLevel: 'info' };
      configWatcher._processConfigChange('test-file');
    });

    it('再起動が必要な変更でrestart-requiredイベントが発火する', (done) => {
      configWatcher.on('restart-required', ({ changes }) => {
        expect(changes).to.be.an('array');
        expect(changes[0].path).to.equal('port');
        done();
      });
      
      configWatcher.currentConfig = { port: 3000 };
      configWatcher._processConfigChange('test-file');
    });

    it('バリデーションエラー時にvalidation-errorイベントが発火する', (done) => {
      configWatcher.on('validation-error', ({ errors }) => {
        expect(errors).to.be.an('array');
        done();
      });
      
      // バリデーションエラーをシミュレート
      configWatcher.configLoader.validateConfig = () => ({
        valid: false,
        errors: ['Test validation error']
      });
      
      configWatcher._processConfigChange('test-file');
    });
  });

  describe('手動再読み込み', () => {
    it('reload()メソッドで手動再読み込みができる', async () => {
      configWatcher.start();
      
      const result = await configWatcher.reload();
      
      expect(result).to.be.an('object');
      expect(result.success).to.be.true;
      expect(result.config).to.be.an('object');
    });

    it('再読み込みエラー時に適切なエラーを返す', async () => {
      configWatcher.configLoader.loadConfig = () => {
        throw new Error('Test error');
      };
      
      const result = await configWatcher.reload();
      
      expect(result.success).to.be.false;
      expect(result.error).to.equal('Test error');
    });
  });

  describe('ライフサイクル管理', () => {
    it('stop()でファイル監視を停止できる', () => {
      configWatcher.start();
      expect(configWatcher.isInitialized).to.be.true;
      
      configWatcher.stop();
      expect(configWatcher.isInitialized).to.be.false;
      expect(configWatcher.watchers.size).to.equal(0);
    });

    it('デバウンスタイマーが正しくクリアされる', () => {
      configWatcher.debounceTimers.set('test', setTimeout(() => {}, 1000));
      expect(configWatcher.debounceTimers.size).to.equal(1);
      
      configWatcher.stop();
      expect(configWatcher.debounceTimers.size).to.equal(0);
    });
  });
});