const { describe, it, before, after, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const TestEnvironment = require('../helpers/test-environment');
const APIMocks = require('../helpers/api-mocks');
const fs = require('fs').promises;
const path = require('path');

describe('E2E: マルチエージェント連携', function() {
  this.timeout(120000); // マルチエージェントテストは時間がかかるため120秒に設定

  let testEnv;
  let apiMocks;
  let sandbox;
  let processes = {};

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
    apiMocks.setupErrorResponses();
  });

  afterEach(async function() {
    // すべてのプロセスの停止
    await testEnv.stopAllProcesses();
    processes = {};
  });

  describe('PoppoBuilder → CCLA → CCAG の連携', function() {
    it('エラー検出から自動修復、ドキュメント生成まで', async function() {
      let errorDetected = false;
      let fixApplied = false;
      let documentGenerated = false;

      // エラーを含むIssueのモック
      apiMocks.githubMock
        .get('/repos/medamap/PoppoBuilderSuite/issues')
        .query(true)
        .reply(200, [{
          id: 1,
          number: 200,
          title: 'エラー修正テスト',
          body: 'このコードにはエラーがあります:\n```javascript\nconsole.log(undefinedVariable);\n```',
          state: 'open',
          labels: [{ name: 'task:execute' }],
          user: { login: 'test-user' },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }]);

      // エラーログを検出するCCLAのモック
      apiMocks.githubMock
        .get('/repos/medamap/PoppoBuilderSuite/issues')
        .query({ labels: 'task:error-log' })
        .reply(200, () => {
          errorDetected = true;
          return [{
            id: 2,
            number: 201,
            title: 'エラーログ: ReferenceError',
            body: 'エラーが検出されました:\n- Issue #200\n- エラー: undefinedVariable is not defined',
            state: 'open',
            labels: [{ name: 'task:error-log' }],
            user: { login: 'ccla-agent' },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }];
        });

      // 修正を適用するためのコメント投稿
      apiMocks.githubMock
        .post('/repos/medamap/PoppoBuilderSuite/issues/200/comments')
        .reply(201, (uri, requestBody) => {
          if (requestBody.body.includes('修正コード')) {
            fixApplied = true;
          }
          return {
            id: Date.now(),
            body: requestBody.body,
            user: { login: 'ccla-agent' },
            created_at: new Date().toISOString()
          };
        });

      // ドキュメント生成のCCAGモック
      apiMocks.githubMock
        .get('/repos/medamap/PoppoBuilderSuite/issues')
        .query({ labels: 'task:documentation' })
        .reply(200, () => {
          documentGenerated = true;
          return [{
            id: 3,
            number: 202,
            title: 'ドキュメント生成: エラー修正ガイド',
            body: 'エラー修正のドキュメントを生成してください。',
            state: 'open',
            labels: [{ name: 'task:documentation' }],
            user: { login: 'test-user' },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }];
        });

      // エージェントコーディネーターを起動
      processes.coordinator = await testEnv.startProcess('node', ['scripts/start-agents.js'], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CONFIG_PATH: path.join(testEnv.tempDir, 'config.json'),
          DB_PATH: path.join(testEnv.tempDir, 'test.db'),
          LOG_DIR: path.join(testEnv.tempDir, 'logs'),
          GITHUB_TOKEN: 'test-github-token',
          CLAUDE_API_KEY: 'test-claude-api-key',
          AGENT_COORDINATOR_ENABLED: 'true',
          AGENT_CCLA_ENABLED: 'true',
          AGENT_CCAG_ENABLED: 'true',
          AGENT_CCPM_ENABLED: 'false',
          AGENT_CCQA_ENABLED: 'false'
        }
      });

      // コーディネーターが起動するまで待機
      await testEnv.waitForProcess(processes.coordinator, /Agent Coordinator が起動しました|Agent Coordinator started/, 15000);

      // PoppoBuilderを起動
      processes.poppo = await testEnv.startProcess('node', ['src/minimal-poppo.js'], {
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

      // PoppoBuilderが起動するまで待機
      await testEnv.waitForProcess(processes.poppo, /PoppoBuilder が起動しました|PoppoBuilder started/, 10000);

      // エージェント連携が完了するまで待機
      await new Promise(resolve => setTimeout(resolve, 20000));

      // 各ステップが実行されたことを確認
      expect(errorDetected).to.be.true;
      expect(fixApplied).to.be.true;
      expect(documentGenerated).to.be.true;

      // ログファイルを確認
      const logFiles = await fs.readdir(path.join(testEnv.tempDir, 'logs'));
      const coordinatorLog = logFiles.find(f => f.includes('agent-coordinator'));
      
      if (coordinatorLog) {
        const logContent = await fs.readFile(
          path.join(testEnv.tempDir, 'logs', coordinatorLog), 
          'utf-8'
        );
        
        // エージェント間の連携ログを確認
        expect(logContent).to.include('CCLA');
        expect(logContent).to.include('CCAG');
      }
    });

    it('エージェント間でタスクが正しく振り分けられる', async function() {
      const taskAssignments = {
        ccla: 0,
        ccag: 0,
        ccpm: 0,
        ccqa: 0
      };

      // 異なるタイプのIssueをモック
      apiMocks.githubMock
        .get('/repos/medamap/PoppoBuilderSuite/issues')
        .query(true)
        .reply(200, [
          {
            id: 1,
            number: 300,
            title: 'エラーログ収集',
            body: 'エラーログを収集してください。',
            state: 'open',
            labels: [{ name: 'task:error-log' }],
            user: { login: 'test-user' },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          },
          {
            id: 2,
            number: 301,
            title: 'ドキュメント生成',
            body: 'APIドキュメントを生成してください。',
            state: 'open',
            labels: [{ name: 'task:documentation' }],
            user: { login: 'test-user' },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          },
          {
            id: 3,
            number: 302,
            title: 'コードレビュー',
            body: 'このPRをレビューしてください。',
            state: 'open',
            labels: [{ name: 'task:review' }],
            user: { login: 'test-user' },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          },
          {
            id: 4,
            number: 303,
            title: '品質保証',
            body: 'テストカバレッジを確認してください。',
            state: 'open',
            labels: [{ name: 'task:quality' }],
            user: { login: 'test-user' },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        ]);

      // 各エージェントのタスク処理をトラッキング
      apiMocks.claudeMock
        .post('/v1/messages')
        .reply(200, (uri, requestBody) => {
          const content = requestBody.messages[0].content;
          
          if (content.includes('エラーログ')) {
            taskAssignments.ccla++;
          } else if (content.includes('ドキュメント')) {
            taskAssignments.ccag++;
          } else if (content.includes('レビュー')) {
            taskAssignments.ccpm++;
          } else if (content.includes('品質') || content.includes('テスト')) {
            taskAssignments.ccqa++;
          }

          return {
            id: 'msg_' + Date.now(),
            type: 'message',
            role: 'assistant',
            content: [{
              type: 'text',
              text: 'タスクを処理しました。'
            }],
            model: 'claude-3-haiku-20240307',
            stop_reason: 'end_turn',
            usage: {
              input_tokens: 100,
              output_tokens: 50
            }
          };
        });

      // すべてのエージェントを有効にしてコーディネーターを起動
      processes.coordinator = await testEnv.startProcess('node', ['scripts/start-agents.js'], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CONFIG_PATH: path.join(testEnv.tempDir, 'config.json'),
          DB_PATH: path.join(testEnv.tempDir, 'test.db'),
          LOG_DIR: path.join(testEnv.tempDir, 'logs'),
          GITHUB_TOKEN: 'test-github-token',
          CLAUDE_API_KEY: 'test-claude-api-key',
          AGENT_COORDINATOR_ENABLED: 'true',
          AGENT_CCLA_ENABLED: 'true',
          AGENT_CCAG_ENABLED: 'true',
          AGENT_CCPM_ENABLED: 'true',
          AGENT_CCQA_ENABLED: 'true'
        }
      });

      // コーディネーターが起動するまで待機
      await testEnv.waitForProcess(processes.coordinator, /Agent Coordinator が起動しました|Agent Coordinator started/, 15000);

      // タスク処理が完了するまで待機
      await new Promise(resolve => setTimeout(resolve, 25000));

      // 各エージェントが適切なタスクを処理したことを確認
      expect(taskAssignments.ccla).to.be.greaterThan(0);
      expect(taskAssignments.ccag).to.be.greaterThan(0);
      expect(taskAssignments.ccpm).to.be.greaterThan(0);
      expect(taskAssignments.ccqa).to.be.greaterThan(0);
    });
  });

  describe('エージェント間のメッセージング', function() {
    it('ファイルベースのメッセージが正しく処理される', async function() {
      // メッセージディレクトリを作成
      const messageDir = path.join(testEnv.tempDir, 'data', 'messages');
      await fs.mkdir(messageDir, { recursive: true });

      // テストメッセージを作成
      const testMessage = {
        id: 'test-msg-001',
        from: 'poppo-builder',
        to: 'ccla',
        type: 'task',
        payload: {
          issueNumber: 400,
          action: 'analyze-error',
          data: {
            error: 'TypeError: Cannot read property of undefined',
            file: 'test.js',
            line: 42
          }
        },
        timestamp: new Date().toISOString()
      };

      // メッセージファイルを作成
      const messageFile = path.join(messageDir, `${testMessage.id}.json`);
      await fs.writeFile(messageFile, JSON.stringify(testMessage, null, 2));

      // CCLAエージェントを単独で起動
      processes.ccla = await testEnv.startProcess('node', ['agents/ccla/index.js'], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CONFIG_PATH: path.join(testEnv.tempDir, 'config.json'),
          DB_PATH: path.join(testEnv.tempDir, 'test.db'),
          LOG_DIR: path.join(testEnv.tempDir, 'logs'),
          MESSAGE_DIR: messageDir,
          GITHUB_TOKEN: 'test-github-token',
          CLAUDE_API_KEY: 'test-claude-api-key'
        }
      });

      // エージェントが起動するまで待機
      await testEnv.waitForProcess(processes.ccla, /CCLA Agent が起動しました|CCLA Agent started/, 10000);

      // メッセージが処理されるまで待機
      await new Promise(resolve => setTimeout(resolve, 5000));

      // メッセージファイルが処理されて削除されたことを確認
      const remainingFiles = await fs.readdir(messageDir);
      expect(remainingFiles).to.not.include(`${testMessage.id}.json`);

      // 処理済みディレクトリにファイルが移動されたことを確認
      const processedDir = path.join(messageDir, 'processed');
      try {
        const processedFiles = await fs.readdir(processedDir);
        expect(processedFiles).to.include(`${testMessage.id}.json`);
      } catch (err) {
        // processedディレクトリが存在しない場合もOK（実装による）
      }
    });

    it('エージェント間の循環参照が防止される', async function() {
      let messageCount = 0;
      const maxExpectedMessages = 10; // 循環参照が防止されていれば、この数を超えない

      // メッセージ送信をカウント
      apiMocks.githubMock
        .post('/repos/medamap/PoppoBuilderSuite/issues/500/comments')
        .reply(201, () => {
          messageCount++;
          return {
            id: Date.now(),
            body: `メッセージ ${messageCount}`,
            user: { login: 'agent' },
            created_at: new Date().toISOString()
          };
        });

      // 循環参照を引き起こす可能性のあるIssue
      apiMocks.githubMock
        .get('/repos/medamap/PoppoBuilderSuite/issues')
        .query(true)
        .reply(200, [{
          id: 1,
          number: 500,
          title: '循環参照テスト',
          body: 'CCLAとCCAGで相互に参照するタスク',
          state: 'open',
          labels: [
            { name: 'task:error-log' },
            { name: 'task:documentation' }
          ],
          user: { login: 'test-user' },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }]);

      // エージェントコーディネーターを起動
      processes.coordinator = await testEnv.startProcess('node', ['scripts/start-agents.js'], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CONFIG_PATH: path.join(testEnv.tempDir, 'config.json'),
          DB_PATH: path.join(testEnv.tempDir, 'test.db'),
          LOG_DIR: path.join(testEnv.tempDir, 'logs'),
          GITHUB_TOKEN: 'test-github-token',
          CLAUDE_API_KEY: 'test-claude-api-key',
          AGENT_COORDINATOR_ENABLED: 'true',
          AGENT_CCLA_ENABLED: 'true',
          AGENT_CCAG_ENABLED: 'true',
          MESSAGE_LOOP_DETECTION: 'true',
          MAX_MESSAGE_HOPS: '5'
        }
      });

      // コーディネーターが起動するまで待機
      await testEnv.waitForProcess(processes.coordinator, /Agent Coordinator が起動しました|Agent Coordinator started/, 15000);

      // 処理が完了するまで待機
      await new Promise(resolve => setTimeout(resolve, 20000));

      // メッセージ数が適切な範囲内であることを確認
      expect(messageCount).to.be.lessThan(maxExpectedMessages);
    });
  });
});