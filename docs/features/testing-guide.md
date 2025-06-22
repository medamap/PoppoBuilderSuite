# テストフレームワーク活用ガイド

PoppoBuilder Suiteのテストフレームワークを最大限に活用するための包括的なガイドです。ユニットテスト、統合テスト、E2Eテスト、パフォーマンステストの実行方法と開発方法を説明します。

## 🧪 テストの種類と目的

### 1. テストピラミッド

```
        /\
       /E2E\      <- 少数の重要なシナリオ
      /------\
     /統合テスト\   <- コンポーネント間の連携
    /----------\
   /ユニットテスト\  <- 個々の関数・クラス
  /--------------\
```

### 2. 各テストの役割

- **ユニットテスト**: 個々の関数やクラスの動作検証
- **統合テスト**: 複数のコンポーネント間の連携確認
- **E2Eテスト**: システム全体の動作確認
- **パフォーマンステスト**: 性能とスケーラビリティの検証

## 🚀 テストの実行

### 1. 基本的なテスト実行

```bash
# すべてのテストを実行
npm test

# カバレッジ付きで実行
npm run test:coverage

# 監視モード（ファイル変更時に自動実行）
npm run test:watch

# 特定のファイルのみ実行
npm test test/github-client.test.js
```

### 2. テストタイプ別の実行

```bash
# ユニットテストのみ
npm run test:unit

# 統合テストのみ
npm run test:integration

# E2Eテスト（要事前準備）
npm run test:e2e

# パフォーマンステスト
npm run test:performance
```

### 3. 詳細オプション

```bash
# 詳細なログ出力
npm test -- --verbose

# 特定のテストパターンにマッチ
npm test -- --grep "should handle errors"

# 失敗時に即座に停止
npm test -- --bail

# 並列実行の無効化
npm test -- --no-parallel
```

## 📝 ユニットテストの書き方

### 1. 基本的な構造

```javascript
// test/example.test.js
const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const ExampleClass = require('../src/example-class');

describe('ExampleClass', () => {
  let instance;
  
  beforeEach(() => {
    // 各テスト前のセットアップ
    instance = new ExampleClass();
  });
  
  afterEach(() => {
    // 各テスト後のクリーンアップ
    instance.cleanup();
  });
  
  describe('メソッド名', () => {
    it('期待される動作の説明', () => {
      // Arrange（準備）
      const input = 'test data';
      
      // Act（実行）
      const result = instance.process(input);
      
      // Assert（検証）
      expect(result).toBe('expected output');
    });
    
    it('エラーケースの処理', () => {
      // エラーがスローされることを検証
      expect(() => {
        instance.process(null);
      }).toThrow('Input cannot be null');
    });
  });
});
```

### 2. 非同期処理のテスト

```javascript
describe('非同期処理', () => {
  it('Promiseを返す関数のテスト', async () => {
    const result = await asyncFunction();
    expect(result).toBe('success');
  });
  
  it('コールバック関数のテスト', (done) => {
    callbackFunction((error, result) => {
      expect(error).toBeNull();
      expect(result).toBe('success');
      done();
    });
  });
  
  it('タイムアウトのテスト', async () => {
    jest.useFakeTimers();
    
    const promise = delayedFunction();
    jest.advanceTimersByTime(5000);
    
    const result = await promise;
    expect(result).toBe('completed');
    
    jest.useRealTimers();
  });
});
```

### 3. モックの使用

```javascript
// 外部依存のモック
jest.mock('../src/github-client');
const GitHubClient = require('../src/github-client');

describe('GitHubクライアントのモック', () => {
  beforeEach(() => {
    // モックの設定
    GitHubClient.mockImplementation(() => ({
      getIssue: jest.fn().mockResolvedValue({
        number: 123,
        title: 'Test Issue'
      }),
      createComment: jest.fn().mockResolvedValue({ id: 456 })
    }));
  });
  
  it('モックされたGitHubクライアントを使用', async () => {
    const client = new GitHubClient();
    const issue = await client.getIssue(123);
    
    expect(issue.title).toBe('Test Issue');
    expect(client.getIssue).toHaveBeenCalledWith(123);
  });
});
```

