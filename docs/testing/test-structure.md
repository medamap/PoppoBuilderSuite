# テスト構造ガイド

PoppoBuilder Suite のテスト環境の構造と使用方法について説明します。

## 📁 ディレクトリ構造

```
test/
├── helpers/              # テストヘルパー
│   ├── test-setup.js     # グローバルセットアップ
│   ├── test-isolation.js # テスト分離機能
│   ├── redis-test-helper.js # Redisテスト用ヘルパー
│   └── test-environment-check.js # 環境チェック
├── unit/                 # ユニットテスト
├── integration/          # 統合テスト
├── agents/              # エージェントテスト
├── security/            # セキュリティテスト
└── dangerous/           # 破壊的テスト（通常スキップ）
```

## 🧪 テスト実行方法

### 基本的なテスト実行

```bash
# すべてのテストを実行
npm test

# カテゴリ別実行
npm run test:unit         # ユニットテストのみ
npm run test:integration  # 統合テストのみ
npm run test:agents      # エージェントテストのみ
npm run test:security    # セキュリティテストのみ
```

### 環境チェック

```bash
# テスト環境が正しく設定されているか確認
node test/helpers/test-environment-check.js
```

## 🔒 テストの分離

PoppoBuilder Suite のテストは、お互いに影響しないよう分離して実行されます。

### 分離されたテストの書き方

```javascript
const { runIsolated } = require('./helpers/test-isolation');

describe('FileStateManager', () => {
  it('should save state in isolated environment', async () => {
    await runIsolated('file-state-test', async (env) => {
      // env.dirには分離されたディレクトリが提供される
      const stateManager = new FileStateManager(env.stateDir);
      
      // テストコード
      await stateManager.saveProcessedIssues([1, 2, 3]);
      
      // アサーション
      const issues = await stateManager.loadProcessedIssues();
      expect(issues).to.deep.equal([1, 2, 3]);
    });
  });
});
```

### Redis分離

テスト用のRedisは本番とは別のDB番号（デフォルト: 15）を使用します。

```javascript
const { getInstance } = require('./helpers/redis-test-helper');

describe('Redis Integration', () => {
  let redisHelper;
  
  before(async () => {
    redisHelper = getInstance();
    await redisHelper.connect();
  });
  
  after(async () => {
    await redisHelper.disconnect();
  });
  
  beforeEach(async () => {
    // 各テストの前にRedisをクリア
    await redisHelper.clearPattern('test:*');
  });
});
```

## 🗂️ テストディレクトリの整理

既存のテストファイルを整理するには：

```bash
# テストファイルの分類と整理
npm run test:organize
```

このコマンドは、test/直下のファイルをカテゴリ別のサブディレクトリに移動します。

## ⚠️ 注意事項

### 環境変数

テスト実行時は以下の環境変数が自動設定されます：

- `NODE_ENV=test`
- `LOG_LEVEL=error`
- `REDIS_TEST_DB=15`

### 一時ファイル

テストで作成される一時ファイルは以下に保存されます：

- `.test-temp/` - 一般的な一時ファイル
- `.test-isolated/` - 分離テスト環境

これらは通常、テスト終了後に自動削除されます。

### デバッグ

テスト環境を保持したい場合：

```bash
# 一時ディレクトリを削除しない
KEEP_TEST_ENV=true npm test
```

## 🎯 ベストプラクティス

1. **テストは独立して実行可能に**
   - 他のテストに依存しない
   - 実行順序に依存しない

2. **適切なタイムアウト設定**
   - ユニットテスト: 5秒
   - 統合テスト: 30秒
   - エージェントテスト: 10秒

3. **モックの使用**
   - 外部APIはモック化
   - ファイルシステムは分離環境を使用

4. **クリーンアップ**
   - `after`フックで必ずクリーンアップ
   - プロセスやファイルを残さない

5. **エラーケースのテスト**
   - 正常系だけでなく異常系もテスト
   - エラーハンドリングの確認