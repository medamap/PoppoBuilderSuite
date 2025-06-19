# CCQA (Code Change Quality Assurance) エージェント

## 概要

CCQAエージェントは、コード変更の品質保証を担当する専門エージェントです。自動テスト実行、コード品質チェック、セキュリティ検査、パフォーマンス分析を統合的に実行し、コード変更の品質を体系的に評価します。

## 主な機能

### 1. 自動テスト実行
- **テストランナー自動検出**: Jest、Mocha等の主要なテストランナーを自動検出
- **カバレッジ計測**: テストカバレッジの自動計測とレポート
- **失敗テスト分析**: 失敗したテストの詳細情報を収集
- **影響テスト特定**: 変更されたファイルに関連するテストを特定

### 2. コード品質チェック
- **リンティング**: ESLint等によるコード品質チェック
- **フォーマット確認**: Prettier等によるコードフォーマット確認
- **複雑度分析**: サイクロマティック複雑度の計算
- **重複コード検出**: コードの重複箇所を検出
- **コーディング規約**: 命名規則やファイル長などの規約チェック

### 3. セキュリティ検査
- **依存関係スキャン**: npm audit等による脆弱性スキャン
- **認証情報検出**: ハードコードされたAPIキーやパスワードの検出
- **脆弱性パターン**: OWASP Top 10に基づくセキュリティチェック
- **セキュアコーディング**: SQLインジェクション、XSS等のリスク検出

### 4. パフォーマンス分析
- **実行時間計測**: 関数の実行時間を推定
- **メモリ使用量分析**: メモリリークの可能性を検出
- **バンドルサイズ**: ビルド成果物のサイズ分析
- **パフォーマンス回帰**: 前回との比較による性能低下の検出

### 5. レポート生成
- **品質スコア**: 総合的な品質スコア（0-100）の算出
- **Markdownレポート**: 人間が読みやすい形式のレポート
- **JSONレポート**: プログラムで処理可能な構造化データ
- **推奨事項**: 改善のための具体的なアクション提案

## アーキテクチャ

```
agents/ccqa/
├── index.js              # メインエージェントクラス
├── test-runner.js        # テスト実行モジュール
├── quality-checker.js    # 品質チェックモジュール
├── security-scanner.js   # セキュリティ検査モジュール
├── performance-analyzer.js # パフォーマンス分析モジュール
└── report-generator.js   # レポート生成モジュール
```

## 設定

### 環境変数

```bash
# 機能の有効/無効
CCQA_RUN_TESTS=true
CCQA_CHECK_QUALITY=true
CCQA_SCAN_SECURITY=true
CCQA_ANALYZE_PERFORMANCE=true

# 閾値設定
CCQA_COVERAGE_THRESHOLD=80
CCQA_COMPLEXITY_THRESHOLD=20
CCQA_DUPLICATE_RATIO_THRESHOLD=5
CCQA_SECURITY_LEVEL=high
CCQA_PERF_REGRESSION_THRESHOLD=10

# ツール設定
CCQA_TEST_RUNNERS=jest,mocha
CCQA_LINTERS=eslint
CCQA_FORMATTERS=prettier
CCQA_TEST_TIMEOUT=60000
```

### 設定ファイル

```json
{
  "agentMode": {
    "enabled": true,
    "taskMapping": {
      "labels": {
        "quality": ["quality-assurance"],
        "test": ["quality-assurance"],
        "qa": ["quality-assurance"]
      },
      "keywords": {
        "品質": ["quality-assurance"],
        "quality": ["quality-assurance"],
        "テスト": ["quality-assurance"],
        "test": ["quality-assurance"]
      }
    }
  }
}
```

## 使用方法

### 1. スタンドアロン実行

```bash
# CCQAエージェントを直接起動
node scripts/start-ccqa.js
```

### 2. PoppoBuilderとの統合

PoppoBuilderがIssueを処理する際、以下のラベルやキーワードでCCQAエージェントが自動的に呼び出されます：