## 🔗 統合テストの書き方

### 1. コンポーネント間の統合テスト

```javascript
// test/integration/issue-processor.test.js
const IssueProcessor = require('../../src/issue-processor');
const GitHubClient = require('../../src/github-client');
const ClaudeClient = require('../../src/claude-client');

describe('IssueProcessor統合テスト', () => {
  let processor;
  let github;
  let claude;
  
  beforeEach(async () => {
    // 実際のインスタンスを使用（モックなし）
    github = new GitHubClient({ token: process.env.TEST_GITHUB_TOKEN });
    claude = new ClaudeClient({ apiKey: process.env.TEST_CLAUDE_KEY });
    processor = new IssueProcessor(github, claude);
    
    // テスト用のデータ準備
    await setupTestData();
  });
  
  afterEach(async () => {
    // テストデータのクリーンアップ
    await cleanupTestData();
  });
  
  it('Issueの完全な処理フロー', async () => {
    // テスト用Issueを作成
    const issue = await github.createIssue({
      title: 'Integration Test Issue',
      body: 'Test content',
      labels: ['task:misc']
    });
    
    // 処理実行
    const result = await processor.processIssue(issue);
    
    // 結果検証
    expect(result.status).toBe('completed');
    expect(result.comment).toBeTruthy();
    
    // 実際のGitHubでの状態確認
    const updatedIssue = await github.getIssue(issue.number);
    expect(updatedIssue.labels).toContain('completed');
  });
});
```

### 2. データベース統合テスト

```javascript
// test/integration/database.test.js
const DatabaseManager = require('../../src/database-manager');
const fs = require('fs').promises;

describe('データベース統合テスト', () => {
  let db;
  const testDbPath = './test-db.sqlite';
  
  beforeAll(async () => {
    // テスト用データベース作成
    db = new DatabaseManager(testDbPath);
    await db.initialize();
  });
  
  afterAll(async () => {
    // データベースクローズとファイル削除
    await db.close();
    await fs.unlink(testDbPath);
  });
  
  beforeEach(async () => {
    // 各テスト前にデータクリア
    await db.clear();
  });
  
  it('プロセス履歴の保存と取得', async () => {
    // データ保存
    const processData = {
      taskId: 'test-123',
      status: 'completed',
      duration: 5000
    };
    await db.saveProcessHistory(processData);
    
    // データ取得
    const history = await db.getProcessHistory('test-123');
    expect(history).toMatchObject(processData);
  });
});
```

## 🌐 E2Eテストの書き方

### 1. システム全体のE2Eテスト

```javascript
// test/e2e/scenarios/full-flow.test.js
const { TestEnvironment } = require('../helpers/test-environment');
const { GitHubMock } = require('../helpers/github-mock');

describe('PoppoBuilder E2Eテスト', () => {
  let env;
  let githubMock;
  
  beforeAll(async () => {
    // テスト環境のセットアップ
    env = new TestEnvironment();
    await env.setup();
    
    // GitHubAPIのモック
    githubMock = new GitHubMock();
    await githubMock.start();
  });
  
  afterAll(async () => {
    await env.cleanup();
    await githubMock.stop();
  });
  
  it('Issue作成から完了までの完全なフロー', async () => {
    // PoppoBuilder起動
    const poppo = await env.startPoppoBuilder();
    
    // テストIssue作成
    const issue = await githubMock.createIssue({
      title: 'E2E Test Issue',
      body: 'Please process this',
      labels: ['task:misc']
    });
    
    // 処理完了を待つ（最大2分）
    const result = await env.waitForCompletion(issue.number, 120000);
    
    // 検証
    expect(result.status).toBe('completed');
    expect(result.comments.length).toBeGreaterThan(0);
    expect(result.labels).toContain('completed');
    
    // ログ検証
    const logs = await env.getLogs();
    expect(logs).toContain(`Processing issue #${issue.number}`);
  });
});
```

### 2. ブラウザベースのE2Eテスト

```javascript
// test/e2e/dashboard.test.js
const { chromium } = require('playwright');

