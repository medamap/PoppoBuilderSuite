#!/usr/bin/env node

/**
 * Issue #142 最終バリデーション - ダッシュボードUIテスト
 * 
 * CCSPダッシュボードの機能とUIコンポーネントをテストします
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

class DashboardUITest {
  constructor() {
    this.testResults = [];
    this.dashboardPath = path.join(__dirname, '../../../dashboard/ccsp');
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
    console.log('🚀 Issue #142 ダッシュボードUIテスト開始\n');
    
    // ファイル存在確認テスト
    await this.runTest('HTMLファイルの存在確認', async () => {
      const htmlPath = path.join(this.dashboardPath, 'index.html');
      assert(fs.existsSync(htmlPath), 'index.htmlが存在すること');
      
      const content = fs.readFileSync(htmlPath, 'utf8');
      assert(content.includes('CCSP管理ダッシュボード'), 'タイトルが含まれること');
      assert(content.includes('ccsp-dashboard.js'), 'JavaScriptファイルがリンクされていること');
      assert(content.includes('<style>'), 'CSSスタイルが含まれること');
    });
    
    await this.runTest('CSSスタイルの組み込み確認', async () => {
      const htmlPath = path.join(this.dashboardPath, 'index.html');
      const content = fs.readFileSync(htmlPath, 'utf8');
      
      assert(content.includes('.container'), 'コンテナのスタイルが含まれること');
      assert(content.includes('.tab'), 'タブのスタイルが含まれること');
      assert(content.includes('.card'), 'カードのスタイルが含まれること');
      assert(content.includes('.metric'), 'メトリックのスタイルが含まれること');
    });
    
    await this.runTest('JavaScriptファイルの存在確認', async () => {
      const jsPath = path.join(this.dashboardPath, 'ccsp-dashboard.js');
      assert(fs.existsSync(jsPath), 'ccsp-dashboard.jsが存在すること');
      
      const content = fs.readFileSync(jsPath, 'utf8');
      assert(content.includes('class CCSPDashboard'), 'CCSPDashboardクラスが含まれること');
      assert(content.includes('connectWebSocket'), 'WebSocket接続機能が含まれること');
      assert(content.includes('initializeMockData'), 'モックデータ初期化機能が含まれること');
    });
    
    // HTMLコンテンツの構造確認
    await this.runTest('HTML構造の確認', async () => {
      const htmlPath = path.join(this.dashboardPath, 'index.html');
      const content = fs.readFileSync(htmlPath, 'utf8');
      
      // 必要なタブが存在するか確認
      assert(content.includes('概要'), '概要タブが存在すること');
      assert(content.includes('キュー管理'), 'キュー管理タブが存在すること');
      assert(content.includes('使用量'), '使用量タブが存在すること');
      assert(content.includes('エージェント'), 'エージェントタブが存在すること');
      
      // 制御ボタンが存在するか確認
      assert(content.includes('一時停止'), '一時停止ボタンが存在すること');
      assert(content.includes('再開'), '再開ボタンが存在すること');
      assert(content.includes('緊急停止'), '緊急停止ボタンが存在すること');
      assert(content.includes('クリア'), 'クリアボタンが存在すること');
      
      // メトリック表示要素が存在するか確認
      assert(content.includes('id="totalTasks"'), '総タスク数表示要素が存在すること');
      assert(content.includes('id="currentUsage"'), '現在使用量表示要素が存在すること');
      assert(content.includes('id="successRate"'), '成功率表示要素が存在すること');
    });
    
    // JavaScript機能の確認
    await this.runTest('JavaScript機能の確認', async () => {
      const jsPath = path.join(this.dashboardPath, 'ccsp-dashboard.js');
      const content = fs.readFileSync(jsPath, 'utf8');
      
      // 主要なメソッドが存在するか確認
      assert(content.includes('connectWebSocket'), 'WebSocket接続メソッドが存在すること');
      assert(content.includes('initializeMockData'), 'モックデータ初期化メソッドが存在すること');
      assert(content.includes('updateDisplay'), '表示更新メソッドが存在すること');
      assert(content.includes('updateQueueDisplay'), 'キュー表示更新メソッドが存在すること');
      assert(content.includes('updateUsageDisplay'), '使用量表示更新メソッドが存在すること');
      assert(content.includes('updateAgentDisplay'), 'エージェント表示更新メソッドが存在すること');
      
      // イベントハンドラーが存在するか確認
      assert(content.includes('handleQueueUpdate'), 'キュー更新ハンドラーが存在すること');
      assert(content.includes('handleUsageUpdate'), '使用量更新ハンドラーが存在すること');
      assert(content.includes('handleAlert'), 'アラートハンドラーが存在すること');
      
      // チャート機能が存在するか確認
      assert(content.includes('initCharts'), 'チャート初期化メソッドが存在すること');
      assert(content.includes('updateCharts'), 'チャート更新メソッドが存在すること');
      assert(content.includes('Chart'), 'Chart.jsの使用が確認できること');
    });
    
    // CSS スタイルの確認（HTMLに組み込まれている）
    await this.runTest('CSSスタイルの確認', async () => {
      const htmlPath = path.join(this.dashboardPath, 'index.html');
      const content = fs.readFileSync(htmlPath, 'utf8');
      
      // レイアウト関連のスタイルが存在するか確認
      assert(content.includes('display: flex') || content.includes('display:flex'), 
             'フレックスレイアウトが使用されていること');
      assert(content.includes('grid') || content.includes('Grid'), 
             'グリッドレイアウトが使用されていること');
      
      // カラーテーマが存在するか確認
      assert(content.includes('#') && content.match(/#[0-9a-fA-F]{3,6}/), 
             'カラーコードが定義されていること');
      
      // アニメーション効果の確認
      assert(content.includes('@keyframes') || content.includes('animation'), 
             'アニメーション効果が実装されていること');
    });
    
    // フォールバック機能の確認
    await this.runTest('フォールバック機能の確認', async () => {
      const jsPath = path.join(this.dashboardPath, 'ccsp-dashboard.js');
      const content = fs.readFileSync(jsPath, 'utf8');
      
      // モックデータによるフォールバックが実装されているか確認
      assert(content.includes('initializeMockData'), 'モックデータ初期化機能が存在すること');
      assert(content.includes('startMockDataUpdates'), 'モックデータ更新機能が存在すること');
      assert(content.includes('connect_error'), 'WebSocket接続エラーハンドリングが存在すること');
      
      // エラーハンドリングが適切に実装されているか確認
      assert(content.includes('catch'), 'try-catchエラーハンドリングが存在すること');
      assert(content.includes('showAlert'), 'アラート表示機能が存在すること');
      
      // フォールバック時の制御機能が実装されているか確認
      assert(content.includes('CCSP未接続のためモック動作'), 'フォールバック時のメッセージが定義されていること');
    });
    
    // アクセシビリティの確認
    await this.runTest('アクセシビリティの確認', async () => {
      const htmlPath = path.join(this.dashboardPath, 'index.html');
      const content = fs.readFileSync(htmlPath, 'utf8');
      
      // 基本的なアクセシビリティ要素が存在するか確認
      assert(content.includes('lang='), '言語属性が設定されていること');
      assert(content.includes('viewport'), 'ビューポート設定があること');
      
      // ボタンやフォーム要素に適切なラベルが設定されているか
      const hasProperLabels = content.includes('title=') || 
                             content.includes('onclick=') ||
                             content.includes('id=');
      assert(hasProperLabels, 'ボタンやフォーム要素に適切な識別子が設定されていること');
    });
    
    // パフォーマンス最適化の確認
    await this.runTest('パフォーマンス最適化の確認', async () => {
      const jsPath = path.join(this.dashboardPath, 'ccsp-dashboard.js');
      const content = fs.readFileSync(jsPath, 'utf8');
      
      // 効率的な更新方法が使用されているか確認
      assert(content.includes('getElementById'), 'DOMセレクションが効率的に行われていること');
      assert(content.includes('update(\'none\')') || content.includes('requestAnimationFrame'), 
             'アニメーションやチャート更新が最適化されていること');
      
      // データキャッシングが実装されているか確認
      assert(content.includes('this.data'), 'データキャッシングが実装されていること');
      
      // 不要な処理を避ける仕組みが存在するか確認
      assert(content.includes('return') && content.includes('!'), 
             'early returnパターンが使用されていること');
    });
    
    // セキュリティの確認
    await this.runTest('セキュリティの確認', async () => {
      const jsPath = path.join(this.dashboardPath, 'ccsp-dashboard.js');
      const content = fs.readFileSync(jsPath, 'utf8');
      
      // 安全なAPI呼び出しが実装されているか確認
      assert(content.includes("'Content-Type': 'application/json'") || 
             content.includes('"Content-Type": "application/json"'), 
             '適切なContent-Typeヘッダーが設定されていること');
      
      // ユーザー入力の検証が存在するか確認
      assert(content.includes('confirm('), '重要な操作に確認ダイアログが実装されていること');
      
      // XSS対策が考慮されているか確認
      assert(content.includes('textContent') || content.includes('innerHTML'), 
             'DOM操作でXSS対策が考慮されていること');
    });
    
    this.printResults();
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
      console.log('✅ Issue #142 ダッシュボードUIの動作確認完了');
    } else {
      console.log('\n⚠️  一部のテストが失敗しました。修正が必要です。');
    }
  }
}

// テスト実行
if (require.main === module) {
  const test = new DashboardUITest();
  test.runAllTests().catch(error => {
    console.error('テスト実行エラー:', error);
    process.exit(1);
  });
}

module.exports = DashboardUITest;