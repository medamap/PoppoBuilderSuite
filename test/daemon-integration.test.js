/**
 * Daemon Integration Tests
 * デーモンとプロセスプールの統合テスト
 */

const { expect } = require('chai');
const path = require('path');
const fs = require('fs').promises;
const DaemonManager = require('../lib/daemon/daemon-manager');
const DaemonAPIClient = require('../lib/daemon/api-client');

describe('Daemon Integration Tests', function() {
  this.timeout(30000); // 30秒のタイムアウト
  
  let daemonManager;
  let apiClient;
  let sandbox;
  
  before(async () => {
    // テスト用の設定を作成
    const testConfigPath = path.join(process.env.HOME || process.env.USERPROFILE, '.poppobuilder', 'test-config.json');
    await fs.mkdir(path.dirname(testConfigPath), { recursive: true });
    await fs.writeFile(testConfigPath, JSON.stringify({
      daemon: {
        maxProcesses: 2,
        api: {
          port: 45679, // テスト用ポート
          enableAuth: false // テストでは認証を無効化
        },
        worker: {
          minProcesses: 1,
          maxProcesses: 2,
          autoScale: true
        }
      }
    }, null, 2));
    
    // 環境変数を設定
    process.env.POPPOBUILDER_CONFIG_PATH = testConfigPath;
  });
  
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    daemonManager = new DaemonManager();
    apiClient = new DaemonAPIClient({ port: 45679 });
  });
  
  afterEach(async () => {
    if (daemonManager && await daemonManager.isRunning()) {
      await daemonManager.stop();
    }
  });
  
  describe('Daemon Lifecycle', () => {
    it('should start and stop daemon', async () => {
      // デーモンを開始
      await daemonManager.initialize();
      await daemonManager.start();
      
      // デーモンが実行中であることを確認
      expect(await daemonManager.isRunning()).to.be.true;
      
      // APIクライアントを初期化
      await apiClient.initialize();
      
      // ステータスを取得
      const status = await apiClient.getStatus();
      expect(status).to.have.property('running', true);
      expect(status).to.have.property('workers').that.is.an('array');
      expect(status.workers).to.have.length.at.least(1);
      
      // デーモンを停止
      await daemonManager.stop();
      expect(await daemonManager.isRunning()).to.be.false;
    });
  });
  
  describe('Process Pool Integration', () => {
    beforeEach(async () => {
      await daemonManager.initialize();
      await daemonManager.start();
      await apiClient.initialize();
      
      // デーモンが完全に起動するまで待つ
      await new Promise(resolve => setTimeout(resolve, 2000));
    });
    
    it('should get process pool statistics', async () => {
      const response = await apiClient.request('GET', '/api/process-pool/stats');
      
      expect(response).to.have.property('status', 200);
      expect(response.data).to.have.property('workers');
      expect(response.data).to.have.property('totals');
      
      const totals = response.data.totals;
      expect(totals).to.have.property('workers').that.is.a('number');
      expect(totals).to.have.property('available').that.is.a('number');
      expect(totals).to.have.property('busy').that.is.a('number');
      expect(totals).to.have.property('queued').that.is.a('number');
    });
    
    it('should set project process limit', async () => {
      const response = await apiClient.request('POST', '/api/process-pool/project-limit', {
        projectId: 'test-project',
        limit: 5
      });
      
      expect(response).to.have.property('status', 200);
      expect(response.data).to.have.property('message');
      expect(response.data).to.have.property('projectId', 'test-project');
      expect(response.data).to.have.property('limit', 5);
    });
    
    it('should get project process usage', async () => {
      // 先にプロジェクト制限を設定
      await apiClient.request('POST', '/api/process-pool/project-limit', {
        projectId: 'test-project',
        limit: 3
      });
      
      // 使用状況を取得
      const response = await apiClient.request('GET', '/api/process-pool/project-usage');
      
      expect(response).to.have.property('status', 200);
      expect(response.data).to.have.property('test-project');
      
      const usage = response.data['test-project'];
      expect(usage).to.have.property('used').that.is.a('number');
      expect(usage).to.have.property('limit', 3);
      expect(usage).to.have.property('available').that.is.a('number');
    });
  });
  
  describe('Worker Management', () => {
    beforeEach(async () => {
      await daemonManager.initialize();
      await daemonManager.start();
      await apiClient.initialize();
      await new Promise(resolve => setTimeout(resolve, 2000));
    });
    
    it('should list workers', async () => {
      const response = await apiClient.request('GET', '/api/workers');
      
      expect(response).to.have.property('status', 200);
      expect(response.data).to.be.an('array');
      expect(response.data).to.have.length.at.least(1);
      
      const worker = response.data[0];
      expect(worker).to.have.property('pid').that.is.a('number');
      expect(worker).to.have.property('id').that.is.a('number');
      expect(worker).to.have.property('startTime').that.is.a('number');
      expect(worker).to.have.property('uptime').that.is.a('number');
    });
    
    it('should reload configuration', async () => {
      const response = await apiClient.reloadDaemon();
      
      expect(response).to.have.property('message');
      expect(response.message).to.include('reloaded');
    });
  });
  
  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      // デーモンが起動していない状態でAPIを呼び出す
      try {
        await apiClient.getStatus();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('ECONNREFUSED');
      }
    });
    
    it('should prevent duplicate daemon start', async () => {
      await daemonManager.initialize();
      await daemonManager.start();
      
      // 2回目の起動を試みる
      const secondManager = new DaemonManager();
      await secondManager.initialize();
      
      try {
        await secondManager.start();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('already running');
      }
    });
  });
  
  after(async () => {
    // テスト設定ファイルをクリーンアップ
    const testConfigPath = path.join(process.env.HOME || process.env.USERPROFILE, '.poppobuilder', 'test-config.json');
    try {
      await fs.unlink(testConfigPath);
    } catch (error) {
      // ファイルが存在しない場合は無視
    }
    
    delete process.env.POPPOBUILDER_CONFIG_PATH;
  });
});