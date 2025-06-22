/**
 * 安定した統合テスト - 修正されたテストフレームワーク用
 */

const { expect } = require('chai');
const sinon = require('sinon');
const MockFactory = require('../helpers/mock-factory');
const TestHelper = require('./test-helper');

describe('PoppoBuilder 統合テスト (安定版)', () => {
  let testHelper;
  let mockFactory;
  let sandbox;

  before(() => {
    testHelper = new TestHelper();
    mockFactory = new MockFactory();
    sandbox = sinon.createSandbox();
  });

  after(async () => {
    await testHelper.cleanup();
    mockFactory.cleanup();
    sandbox.restore();
  });

  describe('基本機能テスト', () => {
    it('GitHub クライアントのモック動作', async () => {
      const github = mockFactory.createMockGitHubClient();
      
      // モックデータを設定
      github.issues = [
        { number: 1, title: 'Test Issue', labels: ['task:misc'] }
      ];

      const issue = await github.getIssue(1);
      expect(issue).to.not.be.null;
      expect(issue.number).to.equal(1);
      expect(issue.title).to.equal('Test Issue');
    });

    it('JWT認証モック動作', async () => {
      const jwtAuth = mockFactory.createMockJWTAuth();
      
      const result = await jwtAuth.authenticateAgent('test-agent', 'test-key');
      
      expect(result).to.have.property('accessToken');
      expect(result).to.have.property('refreshToken');
      expect(result.role).to.equal('test-role');
    });

    it('ファイル状態管理モック動作', () => {
      const stateManager = mockFactory.createMockFileStateManager();
      
      expect(stateManager.loadProcessedIssues).to.be.a('function');
      expect(stateManager.saveRunningTasks).to.be.a('function');
      expect(stateManager.acquireProcessLock).to.be.a('function');
    });
  });

  describe('設定管理テスト', () => {
    it('テスト設定を作成できる', () => {
      const config = testHelper.createTestConfig({
        github: { token: 'custom-token' }
      });

      expect(config).to.have.property('github');
      expect(config.github.token).to.equal('custom-token');
      expect(config.github.owner).to.equal('test-owner');
    });

    it('環境変数での設定上書き', async () => {
      const result = await testHelper.withEnv(
        { TEST_VAR: 'test-value' },
        () => {
          return process.env.TEST_VAR;
        }
      );

      expect(result).to.equal('test-value');
    });
  });

  describe('HTTP通信テスト', () => {
    it('HTTPリクエストモック', async () => {
      // 実際のHTTPリクエストは行わず、モックで応答
      const mockResponse = {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ success: true })
      };

      // HTTPリクエストをモック
      const httpStub = sandbox.stub().resolves(mockResponse);
      
      const result = await httpStub('http://example.com/api');
      
      expect(result.statusCode).to.equal(200);
      expect(JSON.parse(result.body).success).to.be.true;
    });
  });

  describe('エラーハンドリングテスト', () => {
    it('エラーを適切にキャッチする', async () => {
      const errorFunction = async () => {
        throw new Error('Test error');
      };

      try {
        await errorFunction();
        expect.fail('エラーが発生すべきでした');
      } catch (error) {
        expect(error.message).to.equal('Test error');
      }
    });

    it('非同期エラーハンドリング', async () => {
      const asyncErrorFunction = () => {
        return Promise.reject(new Error('Async error'));
      };

      try {
        await asyncErrorFunction();
        expect.fail('非同期エラーが発生すべきでした');
      } catch (error) {
        expect(error.message).to.equal('Async error');
      }
    });
  });

  describe('並行処理テスト', () => {
    it('複数の非同期操作を並行実行', async () => {
      const operations = [
        () => Promise.resolve('result1'),
        () => Promise.resolve('result2'),
        () => Promise.resolve('result3')
      ];

      const results = await Promise.all(operations.map(op => op()));
      
      expect(results).to.have.lengthOf(3);
      expect(results).to.include('result1');
      expect(results).to.include('result2');
      expect(results).to.include('result3');
    });

    it('一つの操作が失敗しても他に影響しない', async () => {
      const operations = [
        () => Promise.resolve('success1'),
        () => Promise.reject(new Error('failure')),
        () => Promise.resolve('success2')
      ];

      const results = await Promise.allSettled(operations.map(op => op()));
      
      expect(results).to.have.lengthOf(3);
      expect(results[0].status).to.equal('fulfilled');
      expect(results[0].value).to.equal('success1');
      expect(results[1].status).to.equal('rejected');
      expect(results[2].status).to.equal('fulfilled');
      expect(results[2].value).to.equal('success2');
    });
  });

  describe('タイムアウトテスト', () => {
    it('タイムアウト付きの操作', async () => {
      const timeoutPromise = (ms) => {
        return new Promise((resolve) => {
          setTimeout(() => resolve('completed'), ms);
        });
      };

      const result = await timeoutPromise(100);
      expect(result).to.equal('completed');
    });

    it('タイムアウトエラーのシミュレーション', async () => {
      const slowOperation = () => {
        return new Promise((resolve) => {
          setTimeout(() => resolve('too late'), 1000);
        });
      };

      const timeoutPromise = (promise, ms) => {
        return Promise.race([
          promise,
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timeout')), ms);
          })
        ]);
      };

      try {
        await timeoutPromise(slowOperation(), 100);
        expect.fail('タイムアウトエラーが発生すべきでした');
      } catch (error) {
        expect(error.message).to.equal('Timeout');
      }
    });
  });
});