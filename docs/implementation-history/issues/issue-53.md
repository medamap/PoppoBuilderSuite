# Issue #53: マルチプロジェクト対応

## 概要
マルチプロジェクト対応の実装。複数リポジトリの並列処理、グローバルキュー管理、プロジェクト間優先度設定を実装。

## 実装日
2025年6月17日

## 実装内容

### 1. プロジェクト管理システム
`src/project-manager.js`：
- 複数プロジェクトの登録・管理
- プロジェクトごとの設定管理
- アクティブ/非アクティブ状態制御
- プロジェクト間の依存関係管理

### 2. グローバルタスクキュー
`src/global-task-queue.js`：
- 全プロジェクトのタスクを統一管理
- プロジェクト優先度による順序制御
- 並列実行数の制御
- リソース配分の最適化

### 3. マルチリポジトリスキャナー
`src/multi-repo-scanner.js`：
- 複数リポジトリの並列スキャン
- 効率的なAPI利用
- 差分検出による高速化
- エラー時の個別リトライ

### 4. プロジェクト設定
`.poppo/projects.yaml`：
```yaml
projects:
  poppo-builder-suite:
    repository: medamap/PoppoBuilderSuite
    priority: 100
    enabled: true
    labels:
      - task:misc
      - task:dogfooding
    settings:
      pollingInterval: 30000
      maxConcurrent: 3
      
  sub-project-1:
    repository: org/SubProject1
    priority: 50
    enabled: true
    labels:
      - enhancement
      - bug
    settings:
      pollingInterval: 60000
      maxConcurrent: 2
      
  experimental-project:
    repository: org/Experimental
    priority: 10
    enabled: false
    labels:
      - experiment
    settings:
      pollingInterval: 300000
      maxConcurrent: 1

globalSettings:
  maxTotalConcurrent: 5
  resourceAllocation:
    high: 50%     # 優先度80以上
    medium: 30%   # 優先度40-79
    low: 20%      # 優先度39以下
```

### 5. リソース管理
`src/resource-allocator.js`：
- CPU/メモリ使用率の監視
- プロジェクト別リソース割り当て
- 動的なリソース調整
- オーバーロード防止

## 機能の詳細

### プロジェクト優先度システム
```javascript
// 優先度計算
総合優先度 = プロジェクト優先度 × タスク優先度 / 100

// 例：
// プロジェクト優先度: 100, タスク優先度: 50
// → 総合優先度: 50

// プロジェクト優先度: 50, タスク優先度: 100
// → 総合優先度: 50
```

### 並列実行制御
- グローバル最大並列数: 5
- プロジェクトごとの最大並列数
- リソース使用率による動的調整
- 優先度による実行順序制御

### エラーハンドリング
- プロジェクト単位でのエラー分離
- 他プロジェクトへの影響を防止
- プロジェクト別のリトライ設定
- 障害プロジェクトの自動無効化

## CLIツール拡張
```bash
# プロジェクト管理コマンド
npm run project add <repo> <priority>    # プロジェクト追加
npm run project list                     # プロジェクト一覧
npm run project enable <name>            # プロジェクト有効化
npm run project disable <name>           # プロジェクト無効化
npm run project stats                    # 統計情報表示

# グローバルキュー管理
npm run queue status                     # キュー状態表示
npm run queue clear <project>            # プロジェクトキュークリア
npm run queue pause <project>            # プロジェクト一時停止
```

## ダッシュボード拡張
`dashboard/client/multi-project.html`：
- マルチプロジェクトビュー
- プロジェクト別統計
- リアルタイムキュー表示
- リソース使用状況

## テスト結果
`test/test-multi-project.js`：
- ✅ 複数プロジェクトの同時処理
- ✅ 優先度による順序制御
- ✅ リソース制限の遵守
- ✅ エラー時の分離処理
- ✅ 動的なプロジェクト追加/削除

## 使用例

### 3つのプロジェクトを管理
```yaml
# メインプロジェクト（最優先）
PoppoBuilderSuite: 優先度100, 最大3並列

# サブプロジェクト（中優先度）
SubSystemA: 優先度50, 最大2並列

# 実験プロジェクト（低優先度）
ExperimentalFeatures: 優先度10, 最大1並列
```

### 実行フロー
1. 全プロジェクトをスキャン（並列）
2. タスクをグローバルキューに追加
3. 優先度順に処理
4. リソース制限内で並列実行

## 成果
- 複数プロジェクトの効率的な管理
- リソースの最適配分
- 重要プロジェクトの優先処理
- スケーラブルなアーキテクチャ

## 技術的なポイント

### パフォーマンス
- 非同期処理による高速化
- キャッシュによるAPI呼び出し削減
- 差分検出による効率化

### 信頼性
- プロジェクト間の分離
- 障害の局所化
- 自動リカバリー機能

### 拡張性
- プロジェクトの動的追加
- カスタム優先度ロジック
- プラグイン対応

## 設定例
`config/config.json`：
```json
"multiProject": {
  "enabled": true,
  "configFile": ".poppo/projects.yaml",
  "globalMaxConcurrent": 5,
  "scanInterval": 30000,
  "resourceMonitoring": true
}
```

## 今後の拡張予定
- プロジェクト間依存関係の処理
- 組織レベルの統計分析
- クロスプロジェクト検索
- プロジェクトテンプレート機能

## 関連ファイル
- **プロジェクト管理**: `src/project-manager.js`
- **グローバルキュー**: `src/global-task-queue.js`
- **マルチリポスキャナー**: `src/multi-repo-scanner.js`
- **リソース管理**: `src/resource-allocator.js`
- **設定ファイル**: `.poppo/projects.yaml`
- **テストコード**: `test/test-multi-project.js`

## 関連Issue
- Issue #24: レート制限対応（マルチプロジェクトでの考慮）
- Issue #26: 動的タイムアウト制御（プロジェクト別設定）