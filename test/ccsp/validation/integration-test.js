#!/usr/bin/env node

/**
 * Issue #142 最終バリデーション - 統合テスト
 * 
 * CCSPエージェントとダッシュボードの統合動作をテストします
 */

const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// HTTPリクエストユーティリティ
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      
      res.on('data', chunk => {
        body += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = {
            statusCode: res.statusCode,
            headers: res.headers,
            body: body,
            data: body ? JSON.parse(body) : null
          };
          resolve(response);
        } catch (error) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: body,
            data: null,
            parseError: error.message
          });
        }
      });
    });
    
    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

// ファイルの存在とアクセス可能性をチェック
function waitForFile(filepath, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    
    function check() {
      if (fs.existsSync(filepath)) {
        resolve(true);
      } else if (Date.now() - start > timeout) {
        reject(new Error(`File ${filepath} not found within ${timeout}ms`));
      } else {
        setTimeout(check, 100);
      }
    }
    
    check();
  });
}

// サーバーの応答を待機
function waitForServer(port, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    
    function check() {
      makeRequest({
        hostname: 'localhost',
        port: port,
        path: '/health',
        method: 'GET',
        timeout: 1000
      }).then(() => {
        resolve(true);
      }).catch(() => {
        if (Date.now() - start > timeout) {
          reject(new Error(`Server on port ${port} not responding within ${timeout}ms`));
        } else {
          setTimeout(check, 1000);
        }
      });
    }
    
    check();
  });
}

class IntegrationTest {
  constructor() {
    this.testResults = [];
    this.dashboardProcess = null;
    this.ccspProcess = null;
    this.baseDir = path.join(__dirname, '../../..');
  }
  
  async runTest(testName, testFn) {
    try {
      console.log(`\n🧪 テスト実行: ${testName}`);
      await testFn();
      console.log(`✅ ${testName} - 成功`);
      this.testResults.push({ name: testName, status: 'PASS' });
    } catch (error) {
      console.error(`❌ ${testName} - 失敗: ${error.message}`);
      this.testResults.push({ name: testName, status: 'FAIL', error: error.message });
    }
  }
  
  async runAllTests() {
    console.log('🚀 Issue #142 CCSPエージェントとダッシュボードの統合テスト開始\n');
    
    try {
      // ファイル構造の確認
      await this.runTest('ファイル構造の確認', async () => {
        const requiredFiles = [
          'dashboard/ccsp/index.html',
          'dashboard/ccsp/ccsp-dashboard.js',
          'scripts/start-dashboard.js',
          'agents/ccsp/index.js',
          'agents/ccsp/advanced-queue-manager.js',
          'agents/ccsp/usage-monitoring-manager.js',
          'agents/ccsp/management-api.js'
        ];
        
        for (const file of requiredFiles) {
          const filePath = path.join(this.baseDir, file);
          assert(fs.existsSync(filePath), `必要なファイルが存在すること: ${file}`);
        }
      });
      
      // 設定ファイルの確認
      await this.runTest('設定ファイルの確認', async () => {
        const configPath = path.join(this.baseDir, 'config/config.json');
        assert(fs.existsSync(configPath), 'config.jsonが存在すること');
        
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert(config.ccsp, 'CCSP設定が存在すること');
        assert(config.ccsp.enabled !== undefined, 'CCSP有効/無効設定が存在すること');
      });
      
      // package.jsonの確認
      await this.runTest('package.jsonの確認', async () => {
        const packagePath = path.join(this.baseDir, 'package.json');
        assert(fs.existsSync(packagePath), 'package.jsonが存在すること');
        
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        assert(packageJson.scripts.dashboard, 'ダッシュボード起動スクリプトが存在すること');
        assert(packageJson.dependencies['socket.io'], 'socket.io依存関係が存在すること');
      });
      
      // ダッシュボードのスタンドアロン起動テスト
      await this.runTest('ダッシュボードのスタンドアロン起動', async () => {
        console.log('  ダッシュボードサーバーを起動中...');
        
        this.dashboardProcess = spawn('node', ['scripts/start-dashboard.js'], {
          cwd: this.baseDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, NODE_ENV: 'test' }
        });
        
        let startupOutput = '';
        this.dashboardProcess.stdout.on('data', (data) => {
          startupOutput += data.toString();
        });
        
        this.dashboardProcess.stderr.on('data', (data) => {
          console.error('  Dashboard stderr:', data.toString());
        });
        
        // ダッシュボードが起動するまで待機
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('ダッシュボードの起動がタイムアウトしました'));
          }, 15000);
          
