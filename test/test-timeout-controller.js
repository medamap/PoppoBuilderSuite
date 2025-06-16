const TimeoutController = require('../src/timeout-controller');
const fs = require('fs');
const path = require('path');

// テスト用の設定
const testConfig = {
  minTimeout: 10 * 60 * 1000,      // 10分
  maxTimeout: 24 * 60 * 60 * 1000, // 24時間
  timeoutProfiles: {
    misc: 30 * 60 * 1000,          // 30分
    dogfooding: 2 * 60 * 60 * 1000, // 2時間
    documentation: 60 * 60 * 1000,   // 1時間
    complex: 6 * 60 * 60 * 1000,    // 6時間
    feature: 2 * 60 * 60 * 1000,    // 2時間
    bug: 60 * 60 * 1000             // 1時間
  },
  complexityFactors: {
    enableLearning: true,
    learningWeight: 0.5
  }
};

// モックのロガー
const mockLogger = {
  log: (level, message, data) => {
    console.log(`[${level}] ${message}`, data || '');
  }
};

// テスト実行
async function runTests() {
  console.log('🧪 タイムアウトコントローラーのテスト開始\n');
  
  // コントローラーのインスタンス作成
  const controller = new TimeoutController(testConfig, mockLogger);
  
  // テスト1: シンプルなIssueの複雑度判定
  console.log('--- テスト1: シンプルなIssueの複雑度判定 ---');
  const simpleIssue = {
    number: 1,
    title: 'テストIssue',
    body: 'これは短いテストIssueです。',
    labels: [{ name: 'task:misc' }]
  };
  
  const simpleComplexity = controller.calculateComplexity(simpleIssue);
  console.log('シンプルなIssue:', simpleComplexity);
  console.assert(simpleComplexity.level === 'simple', 'シンプルなIssueの判定が正しくない');
  
  // テスト2: 複雑なIssueの複雑度判定
  console.log('\n--- テスト2: 複雑なIssueの複雑度判定 ---');
  const complexIssue = {
    number: 2,
    title: '複雑な機能実装',
    body: `## 概要
長い説明文があるIssueです。これは非常に複雑な実装を必要とします。

## 要求事項
- 要求1: 複雑な処理の実装
- 要求2: データベース設計
- 要求3: API設計
- 要求4: フロントエンド実装

## 技術詳細
\`\`\`javascript
// コードブロック1
function complexFunction() {
  // 複雑な処理
}
\`\`\`

\`\`\`javascript
// コードブロック2
class ComplexClass {
  // 複雑なクラス
}
\`\`\`

## 参考リンク
- [リンク1](http://example.com)
- [リンク2](http://example.com)
- [リンク3](http://example.com)

![画像1](image1.png)
![画像2](image2.png)
`,
    labels: [
      { name: 'task:complex' },
      { name: 'feature' }
    ]
  };
  
  const complexComplexity = controller.calculateComplexity(complexIssue);
  console.log('複雑なIssue:', complexComplexity);
  console.assert(complexComplexity.level === 'complex', '複雑なIssueの判定が正しくない');
  
  // テスト3: タスクタイプの識別
  console.log('\n--- テスト3: タスクタイプの識別 ---');
  const dogfoodingIssue = {
    labels: [{ name: 'task:dogfooding' }]
  };
  
  const taskType = controller.identifyTaskType(dogfoodingIssue);
  console.log('Dogfoodingタスクタイプ:', taskType);
  console.assert(taskType === 'dogfooding', 'タスクタイプ識別が正しくない');
  
  // テスト4: タイムアウトの計算
  console.log('\n--- テスト4: タイムアウトの計算 ---');
  const timeoutInfo = controller.calculateTimeout(simpleIssue);
  console.log('シンプルなIssueのタイムアウト:', {
    timeout: Math.round(timeoutInfo.timeout / 60000) + '分',
    taskType: timeoutInfo.taskType,
    complexity: timeoutInfo.complexity.level,
    reasoning: timeoutInfo.reasoning
  });
  
  const complexTimeoutInfo = controller.calculateTimeout(complexIssue);
  console.log('複雑なIssueのタイムアウト:', {
    timeout: Math.round(complexTimeoutInfo.timeout / 60000) + '分',
    taskType: complexTimeoutInfo.taskType,
    complexity: complexTimeoutInfo.complexity.level,
    reasoning: complexTimeoutInfo.reasoning
  });
  
  // テスト5: 実行履歴の記録
  console.log('\n--- テスト5: 実行履歴の記録 ---');
  controller.recordExecution('test-1', simpleIssue, 15 * 60 * 1000, 'completed');
  controller.recordExecution('test-2', complexIssue, 120 * 60 * 1000, 'completed');
  controller.recordExecution('test-3', simpleIssue, 35 * 60 * 1000, 'timeout');
  
  // テスト6: 統計情報の取得
  console.log('\n--- テスト6: 統計情報の取得 ---');
  const stats = controller.getStatistics();
  console.log('統計情報:', JSON.stringify(stats, null, 2));
  
  // テスト7: タイムアウト延長リクエスト
  console.log('\n--- テスト7: タイムアウト延長リクエスト ---');
  const currentTimeout = 60 * 60 * 1000; // 1時間
  const newTimeout = controller.requestTimeoutExtension('test-4', currentTimeout, '処理が予想以上に複雑');
  console.log('延長後のタイムアウト:', Math.round(newTimeout / 60000) + '分');
  
  // テスト8: 学習による調整
  console.log('\n--- テスト8: 学習による調整（実行履歴がある場合） ---');
  const adjustedTimeoutInfo = controller.calculateTimeout(simpleIssue);
  console.log('学習後のタイムアウト:', {
    timeout: Math.round(adjustedTimeoutInfo.timeout / 60000) + '分',
    historicalAdjustment: adjustedTimeoutInfo.historicalAdjustment
  });
  
  // テスト履歴ファイルのクリーンアップ
  const historyFile = path.join(__dirname, '../logs/execution-history.json');
  if (fs.existsSync(historyFile)) {
    fs.unlinkSync(historyFile);
    console.log('\n✅ テスト履歴ファイルをクリーンアップしました');
  }
  
  console.log('\n✅ すべてのテストが完了しました');
}

// テスト実行
runTests().catch(console.error);