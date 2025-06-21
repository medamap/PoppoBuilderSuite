/**
 * State Synchronizer Tests
 */

const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { StateSynchronizer } = require('../lib/core/state-synchronizer');
const { LockManager } = require('../lib/utils/lock-manager');

describe('StateSynchronizer', function() {
  this.timeout(10000);
  
  let synchronizer;
  let sandbox;
  let tempDir;
  let projectDir;
  
  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    
    // テンポラリディレクトリの作成
    tempDir = path.join(os.tmpdir(), `state-sync-test-${Date.now()}`);
    projectDir = path.join(tempDir, 'test-project');
    
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(projectDir, { recursive: true });
    
    // テスト用のSynchronizerを作成
    synchronizer = new StateSynchronizer({
      globalStateDir: path.join(tempDir, 'global-state'),
      syncInterval: 1000, // テスト用に短く設定
      enableAutoSync: false // テストでは自動同期を無効化
    });
    
    await synchronizer.initialize();
  });
  
  afterEach(async () => {
    if (synchronizer) {
      await synchronizer.cleanup();
    }
    
    sandbox.restore();
    
    // テンポラリディレクトリのクリーンアップ
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // エラーは無視
    }
  });
  
  describe('Initialization', () => {
    it('should initialize with default options', async () => {
      const sync = new StateSynchronizer();
      expect(sync.options.syncInterval).to.equal(5000);
      expect(sync.options.conflictResolution).to.equal('last-write-wins');
      expect(sync.options.enableAutoSync).to.be.true;
    });
    
    it('should create global state directory', async () => {
      const stats = await fs.stat(synchronizer.options.globalStateDir);
      expect(stats.isDirectory()).to.be.true;
    });
    
    it('should initialize lock manager', async () => {
      expect(synchronizer.lockManager).to.be.instanceOf(LockManager);
    });
  });
  
  describe('Project Registration', () => {
    it('should register a project', async () => {
      await synchronizer.registerProject('test-project', projectDir);
      
      const project = synchronizer.localStates.get('test-project');
      expect(project).to.exist;
      expect(project.id).to.equal('test-project');
      expect(project.path).to.equal(projectDir);
      
      // ローカル状態ディレクトリが作成されていることを確認
      const stateDir = path.join(projectDir, '.poppobuilder', 'state');
      const stats = await fs.stat(stateDir);
      expect(stats.isDirectory()).to.be.true;
    });
    
    it('should emit project-registered event', async () => {
      const eventSpy = sandbox.spy();
      synchronizer.on('project-registered', eventSpy);
      
      await synchronizer.registerProject('test-project', projectDir);
      
      expect(eventSpy.calledOnce).to.be.true;
      expect(eventSpy.firstCall.args[0]).to.deep.equal({
        projectId: 'test-project',
        projectPath: projectDir
      });
    });
    
    it('should unregister a project', async () => {
      await synchronizer.registerProject('test-project', projectDir);
      await synchronizer.unregisterProject('test-project');
      
      expect(synchronizer.localStates.has('test-project')).to.be.false;
    });
  });
  
  describe('Global State Management', () => {
    it('should set and get global state', async () => {
      await synchronizer.setGlobalState('test-key', 'test-value');
      const value = await synchronizer.getGlobalState('test-key');
      
      expect(value).to.exist;
      expect(value.value).to.equal('test-value');
      expect(value.version).to.equal(1);
    });
    
    it('should handle version conflicts', async () => {
      await synchronizer.setGlobalState('test-key', 'value1');
      
      try {
        await synchronizer.setGlobalState('test-key', 'value2', { version: 0 });
        expect.fail('Should have thrown version conflict error');
      } catch (error) {
        expect(error.message).to.include('Version conflict');
      }
    });
    
    it('should save global state to disk', async () => {
      await synchronizer.setGlobalState('process:test', { status: 'running' });
      await synchronizer.setGlobalState('queue:test', { items: [] });
      
      // ファイルが作成されていることを確認
      const processFile = path.join(synchronizer.options.globalStateDir, 'processes.json');
      const queueFile = path.join(synchronizer.options.globalStateDir, 'queue.json');
      
      const processContent = await fs.readFile(processFile, 'utf8');
      const queueContent = await fs.readFile(queueFile, 'utf8');
      
      expect(JSON.parse(processContent)).to.have.property('process:test');
      expect(JSON.parse(queueContent)).to.have.property('queue:test');
    });
  });
  
  describe('Local State Management', () => {
    beforeEach(async () => {
      await synchronizer.registerProject('test-project', projectDir);
    });
    
    it('should set and get local state', async () => {
      await synchronizer.setLocalState('test-project', 'test-key', 'test-value');
      const value = await synchronizer.getLocalState('test-project', 'test-key');
      
      expect(value).to.equal('test-value');
    });
    
    it('should save local state to disk', async () => {
      await synchronizer.setLocalState('test-project', 'test-key', { data: 'test' });
      
      const stateFile = path.join(projectDir, '.poppobuilder', 'state', 'test-key.json');
      const content = await fs.readFile(stateFile, 'utf8');
      const state = JSON.parse(content);
      
      expect(state.value).to.deep.equal({ data: 'test' });
      expect(state.version).to.equal(1);
      expect(state.projectId).to.equal('test-project');
    });
    
    it('should throw error for unregistered project', async () => {
      try {
        await synchronizer.setLocalState('unknown-project', 'key', 'value');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Project not registered');
      }
    });
  });
  
  describe('State Synchronization', () => {
    beforeEach(async () => {
      await synchronizer.registerProject('test-project', projectDir);
    });
    
    it('should sync global state to local', async () => {
      // グローバル状態を設定
      await synchronizer.setGlobalState('project:test-project:config', {
        setting: 'global-value'
      });
      
      // 同期を実行
      await synchronizer.syncProject('test-project');
      
      // ローカル状態に反映されていることを確認
      const localValue = await synchronizer.getLocalState('test-project', 'config');
      expect(localValue).to.deep.equal({ setting: 'global-value' });
    });
    
    it('should sync local state to global', async () => {
      // ローカル状態を設定
      await synchronizer.setLocalState('test-project', 'config', {
        setting: 'local-value'
      });
      
      // 同期を実行
      await synchronizer.syncProject('test-project');
      
      // グローバル状態に反映されていることを確認
      const globalValue = await synchronizer.getGlobalState('project:test-project:config');
      expect(globalValue.value).to.deep.equal({ setting: 'local-value' });
    });
    
    it('should handle sync conflicts with last-write-wins', async () => {
      // グローバルとローカルに異なる値を設定
      await synchronizer.setGlobalState('project:test-project:config', 'global-value');
      await synchronizer.setLocalState('test-project', 'config', 'local-value');
      
      // ローカルの方を後で更新
      await new Promise(resolve => setTimeout(resolve, 100));
      await synchronizer.setLocalState('test-project', 'config', 'newer-local-value');
      
      // 同期を実行
      await synchronizer.syncProject('test-project');
      
      // 新しい方の値が採用されることを確認
      const globalValue = await synchronizer.getGlobalState('project:test-project:config');
      expect(globalValue.value).to.equal('newer-local-value');
    });
  });
  
  describe('Lock Management', () => {
    it('should use locks for concurrent access', async () => {
      await synchronizer.registerProject('test-project', projectDir);
      
      // 並行して同じキーを更新
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          synchronizer.setGlobalState('concurrent-test', `value-${i}`)
        );
      }
      
      await Promise.all(promises);
      
      // 最終的な値を確認（どれか1つの値になっているはず）
      const finalValue = await synchronizer.getGlobalState('concurrent-test');
      expect(finalValue.value).to.match(/^value-\d$/);
      expect(finalValue.version).to.be.at.least(1);
    });
  });
  
  describe('Transaction Support', () => {
    it('should handle transaction timeout', async () => {
      const transactionSpy = sandbox.spy();
      synchronizer.on('transaction-timeout', transactionSpy);
      
      try {
        await synchronizer.executeTransaction(async () => {
          // タイムアウトするまで待機
          await new Promise(resolve => setTimeout(resolve, 1000));
        }, { transactionTimeout: 100 });
      } catch (error) {
        // エラーは無視
      }
      
      // タイムアウトまで待機
      await new Promise(resolve => setTimeout(resolve, 200));
      
      expect(transactionSpy.called).to.be.true;
    });
  });
  
  describe('Event Broadcasting', () => {
    it('should broadcast state changes', async () => {
      const changeSpy = sandbox.spy();
      synchronizer.on('state-changed', changeSpy);
      
      await synchronizer.setGlobalState('broadcast-test', 'value');
      
      expect(changeSpy.calledOnce).to.be.true;
      expect(changeSpy.firstCall.args[0]).to.include({
        type: 'global',
        key: 'broadcast-test'
      });
    });
  });
  
  describe('Conflict Resolution', () => {
    it('should support custom conflict resolver', async () => {
      const customResolver = async (state1, state2) => {
        // カスタムロジック: 値を結合
        return {
          value: `${state1.value}+${state2.value}`,
          version: Math.max(state1.version, state2.version) + 1,
          updatedAt: Date.now()
        };
      };
      
      const customSync = new StateSynchronizer({
        globalStateDir: path.join(tempDir, 'custom-sync'),
        conflictResolution: 'callback',
        conflictResolver: customResolver,
        enableAutoSync: false
      });
      
      await customSync.initialize();
      
      // 競合する状態を作成
      await customSync.setGlobalState('test', 'value1');
      const conflict = await customSync.resolveConflict(
        { value: 'value1', version: 1, updatedAt: Date.now() },
        { value: 'value2', version: 1, updatedAt: Date.now() }
      );
      
      expect(conflict.value).to.equal('value1+value2');
      
      await customSync.cleanup();
    });
    
    it('should merge object states', async () => {
      const state1 = {
        value: { a: 1, b: 2 },
        version: 1,
        updatedAt: Date.now()
      };
      
      const state2 = {
        value: { b: 3, c: 4 },
        version: 1,
        updatedAt: Date.now() + 100
      };
      
      const merged = await synchronizer.mergeStates(state1, state2);
      
      expect(merged.value).to.deep.equal({
        a: 1,
        b: 3, // state2の値が採用される
        c: 4
      });
    });
  });
});