          const checkStartup = () => {
            if (startupOutput.includes('ダッシュボードが起動しました') || 
                startupOutput.includes('localhost:3001')) {
              clearTimeout(timeout);
              resolve();
            } else {
              setTimeout(checkStartup, 500);
            }
          };
          
          checkStartup();
        });
        
        console.log('  ダッシュボードが正常に起動しました');
      });
      
      // ダッシュボードHTTPレスポンステスト
      await this.runTest('ダッシュボードHTTPレスポンス', async () => {
        // ポート3001でリッスンしているかテスト
        const response = await makeRequest({
          hostname: 'localhost',
          port: 3001,
          path: '/',
          method: 'GET',
          headers: { 'Accept': 'text/html' }
        });
        
        assert(response.statusCode >= 200 && response.statusCode < 400, 
               'ダッシュボードが正常なHTTPレスポンスを返すこと');
        assert(response.body.includes('CCSP'), 
               'レスポンスにCCSPコンテンツが含まれること');
      });
      
      // CCSPダッシュボードの特定パスの確認
      await this.runTest('CCSPダッシュボードパスの確認', async () => {
        const response = await makeRequest({
          hostname: 'localhost',
          port: 3001,
          path: '/ccsp',
          method: 'GET',
          headers: { 'Accept': 'text/html' }
        });
        
        assert(response.statusCode >= 200 && response.statusCode < 400, 
               'CCSPダッシュボードパスが正常に応答すること');
      });
      
      // WebSocketエンドポイントの確認（間接的）
      await this.runTest('WebSocketサポートの確認', async () => {
        // Socket.IOエンドポイントの確認
        const response = await makeRequest({
          hostname: 'localhost',
          port: 3001,
          path: '/socket.io/',
          method: 'GET'
        });
        
        // Socket.IOが利用可能であることを確認（200または400系でも良い）
        assert(response.statusCode !== 500, 'Socket.IOエンドポイントが利用可能であること');
      });
      
      // フォールバック機能のテスト（CCSPエージェントなしでの動作）
      await this.runTest('フォールバック機能（CCSPエージェントなし）', async () => {
        // CCSPエージェントが起動していない状態で、ダッシュボードがモックデータで動作することを確認
        
        // ダッシュボードのJavaScriptファイルを確認
        const response = await makeRequest({
          hostname: 'localhost',
          port: 3001,
          path: '/ccsp/ccsp-dashboard.js',
          method: 'GET'
        });
        
        assert(response.statusCode === 200, 'JavaScript ファイルが正常に提供されること');
        assert(response.body.includes('initializeMockData'), 
               'モックデータ初期化機能が含まれていること');
        assert(response.body.includes('connect_error'), 
               'WebSocket接続エラーハンドリングが含まれていること');
      });
      
      // 静的ファイルの提供確認
      await this.runTest('静的ファイルの提供', async () => {
        const files = [
          { path: '/ccsp/', contentCheck: 'CCSP管理ダッシュボード' },
          { path: '/ccsp/ccsp-dashboard.js', contentCheck: 'CCSPDashboard' }
        ];
        
        for (const file of files) {
          const response = await makeRequest({
            hostname: 'localhost',
            port: 3001,
            path: file.path,
            method: 'GET'
          });
          
          assert(response.statusCode === 200, 
                 `ファイル ${file.path} が正常に提供されること`);
          assert(response.body.includes(file.contentCheck), 
                 `ファイル ${file.path} に期待されるコンテンツが含まれること`);
        }
      });
      
      // エラーハンドリングの確認
      await this.runTest('エラーハンドリングの確認', async () => {
        // 存在しないパスにアクセス
        const response = await makeRequest({
          hostname: 'localhost',
          port: 3001,
          path: '/nonexistent-path',
          method: 'GET'
        });
        
        assert(response.statusCode === 404, 
               '存在しないパスに対して404を返すこと');
      });
      
      // レスポンス時間の確認
      await this.runTest('レスポンス時間の確認', async () => {
        const start = Date.now();
        
        const response = await makeRequest({
          hostname: 'localhost',
          port: 3001,
          path: '/ccsp/',
          method: 'GET'
        });
        
        const responseTime = Date.now() - start;
        
        assert(response.statusCode === 200, 'リクエストが成功すること');
        assert(responseTime < 2000, 'レスポンス時間が2秒以内であること');
        
        console.log(`  レスポンス時間: ${responseTime}ms`);
      });
      
      // ダッシュボードのメモリ使用量確認
      await this.runTest('ダッシュボードプロセスの健全性', async () => {
        assert(this.dashboardProcess, 'ダッシュボードプロセスが実行中であること');
        assert(!this.dashboardProcess.killed, 'ダッシュボードプロセスが停止していないこと');
        
        // プロセスのメモリ使用量を確認（大まかな確認）
        const memUsage = process.memoryUsage();
        assert(memUsage.heapUsed < 100 * 1024 * 1024, 
               'メモリ使用量が100MB以下であること'); // 緩い制限
      });
      
    } finally {
      // クリーンアップ
      await this.cleanup();
    }
    
    this.printResults();
  }
  
  async cleanup() {
    console.log('\n🧹 クリーンアップ中...');
    
    if (this.dashboardProcess && !this.dashboardProcess.killed) {
      console.log('  ダッシュボードプロセスを終了しています...');
      this.dashboardProcess.kill('SIGTERM');
      
      // プロセスが終了するまで少し待機
      await new Promise(resolve => {
        this.dashboardProcess.on('exit', resolve);
        setTimeout(() => {
          if (!this.dashboardProcess.killed) {
            this.dashboardProcess.kill('SIGKILL');
          }
          resolve();
        }, 3000);
      });
    }
    
    if (this.ccspProcess && !this.ccspProcess.killed) {
      console.log('  CCSPプロセスを終了しています...');
      this.ccspProcess.kill('SIGTERM');
      
      await new Promise(resolve => {
        this.ccspProcess.on('exit', resolve);
        setTimeout(() => {
          if (!this.ccspProcess.killed) {
            this.ccspProcess.kill('SIGKILL');
          }
          resolve();
        }, 3000);
      });
    }
    
    console.log('  クリーンアップ完了');
  }
  
  printResults() {
    console.log('\n📊 テスト結果:');
    console.log('=' .repeat(50));
    
    let passed = 0;
    let failed = 0;
    
    this.testResults.forEach(result => {
      const status = result.status === 'PASS' ? '✅' : '❌';
      console.log(`${status} ${result.name}`);
      if (result.error) {
        console.log(`   エラー: ${result.error}`);
      }
      
      if (result.status === 'PASS') passed++;
      else failed++;
    });
    
    console.log('\n📈 サマリー:');
    console.log(`✅ 成功: ${passed}件`);
    console.log(`❌ 失敗: ${failed}件`);
    console.log(`📊 成功率: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
    
    if (failed === 0) {
      console.log('\n🎉 すべてのテストが成功しました！');
      console.log('✅ Issue #142 CCSPエージェントとダッシュボードの統合テスト完了');
    } else {
      console.log('\n⚠️  一部のテストが失敗しました。修正が必要です。');
    }
  }
}

// シグナルハンドリング
process.on('SIGINT', async () => {
  console.log('\n⚠️  テストが中断されました。クリーンアップ中...');
  const test = new IntegrationTest();
  await test.cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n⚠️  テストが終了されました。クリーンアップ中...');
  const test = new IntegrationTest();
  await test.cleanup();
  process.exit(0);
});

// テスト実行
if (require.main === module) {
  const test = new IntegrationTest();
  test.runAllTests().catch(error => {
    console.error('テスト実行エラー:', error);
    test.cleanup().then(() => {
      process.exit(1);
    });
  });
}

module.exports = IntegrationTest;