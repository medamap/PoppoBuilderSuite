#!/usr/bin/env node

/**
 * Issue #142 最終バリデーション - 統合テストランナー
 * 
 * 全てのバリデーションテストを実行し、最終結果をレポートします
 */

const { spawn } = require('child_process');
const path = require('path');

class FinalValidationRunner {
  constructor() {
    this.testSuites = [
      {
        name: 'キュー管理システム',
        file: 'queue-management-test.js',
        description: 'AdvancedQueueManagerの機能テスト'
      },
      {
        name: '使用量モニタリングシステム',
        file: 'usage-monitoring-test.js',
        description: 'UsageMonitoringManagerの機能テスト'
      },
      {
        name: '管理APIエンドポイント',
        file: 'management-api-test.js',
        description: 'CCSP管理APIの全エンドポイントテスト'
      },
      {
        name: 'ダッシュボードUI',
        file: 'dashboard-ui-test.js',
        description: 'CCSPダッシュボードのUI・機能テスト'
      },
      {
        name: 'エラーハンドリング',
        file: 'error-handling-test.js',
        description: '異常系動作とエラー回復テスト'
      }
    ];
    
    this.results = [];
  }
  
  async runTest(testSuite) {
    return new Promise((resolve) => {
      console.log(`\n🔄 実行中: ${testSuite.name}`);
      console.log(`   ${testSuite.description}`);
      
      const testPath = path.join(__dirname, testSuite.file);
      const process = spawn('node', [testPath], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      process.on('close', (code) => {
        const result = this.parseTestOutput(stdout, stderr, code);
        result.name = testSuite.name;
        result.description = testSuite.description;
        result.file = testSuite.file;
        
        this.results.push(result);
        
        if (result.success) {
          console.log(`✅ ${testSuite.name} - 成功 (${result.passed}/${result.total})`);
        } else {
          console.log(`❌ ${testSuite.name} - 失敗 (${result.passed}/${result.total})`);
        }
        
        resolve(result);
      });
    });
  }
  
  parseTestOutput(stdout, stderr, exitCode) {
    const result = {
      success: exitCode === 0,
      exitCode,
      stdout,
      stderr,
      passed: 0,
      failed: 0,
      total: 0,
      successRate: 0,
      errors: []
    };
    
    // 成功・失敗の数を解析
    const successMatches = stdout.match(/✅ 成功: (\d+)件/);
    const failureMatches = stdout.match(/❌ 失敗: (\d+)件/);
    const rateMatches = stdout.match(/📊 成功率: ([\d.]+)%/);
    
    if (successMatches) {
      result.passed = parseInt(successMatches[1]);
    }
    
    if (failureMatches) {
      result.failed = parseInt(failureMatches[1]);
    }
    
    result.total = result.passed + result.failed;
    
    if (rateMatches) {
      result.successRate = parseFloat(rateMatches[1]);
    }
    
    // エラーメッセージを抽出
    const errorLines = stdout.split('\n').filter(line => 
      line.includes('❌') || line.includes('エラー:')
    );
    result.errors = errorLines;
    
    return result;
  }
  
  async runAllTests() {
    console.log('🚀 Issue #142 最終バリデーション開始');
    console.log('=' .repeat(60));
    console.log('CCSPの高度な制御機能とモニタリング実装の最終検証\n');
    
    const startTime = Date.now();
    
    // 全テストスイートを順次実行
    for (const testSuite of this.testSuites) {
      await this.runTest(testSuite);
    }
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(1);
    
    this.generateFinalReport(duration);
  }
  
  generateFinalReport(duration) {
    console.log('\n' + '=' .repeat(60));
    console.log('📊 Issue #142 最終バリデーション結果');
    console.log('=' .repeat(60));
    
    let totalPassed = 0;
    let totalFailed = 0;
    let totalTests = 0;
    let allSuitesSuccessful = true;
    
    console.log('\n📋 テストスイート別結果:');
    this.results.forEach((result, index) => {
      const status = result.success ? '✅' : '❌';
      const rate = result.successRate ? result.successRate.toFixed(1) : '0.0';
      
      console.log(`${index + 1}. ${status} ${result.name}`);
      console.log(`   ${result.description}`);
      console.log(`   成功率: ${rate}% (${result.passed}/${result.total})`);
      
      if (!result.success) {
        allSuitesSuccessful = false;
        console.log(`   ⚠️  失敗理由: 終了コード ${result.exitCode}`);
        if (result.errors.length > 0) {
          console.log(`   🔍 主なエラー: ${result.errors[0].replace(/❌|エラー:/g, '').trim()}`);
        }
      }
      
      totalPassed += result.passed;
      totalFailed += result.failed;
      totalTests += result.total;
      console.log('');
    });
    
    // 総合統計
    const overallSuccessRate = totalTests > 0 ? (totalPassed / totalTests * 100).toFixed(1) : 0;
    
    console.log('📈 総合統計:');
    console.log(`   総テスト数: ${totalTests}件`);
    console.log(`   成功: ${totalPassed}件`);
    console.log(`   失敗: ${totalFailed}件`);
    console.log(`   成功率: ${overallSuccessRate}%`);
    console.log(`   実行時間: ${duration}秒`);
    
    // 機能別評価
    console.log('\n🎯 機能別評価:');
    this.results.forEach((result) => {
      const evaluation = this.evaluateTestSuite(result);
      console.log(`   ${result.name}: ${evaluation.status} ${evaluation.comment}`);
    });
    
    // 最終判定
    console.log('\n🏆 最終判定:');
    if (allSuitesSuccessful && overallSuccessRate >= 90) {
      console.log('🎉 Issue #142 実装完了！');
      console.log('✅ CCSPの高度な制御機能とモニタリング実装が正常に動作しています');
      console.log('✅ 全ての主要機能が期待通りに機能しています');
      console.log('✅ 本番環境での使用準備が完了しました');
    } else if (overallSuccessRate >= 80) {
      console.log('⚠️  Issue #142 部分的完了');
      console.log('✅ 主要機能は動作していますが、一部改善が必要です');
      console.log('🔧 修正推奨事項があります');
    } else {
      console.log('❌ Issue #142 追加作業が必要');
      console.log('🔧 重要な機能に問題があります');
      console.log('🚨 本番使用前に修正が必要です');
    }
    
    // 推奨次ステップ
    console.log('\n📋 推奨次ステップ:');
    if (allSuitesSuccessful) {
      console.log('1. 🚀 本番環境での段階的ロールアウト');
      console.log('2. 📊 実際の負荷でのパフォーマンステスト');
      console.log('3. 👥 ユーザー受け入れテスト');
      console.log('4. 📖 運用ドキュメントの最終確認');
    } else {
      console.log('1. 🔧 失敗したテストの問題解決');
      console.log('2. 🧪 修正後の再テスト');
      console.log('3. 📋 エラーハンドリングの強化検討');
      console.log('4. 🔍 統合テストの改善');
    }
    
    console.log('\n' + '=' .repeat(60));
    console.log(`Issue #142 最終バリデーション完了 (実行時間: ${duration}秒)`);
    console.log('=' .repeat(60));
  }
  
  evaluateTestSuite(result) {
    if (result.successRate === 100) {
      return { status: '🏆', comment: '完璧 - 全てのテストが成功' };
    } else if (result.successRate >= 90) {
      return { status: '✅', comment: '優秀 - 軽微な問題のみ' };
    } else if (result.successRate >= 80) {
      return { status: '⚠️ ', comment: '良好 - 一部改善が必要' };
    } else if (result.successRate >= 60) {
      return { status: '🔧', comment: '要改善 - 複数の問題あり' };
    } else {
      return { status: '❌', comment: '要修正 - 重大な問題あり' };
    }
  }
}

// シグナルハンドリング
process.on('SIGINT', () => {
  console.log('\n⚠️  テストが中断されました');
  process.exit(1);
});

// テスト実行
if (require.main === module) {
  const runner = new FinalValidationRunner();
  runner.runAllTests().catch(error => {
    console.error('バリデーション実行エラー:', error);
    process.exit(1);
  });
}

module.exports = FinalValidationRunner;