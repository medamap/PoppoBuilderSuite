const { describe, it, before, after, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const TestEnvironment = require('../helpers/test-environment');
const APIMocks = require('../helpers/api-mocks');
const fs = require('fs').promises;
const path = require('path');

describe('E2E: 基本的なIssue処理フロー', function() {
  this.timeout(60000); // E2Eテストは時間がかかるため60秒に設定

  let testEnv;
  let apiMocks;
  let sandbox;
  let poppoProcess;

  before(async function() {
    // テスト環境の初期化
    testEnv = new TestEnvironment();
    apiMocks = new APIMocks();
    
    await testEnv.setup();
    
    // APIモックのセットアップ
    apiMocks.setupGitHubMocks();
    apiMocks.setupClaudeMocks();
  });

  after(async function() {
    // クリーンアップ
    await testEnv.teardown();
    apiMocks.cleanupMocks();
  });

  beforeEach(function() {
    // 各テストの前にモックをリセット
    apiMocks.cleanupMocks();
    apiMocks.setupGitHubMocks();
    apiMocks.setupClaudeMocks();
  });

  afterEach(async function() {
    // プロセスの停止
    if (poppoProcess) {
      await testEnv.stopAllProcesses();
      poppoProcess = null;
    }
  });

  describe('新規Issue作成から処理完了まで', function() {
    it('task:executeラベルが付いたIssueを正常に処理できる', async function() {
      // PoppoBuilderプロセスを起動
      poppoProcess = await testEnv.startProcess('node', ['src/minimal-poppo.js'], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CONFIG_PATH: path.join(testEnv.tempDir, 'config.json'),
          DB_PATH: path.join(testEnv.tempDir, 'test.db'),
          LOG_DIR: path.join(testEnv.tempDir, 'logs'),
          GITHUB_TOKEN: 'test-github-token',
          CLAUDE_API_KEY: 'test-claude-api-key'
        }
      });

      // プロセスが起動するまで待機
      await testEnv.waitForProcess(poppoProcess, /PoppoBuilder が起動しました|PoppoBuilder started/, 10000);

      // しばらく待ってIssueが処理されるのを確認
      await new Promise(resolve => setTimeout(resolve, 5000));

      // ログファイルを確認
      const logFiles = await fs.readdir(path.join(testEnv.tempDir, 'logs'));
      expect(logFiles).to.have.length.greaterThan(0);

      // ログ内容を確認
      const logContent = await fs.readFile(
        path.join(testEnv.tempDir, 'logs', logFiles[0]), 
        'utf-8'
      );

      // Issue処理のログが含まれていることを確認
      expect(logContent).to.include('Issue #100');
      expect(logContent).to.include('タスクを実行');

      // APIモックが呼ばれたことを確認
      expect(apiMocks.verifyMocks()).to.be.true;
    });

    it('処理完了後にコメントが投稿される', async function() {
      let commentPosted = false;

      // コメント投稿をキャプチャ
      apiMocks.githubMock
        .post('/repos/medamap/PoppoBuilderSuite/issues/100/comments')
        .reply(201, (uri, requestBody) => {
          commentPosted = true;
          expect(requestBody.body).to.include('処理が完了しました');
          return {
            id: Date.now(),
            body: requestBody.body,
            user: { login: 'poppo-builder[bot]' },
            created_at: new Date().toISOString()
          };
        });

      // PoppoBuilderを起動
      poppoProcess = await testEnv.startProcess('node', ['src/minimal-poppo.js'], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CONFIG_PATH: path.join(testEnv.tempDir, 'config.json'),
          DB_PATH: path.join(testEnv.tempDir, 'test.db'),
          LOG_DIR: path.join(testEnv.tempDir, 'logs'),
          GITHUB_TOKEN: 'test-github-token',
          CLAUDE_API_KEY: 'test-claude-api-key'
        }
      });

      // プロセスが起動するまで待機
      await testEnv.waitForProcess(poppoProcess, /PoppoBuilder が起動しました|PoppoBuilder started/, 10000);

      // Issue処理が完了するまで待機
      await new Promise(resolve => setTimeout(resolve, 8000));

      // コメントが投稿されたことを確認
      expect(commentPosted).to.be.true;
    });
  });

  describe('コメント追加による再処理', function() {
    it('新しいコメントが追加されたときに再処理される', async function() {
      const dynamicMocks = apiMocks.setupDynamicMocks();
      let reprocessed = false;

      // PoppoBuilderを起動
      poppoProcess = await testEnv.startProcess('node', ['src/minimal-poppo.js'], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CONFIG_PATH: path.join(testEnv.tempDir, 'config.json'),
          DB_PATH: path.join(testEnv.tempDir, 'test.db'),
          LOG_DIR: path.join(testEnv.tempDir, 'logs'),
          GITHUB_TOKEN: 'test-github-token',
          CLAUDE_API_KEY: 'test-claude-api-key'
        }
      });

      // プロセスが起動するまで待機
      await testEnv.waitForProcess(poppoProcess, /PoppoBuilder が起動しました|PoppoBuilder started/, 10000);

      // 初回処理が完了するまで待機
      await new Promise(resolve => setTimeout(resolve, 5000));

      // 新しいコメントを追加
      dynamicMocks.addComment('追加の処理をお願いします。');

      // コメント取得時に再処理フラグを立てる
      apiMocks.githubMock
        .get('/repos/medamap/PoppoBuilderSuite/issues/100/comments')
        .reply(200, () => {
          reprocessed = true;
          return [{
            id: Date.now(),
            body: '追加の処理をお願いします。',
            user: { login: 'test-user' },
            created_at: new Date().toISOString()
          }];
        });

      // 再処理が行われるまで待機
      await new Promise(resolve => setTimeout(resolve, 10000));

      // 再処理が行われたことを確認
      expect(reprocessed).to.be.true;
    });
  });

  describe('エラー発生時のリトライ動作', function() {
    it('Claude APIエラー時にリトライされる', async function() {
      let retryCount = 0;

      // 最初の2回はエラー、3回目で成功
      apiMocks.claudeMock
        .post('/v1/messages')
        .times(2)
        .reply(500, {
          error: {
            type: 'internal_server_error',
            message: 'An internal server error occurred'
          }
        });

      apiMocks.claudeMock
        .post('/v1/messages')
        .reply(200, () => {
          retryCount++;
          return {
            id: 'msg_' + Date.now(),
            type: 'message',
            role: 'assistant',
            content: [{
              type: 'text',
              text: 'リトライ後に成功しました。'
            }],
            model: 'claude-3-haiku-20240307',
            stop_reason: 'end_turn',
            usage: {
              input_tokens: 100,
              output_tokens: 50
            }
          };
        });

      // PoppoBuilderを起動
      poppoProcess = await testEnv.startProcess('node', ['src/minimal-poppo.js'], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CONFIG_PATH: path.join(testEnv.tempDir, 'config.json'),
          DB_PATH: path.join(testEnv.tempDir, 'test.db'),
          LOG_DIR: path.join(testEnv.tempDir, 'logs'),
          GITHUB_TOKEN: 'test-github-token',
          CLAUDE_API_KEY: 'test-claude-api-key',
          RETRY_ATTEMPTS: '3',
          RETRY_DELAY: '1000'
        }
      });

      // プロセスが起動するまで待機
      await testEnv.waitForProcess(poppoProcess, /PoppoBuilder が起動しました|PoppoBuilder started/, 10000);

      // リトライ処理が完了するまで待機
      await new Promise(resolve => setTimeout(resolve, 15000));

      // ログファイルを確認
      const logFiles = await fs.readdir(path.join(testEnv.tempDir, 'logs'));
      const logContent = await fs.readFile(
        path.join(testEnv.tempDir, 'logs', logFiles[0]), 
        'utf-8'
      );

      // リトライログが含まれていることを確認
      expect(logContent).to.include('リトライ');
      expect(retryCount).to.be.greaterThan(0);
    });

    it('GitHub APIレート制限時に待機して再試行される', async function() {
      let rateLimitHit = false;
      let retryAttempted = false;

      // 最初はレート制限エラー
      apiMocks.githubMock
        .get('/repos/medamap/PoppoBuilderSuite/issues')
        .query(true)
        .reply(403, () => {
          rateLimitHit = true;
          return {
            message: 'API rate limit exceeded',
            documentation_url: 'https://docs.github.com/rest'
          };
        });

      // レート制限後は成功
      setTimeout(() => {
        apiMocks.githubMock
          .get('/repos/medamap/PoppoBuilderSuite/issues')
          .query(true)
          .reply(200, () => {
            retryAttempted = true;
            return [{
              id: 1,
              number: 100,
              title: 'テストIssue 1',
              body: 'レート制限後の処理',
              state: 'open',
              labels: [{ name: 'task:execute' }],
              user: { login: 'test-user' },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }];
          });
      }, 2000);

      // PoppoBuilderを起動
      poppoProcess = await testEnv.startProcess('node', ['src/minimal-poppo.js'], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CONFIG_PATH: path.join(testEnv.tempDir, 'config.json'),
          DB_PATH: path.join(testEnv.tempDir, 'test.db'),
          LOG_DIR: path.join(testEnv.tempDir, 'logs'),
          GITHUB_TOKEN: 'test-github-token',
          CLAUDE_API_KEY: 'test-claude-api-key',
          RATE_LIMIT_RETRY_DELAY: '2000'
        }
      });

      // プロセスが起動するまで待機
      await testEnv.waitForProcess(poppoProcess, /PoppoBuilder が起動しました|PoppoBuilder started/, 10000);

      // レート制限の処理が完了するまで待機
      await new Promise(resolve => setTimeout(resolve, 10000));

      // レート制限に遭遇し、再試行されたことを確認
      expect(rateLimitHit).to.be.true;
      expect(retryAttempted).to.be.true;
    });
  });

  describe('並行処理の制御', function() {
    it('最大同時実行数が守られる', async function() {
      const dynamicMocks = apiMocks.setupDynamicMocks();
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      // 複数のIssueを返す
      apiMocks.githubMock
        .get('/repos/medamap/PoppoBuilderSuite/issues')
        .query(true)
        .reply(200, Array(5).fill(null).map((_, i) => ({
          id: i + 1,
          number: 100 + i,
          title: `テストIssue ${i + 1}`,
          body: `並行処理テスト用Issue ${i + 1}`,
          state: 'open',
          labels: [{ name: 'task:execute' }],
          user: { login: 'test-user' },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })));

      // Claude API呼び出しをトラッキング
      apiMocks.claudeMock
        .post('/v1/messages')
        .reply(200, async () => {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
          
          // 処理時間をシミュレート
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          currentConcurrent--;
          
          return {
            id: 'msg_' + Date.now(),
            type: 'message',
            role: 'assistant',
            content: [{
              type: 'text',
              text: '並行処理テストの結果です。'
            }],
            model: 'claude-3-haiku-20240307',
            stop_reason: 'end_turn',
            usage: {
              input_tokens: 100,
              output_tokens: 50
            }
          };
        });

      // PoppoBuilderを起動（最大同時実行数を2に設定）
      poppoProcess = await testEnv.startProcess('node', ['src/minimal-poppo.js'], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CONFIG_PATH: path.join(testEnv.tempDir, 'config.json'),
          DB_PATH: path.join(testEnv.tempDir, 'test.db'),
          LOG_DIR: path.join(testEnv.tempDir, 'logs'),
          GITHUB_TOKEN: 'test-github-token',
          CLAUDE_API_KEY: 'test-claude-api-key',
          MAX_CONCURRENT_PROCESSES: '2'
        }
      });

      // プロセスが起動するまで待機
      await testEnv.waitForProcess(poppoProcess, /PoppoBuilder が起動しました|PoppoBuilder started/, 10000);

      // すべての処理が完了するまで待機
      await new Promise(resolve => setTimeout(resolve, 15000));

      // 最大同時実行数が2を超えていないことを確認
      expect(maxConcurrent).to.be.at.most(2);
    });
  });
});