- **ラベル**: `task:quality`, `test`, `qa`
- **キーワード**: "品質", "quality", "テスト", "test"

### 3. Issue例

```markdown
# コード品質チェックの実行

task:quality ラベルを付けてください。

以下のファイルの品質をチェックしてください：
- src/minimal-poppo.js
- src/process-manager.js
- agents/ccqa/index.js

特に以下の観点で確認をお願いします：
- テストカバレッジが80%以上あるか
- セキュリティ上の問題がないか
- パフォーマンス回帰がないか
```

## 出力例

### Markdownレポート

```markdown
# 🔍 Code Quality Assurance Report

**品質スコア**: ✅ 87/100

- **リポジトリ**: medamap/PoppoBuilderSuite
- **Issue**: #79
- **実行日時**: 2025/06/18 10:30:45

## 📊 サマリー
- **テスト**: ✅ 95/100 成功 (カバレッジ: 85%)
- **コード品質**: ⚠️ 5 件の問題
- **セキュリティ**: ✅ 0 件の問題
- **パフォーマンス**: ✅ 0 件の回帰

## 🧪 テスト結果

### 概要
- **総テスト数**: 100
- **成功**: 95 ✅
- **失敗**: 5 ❌
- **カバレッジ**: 85%
- **実行時間**: 15234ms

### カバレッジ詳細
| 項目 | カバレッジ |
|------|-----------|
| 行 | 85% |
| 文 | 82% |
| 関数 | 90% |
| 分岐 | 75% |

## 💡 推奨事項

### ❗ HIGH
- **テストカバレッジを 80% 以上に向上させてください**
  - 対処法: テストケースを追加してください
```

### JSONレポート（抜粋）

```json
{
  "metadata": {
    "timestamp": "2025-06-18T01:30:45.123Z",
    "repository": "medamap/PoppoBuilderSuite",
    "issue": 79
  },
  "summary": {
    "qualityScore": 87,
    "testsTotal": 100,
    "testsPassed": 95,
    "testsFailed": 5,
    "testCoverage": 85,
    "qualityIssues": 5,
    "securityIssues": 0,
    "performanceRegressions": 0
  },
  "recommendations": [
    {
      "priority": "high",
      "type": "test_coverage",
      "message": "テストカバレッジを 80% 以上に向上させてください",
      "action": "テストケースを追加してください"
    }
  ]
}
```

## 品質スコアの計算

品質スコアは以下の要素から算出されます（100点満点）：

| 要素 | 重み |
|------|------|
| テスト | 30% |
| コード品質 | 30% |
| セキュリティ | 25% |
| パフォーマンス | 15% |

## 拡張性

### カスタムチェックの追加

新しいチェックを追加する場合は、対応するモジュールを拡張します：

```javascript
// quality-checker.js にカスタムルールを追加
class QualityChecker {
  async checkCustomRule(projectDir, changedFiles) {
    // カスタムチェックの実装
  }
}
```

### 新しいツールの統合

新しいテストランナーやリンターを追加する場合：

```javascript
// 設定に追加
{
  testConfig: {
    runners: ['jest', 'mocha', 'vitest']
  },
  qualityConfig: {
    linters: ['eslint', 'tslint', 'biome']
  }
}
```

## トラブルシューティング

### テストが実行されない
- `package.json`に`test`スクリプトが定義されているか確認
- テストランナーがインストールされているか確認

### セキュリティスキャンが遅い
- `npm audit`の実行に時間がかかる場合があります
- キャッシュを活用するか、頻度を調整してください

### パフォーマンス分析が不正確
- ベンチマークデータが存在しない場合は初回実行時に作成されます
- `.poppo/benchmarks/`ディレクトリを確認してください

## 関連ドキュメント

- [エージェントアーキテクチャ](../architecture/agent-separation.md)
- [PoppoBuilder統合ガイド](../guides/agent-integration.md)
- [設定管理](../config-management.md)