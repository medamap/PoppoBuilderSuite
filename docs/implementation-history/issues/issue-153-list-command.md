# Issue #153: list（ls）コマンドの実装

**実装日**: 2025/6/21  
**実装者**: Claude (PoppoBuilder)  
**関連Issue**: #153

## 概要

PoppoBuilderのマルチプロジェクト管理システムにおいて、登録されたプロジェクトの一覧表示機能を実装しました。Issue #150で実装したProjectRegistryを活用し、ユーザーが管理対象のプロジェクト状況を把握できる包括的なリストコマンドを提供します。

## 実装内容

### 1. ListCommandクラス (`lib/commands/list.js`)

#### 主要機能
- **プロジェクト一覧表示**: 登録されたすべてのプロジェクトの表示
- **柔軟なフィルタリング**: 有効/無効、タグによる絞り込み
- **多様なソート**: 名前、優先度、パス、日時、アクティビティでソート
- **複数の出力形式**: デフォルト、テーブル、JSON形式
- **詳細情報表示**: 統計、リソース設定、実行時ステータス

#### コマンドオプション
```bash
poppobuilder list [options]
poppobuilder ls [options]  # エイリアス

フィルター:
  --enabled                  有効なプロジェクトのみ表示
  --disabled                 無効なプロジェクトのみ表示
  --tag <tag>                指定タグでフィルター

ソート:
  --sort <field>             ソート項目 (name|priority|path|created|updated|activity)

出力形式:
  --table                    テーブル形式で表示
  --json                     JSON形式で出力
  --status                   実行時ステータス情報を含める
  -v, --verbose              詳細情報表示
  -q, --quiet                最小限の出力
```

### 2. 出力形式

#### デフォルト形式（カード表示）
```
📋 PoppoBuilder Projects

Project One ✓ enabled [P80]
  ID: project1-abc123
  Path: /home/user/project1
  GitHub: testuser/project1
  Description: First test project
  Tags: #web #api
  Stats: 15 issues processed, 2 errors
         Average processing time: 1500ms
         Last activity: 6/21/2025, 7:30:00 AM

Project Two ✗ disabled [P50]
  ID: project2-def456
  Path: /home/user/project2
  Description: Second test project
  Tags: #mobile #app
  Stats: 0 issues processed, 0 errors

────────────────────────────────────────────────────────────
Total: 3 projects
Enabled: 2  Disabled: 1
Total processed: 20 issues, 2 errors
```

#### テーブル形式
```
ID              | Name          | Status  | Priority | Path
----------------|---------------|---------|----------|------------------
project1-abc123 | Project One   | enabled | 80       | /home/user/project1
project2-def456 | Project Two   | disabled| 50       | /home/user/project2
project3-ghi789 | Project Three | enabled | 90       | /home/user/project3
```

#### JSON形式
```json
{
  "project1-abc123": {
    "path": "/home/user/project1",
    "enabled": true,
    "config": {
      "name": "Project One",
      "priority": 80,
      "tags": ["web", "api"]
    },
    "stats": {
      "totalIssuesProcessed": 15,
      "totalErrors": 2
    }
  }
}
```

### 3. 高度な機能

#### ソート機能
- **name**: プロジェクト名による辞書順ソート
- **priority**: 優先度による降順ソート（高→低）
- **path**: パスによる辞書順ソート
- **created**: 作成日時による降順ソート（新→古）
- **updated**: 更新日時による降順ソート（新→古）
- **activity**: 最終アクティビティによる降順ソート（新→古）

#### フィルタリング機能
- **--enabled**: 有効なプロジェクトのみ表示
- **--disabled**: 無効なプロジェクトのみ表示
- **--tag**: 指定されたタグを含むプロジェクトのみ表示（部分一致）

#### 実行時ステータス（--status）
- **パス存在確認**: プロジェクトディレクトリの存在チェック
- **設定状態確認**: `.poppobuilder/config.json`の存在チェック
- **Git状態確認**: Git作業ディレクトリの状態表示

### 4. パフォーマンス最適化

#### パス表示の最適化
- 長いパスの智的な短縮（重要部分を保持）
- 表示幅に応じた動的調整
- 最初と最後のディレクトリ名を優先保持

