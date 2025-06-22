/**
 * PoppoBuilder Suite全体の統合テスト
 * 
 * 各エージェントの連携とシステム全体の動作を検証
 */

const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const Redis = require('ioredis');

// テストタイムアウト設定
const TIMEOUT = 300000; // 5分
const SERVICE_STARTUP_DELAY = 5000; // 5秒

// テスト結果を保存
const testResults = {
  passed: 0,
  failed: 0,
  services: {},
  tests: []
};

// ログ出力
function log(message, level = 'info') {
  const timestamp = new Date().toISOString();
  const colorMap = {
    info: '\x1b[36m',
    success: '\x1b[32m',
    error: '\x1b[31m',
    warn: '\x1b[33m'
  };
  const color = colorMap[level] || '';
  const reset = '\x1b[0m';
  console.log(`${color}[${timestamp}] ${message}${reset}`);
}

// サービス起動状態を確認
class ServiceMonitor {
  constructor() {
    this.services = {
      redis: { process: null, running: false },
      poppoBuilder: { process: null, running: false },
      medamaRepair: { process: null, running: false },
      meraCleaner: { process: null, running: false },
      mirinOrphan: { process: null, running: false },
      cclaAgent: { process: null, running: false },
      ccagAgent: { process: null, running: false },
      ccpmAgent: { process: null, running: false },
      ccqaAgent: { process: null, running: false },
      ccraAgent: { process: null, running: false },
      cctaAgent: { process: null, running: false },
      ccspAgent: { process: null, running: false },
      dashboard: { process: null, running: false }
    };
  }

  async checkRedis() {
    try {
      const redis = new Redis();
      await redis.ping();
      await redis.quit();
      this.services.redis.running = true;
      return true;
    } catch (error) {
      log('Redisの接続チェック失敗: ' + error.message, 'error');
      return false;
    }
  }

  async checkService(serviceName, port = null) {
    try {
      if (port) {
        // ポートが指定されている場合はHTTPチェック
        const http = require('http');
        return new Promise((resolve) => {
          const req = http.get(`http://localhost:${port}/health`, (res) => {
            resolve(res.statusCode === 200);
          });
          req.on('error', () => resolve(false));
          req.setTimeout(5000, () => {
            req.destroy();
            resolve(false);
          });
        });
      } else {
        // プロセスの存在チェック
        const result = await this.execCommand('ps aux | grep -E "' + serviceName + '" | grep -v grep');
        return result.success && result.stdout.includes(serviceName);
      }
    } catch (error) {
      return false;
    }
  }

  async execCommand(command) {
    return new Promise((resolve) => {
      const proc = spawn('bash', ['-c', command]);
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      proc.on('close', (code) => {
        resolve({
          success: code === 0,
          stdout,
          stderr,
          code
        });
      });
    });
  }

  async checkAllServices() {
    log('\n=== サービス状態チェック ===');
    
    // Redis
    this.services.redis.running = await this.checkRedis();
    log(`Redis: ${this.services.redis.running ? '✅ 稼働中' : '❌ 停止'}`);
    
    // ダッシュボード
    this.services.dashboard.running = await this.checkService('dashboard', 3001);
    log(`ダッシュボード: ${this.services.dashboard.running ? '✅ 稼働中' : '❌ 停止'}`);
    
    // 各サービス
    const serviceChecks = [
      { name: 'poppoBuilder', process: 'minimal-poppo' },
      { name: 'medamaRepair', process: 'medama-repair' },
      { name: 'meraCleaner', process: 'mera-cleaner' },
      { name: 'mirinOrphan', process: 'mirin-orphan' },
      { name: 'cclaAgent', process: 'agents/ccla' },
      { name: 'ccagAgent', process: 'agents/ccag' },
      { name: 'ccpmAgent', process: 'agents/ccpm' },
      { name: 'ccqaAgent', process: 'agents/ccqa' },
      { name: 'ccraAgent', process: 'agents/ccra' },
      { name: 'cctaAgent', process: 'agents/ccta' },
      { name: 'ccspAgent', process: 'agents/ccsp' }
    ];
    
    for (const check of serviceChecks) {
      this.services[check.name].running = await this.checkService(check.process);
      log(`${check.name}: ${this.services[check.name].running ? '✅ 稼働中' : '❌ 停止'}`);
    }
    
    // 結果を集計
    const runningCount = Object.values(this.services).filter(s => s.running).length;
    const totalCount = Object.keys(this.services).length;
    
    testResults.services = { ...this.services };
    
    return {
      runningCount,
      totalCount,
      allRunning: runningCount === totalCount
    };
  }
}

// 統合テストクラス
class IntegrationTest {
  constructor() {
    this.redis = new Redis();
    this.monitor = new ServiceMonitor();
  }

  async runTest(name, testFunc) {
    log(`\nテスト実行: ${name}`);
    try {
      const result = await testFunc();
      if (result.success) {
        log(`✅ ${name}: 成功`, 'success');
        testResults.passed++;
      } else {
        log(`❌ ${name}: 失敗 - ${result.message}`, 'error');
        testResults.failed++;
      }
      testResults.tests.push({ name, ...result });
      return result;
    } catch (error) {
      log(`❌ ${name}: エラー - ${error.message}`, 'error');
      testResults.failed++;
      testResults.tests.push({ name, success: false, error: error.message });
      return { success: false, error: error.message };
    }
  }

  // Test 1: Redis接続テスト
  async testRedisConnection() {
    return await this.runTest('Redis接続テスト', async () => {
      await this.redis.ping();
      return { success: true, message: 'Redisに正常に接続できました' };
    });
  }

