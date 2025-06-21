const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');
const fs = require('fs').promises;

// テスト対象のモジュール
const HealthCheckManager = require('../src/health-check-manager');
const ApplicationMonitor = require('../src/monitors/application-monitor');
const SystemMonitor = require('../src/monitors/system-monitor');
const NetworkMonitor = require('../src/monitors/network-monitor');
const DataMonitor = require('../src/monitors/data-monitor');
const MetricsStore = require('../src/health-metrics-store');
const RecoveryManager = require('../src/recovery-manager');
const AlertManager = require('../src/alert-manager');

describe('HealthCheck System', () => {
  let sandbox;
  
  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });
  
  afterEach(() => {
    sandbox.restore();
  });
  
  describe('HealthCheckManager', () => {
    let healthCheckManager;
    let mockProcessManager;
    let mockNotificationManager;
    let config;
    
    beforeEach(() => {
      config = {
        healthCheck: {
          enabled: true,
          interval: 1000,
          scoring: {
            weights: {
              application: 0.4,
              system: 0.3,
              network: 0.2,
              data: 0.1
            }
          },
          thresholds: {
            healthy: 80,
            degraded: 60
          },
          autoRecovery: {
            enabled: true,
            actions: {
              memoryCleanup: true,
              processRestart: true
            }
          },
          alerts: {
            enabled: true,
            channels: ['log']
          }
        }
      };
      
      mockProcessManager = {
        getRunningProcesses: sinon.stub().returns([]),
        getAllProcesses: sinon.stub().returns([]),
        stopProcess: sinon.stub().resolves(true),
        restartProcess: sinon.stub().resolves(true)
      };
      
      mockNotificationManager = {
        send: sinon.stub().resolves()
      };
      
      healthCheckManager = new HealthCheckManager(config, mockProcessManager, mockNotificationManager);
    });
    
    it('ヘルスチェックマネージャーが正しく初期化される', () => {
      expect(healthCheckManager).to.be.an.instanceOf(HealthCheckManager);
      expect(healthCheckManager.monitors).to.have.all.keys('application', 'system', 'network', 'data');
      expect(healthCheckManager.metricsStore).to.be.an.instanceOf(MetricsStore);
      expect(healthCheckManager.recoveryManager).to.be.an.instanceOf(RecoveryManager);
      expect(healthCheckManager.alertManager).to.be.an.instanceOf(AlertManager);
    });
    
    it('ヘルスチェックを実行できる', async () => {
      // モニターのモック
      sandbox.stub(healthCheckManager.monitors.application, 'check').resolves({
        status: 'healthy',
        score: 90,
        details: {}
      });
      sandbox.stub(healthCheckManager.monitors.system, 'check').resolves({
        status: 'healthy',
        score: 85,
        details: {}
      });
      sandbox.stub(healthCheckManager.monitors.network, 'check').resolves({
        status: 'healthy',
        score: 95,
        details: {}
      });
      sandbox.stub(healthCheckManager.monitors.data, 'check').resolves({
        status: 'healthy',
        score: 100,
        details: {}
      });
      
      const result = await healthCheckManager.performHealthCheck();
      
      expect(result).to.have.property('status', 'healthy');
      expect(result).to.have.property('score');
      expect(result.score).to.be.above(80);
      expect(result).to.have.property('components');
      expect(result).to.have.property('timestamp');
    });
    
    it('スコアが正しく計算される', () => {
      const results = {
        application: { score: 80 },
        system: { score: 70 },
        network: { score: 90 },
        data: { score: 100 }
      };
      
      const score = healthCheckManager.calculateScore(results);
      
      // 重み付け計算: (80*0.4 + 70*0.3 + 90*0.2 + 100*0.1) = 81
      expect(score).to.equal(81);
    });
    
    it('ステータスが正しく判定される', () => {
      expect(healthCheckManager.determineStatus(85)).to.equal('healthy');
      expect(healthCheckManager.determineStatus(70)).to.equal('degraded');
      expect(healthCheckManager.determineStatus(50)).to.equal('unhealthy');
    });
  });
  
  describe('ApplicationMonitor', () => {
    let appMonitor;
    let mockProcessManager;
    
    beforeEach(() => {
      mockProcessManager = {
        getRunningProcesses: sinon.stub().returns([
          {
            taskId: 'task-1',
            status: 'running',
            taskType: 'claude-cli',
            startTime: new Date(),
            memoryUsage: 100 * 1024 * 1024,
            pid: 12345
          }
        ]),
        getAllProcesses: sinon.stub().returns([
          {
            taskId: 'task-1',
            status: 'running',
            taskType: 'claude-cli',
            startTime: new Date(),
            memoryUsage: 100 * 1024 * 1024,
            pid: 12345
          }
        ])
      };
      
      appMonitor = new ApplicationMonitor(mockProcessManager);
    });
    
    it('アプリケーション層のヘルスチェックができる', async () => {
      // ハートビートファイルのモック
      const heartbeatDir = path.join(__dirname, '../.heartbeat');
      await fs.mkdir(heartbeatDir, { recursive: true });
      
      const heartbeat = {
        timestamp: new Date().toISOString(),
        pid: 12345,
        memory: 50 * 1024 * 1024,
        cpu: 10
      };
      
      await fs.writeFile(
        path.join(heartbeatDir, 'ccla.json'),
        JSON.stringify(heartbeat)
      );
      
      const result = await appMonitor.check();
      
      expect(result).to.have.property('status');
      expect(result).to.have.property('score');
      expect(result).to.have.property('details');
      expect(result.details).to.have.property('agents');
      expect(result.details).to.have.property('processes');
      
      // クリーンアップ
      try {
        await fs.unlink(path.join(heartbeatDir, 'ccla.json'));
        await fs.rmdir(heartbeatDir);
      } catch (error) {
        // エラーは無視
      }
    });
  });
  
  describe('SystemMonitor', () => {
    let sysMonitor;
    
    beforeEach(() => {
      sysMonitor = new SystemMonitor();
    });
    
    it('システム層のヘルスチェックができる', async () => {
      const result = await sysMonitor.check();
      
      expect(result).to.have.property('status');
      expect(result).to.have.property('score');
      expect(result).to.have.property('details');
      expect(result.details).to.have.property('cpu');
      expect(result.details).to.have.property('memory');
      expect(result.details).to.have.property('disk');
      expect(result.details).to.have.property('loadAverage');
    });
    
    it('CPU使用率を取得できる', async () => {
      const cpu = await sysMonitor.getCpuUsage();
      expect(cpu).to.be.a('number');
      expect(cpu).to.be.at.least(0);
      expect(cpu).to.be.at.most(100);
    });
    
    it('メモリ使用率を取得できる', async () => {
      const memory = await sysMonitor.getMemoryUsage();
      expect(memory).to.be.a('number');
      expect(memory).to.be.at.least(0);
      expect(memory).to.be.at.most(100);
    });
  });
  
  describe('MetricsStore', () => {
    let metricsStore;
    let testDataFile;
    
    beforeEach(() => {
      metricsStore = new MetricsStore();
      testDataFile = path.join(__dirname, '../.poppo/health-metrics.json');
    });
    
    afterEach(async () => {
      // テストデータのクリーンアップ
      try {
        await fs.unlink(testDataFile);
      } catch (error) {
        // ファイルが存在しない場合は無視
      }
    });
    
    it('メトリクスを記録できる', async () => {
      const healthData = {
        status: 'healthy',
        score: 85,
        timestamp: new Date().toISOString()
      };
      
      await metricsStore.record(healthData);
      
      const latest = await metricsStore.getLatest();
      expect(latest).to.have.property('status', 'healthy');
      expect(latest).to.have.property('score', 85);
    });
    
    it('履歴を取得できる', async () => {
      // 複数のレコードを追加
      for (let i = 0; i < 5; i++) {
        await metricsStore.record({
          status: 'healthy',
          score: 80 + i,
          timestamp: new Date().toISOString()
        });
      }
      
      const history = await metricsStore.getHistory(1);
      expect(history).to.be.an('array');
      expect(history.length).to.be.at.least(5);
    });
    
    it('トレンド分析ができる', async () => {
      // テストデータを追加
      const baseTime = Date.now();
      for (let i = 0; i < 20; i++) {
        metricsStore.metrics.push({
          status: 'healthy',
          score: 80 + Math.sin(i / 3) * 10,
          timestamp: new Date(baseTime + i * 60000).toISOString(),
          components: {
            application: { score: 85 + Math.sin(i / 3) * 5 },
            system: { score: 75 + Math.sin(i / 3) * 15 }
          }
        });
      }
      
      const trends = await metricsStore.analyzeTrends();
      
      expect(trends).to.have.property('hasEnoughData', true);
      expect(trends).to.have.property('score');
      expect(trends.score).to.have.property('trend');
      expect(trends).to.have.property('components');
    });
  });
  
  describe('RecoveryManager', () => {
    let recoveryManager;
    let mockProcessManager;
    
    beforeEach(() => {
      mockProcessManager = {
        stopProcess: sinon.stub().resolves(true),
        restartProcess: sinon.stub().resolves(true)
      };
      
      recoveryManager = new RecoveryManager(mockProcessManager);
    });
    
    it('メモリクリーンアップを実行できる', async () => {
      const result = await recoveryManager.cleanupMemory();
      
      expect(result).to.have.property('success');
      expect(result).to.have.property('actions');
      expect(result.actions).to.be.an('array');
    });
    
    it('プロセスを再起動できる', async () => {
      const result = await recoveryManager.restartProcess('test-process');
      
      expect(result).to.have.property('success', true);
      expect(result).to.have.property('processId', 'test-process');
      expect(mockProcessManager.stopProcess).to.have.been.calledWith('test-process');
      expect(mockProcessManager.restartProcess).to.have.been.calledWith('test-process');
    });
    
    it('クールダウンが機能する', async () => {
      // 最初の実行
      await recoveryManager.cleanupMemory();
      
      // 即座に再実行
      const result = await recoveryManager.cleanupMemory();
      
      expect(result).to.have.property('success', false);
      expect(result).to.have.property('reason', 'cooldown');
    });
  });
  
  describe('AlertManager', () => {
    let alertManager;
    let mockNotificationManager;
    
    beforeEach(() => {
      mockNotificationManager = {
        send: sinon.stub().resolves()
      };
      
      alertManager = new AlertManager(mockNotificationManager);
    });
    
    it('アラートを送信できる', async () => {
      const alert = {
        type: 'test_alert',
        severity: 'warning',
        title: 'テストアラート',
        message: 'これはテストです'
      };
      
      const result = await alertManager.sendAlert(alert);
      
      expect(result).to.have.property('sent', true);
      expect(result).to.have.property('channels');
    });
    
    it('アラートがスロットリングされる', async () => {
      const alert = {
        type: 'test_alert',
        severity: 'info',
        title: 'テストアラート',
        message: 'これはテストです'
      };
      
      // 最初の送信
      await alertManager.sendAlert(alert);
      
      // 即座に再送信
      const result = await alertManager.sendAlert(alert);
      
      expect(result).to.have.property('sent', false);
      expect(result).to.have.property('reason', 'throttled');
    });
    
    it('クリティカルアラートは集約されない', async () => {
      const alert = {
        type: 'critical_alert',
        severity: 'critical',
        title: '重大なアラート',
        message: '即座に対応が必要です'
      };
      
      const result = await alertManager.sendAlert(alert);
      
      expect(result).to.have.property('sent', true);
      expect(result.reason).to.not.equal('aggregated');
    });
  });
});

// ヘルスチェックマネージャーの統合テスト
describe('HealthCheck Integration', () => {
  it('エンドツーエンドのヘルスチェックが動作する', async function() {
    this.timeout(5000);
    
    const config = {
      healthCheck: {
        enabled: true,
        interval: 1000,
        scoring: {
          weights: {
            application: 0.4,
            system: 0.3,
            network: 0.2,
            data: 0.1
          }
        },
        thresholds: {
          healthy: 80,
          degraded: 60
        },
        autoRecovery: {
          enabled: false
        },
        alerts: {
          enabled: false
        }
      }
    };
    
    const mockProcessManager = {
      getRunningProcesses: () => [],
      getAllProcesses: () => []
    };
    
    const healthCheckManager = new HealthCheckManager(config, mockProcessManager, null);
    
    // ヘルスチェックを実行
    const result = await healthCheckManager.performHealthCheck();
    
    expect(result).to.have.property('status');
    expect(result).to.have.property('score');
    expect(result).to.have.property('components');
    expect(result).to.have.property('timestamp');
    
    // 各コンポーネントの結果を確認
    expect(result.components).to.have.property('application');
    expect(result.components).to.have.property('system');
    expect(result.components).to.have.property('network');
    expect(result.components).to.have.property('data');
  });
});