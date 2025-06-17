const fs = require('fs').promises;
const path = require('path');
const ErrorGrouper = require('../agents/ccla/error-grouper');
const ErrorStatistics = require('../agents/ccla/statistics');
const AdvancedAnalyzer = require('../agents/ccla/advanced-analyzer');

// 簡易ロガー
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`)
};

/**
 * Phase 2機能のテスト
 */
async function testPhase2Features() {
  console.log('=== CCLAエージェント Phase 2 機能テスト ===\n');
  
  // テスト用エラーデータ
  const testErrors = [
    {
      hash: 'error001',
      category: 'Type Error',
      message: 'Cannot read property \'name\' of undefined',
      stackTrace: [
        '    at processUser (/src/user-service.js:45:23)',
        '    at async handleRequest (/src/api.js:123:5)',
        '    at process._tickCallback (internal/process/next_tick.js:68:7)'
      ],
      file: '/src/user-service.js',
      line: 45,
      timestamp: '2025-06-16 10:00:00',
      level: 'ERROR',
      severity: 'high',
      type: 'bug'
    },
    {
      hash: 'error002',
      category: 'Type Error',
      message: 'Cannot read property \'email\' of undefined',
      stackTrace: [
        '    at validateUser (/src/user-service.js:67:30)',
        '    at async processRequest (/src/api.js:145:5)'
      ],
      file: '/src/user-service.js',
      line: 67,
      timestamp: '2025-06-16 10:05:00',
      level: 'ERROR',
      severity: 'high',
      type: 'bug'
    },
    {
      hash: 'error003',
      category: 'Reference Error',
      message: 'logger is not defined',
      stackTrace: [
        '    at logEvent (/src/event-handler.js:23:5)',
        '    at EventEmitter.emit (events.js:315:20)'
      ],
      file: '/src/event-handler.js',
      line: 23,
      timestamp: '2025-06-16 10:10:00',
      level: 'ERROR',
      severity: 'medium',
      type: 'bug'
    }
  ];
  
  try {
    // 1. エラーグループ化のテスト
    console.log('1. エラーグループ化機能のテスト');
    console.log('================================');
    
    const errorGrouper = new ErrorGrouper(logger);
    await errorGrouper.initialize();
    
    for (const error of testErrors) {
      const groupInfo = await errorGrouper.groupError(error);
      console.log(`\nエラー ${error.hash}:`);
      console.log(`  - グループID: ${groupInfo.groupId}`);
      console.log(`  - 新規グループ: ${groupInfo.isNew}`);
      console.log(`  - 類似度: ${(groupInfo.similarity * 100).toFixed(1)}%`);
      console.log(`  - グループ内エラー数: ${groupInfo.group.occurrenceCount}`);
    }
    
    // グループ統計の表示
    const groupStats = errorGrouper.getGroupStatistics();
    console.log('\nグループ統計:');
    console.log(`  - 総グループ数: ${groupStats.totalGroups}`);
    console.log(`  - オープン: ${groupStats.openGroups}`);
    console.log(`  - 総エラー数: ${groupStats.totalErrors}`);
    console.log(`  - 平均発生回数: ${groupStats.averageOccurrences.toFixed(1)}`);
    
    // 2. 統計分析のテスト
    console.log('\n\n2. 統計分析機能のテスト');
    console.log('=======================');
    
    const errorStatistics = new ErrorStatistics(logger);
    await errorStatistics.initialize();
    
    // エラーを統計に追加
    for (let i = 0; i < testErrors.length; i++) {
      const error = testErrors[i];
      const groupInfo = { isNew: i === 0 || i === 2 }; // 最初と3番目を新規とする
      await errorStatistics.addError(error, groupInfo);
    }
    
    // 追加のエラーを生成（トレンド分析用）
    for (let day = 0; day < 7; day++) {
      const date = new Date();
      date.setDate(date.getDate() - day);
      const dateKey = date.toISOString().split('T')[0];
      
      // Type Errorを増加傾向にする
      const typeErrorCount = 5 + day * 2;
      for (let i = 0; i < typeErrorCount; i++) {
        await errorStatistics.addError({
          ...testErrors[0],
          hash: `trend-${dateKey}-${i}`,
          timestamp: date.toISOString()
        }, { isNew: false });
      }
    }
    
    // レポート生成
    const report = errorStatistics.generateReport();
    console.log('\n統計レポート:');
    console.log(JSON.stringify(report, null, 2));
    
    // 3. 高度な分析機能のテスト（モック）
    console.log('\n\n3. 高度な分析機能のテスト');
    console.log('=========================');
    
    const advancedAnalyzer = new AdvancedAnalyzer(logger);
    await advancedAnalyzer.initialize();
    
    // フォールバック分析のテスト（Claude APIを使わない）
    const fallbackAnalysis = advancedAnalyzer.getFallbackAnalysis(testErrors[0]);
    console.log('\nフォールバック分析結果:');
    console.log(`  - 根本原因: ${fallbackAnalysis.rootCause}`);
    console.log(`  - 影響範囲: ${fallbackAnalysis.impactScope}`);
    console.log(`  - 推定修正時間: ${fallbackAnalysis.estimatedFixTime}`);
    console.log(`  - 信頼度: ${(fallbackAnalysis.confidence * 100).toFixed(0)}%`);
    console.log(`  - 関連ファイル: ${fallbackAnalysis.relatedFiles.join(', ')}`);
    
    // 分析サマリーの生成
    const summary = advancedAnalyzer.generateAnalysisSummary(fallbackAnalysis);
    console.log('\n分析サマリー:');
    console.log(summary);
    
    // 4. 統合テスト
    console.log('\n\n4. 統合動作テスト');
    console.log('=================');
    
    // 類似度計算のテスト
    const similarity1 = errorGrouper.calculateSimilarity(testErrors[0], testErrors[1]);
    const similarity2 = errorGrouper.calculateSimilarity(testErrors[0], testErrors[2]);
    
    console.log(`\nエラー類似度計算:`);
    console.log(`  - Error001 vs Error002: ${(similarity1 * 100).toFixed(1)}%`);
    console.log(`  - Error001 vs Error003: ${(similarity2 * 100).toFixed(1)}%`);
    
    // API統計の取得
    const apiStats = errorStatistics.getStatistics();
    console.log('\nAPI統計データ:');
    console.log(`  - 総エラー数: ${apiStats.overview.totalErrors}`);
    console.log(`  - ユニークエラー: ${apiStats.overview.uniqueErrors}`);
    console.log(`  - 現在のトレンド数: ${apiStats.currentTrends.length}`);
    
    if (apiStats.currentTrends.length > 0) {
      console.log('\n検出されたトレンド:');
      for (const trend of apiStats.currentTrends) {
        console.log(`  - ${trend.category}: ${trend.trend} (${(trend.rate * 100).toFixed(0)}%)`);
      }
    }
    
    console.log('\n✅ すべてのPhase 2機能テストが完了しました');
    
  } catch (error) {
    console.error('\n❌ テストエラー:', error);
    throw error;
  }
}

// テスト実行
if (require.main === module) {
  testPhase2Features()
    .then(() => {
      console.log('\n✨ テスト完了');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 テスト失敗:', error);
      process.exit(1);
    });
}