# Issue #34: エラーログ収集Phase 3基本

## 概要
エラーログ収集機能 Phase 3: 自動修復機能の実装。既知のエラーパターンに対する自動修復機能を実装。Phase 1でエラー検出、Phase 2で高度な分析の後、最終段階として自動修復機能を追加。

## 実装日
2025年6月16日

## 実装内容

### 1. 修復パターンライブラリ
`agents/ccla/patterns.js`：

一般的なエラーパターンの修復方法を定義：
- **EP001**: Type Error - nullチェックの追加（オプショナルチェイニング）
- **EP002**: Reference Error - 自動インポート（モジュールの推測とrequire文追加）
- **EP003**: Syntax Error - 構文エラーの修正（セミコロン追加、括弧の修正等）
- **EP004**: File Not Found - 設定ファイルの自動作成
- **EP010**: JSON Parse Error - JSONフォーマットの修正

### 2. 自動修復エンジン
`agents/ccla/repairer.js`：
- エラーパターンと修復方法のマッチング
- 修復案の生成と適用
- 修復前のバックアップ作成
- 修復後の動作確認（構文チェック、JSON検証）
- 修復成功率の追跡と学習

### 3. テストケース自動生成
`agents/ccla/test-generator.js`：
- 修復箇所に対するテストケース生成
- JestまたはMochaフレームワークの自動検出
- 既存テストファイルへの統合
- Claudeによるテストコード改善（オプション）

### 4. ロールバック機能
`agents/ccla/rollback.js`：
- 修復失敗時の自動ロールバック
- バックアップファイルの管理（最大50件、7日間保持）
- 変更履歴の完全記録
- ロールバック理由の記録

### 5. CCLAエージェントの統合
`agents/ccla/index.js`：
- 自動修復エンジンの統合（134-136行目で条件付き初期化）
- エラー検出時の自動修復試行（321-365行目）
- 修復成功時の特別なIssue作成（`task:auto-repaired`ラベル）
- 学習データの自動保存とエクスポート（539-547行目）

### 6. 設定の拡張
`config/config.json`：
```json
"errorLogCollection": {
  "autoRepair": {
    "enabled": false,           // デフォルトは無効
    "maxRetries": 3,           // 最大リトライ回数
    "testTimeout": 60000,      // テストタイムアウト（60秒）
    "enableTestGeneration": true,
    "enableRollback": true,
    "dryRun": false,           // trueの場合、実際の修復は行わない
    "confidenceThreshold": 0.8,
    "repairablePatterns": ["EP001", "EP002", "EP003", "EP004", "EP010"]
  }
}
```

## 修復フロー

1. **エラー検出**: CCLAエージェントがエラーログを検出
2. **パターンマッチング**: エラーパターンライブラリと照合
3. **修復可能性判定**: 自動修復可能かチェック（成功率も考慮）
4. **バックアップ作成**: 修復前のファイルをバックアップ
5. **修復実行**: パターンに応じた修復を適用
6. **検証**: 構文チェックやテスト実行
7. **結果判定**: 成功時はIssue作成、失敗時はロールバック

## 修復パターンの詳細

### EP001: Type Error - Property Access
```javascript
// 修復前
return user.name;  // userがundefinedの可能性

// 修復後（オプショナルチェイニング）
return user?.name;
```

### EP002: Reference Error - Undefined Variable
```javascript
// 修復前
const content = fs.readFileSync('file.txt');  // fsが未定義

// 修復後（自動インポート）
const fs = require('fs');
const content = fs.readFileSync('file.txt');
```

### EP004: File Not Found
```javascript
// config.jsonが存在しない場合
// → 空のJSONファイル {} を自動作成
```

## テスト方法

```bash
# 自動修復機能のテスト
node test/test-auto-repair.js

# 実際の動作確認（エージェントモードで起動）
npm run start:agents

# 設定で自動修復を有効化
# config.jsonで errorLogCollection.autoRepair.enabled: true
```

## 実装状況
- ✅ **patterns.js** - 既存ファイルを確認（修復パターンライブラリ実装済み）
- ✅ **repairer.js** - 既存ファイルを確認（自動修復エンジン実装済み）
- ✅ **test-generator.js** - 既存ファイルを確認（テスト生成機能実装済み）
- ✅ **rollback.js** - 既存ファイルを確認（ロールバック機能実装済み）
- ✅ **CCLAエージェント統合** - index.jsで自動修復機能が統合済み
- ✅ **設定ファイル** - config.jsonに自動修復設定が追加済み
- ✅ **テストスクリプト** - test/test-auto-repair.js実装済み

## セキュリティ考慮事項
- 重要なファイルの変更は制限（設定ファイルとデータファイルのみ）
- 修復前に必ずバックアップを作成
- 変更ログの完全記録
- ロールバック機能により安全な復元が可能

## 実装上の特徴
- **学習機能**: 修復成功率を記録し、低い成功率のパターンは自動的に無効化
- **ドライランモード**: 実際の修復を行わずに結果を確認可能
- **拡張性**: 新しい修復パターンを容易に追加可能
- **統計情報**: 修復試行数、成功数、失敗数を追跡

## 成果
- 既知のエラーパターンの自動修復
- 運用負荷の大幅削減
- エラー対応時間の短縮
- 品質向上と安定性確保

## 技術的なポイント
- パターンベースの修復戦略
- 安全性を重視したバックアップ機能
- 学習による最適化
- テスト生成による品質保証

## 今後の拡張予定
- より複雑なエラーパターンへの対応
- 修復戦略の機械学習による最適化
- Webダッシュボードでの修復履歴表示

## 注意事項
- 自動修復機能はデフォルトで無効（`enabled: false`）
- 有効化するには`config.json`で`errorLogCollection.autoRepair.enabled: true`に設定
- エージェントモードで実行する必要があります（`npm run start:agents`）

## 関連ファイル
- **修復パターン**: `agents/ccla/patterns.js`
- **修復エンジン**: `agents/ccla/repairer.js`
- **テスト生成**: `agents/ccla/test-generator.js`
- **ロールバック**: `agents/ccla/rollback.js`
- **テストスクリプト**: `test/test-auto-repair.js`

## 関連Issue
- Issue #30, #32: エラーログ収集Phase 1（基本検出機能）
- Issue #37: エラーログ収集Phase 2（高度な分析）
- Issue #38: エラーログ収集Phase 3拡張（学習機能とPR作成）