/**
 * SLA監視システムのテストスクリプト
 */

const { SLAManager } = require('../src/sla/sla-manager');
const DatabaseManager = require('../src/database-manager');
const path = require('path');
const fs = require('fs').promises;

// カラー出力用
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

async function runTests() {
  console.log(`${colors.cyan}========== SLA監視システムテスト ==========${colors.reset}\n`);
  
  // データベースマネージャーを作成
  const testDbPath = path.join(__dirname, 'test-sla.db');
  const databaseManager = new DatabaseManager(testDbPath);
  
  // SLAマネージャーを作成
  const slaManager = new SLAManager({
    enabled: true,
    metricsRetentionDays: 1,
    checkInterval: 5000, // 5秒ごとにチェック（テスト用）
    databaseManager
  });
  
  try {
    // 初期化
    console.log(`${colors.blue}1. SLAマネージャーを初期化${colors.reset}`);
    await slaManager.initialize();
    console.log(`${colors.green}✓ 初期化完了${colors.reset}\n`);
    
    // イベントリスナーを設定
    setupEventListeners(slaManager);
    
    // 開始
    console.log(`${colors.blue}2. SLA監視を開始${colors.reset}`);
    await slaManager.start();
    console.log(`${colors.green}✓ 監視開始${colors.reset}\n`);
    
    // テストメトリクスを記録
    console.log(`${colors.blue}3. テストメトリクスを記録${colors.reset}`);
    await recordTestMetrics(slaManager);
    
    // SLO状態を確認
    console.log(`${colors.blue}4. 現在のSLO状態${colors.reset}`);
    await displaySLOStatus(slaManager);
    
    // 10秒待機（SLOチェックが実行されるのを待つ）
    console.log(`\n${colors.yellow}10秒待機中...${colors.reset}`);
    await sleep(10000);
    
    // 再度状態を確認
    console.log(`\n${colors.blue}5. 更新されたSLO状態${colors.reset}`);
    await displaySLOStatus(slaManager);
    
    // レポート生成
    console.log(`${colors.blue}6. レポート生成${colors.reset}`);
    const report = await slaManager.generateReport('custom', 
      new Date(Date.now() - 24 * 60 * 60 * 1000), // 24時間前
      new Date()
    );
    console.log(`${colors.green}✓ レポート生成完了${colors.reset}`);
    console.log(`  - 総SLO数: ${report.summary.total_slos}`);
    console.log(`  - 達成SLO数: ${report.summary.compliant_slos}`);
    console.log(`  - 違反数: ${report.summary.violations}`);
    
    // 停止
    console.log(`\n${colors.blue}7. SLA監視を停止${colors.reset}`);
    await slaManager.stop();
    console.log(`${colors.green}✓ 監視停止${colors.reset}`);
    
  } catch (error) {
    console.error(`${colors.red}エラー:`, error, colors.reset);
  } finally {
    // クリーンアップ
    await cleanup(testDbPath);
  }
}

/**
 * イベントリスナーを設定
 */
function setupEventListeners(slaManager) {
  slaManager.on('slo-violation', (data) => {
    console.log(`${colors.red}[イベント] SLO違反: ${data.message}${colors.reset}`);
  });
  
  slaManager.on('error-budget-warning', (data) => {
    console.log(`${colors.yellow}[イベント] エラーバジェット警告: ${data.message}${colors.reset}`);
  });
  
  slaManager.on('error-budget-critical', (data) => {
    console.log(`${colors.red}[イベント] エラーバジェット緊急: ${data.message}${colors.reset}`);
  });
}

/**
 * テストメトリクスを記録
 */