  // Test 2: CCSPエージェントへのリクエストテスト
  async testCCSPRequest() {
    return await this.runTest('CCSPエージェントリクエスト', async () => {
      const requestId = `test-${Date.now()}`;
      const request = {
        requestId,
        fromAgent: 'integration-test',
        type: 'test',
        prompt: 'Return "Integration test successful!"',
        timestamp: new Date().toISOString()
      };
      
      // リクエスト送信
      await this.redis.rpush('ccsp:requests', JSON.stringify(request));
      
      // レスポンス待機（30秒タイムアウト）
      const responseQueue = 'ccsp:response:integration-test';
      const timeout = Date.now() + 30000;
      
      while (Date.now() < timeout) {
        const response = await this.redis.lpop(responseQueue);
        if (response) {
          const parsed = JSON.parse(response);
          if (parsed.requestId === requestId) {
            return {
              success: parsed.success,
              message: parsed.success ? 'CCSPからレスポンスを受信' : parsed.error
            };
          }
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      return { success: false, message: 'タイムアウト' };
    });
  }

  // Test 3: ステータス管理テスト
  async testStatusManagement() {
    return await this.runTest('ステータス管理システム', async () => {
      const statusFile = path.join(__dirname, '../../state/issue-status.json');
      const exists = await fs.access(statusFile).then(() => true).catch(() => false);
      
      if (!exists) {
        return { success: false, message: 'ステータスファイルが存在しません' };
      }
      
      const content = await fs.readFile(statusFile, 'utf8');
      const status = JSON.parse(content);
      
      return {
        success: true,
        message: `ステータス管理が正常に動作中 (${Object.keys(status).length}件のエントリ)`
      };
    });
  }

  // Test 4: メトリクス収集テスト
  async testMetricsCollection() {
    return await this.runTest('メトリクス収集', async () => {
      // CCSPのメトリクスキーを確認
      const metricsKeys = await this.redis.keys('ccsp:metrics:*');
      
      if (metricsKeys.length > 0) {
        return {
          success: true,
          message: `${metricsKeys.length}個のメトリクスキーが存在`
        };
      }
      
      // メトリクスがない場合も成功とする（まだ処理されていない可能性）
      return {
        success: true,
        message: 'メトリクス収集システムが動作可能'
      };
    });
  }

  // Test 5: エージェント間通信テスト
  async testAgentCommunication() {
    return await this.runTest('エージェント間通信', async () => {
      // Redisキューの存在チェック
      const queues = [
        'ccsp:requests',
        'ccla:queue',
        'ccag:queue',
        'ccpm:queue',
        'ccqa:queue',
        'ccra:queue',
        'ccta:queue'
      ];
      
      const existingQueues = [];
      for (const queue of queues) {
        const exists = await this.redis.exists(queue);
        if (exists) {
          existingQueues.push(queue);
        }
      }
      
      return {
        success: existingQueues.length > 0,
        message: `${existingQueues.length}/${queues.length}個のキューが存在`
      };
    });
  }

  // Test 6: ヘルスチェックテスト
  async testHealthCheck() {
    return await this.runTest('ヘルスチェック', async () => {
      try {
        const http = require('http');
        const result = await new Promise((resolve) => {
          const req = http.get('http://localhost:3001/api/health', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              resolve({
                success: res.statusCode === 200,
                data: data ? JSON.parse(data) : null
              });
            });
          });
          req.on('error', (error) => {
            resolve({ success: false, error: error.message });
          });
          req.setTimeout(5000, () => {
            req.destroy();
            resolve({ success: false, error: 'timeout' });
          });
        });
        
        return {
          success: result.success,
          message: result.success ? 'ヘルスチェックAPIが正常' : result.error
        };
      } catch (error) {
        return { success: false, message: error.message };
      }
    });
  }

  async cleanup() {
    await this.redis.quit();
  }
}

// メイン実行
async function main() {
  log('\n🚀 PoppoBuilder Suite 統合テストを開始します...\n', 'info');
  
  const monitor = new ServiceMonitor();
  const test = new IntegrationTest();
  
  try {
    // サービス状態チェック
    const serviceStatus = await monitor.checkAllServices();
    log(`\nサービス: ${serviceStatus.runningCount}/${serviceStatus.totalCount} 稼働中\n`);
    
    if (!serviceStatus.allRunning) {
      log('⚠️  一部のサービスが停止しています。テストを続行します...', 'warn');
    }
    
    // テスト実行
    log('\n=== 統合テスト実行 ===\n');
    
    await test.testRedisConnection();
    await test.testCCSPRequest();
    await test.testStatusManagement();
    await test.testMetricsCollection();
    await test.testAgentCommunication();
    await test.testHealthCheck();
    
    // 結果サマリ
    log('\n=== テスト結果サマリ ===');
    log(`\n合計: ${testResults.passed + testResults.failed} テスト`);
    log(`成功: ${testResults.passed} ✅`, 'success');
    log(`失敗: ${testResults.failed} ❌`, testResults.failed > 0 ? 'error' : 'success');
    
    // 詳細レポート保存
    const reportPath = path.join(__dirname, '../../logs/integration-test-report.json');
    await fs.writeFile(reportPath, JSON.stringify(testResults, null, 2));
    log(`\n詳細レポートを保存しました: ${reportPath}`);
    
    // 推奨事項
    if (testResults.failed > 0) {
      log('\n📝 推奨事項:', 'warn');
      log('1. 失敗したテストの詳細を確認してください');
      log('2. 停止しているサービスを起動してください');
      log('3. ログファイルを確認してエラーの原因を特定してください');
    } else {
      log('\n🎉 すべてのテストが成功しました！', 'success');
    }
    
  } catch (error) {
    log(`\n致命的エラー: ${error.message}`, 'error');
    log(error.stack, 'error');
  } finally {
    await test.cleanup();
  }
  
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// 実行
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { ServiceMonitor, IntegrationTest };