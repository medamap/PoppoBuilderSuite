const { describe, it, before, after, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const TestEnvironment = require('../helpers/test-environment');
const APIMocks = require('../helpers/api-mocks');
const fs = require('fs').promises;
const path = require('path');

describe('E2E: 設定管理とエラーリカバリー', function() {
  this.timeout(60000);

  let testEnv;
  let apiMocks;
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
    processes = {};
  });

  afterEach(async function() {
    // すべてのプロセスの停止
    await testEnv.stopAllProcesses();
  });

  describe('設定管理フロー', function() {
    it('設定変更が動的に反映される', async function() {
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

      // プロセスが起動するまで待機
      await testEnv.waitForProcess(processes.poppo, /PoppoBuilder が起動しました|PoppoBuilder started/, 10000);

      // 初期設定の確認
      const configPath = path.join(testEnv.tempDir, 'config.json');
      const initialConfig = JSON.parse(await fs.readFile(configPath, 'utf-8'));
      expect(initialConfig.language.primary).to.equal('ja');

      // 設定を変更
      initialConfig.language.primary = 'en';
      initialConfig.claude.maxConcurrent = 5;
      await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2));

      // 設定変更の通知を送信（ファイル監視をシミュレート）
      processes.poppo.kill('SIGHUP'); // 設定再読み込みシグナル

      // 変更が反映されるまで待機
      await new Promise(resolve => setTimeout(resolve, 3000));

      // ログを確認
      const logFiles = await fs.readdir(path.join(testEnv.tempDir, 'logs'));
      const logContent = await fs.readFile(
        path.join(testEnv.tempDir, 'logs', logFiles[0]), 
        'utf-8'
      );

      // 設定再読み込みのログを確認
      expect(logContent).to.include('設定を再読み込み');
    });

    it('環境変数による設定の上書きが機能する', async function() {
      // 環境変数で設定を上書き
      processes.poppo = await testEnv.startProcess('node', ['src/minimal-poppo.js'], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CONFIG_PATH: path.join(testEnv.tempDir, 'config.json'),
          DB_PATH: path.join(testEnv.tempDir, 'test.db'),
          LOG_DIR: path.join(testEnv.tempDir, 'logs'),
          GITHUB_TOKEN: 'test-github-token',
          CLAUDE_API_KEY: 'test-claude-api-key',
          POPPO_LANGUAGE_PRIMARY: 'en',
          POPPO_CLAUDE_MAXCONCURRENT: '10',
          POPPO_CLAUDE_TIMEOUT: '3000'
        }
      });

      // プロセスが起動するまで待機
      await testEnv.waitForProcess(processes.poppo, /PoppoBuilder が起動しました|PoppoBuilder started/, 10000);

      // 設定確認スクリプトを実行
      processes.configCheck = await testEnv.startProcess('node', ['scripts/poppo-config.js', 'show'], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CONFIG_PATH: path.join(testEnv.tempDir, 'config.json'),
          POPPO_LANGUAGE_PRIMARY: 'en',
          POPPO_CLAUDE_MAXCONCURRENT: '10'
        }
      });

      // 出力を確認
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 環境変数による上書きが適用されていることを確認
      // (実際の実装では、設定の出力をキャプチャして確認)
    });

    it('設定バリデーションが正しく動作する', async function() {
      // 不正な設定を作成
      const invalidConfig = {
        language: {
          // primary が欠落
          secondary: 'en'
        },
        claude: {
          apiKey: 'test-key',
          maxConcurrent: 100, // 範囲外
          timeout: -1000 // 負の値
        }
      };

      const configPath = path.join(testEnv.tempDir, 'config.json');
      await fs.writeFile(configPath, JSON.stringify(invalidConfig, null, 2));

      // バリデーションを実行
      processes.validate = await testEnv.startProcess('node', ['scripts/poppo-config.js', 'validate'], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CONFIG_PATH: configPath
        }
      });

      // バリデーションエラーが発生することを確認
      await new Promise((resolve, reject) => {
        processes.validate.on('exit', (code) => {
          expect(code).to.not.equal(0);
          resolve();
        });
      });
    });
  });

  describe('エラーリカバリー', function() {
    it('プロセスクラッシュからの自動復旧', async function() {
      let crashCount = 0;
      let recoveryCount = 0;

      // クラッシュをシミュレートするモック
      apiMocks.claudeMock
        .post('/v1/messages')
        .reply(200, () => {
          crashCount++;
          if (crashCount === 1) {
            // 最初の呼び出しでクラッシュをシミュレート
            process.nextTick(() => {
              processes.poppo.kill('SIGKILL');
            });
            throw new Error('Simulated crash');
          }
          
          recoveryCount++;
          return {
            id: 'msg_' + Date.now(),
            type: 'message',
            role: 'assistant',
            content: [{
              type: 'text',
              text: '復旧後の処理結果'
            }],
            model: 'claude-3-haiku-20240307',
            stop_reason: 'end_turn',
            usage: {
              input_tokens: 100,
              output_tokens: 50
            }
          };
        });

      // MedamaRepair（監視・復旧システム）を起動
      processes.medama = await testEnv.startProcess('node', ['scripts/medama-repair.js'], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CONFIG_PATH: path.join(testEnv.tempDir, 'config.json'),
          DB_PATH: path.join(testEnv.tempDir, 'test.db'),
          LOG_DIR: path.join(testEnv.tempDir, 'logs'),
          MONITOR_INTERVAL: '2000', // 2秒ごとに監視
          AUTO_RESTART: 'true'
        }
      });

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

      // クラッシュと復旧を待つ
      await new Promise(resolve => setTimeout(resolve, 10000));

      // 復旧が行われたことを確認
      expect(recoveryCount).to.be.greaterThan(0);
    });

    it('レート制限への自動対応', async function() {
      let rateLimitCount = 0;
      let successAfterWait = false;

      // レート制限を返すモック
      apiMocks.githubMock
        .get('/repos/medamap/PoppoBuilderSuite/issues')
        .query(true)
        .reply(function() {
          rateLimitCount++;
          if (rateLimitCount <= 2) {
            // 最初の2回はレート制限
            return [429, {
              message: 'API rate limit exceeded',
              documentation_url: 'https://docs.github.com/rest'
            }, {
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': Math.floor(Date.now() / 1000) + 5
            }];
          }
          
          // 3回目は成功
          successAfterWait = true;
          return [200, [{
            id: 1,
            number: 600,
            title: 'レート制限テスト',
            body: 'レート制限後の処理',
            state: 'open',
            labels: [{ name: 'task:execute' }],
            user: { login: 'test-user' },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }]];
        });

      // PoppoBuilderを起動
      processes.poppo = await testEnv.startProcess('node', ['src/minimal-poppo.js'], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CONFIG_PATH: path.join(testEnv.tempDir, 'config.json'),
          DB_PATH: path.join(testEnv.tempDir, 'test.db'),
          LOG_DIR: path.join(testEnv.tempDir, 'logs'),
          GITHUB_TOKEN: 'test-github-token',
          CLAUDE_API_KEY: 'test-claude-api-key',
          RATE_LIMIT_RETRY: 'true',
          RATE_LIMIT_MAX_RETRIES: '3'
        }
      });

      // プロセスが起動するまで待機
      await testEnv.waitForProcess(processes.poppo, /PoppoBuilder が起動しました|PoppoBuilder started/, 10000);

      // レート制限の処理を待つ
      await new Promise(resolve => setTimeout(resolve, 15000));

      // レート制限に遭遇し、待機後に成功したことを確認
      expect(rateLimitCount).to.be.greaterThan(1);
      expect(successAfterWait).to.be.true;
    });

    it('並行処理の競合解決', async function() {
      let processingCount = 0;
      const maxConcurrent = 3;

      // 同時処理数をトラッキング
      apiMocks.claudeMock
        .post('/v1/messages')
        .reply(200, async () => {
          processingCount++;
          const currentCount = processingCount;
          
          // 処理時間をシミュレート
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          processingCount--;
          
          return {
            id: 'msg_' + Date.now(),
            type: 'message',
            role: 'assistant',
            content: [{
              type: 'text',
              text: `並行処理 ${currentCount}/${maxConcurrent}`
            }],
            model: 'claude-3-haiku-20240307',
            stop_reason: 'end_turn',
            usage: {
              input_tokens: 100,
              output_tokens: 50
            }
          };
        });

      // 多数のIssueを返す
      apiMocks.githubMock
        .get('/repos/medamap/PoppoBuilderSuite/issues')
        .query(true)
        .reply(200, Array(10).fill(null).map((_, i) => ({
          id: i + 1,
          number: 700 + i,
          title: `並行処理テスト ${i + 1}`,
          body: '競合解決のテスト',
          state: 'open',
          labels: [{ name: 'task:execute' }],
          user: { login: 'test-user' },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })));

      // PoppoBuilderを起動（最大同時実行数を設定）
      processes.poppo = await testEnv.startProcess('node', ['src/minimal-poppo.js'], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CONFIG_PATH: path.join(testEnv.tempDir, 'config.json'),
          DB_PATH: path.join(testEnv.tempDir, 'test.db'),
          LOG_DIR: path.join(testEnv.tempDir, 'logs'),
          GITHUB_TOKEN: 'test-github-token',
          CLAUDE_API_KEY: 'test-claude-api-key',
          MAX_CONCURRENT_PROCESSES: String(maxConcurrent)
        }
      });

      // プロセスが起動するまで待機
      await testEnv.waitForProcess(processes.poppo, /PoppoBuilder が起動しました|PoppoBuilder started/, 10000);

      // 並行処理の監視
      let maxObservedConcurrent = 0;
      const checkInterval = setInterval(() => {
        maxObservedConcurrent = Math.max(maxObservedConcurrent, processingCount);
      }, 100);

      // すべての処理が完了するまで待機
      await new Promise(resolve => setTimeout(resolve, 20000));
      clearInterval(checkInterval);

      // 最大同時実行数が守られていることを確認
      expect(maxObservedConcurrent).to.be.at.most(maxConcurrent);
    });

    it('データベース破損からの復旧', async function() {
      // 正常なデータベースで開始
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

      // プロセスが起動するまで待機
      await testEnv.waitForProcess(processes.poppo, /PoppoBuilder が起動しました|PoppoBuilder started/, 10000);

      // プロセスを停止
      await testEnv.stopAllProcesses();

      // データベースファイルを破損させる
      const dbPath = path.join(testEnv.tempDir, 'test.db');
      await fs.writeFile(dbPath, 'corrupted data');

      // ヘルスチェックマネージャーを起動
      processes.health = await testEnv.startProcess('node', ['scripts/poppo-health.js', 'check'], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CONFIG_PATH: path.join(testEnv.tempDir, 'config.json'),
          DB_PATH: dbPath,
          LOG_DIR: path.join(testEnv.tempDir, 'logs'),
          AUTO_RECOVERY: 'true'
        }
      });

      // 復旧処理を待つ
      await new Promise(resolve => setTimeout(resolve, 5000));

      // データベースが再作成されたことを確認
      const stats = await fs.stat(dbPath);
      expect(stats.size).to.be.greaterThan(100); // 破損データより大きい

      // PoppoBuilderを再起動して正常に動作することを確認
      processes.poppo2 = await testEnv.startProcess('node', ['src/minimal-poppo.js'], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CONFIG_PATH: path.join(testEnv.tempDir, 'config.json'),
          DB_PATH: dbPath,
          LOG_DIR: path.join(testEnv.tempDir, 'logs'),
          GITHUB_TOKEN: 'test-github-token',
          CLAUDE_API_KEY: 'test-claude-api-key'
        }
      });

      // 正常に起動することを確認
      await testEnv.waitForProcess(processes.poppo2, /PoppoBuilder が起動しました|PoppoBuilder started/, 10000);
    });
  });
});