async function recordTestMetrics(slaManager) {
  // ヘルスチェック成功
  for (let i = 0; i < 100; i++) {
    slaManager.recordMetric('health_check', {
      service: 'poppo-builder',
      success: Math.random() > 0.01, // 99%成功
      duration: Math.random() * 200
    });
    
    slaManager.recordMetric('health_check', {
      service: 'agents',
      success: Math.random() > 0.02, // 98%成功
      duration: Math.random() * 300
    });
    
    slaManager.recordMetric('health_check', {
      service: 'dashboard',
      success: Math.random() > 0.08, // 92%成功
      duration: Math.random() * 100
    });
  }
  console.log(`${colors.green}✓ ヘルスチェックメトリクス記録 (300件)${colors.reset}`);
  
  // Issue処理メトリクス
  for (let i = 0; i < 50; i++) {
    slaManager.recordMetric('issue_processing', {
      issueNumber: 100 + i,
      success: Math.random() > 0.08, // 92%成功
      duration: Math.random() * 10 * 60 * 1000, // 0-10分
      startDelay: Math.random() * 8 * 60 * 1000 // 0-8分
    });
  }
  console.log(`${colors.green}✓ Issue処理メトリクス記録 (50件)${colors.reset}`);
  
  // API応答メトリクス
  for (let i = 0; i < 200; i++) {
    const endpoints = ['/api/process', '/api/status', '/api/health'];
    const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
    
    slaManager.recordMetric('api_response', {
      endpoint,
      method: 'GET',
      status: Math.random() > 0.05 ? 200 : 500,
      duration: Math.random() * 500 // 0-500ms
    });
  }
  console.log(`${colors.green}✓ API応答メトリクス記録 (200件)${colors.reset}`);
  
  // エージェントタスクメトリクス
  const agents = ['CCLA', 'CCAG', 'CCPM', 'CCQA', 'CCRA'];
  for (let i = 0; i < 100; i++) {
    const agent = agents[Math.floor(Math.random() * agents.length)];
    
    slaManager.recordMetric('agent_task', {
      agent,
      taskType: 'processing',
      success: Math.random() > 0.12, // 88%成功
      duration: Math.random() * 30 * 60 * 1000 // 0-30分
    });
  }
  console.log(`${colors.green}✓ エージェントタスクメトリクス記録 (100件)${colors.reset}`);
  
  // キュー遅延メトリクス
  for (let i = 0; i < 30; i++) {
    slaManager.recordMetric('queue_latency', {
      taskType: 'issue',
      waitTime: Math.random() * 15 * 60 * 1000, // 0-15分
      queueSize: Math.floor(Math.random() * 20)
    });
  }
  console.log(`${colors.green}✓ キュー遅延メトリクス記録 (30件)${colors.reset}`);
}

/**
 * SLO状態を表示
 */
async function displaySLOStatus(slaManager) {
  const status = slaManager.getSLOStatus();
  
  if (!status) {
    console.log('SLO状態を取得できません');
    return;
  }
  
  console.log(`\n${colors.cyan}=== SLO状態 ===${colors.reset}`);
  console.log(`総SLO数: ${status.summary.total}`);
  console.log(`達成数: ${status.summary.compliant}`);
  console.log(`違反数: ${status.summary.violations}`);
  console.log(`コンプライアンス率: ${(status.summary.complianceRate * 100).toFixed(1)}%`);
  
  console.log(`\n${colors.cyan}=== 個別SLO ===${colors.reset}`);
  for (const [key, slo] of Object.entries(status.status)) {
    const icon = slo.compliant ? '✅' : '❌';
    const color = slo.compliant ? colors.green : colors.red;
    const current = slo.current !== null ? 
      (slo.type === 'performance' ? `${slo.current}ms` : `${(slo.current * 100).toFixed(1)}%`) : 
      'N/A';
    const target = slo.type === 'performance' ? `${slo.target}ms` : `${(slo.target * 100).toFixed(1)}%`;
    
    console.log(`${icon} ${color}${key}${colors.reset}`);
    console.log(`   現在値: ${current}, 目標値: ${target}`);
    console.log(`   説明: ${slo.description}`);
  }
  
  console.log(`\n${colors.cyan}=== エラーバジェット ===${colors.reset}`);
  for (const [key, budget] of Object.entries(status.errorBudgets)) {
    const icon = budget.consumed > 0.8 ? '🚨' : budget.consumed > 0.5 ? '⚠️' : '✅';
    const color = budget.consumed > 0.8 ? colors.red : budget.consumed > 0.5 ? colors.yellow : colors.green;
    
    console.log(`${icon} ${color}${key}${colors.reset}`);
    console.log(`   消費: ${budget.percentage.toFixed(1)}%, 残り: ${(budget.remaining * 100).toFixed(1)}%`);
  }
}

/**
 * スリープ関数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * クリーンアップ
 */
async function cleanup(dbPath) {
  try {
    await fs.unlink(dbPath);
    await fs.rmdir(path.join(__dirname, '../data/metrics'), { recursive: true });
    await fs.rmdir(path.join(__dirname, '../reports/slo'), { recursive: true });
  } catch (error) {
    // エラーは無視
  }
}

// テスト実行
if (require.main === module) {
  runTests().catch(console.error);
}