describe('ダッシュボードE2Eテスト', () => {
  let browser;
  let page;
  
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  
  afterAll(async () => {
    await browser.close();
  });
  
  beforeEach(async () => {
    page = await browser.newPage();
    await page.goto('http://localhost:3001');
  });
  
  afterEach(async () => {
    await page.close();
  });
  
  it('ダッシュボードの基本操作', async () => {
    // ログイン
    await page.fill('#username', 'admin');
    await page.fill('#password', 'test-password');
    await page.click('#login-button');
    
    // プロセス一覧の確認
    await page.waitForSelector('.process-list');
    const processes = await page.$$('.process-item');
    expect(processes.length).toBeGreaterThan(0);
    
    // プロセス停止
    await page.click('.process-item:first-child .stop-button');
    await page.waitForSelector('.confirm-dialog');
    await page.click('#confirm-stop');
    
    // ステータス変更を確認
    await page.waitForSelector('.process-item:first-child .status-stopped');
  });
});
```

## ⚡ パフォーマンステストの書き方

### 1. ベンチマークテスト

```javascript
// test/performance/benchmarks/issue-processing.bench.js
const { BenchmarkRunner } = require('../../../src/performance/benchmark-runner');
const IssueProcessor = require('../../../src/issue-processor');

describe('Issue処理パフォーマンス', () => {
  const runner = new BenchmarkRunner({
    warmupRuns: 5,
    testRuns: 100,
    concurrent: false
  });
  
  it('単一Issue処理のベンチマーク', async () => {
    const result = await runner.benchmark('single-issue', async () => {
      const processor = new IssueProcessor();
      await processor.processIssue(mockIssue);
    });
    
    expect(result.mean).toBeLessThan(1000); // 平均1秒以下
    expect(result.p95).toBeLessThan(1500);  // 95パーセンタイル1.5秒以下
  });
  
  it('並行処理のベンチマーク', async () => {
    const result = await runner.benchmark('concurrent-issues', async () => {
      const processor = new IssueProcessor();
      await Promise.all([
        processor.processIssue(mockIssue1),
        processor.processIssue(mockIssue2),
        processor.processIssue(mockIssue3)
      ]);
    });
    
    expect(result.throughput).toBeGreaterThan(100); // 100 issues/hour以上
  });
});
```

### 2. 負荷テスト

```javascript
// test/performance/load-test.js
const { LoadTester } = require('../../src/performance/load-tester');

describe('負荷テスト', () => {
  it('高負荷時の動作確認', async () => {
    const tester = new LoadTester({
      duration: 60000,      // 1分間
      rampUp: 10000,        // 10秒でランプアップ
      targetRPS: 50,        // 秒間50リクエスト
      scenario: 'mixed'     // 混合シナリオ
    });
    
    const results = await tester.run();
    
    // 成功率
    expect(results.successRate).toBeGreaterThan(0.99); // 99%以上
    
    // レスポンスタイム
    expect(results.responseTime.p50).toBeLessThan(200);
    expect(results.responseTime.p99).toBeLessThan(1000);
    
    // エラー率
    expect(results.errorRate).toBeLessThan(0.01); // 1%未満
  });
});
```

## 🔍 テストのデバッグ

### 1. 失敗したテストの調査

```bash
# 詳細なエラー情報を表示
npm test -- --verbose --no-coverage

# 特定のテストのみをデバッグモードで実行
node --inspect-brk node_modules/.bin/jest test/failing-test.js