#### テーブル表示の最適化
- 内容に応じた動的列幅計算
- 最大幅制限による見やすさの確保
- 長い内容の適切な省略表示

### 5. CLIの統合 (`bin/poppobuilder.js`)

```javascript
// list コマンドとlsエイリアスの追加
program
  .command('list')
  .alias('ls')
  .description('List all registered PoppoBuilder projects')
  // ... オプション設定
```

### 6. エラーハンドリング

- プロジェクトレジストリ初期化失敗の適切な処理
- プロジェクトデータ不整合時の警告表示
- 外部コマンド（Git）実行失敗時のフォールバック
- ファイルアクセスエラーの適切な処理

### 7. 国際化対応

- i18n システムとの統合
- 英語・日本語対応（拡張可能）
- 日時表示のロケール対応

## 使用例

### 基本的な一覧表示
```bash
poppobuilder list
poppobuilder ls  # 同じ
```

### フィルタリング
```bash
# 有効なプロジェクトのみ
poppobuilder list --enabled

# 特定タグのプロジェクト
poppobuilder list --tag web

# 無効なプロジェクト
poppobuilder list --disabled
```

### ソート
```bash
# 優先度順
poppobuilder list --sort priority

# 最近のアクティビティ順
poppobuilder list --sort activity

# 作成日順
poppobuilder list --sort created
```

### 出力形式
```bash
# テーブル形式（詳細情報付き）
poppobuilder ls --table --verbose

# JSON出力（スクリプト処理用）
poppobuilder list --json

# 最小限の出力
poppobuilder list --quiet
```

### 複合条件
```bash
# 有効なWebプロジェクトを優先度順で表示
poppobuilder list --enabled --tag web --sort priority

# ステータス情報付きで詳細表示
poppobuilder list --status --verbose --table
```

## 技術的特徴

### モジュラー設計
- 出力形式ごとの独立メソッド（`outputDefault`, `outputTable`, `outputJson`）
- 再利用可能なユーティリティメソッド（`truncatePath`, `sortProjects`）
- 拡張しやすいフィルタリング・ソート機能

### パフォーマンス考慮
- 一度のProjectRegistry読み込みで全機能を提供
- 必要時のみ実行する外部コマンド（Git status等）
- 効率的な文字列処理とフォーマット

### ユーザビリティ
- 直感的なカラーコーディング（緑＝有効、赤＝無効、黄＝警告）
- 情報密度の調整（デフォルト/詳細/最小限）
- 一貫したメッセージとヘルプ表示

## テスト結果

```
ListCommand
  execute
    ✔ should handle empty project list
  sortProjects
    ✔ should sort by name by default
    ✔ should sort by priority descending
    ✔ should sort by creation date descending
    ✔ should sort by last activity descending
  buildTableRow
    ✔ should build correct table row for project
    ✔ should include verbose information in table row
  truncatePath
    ✔ should not truncate short paths
    ✔ should truncate long paths appropriately
    ✔ should preserve important path parts
  calculateColumnWidths
    ✔ should calculate appropriate column widths
    ✔ should respect maximum width limits
  integration features
    ✔ should have all required methods
    ✔ should handle various options combinations

14 passing (104ms)
```

## 依存関係

この実装は以下のコンポーネントに依存しています：
- **Issue #150**: ProjectRegistry - プロジェクト情報の取得
- **Issue #149**: GlobalConfigManager - 設定管理（間接的）
- i18n システム - 国際化対応
- colors モジュール - カラー表示

## 今後の展開

このlistコマンドの実装により、以下の機能への基盤が整いました：
- **Issue #160**: デーモンAPIサーバー - 実行時ステータスのリアルタイム取得
- **Issue #157**: グローバルプロセスプールマネージャー - リソース使用状況の表示
- ダッシュボード統合 - Web UIでのプロジェクト一覧表示

## ファイル一覧

- `lib/commands/list.js` - メインのListCommandクラス
- `bin/poppobuilder.js` - CLIコマンド統合（listとlsエイリアス）
- `test/list-command.test.js` - テストスイート
- `docs/implementation-history/issues/issue-153-list-command.md` - 実装ドキュメント

## 破壊的変更

- 新機能のため、既存機能への影響なし
- 既存のCLIコマンドとの完全な互換性維持