/**
 * MirinOrphanManagerのエラーハンドリングテスト
 */

const fs = require('fs').promises;
const path = require('path');
const { expect } = require('chai');
const MirinOrphanManager = require('../src/mirin-orphan-manager');

describe('MirinOrphanManager - エラーハンドリング', function() {
  let mirinManager;
  let testDir;
  let sandbox;
  let mockGithubClient;
  let mockStatusManager;
  let mockLogger;

  beforeEach(async function() {
    // テスト用ディレクトリ
    testDir = path.join(__dirname, '../temp/test-mirin-error');
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(path.join(testDir, 'requests'), { recursive: true });

    // モックオブジェクト
    mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {}
    };

    mockGithubClient = {
      getIssue: async (issueNumber) => {
        if (issueNumber === 404) {
          return null; // 存在しないIssue
        }
        return {
          number: issueNumber,
          labels: [{ name: 'processing' }]
        };
      },
      updateLabels: async () => {},
      createComment: async () => {}
    };

    mockStatusManager = {
      detectOrphanedIssues: async () => [],
      resetIssueStatus: async () => {}
    };

    // MirinOrphanManagerインスタンス作成
    mirinManager = new MirinOrphanManager(
      mockGithubClient,
      mockStatusManager,
      mockLogger,
      {
        requestsDir: path.join(testDir, 'requests'),
        enabled: true
      }
    );
  });

  afterEach(async function() {
    // テストディレクトリをクリーンアップ
    try {
      await fs.rmdir(testDir, { recursive: true });
    } catch (error) {
      // 無視
    }
  });

  describe('存在しないIssueへのラベル更新リクエスト処理', function() {
    it('存在しないIssueのリクエストファイルが即座に削除されること', async function() {
      // 存在しないIssue #404へのリクエストファイルを作成
      const requestFile = path.join(testDir, 'requests', 'label-update-test-404.json');
      const request = {
        requestId: 'test-404',
        timestamp: new Date().toISOString(),
        issueNumber: 404,
        action: 'update',
        addLabels: ['processing'],
        removeLabels: [],
        requestedBy: 'test',
        processId: 'test-process'
      };

      await fs.writeFile(requestFile, JSON.stringify(request, null, 2));

      // ファイルが存在することを確認
      expect(await fs.access(requestFile).then(() => true).catch(() => false)).to.be.true;

      // リクエストを処理
      await mirinManager.processRequest(requestFile);

      // ファイルが削除されたことを確認
      expect(await fs.access(requestFile).then(() => true).catch(() => false)).to.be.false;
    });

    it('存在するIssueのリクエストは正常に処理されること', async function() {
      // 存在するIssue #123へのリクエストファイルを作成
      const requestFile = path.join(testDir, 'requests', 'label-update-test-123.json');
      const request = {
        requestId: 'test-123',
        timestamp: new Date().toISOString(),
        issueNumber: 123,
        action: 'update',
        addLabels: ['completed'],
        removeLabels: ['processing'],
        requestedBy: 'test',
        processId: 'test-process'
      };

      await fs.writeFile(requestFile, JSON.stringify(request, null, 2));

      // ファイルが存在することを確認
      expect(await fs.access(requestFile).then(() => true).catch(() => false)).to.be.true;

      // リクエストを処理（正常に処理される）
      await mirinManager.processRequest(requestFile);

      // ファイルが削除されたことを確認（正常処理によって）
      expect(await fs.access(requestFile).then(() => true).catch(() => false)).to.be.false;
    });
  });

  describe('updateLabels メソッドのエラーハンドリング', function() {
    it('存在しないIssueに対してISSUE_NOT_FOUNDエラーをthrowすること', async function() {
      const request = {
        issueNumber: 404,
        addLabels: ['test'],
        removeLabels: []
      };

      try {
        await mirinManager.updateLabels(request);
        expect.fail('エラーがthrowされるべき');
      } catch (error) {
        expect(error.code).to.equal('ISSUE_NOT_FOUND');
        expect(error.message).to.include('Issue #404 not found');
      }
    });

    it('存在するIssueは正常に処理されること', async function() {
      const request = {
        issueNumber: 123,
        addLabels: ['completed'],
        removeLabels: ['processing']
      };

      // エラーがthrowされないことを確認
      await expect(mirinManager.updateLabels(request)).to.not.be.rejected;
    });
  });

  describe('古いリクエストファイルの削除', function() {
    it('1時間以上古いファイルは削除されること', async function() {
      // 古いリクエストファイルを作成
      const requestFile = path.join(testDir, 'requests', 'label-update-old.json');
      const request = {
        requestId: 'test-old',
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2時間前
        issueNumber: 123,
        action: 'update',
        addLabels: [],
        removeLabels: [],
        requestedBy: 'test'
      };

      await fs.writeFile(requestFile, JSON.stringify(request, null, 2));
      
      // ファイルのmtimeを古くする
      const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await fs.utimes(requestFile, oldTime, oldTime);

      // mockGithubClientを一時的にエラーを返すように設定
      const originalGetIssue = mockGithubClient.getIssue;
      mockGithubClient.getIssue = async () => {
        throw new Error('API Error');
      };

      try {
        // リクエストを処理（エラーになるが、古いファイルなので削除される）
        await mirinManager.processRequest(requestFile);
        
        // ファイルが削除されたことを確認
        expect(await fs.access(requestFile).then(() => true).catch(() => false)).to.be.false;
      } finally {
        // mockを元に戻す
        mockGithubClient.getIssue = originalGetIssue;
      }
    });
  });
});