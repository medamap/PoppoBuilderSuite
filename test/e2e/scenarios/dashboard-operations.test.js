const { describe, it, before, after, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const TestEnvironment = require('../helpers/test-environment');
const APIMocks = require('../helpers/api-mocks');
const supertest = require('supertest');
const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

describe('E2E: ダッシュボード操作', function() {
  this.timeout(90000); // ブラウザテストは時間がかかるため90秒に設定

  let testEnv;
  let apiMocks;
  let sandbox;
  let dashboardProcess;
  let browser;
  let page;
  let request;

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
    if (browser) {
      await browser.close();
    }
    await testEnv.teardown();
    apiMocks.cleanupMocks();
  });

  beforeEach(async function() {
    // 各テストの前にモックをリセット
    apiMocks.cleanupMocks();
    apiMocks.setupGitHubMocks();
    apiMocks.setupClaudeMocks();

    // ダッシュボードサーバーを起動
    dashboardProcess = await testEnv.startProcess('node', ['dashboard/server/index.js'], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        CONFIG_PATH: path.join(testEnv.tempDir, 'config.json'),
        DB_PATH: path.join(testEnv.tempDir, 'test.db'),
        LOG_DIR: path.join(testEnv.tempDir, 'logs'),
        DASHBOARD_PORT: '4001',
        DASHBOARD_PASSWORD: 'test-password',
        SESSION_SECRET: 'test-session-secret',
        JWT_SECRET: 'test-jwt-secret'
      }
    });

    // ダッシュボードが起動するまで待機
    await testEnv.waitForEndpoint('http://localhost:4001', 30000);

    // SuperTest用のリクエストオブジェクトを作成
    request = supertest('http://localhost:4001');
  });

  afterEach(async function() {
    // プロセスの停止
    if (dashboardProcess) {
      await testEnv.stopAllProcesses();
      dashboardProcess = null;
    }
    
    // ブラウザページを閉じる
    if (page) {
      await page.close();
      page = null;
    }
  });

  describe('ログイン認証', function() {
    it('正しいパスワードでログインできる', async function() {
      const response = await request
        .post('/api/login')
        .send({ password: 'test-password' })
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('token');
      expect(response.body.token).to.be.a('string');
    });

    it('間違ったパスワードでログインが拒否される', async function() {
      const response = await request
        .post('/api/login')
        .send({ password: 'wrong-password' })
        .expect(401);

      expect(response.body).to.have.property('success', false);
      expect(response.body).to.have.property('error');
    });

    it('ブラウザでログインフローが動作する', async function() {
      // ブラウザを起動
      browser = await chromium.launch({ headless: true });
      page = await browser.newPage();

      // ダッシュボードにアクセス
      await page.goto('http://localhost:4001');

      // ログインフォームが表示されることを確認
      await page.waitForSelector('#password-input', { timeout: 5000 });

      // 間違ったパスワードを入力
      await page.fill('#password-input', 'wrong-password');
      await page.click('#login-button');

      // エラーメッセージが表示されることを確認
      const errorMessage = await page.waitForSelector('.error-message', { timeout: 5000 });
      expect(await errorMessage.textContent()).to.include('パスワードが正しくありません');

      // 正しいパスワードを入力
      await page.fill('#password-input', 'test-password');
      await page.click('#login-button');

      // ダッシュボードが表示されることを確認
      await page.waitForSelector('#dashboard-container', { timeout: 5000 });
      const title = await page.textContent('h1');
      expect(title).to.include('PoppoBuilder');
    });
  });

  describe('プロセス監視と制御', function() {
    it('実行中のプロセス一覧が表示される', async function() {
      // ログイン
      const loginResponse = await request
        .post('/api/login')
        .send({ password: 'test-password' });
      
      const token = loginResponse.body.token;

      // テスト用のプロセスデータを追加
      await testEnv.insertTestData('process_history', {
        task_id: 'test-task-001',
        task_type: 'claude-cli',
        issue_number: 100,
        status: 'running',
        started_at: new Date().toISOString(),
        memory_peak_mb: 128.5,
        cpu_usage_percent: 25.3
      });

      // プロセス一覧を取得
      const response = await request
        .get('/api/processes')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).to.have.property('processes');
      expect(response.body.processes).to.be.an('array');
      expect(response.body.processes).to.have.length.greaterThan(0);
      
      const process = response.body.processes[0];
      expect(process).to.have.property('taskId', 'test-task-001');
      expect(process).to.have.property('status', 'running');
    });

    it('プロセスを停止できる', async function() {
      // ログイン
      const loginResponse = await request
        .post('/api/login')
        .send({ password: 'test-password' });
      
      const token = loginResponse.body.token;

      // プロセス停止リクエスト
      const response = await request
        .post('/api/processes/test-task-001/stop')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('message');
    });

    it('ブラウザでプロセス制御が動作する', async function() {
      // ブラウザを起動
      browser = await chromium.launch({ headless: true });
      page = await browser.newPage();

      // ログイン処理
      await page.goto('http://localhost:4001');
      await page.fill('#password-input', 'test-password');
      await page.click('#login-button');
      await page.waitForSelector('#dashboard-container');

      // プロセス一覧タブをクリック
      await page.click('button:has-text("プロセス管理")');
      await page.waitForSelector('#process-list');

      // プロセスが表示されることを確認
      const processRows = await page.$$('.process-row');
      expect(processRows.length).to.be.greaterThan(0);

      // 停止ボタンをクリック
      await page.click('.process-row:first-child .stop-button');

      // 確認ダイアログでOKをクリック
      page.on('dialog', async dialog => {
        await dialog.accept();
      });

      // 成功メッセージが表示されることを確認
      const successMessage = await page.waitForSelector('.success-message', { timeout: 5000 });
      expect(await successMessage.textContent()).to.include('停止しました');
    });
  });

  describe('ログ検索とエクスポート', function() {
    it('ログを検索できる', async function() {
      // ログイン
      const loginResponse = await request
        .post('/api/login')
        .send({ password: 'test-password' });
      
      const token = loginResponse.body.token;

      // テスト用のログファイルを作成
      const logContent = `2025-01-18T10:00:00.000Z [INFO] PoppoBuilder が起動しました
2025-01-18T10:00:01.000Z [INFO] Issue #100 の処理を開始
2025-01-18T10:00:02.000Z [ERROR] エラーが発生しました: テストエラー
2025-01-18T10:00:03.000Z [INFO] リトライを実行します
2025-01-18T10:00:04.000Z [INFO] Issue #100 の処理が完了しました`;

      await fs.writeFile(
        path.join(testEnv.tempDir, 'logs', 'poppo-2025-01-18.log'),
        logContent
      );

      // ログ検索
      const response = await request
        .get('/api/logs/search')
        .query({
          keyword: 'Issue #100',
          level: 'INFO',
          startDate: '2025-01-18T09:00:00.000Z',
          endDate: '2025-01-18T11:00:00.000Z'
        })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).to.have.property('results');
      expect(response.body.results).to.be.an('array');
      expect(response.body.results.length).to.be.greaterThan(0);
      
      const log = response.body.results[0];
      expect(log.message).to.include('Issue #100');
      expect(log.level).to.equal('INFO');
    });

    it('ログをCSV形式でエクスポートできる', async function() {
      // ログイン
      const loginResponse = await request
        .post('/api/login')
        .send({ password: 'test-password' });
      
      const token = loginResponse.body.token;

      // CSVエクスポート
      const response = await request
        .get('/api/logs/export')
        .query({
          format: 'csv',
          startDate: '2025-01-18T09:00:00.000Z',
          endDate: '2025-01-18T11:00:00.000Z'
        })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.headers['content-type']).to.include('text/csv');
      expect(response.headers['content-disposition']).to.include('attachment');
      expect(response.text).to.include('timestamp,level,message');
    });

    it('ログをJSON形式でエクスポートできる', async function() {
      // ログイン
      const loginResponse = await request
        .post('/api/login')
        .send({ password: 'test-password' });
      
      const token = loginResponse.body.token;

      // JSONエクスポート
      const response = await request
        .get('/api/logs/export')
        .query({
          format: 'json',
          startDate: '2025-01-18T09:00:00.000Z',
          endDate: '2025-01-18T11:00:00.000Z'
        })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.headers['content-type']).to.include('application/json');
      expect(response.body).to.be.an('array');
    });
  });

  describe('リアルタイム更新', function() {
    it('WebSocketで新しいプロセスの通知を受信する', async function() {
      // ログイン
      const loginResponse = await request
        .post('/api/login')
        .send({ password: 'test-password' });
      
      const token = loginResponse.body.token;

      // WebSocketクライアントを作成
      const WebSocket = require('ws');
      const ws = new WebSocket('ws://localhost:4001', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      return new Promise((resolve, reject) => {
        ws.on('open', () => {
          // 新しいプロセスを追加
          testEnv.insertTestData('process_history', {
            task_id: 'test-task-002',
            task_type: 'claude-cli',
            issue_number: 101,
            status: 'running',
            started_at: new Date().toISOString()
          });
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data);
          if (message.type === 'process-update') {
            expect(message).to.have.property('data');
            expect(message.data).to.have.property('taskId', 'test-task-002');
            ws.close();
            resolve();
          }
        });

        ws.on('error', reject);
      });
    });
  });
});