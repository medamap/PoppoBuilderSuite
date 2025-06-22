# CCTA (Code Change Test Agent) - クーちゃん

## 概要

CCTA（Code Change Test Agent）は、PoppoBuilder Suiteのエージェントの一つで、自動テスト実行、カバレッジレポート生成、パフォーマンス検証を担当します。愛称は「クーちゃん」です。

## 主な機能

1. **テスト自動実行**
   - 単体テスト、統合テスト、E2Eテストの実行
   - 複数のテストフレームワーク対応（Jest、Mocha、Vitest、Jasmine）
   - 影響を受けるテストの自動検出

2. **カバレッジレポート生成**
   - 行、文、関数、分岐のカバレッジ測定
   - 閾値チェックと違反検出
   - カバレッジバッジの更新
   - ベースラインとの比較

3. **パフォーマンステスト**
   - ページロード時間の測定
   - メモリ使用量の追跡
   - バンドルサイズの分析
   - パフォーマンストレンドの追跡

4. **レポート生成**
   - Markdown形式の人間が読みやすいレポート
   - JSON形式の構造化データ
   - HTML形式のビジュアルレポート
   - GitHubコメントへの自動投稿

## 使用方法

### スタンドアロン起動

```bash
# デーモンモードで起動
node scripts/start-ccta.js

# 単発実行モード
node scripts/start-ccta.js once

# デモモード
DEMO_MODE=true node scripts/start-ccta.js
```

### PoppoBuilderとの統合

以下のラベルまたはキーワードを含むIssueが自動的にCCTAに振り分けられます：

- **ラベル**: `test`, `coverage`, `performance`
- **キーワード**: テスト、test、カバレッジ、coverage、パフォーマンス、performance

### 環境変数設定

```bash
# テストフレームワーク
export CCTA_FRAMEWORKS="jest,mocha"

# カバレッジ閾値
export CCTA_COVERAGE_BRANCHES=80
export CCTA_COVERAGE_FUNCTIONS=80
export CCTA_COVERAGE_LINES=80
export CCTA_COVERAGE_STATEMENTS=80

# パフォーマンス閾値
export CCTA_PERF_LOAD_TIME=3000      # ms
export CCTA_PERF_MEMORY=100          # MB
export CCTA_PERF_BUNDLE_SIZE=500     # KB

# その他
export CCTA_AUTO_FIX=false
export CCTA_TIMEOUT=300000           # 5分
```

## タスクタイプ

### 1. PR テスト (`pr_test`)
Pull Requestに関連するテストを実行します。
- 変更されたファイルの検出
- 影響を受けるテストの特定
- カバレッジ分析
- 必要に応じてパフォーマンステスト

### 2. コミットテスト (`commit_test`)
特定のコミットに対する簡易テストを実行します。
- スモークテストスイートの実行
- 基本的な動作確認
- 短時間での実行（1分以内）

### 3. フルテスト (`full_test`)
すべてのテストを実行します。
- 全テストスイートの実行
- 詳細なカバレッジレポート
- カバレッジバッジの更新
- 閾値チェック

### 4. パフォーマンステスト (`performance_test`)
アプリケーションのパフォーマンスを測定します。
- ロード時間の測定
- メモリ使用量の追跡
- バンドルサイズの分析
- パフォーマンストレンドの生成

### 5. カバレッジチェック (`coverage_check`)
現在のカバレッジを分析します。
- ベースラインとの比較
- カバレッジ改善の提案
- 未カバーコードの特定

## レポート形式

### Markdownレポート例

```markdown
# ✅ テストレポート

**実行日時**: 2025/6/20 10:30:00
**タスクタイプ**: full_test
**ステータス**: 成功

## 📊 テスト結果

| メトリクス | 値 |
|------------|-----|
| 総テスト数 | 150 |
| 成功 | 148 |
| 失敗 | 2 |
| スキップ | 0 |
| 実行時間 | 45.2s |

## 📈 カバレッジ

| タイプ | カバレッジ |
|--------|-----------|
| 行 | 85.3% |
| 文 | 84.7% |
| 関数 | 88.1% |
| 分岐 | 79.5% |
| 閾値達成 | ✅ |

## 💡 推奨事項

- 2個のテストが失敗しています。エラーメッセージを確認して修正してください。
- 分岐カバレッジが80%を下回っています。条件分岐のテストを追加してください。
```

## 設定オプション

```json
{
  "agents": {
    "ccta": {
      "frameworks": ["jest", "mocha"],
      "coverageThreshold": {
        "global": {
          "branches": 80,
          "functions": 80,
          "lines": 80,
          "statements": 80
        }
      },
      "performanceThreshold": {
        "loadTime": 3000,
        "memoryUsage": 100,
        "bundleSize": 500
      },
      "autoFix": false,
      "skipTests": [],
      "timeout": 300000,
      "reportsDir": "test-reports",
      "resultsDir": "performance-results"
    }
  }
}
```

## トラブルシューティング

### テストが実行されない
1. テストフレームワークが正しくインストールされているか確認
2. `package.json`の`test`スクリプトを確認
3. テストファイルのパターンが正しいか確認

### カバレッジが生成されない
1. カバレッジツール（nyc、c8など）がインストールされているか確認
2. テストフレームワークのカバレッジ設定を確認
3. `--coverage`フラグが正しく渡されているか確認

### パフォーマンステストが失敗する
1. 必要なポート（3000など）が空いているか確認
2. ビルドスクリプトが正しく設定されているか確認
3. タイムアウト値を増やしてみる

## 拡張方法

### 新しいテストフレームワークの追加

`test-runner.js`に新しいメソッドを追加：

```javascript
async runNewFramework(options) {
  // 実装
}
```

### カスタムパフォーマンスシナリオ

`config.json`でシナリオを定義：

```json
{
  "scenarios": {
    "custom": {
      "type": "custom",
      "custom": async () => {
        // カスタム測定ロジック
        return { metric: value };
      }
    }
  }
}
```

## 関連ドキュメント

- [PoppoBuilder Suite エージェントアーキテクチャ](../architecture/agent-architecture.md)
- [CCQA エージェント](ccqa-agent.md) - コード品質保証
- [CCRA エージェント](ccra-agent.md) - コードレビュー自動化