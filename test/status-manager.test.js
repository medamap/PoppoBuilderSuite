/**
 * StatusManager のテスト
 */
const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const StatusManager = require('../src/status-manager');

describe('StatusManager', () => {
  let statusManager;
  const testDir = path.join(__dirname, 'test-status-manager');
  const stateFile = path.join(testDir, 'issue-status.json');
  
  beforeEach(async () => {
    // テスト用ディレクトリを作成
    await fs.mkdir(testDir, { recursive: true });
    
    // StatusManager のインスタンスを作成
    statusManager = new StatusManager(stateFile, {
      info: () => {},
      error: () => {}
    });
    
    await statusManager.initialize();
  });
  
  afterEach(async () => {
    // クリーンアップ
    if (statusManager) {
      await statusManager.cleanup();
    }
    
    // テストディレクトリを削除
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // エラーは無視
    }
  });
  
  describe('initialize', () => {
    it('新しい状態ファイルを作成できる', async () => {
      const stats = await fs.stat(stateFile);
      assert(stats.isFile(), '状態ファイルが作成されている');
      
      const content = await fs.readFile(stateFile, 'utf8');
      const state = JSON.parse(content);
      assert.deepStrictEqual(state.issues, {}, 'issues が空のオブジェクト');
    });
    
    it('既存の状態ファイルを読み込める', async () => {
      // 既存の状態を作成
      const existingState = {
        issues: {
          '123': {
            status: 'processing',
            processId: 'test-process'
          }
        },
        lastSync: new Date().toISOString()
      };
      await fs.writeFile(stateFile, JSON.stringify(existingState));
      
      // 新しいインスタンスで読み込み
      const newManager = new StatusManager(stateFile, {
        info: () => {},
        error: () => {}
      });
      await newManager.initialize();
      
      const status = await newManager.getStatus('123');
      assert.strictEqual(status.status, 'processing');
      assert.strictEqual(status.processId, 'test-process');
      
      await newManager.cleanup();
    });
  });
  
  describe('checkout/checkin', () => {
    it('Issue をチェックアウトできる', async () => {
      const result = await statusManager.checkout('123', 'process-123', 'claude-cli');
      
      assert.strictEqual(result.status, 'processing');
      assert.strictEqual(result.processId, 'process-123');
      assert.strictEqual(result.taskType, 'claude-cli');
      assert.strictEqual(result.pid, process.pid);
      assert(result.startTime, 'startTime が設定されている');
      assert(result.lastHeartbeat, 'lastHeartbeat が設定されている');
    });
    
    it('Issue をチェックインできる', async () => {
      // まずチェックアウト
      await statusManager.checkout('123', 'process-123', 'claude-cli');
      
      // チェックイン
      const result = await statusManager.checkin('123', 'completed', {
        exitCode: 0,
        duration: 1000
      });
      
      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(result.processId, null);
      assert.strictEqual(result.pid, null);
      assert(result.endTime, 'endTime が設定されている');
      assert.strictEqual(result.result.exitCode, 0);
    });
    
    it('チェックアウトされていない Issue のチェックインはエラー', async () => {
      await assert.rejects(
        async () => await statusManager.checkin('999'),
        /Issue 999 is not checked out/
      );
    });
  });
  
  describe('updateStatus', () => {
    it('Issue の状態を更新できる', async () => {
      const result = await statusManager.updateStatus('123', 'awaiting-response', {
        reason: 'need_user_input'
      });
      
      assert.strictEqual(result.status, 'awaiting-response');
      assert.strictEqual(result.reason, 'need_user_input');
      assert(result.lastUpdated, 'lastUpdated が設定されている');
    });
    
    it('ラベル更新リクエストを作成する', async () => {
      await statusManager.updateStatus('123', 'processing');
      
      // リクエストファイルが作成されているか確認
      const requestsDir = path.join(testDir, 'state/requests');
      const requestFiles = await fs.readdir(requestsDir);
      assert(requestFiles.length > 0, 'リクエストファイルが作成されている');
      
      const requestContent = await fs.readFile(
        path.join(requestsDir, requestFiles[0]),
        'utf8'
      );
      const request = JSON.parse(requestContent);
      
      assert.strictEqual(request.issueNumber, '123');
      assert(request.addLabels.includes('processing'));
    });
  });
  
  describe('updateHeartbeat', () => {
    it('processing 状態の Issue のハートビートを更新できる', async () => {
      await statusManager.checkout('123', 'process-123', 'claude-cli');
      
      // 少し待機
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const updated = await statusManager.updateHeartbeat('123');
      assert(updated, 'ハートビートが更新された');
      
      const status = await statusManager.getStatus('123');
      assert(new Date(status.lastHeartbeat).getTime() > new Date(status.startTime).getTime());
    });
    
    it('processing 以外の状態では更新されない', async () => {
      await statusManager.updateStatus('123', 'completed');
      
      const updated = await statusManager.updateHeartbeat('123');
      assert(!updated, 'ハートビートは更新されない');
    });
  });
  
  describe('detectOrphanedIssues', () => {
    it('タイムアウトした Issue を検出できる', async () => {
      // 古いハートビートで Issue を作成
      await statusManager.checkout('123', 'process-123', 'claude-cli');
      
      // ハートビートを古い時刻に設定
      await statusManager.acquireLock();
      try {
        statusManager.state.issues['123'].lastHeartbeat = 
          new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10分前
        statusManager.state.issues['123'].pid = 999999; // 存在しない PID
        await statusManager.saveState();
      } finally {
        await statusManager.releaseLock();
      }
      
      const orphaned = await statusManager.detectOrphanedIssues(5 * 60 * 1000); // 5分のタイムアウト
      assert.strictEqual(orphaned.length, 1);
      assert.strictEqual(orphaned[0].issueNumber, '123');
    });
    
    it('実行中のプロセスは孤児とみなさない', async () => {
      // 現在のプロセスの PID でチェックアウト
      await statusManager.checkout('123', 'process-123', 'claude-cli');
      
      // ハートビートを古い時刻に設定（ただし PID は現在のプロセス）
      await statusManager.acquireLock();
      try {
        statusManager.state.issues['123'].lastHeartbeat = 
          new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10分前
        await statusManager.saveState();
      } finally {
        await statusManager.releaseLock();
      }
      
      const orphaned = await statusManager.detectOrphanedIssues(5 * 60 * 1000);
      assert.strictEqual(orphaned.length, 0, '実行中のプロセスは孤児とみなされない');
    });
  });
  
  describe('resetIssueStatus', () => {
    it('Issue の状態をリセットできる', async () => {
      await statusManager.checkout('123', 'process-123', 'claude-cli');
      
      await statusManager.resetIssueStatus('123');
      
      const status = await statusManager.getStatus('123');
      assert.strictEqual(status, null, 'Issue の状態が削除されている');
    });
  });
  
  describe('getStatistics', () => {
    it('統計情報を取得できる', async () => {
      // 複数の Issue を作成
      await statusManager.checkout('123', 'process-123', 'claude-cli');
      await statusManager.updateStatus('124', 'awaiting-response');
      await statusManager.updateStatus('125', 'completed', { taskType: 'agent' });
      
      const stats = await statusManager.getStatistics();
      
      assert.strictEqual(stats.total, 3);
      assert.strictEqual(stats.byStatus.processing, 1);
      assert.strictEqual(stats.byStatus['awaiting-response'], 1);
      assert.strictEqual(stats.byStatus.completed, 1);
      assert.strictEqual(stats.byTaskType['claude-cli'], 1);
      assert.strictEqual(stats.byTaskType.agent, 1);
      assert(stats.oldestProcessing, '最も古い processing が存在する');
      assert.strictEqual(stats.oldestProcessing.issueNumber, '123');
    });
  });
  
  describe('並行処理', () => {
    it('複数の操作が競合しない', async () => {
      const promises = [];
      
      // 10個の並行更新
      for (let i = 0; i < 10; i++) {
        promises.push(
          statusManager.updateStatus(String(i), 'processing', {
            index: i
          })
        );
      }
      
      await Promise.all(promises);
      
      // すべての更新が正しく保存されているか確認
      for (let i = 0; i < 10; i++) {
        const status = await statusManager.getStatus(String(i));
        assert.strictEqual(status.status, 'processing');
        assert.strictEqual(status.index, i);
      }
    });
  });
  
  describe('エラーハンドリング', () => {
    it('初期化前の操作はエラー', async () => {
      const uninitializedManager = new StatusManager(path.join(testDir, 'test2.json'));
      
      await assert.rejects(
        async () => await uninitializedManager.getStatus('123'),
        /StatusManager が初期化されていません/
      );
    });
    
    it('不正な JSON ファイルからの回復', async () => {
      // 不正な JSON を書き込む
      await fs.writeFile(stateFile, '{ invalid json }');
      
      // 新しいインスタンスで読み込み
      const newManager = new StatusManager(stateFile, {
        info: () => {},
        error: () => {}
      });
      
      // エラーになるはず
      await assert.rejects(
        async () => await newManager.initialize(),
        /Expected property name/
      );
    });
  });
});

// テストを実行
if (require.main === module) {
  require('child_process').execSync('mocha ' + __filename, { stdio: 'inherit' });
}