# スナップショットの更新
npm test -- -u
```

### 2. テストログの活用

```javascript
// テスト内でのログ出力
describe('デバッグが必要なテスト', () => {
  it('複雑な処理', () => {
    console.log('=== Test Start ===');
    console.log('Input:', JSON.stringify(testData, null, 2));
    
    const result = complexFunction(testData);
    
    console.log('Output:', JSON.stringify(result, null, 2));
    console.log('=== Test End ===');
    
    expect(result).toMatchSnapshot();
  });
});
```

### 3. テストの分離

```javascript
// 問題のあるテストを分離
describe.only('問題のあるテスト', () => {
  it.only('失敗するテスト', () => {
    // このテストのみ実行される
  });
});

// 一時的にスキップ
describe.skip('不安定なテスト', () => {
  it('後で修正する', () => {
    // スキップされる
  });
});
```

## 📊 テストカバレッジ

### 1. カバレッジレポートの生成

```bash
# HTMLレポートを生成
npm run test:coverage

# ブラウザで確認
open coverage/lcov-report/index.html

# 最小カバレッジを設定
npm test -- --coverage --coverageThreshold='{"global":{"branches":80,"functions":80,"lines":80,"statements":80}}'
```

### 2. カバレッジの改善

```javascript
// カバレッジが低い部分を特定
/* istanbul ignore next */  // カバレッジから除外
if (process.env.NODE_ENV === 'development') {
  console.log('Debug info');
}

// エッジケースのテスト追加
describe('エッジケース', () => {
  it('空の入力', () => {
    expect(fn('')).toBe(null);
  });
  
  it('巨大な入力', () => {
    const hugeInput = 'x'.repeat(1000000);
    expect(() => fn(hugeInput)).toThrow();
  });
  
  it('特殊文字', () => {
    expect(fn('🚀')).toBe('rocket');
  });
});
```

## 🛠️ テスト環境のセットアップ

### 1. 環境変数の設定

```bash
# test/.env.test
NODE_ENV=test
LOG_LEVEL=error
TEST_TIMEOUT=30000
GITHUB_TOKEN=test-token
CLAUDE_API_KEY=test-key
```

### 2. テスト用の設定

```javascript
// test/setup.js
beforeAll(() => {
  // グローバルなセットアップ
  jest.setTimeout(30000);
  
  // 環境変数の設定
  process.env.NODE_ENV = 'test';
});

afterAll(() => {
  // グローバルなクリーンアップ
  jest.clearAllMocks();
});
```

### 3. カスタムマッチャー

```javascript
// test/matchers.js
expect.extend({
  toBeValidIssue(received) {
    const pass = received.number > 0 && 
                 received.title && 
                 received.state;
    
    return {
      pass,
      message: () => pass
        ? `expected ${received} not to be a valid issue`
        : `expected ${received} to be a valid issue`
    };
  }
});

// 使用例
expect(issue).toBeValidIssue();
```

## 📈 継続的テスト改善

### 1. テストメトリクスの追跡

```bash
# テスト実行時間の記録
npm test -- --json --outputFile=test-results.json

# メトリクス分析
node scripts/analyze-test-metrics.js test-results.json
```

### 2. 不安定なテストの検出

```javascript
// テストの安定性を確認
for i in {1..10}; do
  npm test test/flaky-test.js
  if [ $? -ne 0 ]; then
    echo "Test failed on run $i"
    break
  fi
done
```

### 3. テストの最適化

```javascript
// 遅いテストの特定
npm test -- --logHeapUsage

// 並列実行の最適化
{
  "jest": {
    "maxWorkers": "50%",
    "testTimeout": 30000
  }
}
```

## 🎯 まとめ

効果的なテストのポイント：

1. **テストピラミッドの遵守** - ユニットテストを基盤に
2. **読みやすいテスト** - テストもドキュメントの一部
3. **独立性の確保** - テスト間の依存を避ける
4. **継続的な実行** - CIでの自動実行
5. **カバレッジの向上** - 品質指標として活用

詳細な情報は[テストフレームワーク仕様書](../test-framework-fixes.md)を参照してください。