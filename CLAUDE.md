# PoppoBuilder Suite - セッション継続用ガイド

## 🎭 システムファミリー

PoppoBuilder Suiteは以下の協調システムで構成されています：

- **PoppoBuilder（ぽっぽちゃん）** 🚂 - メインの自動タスク処理システム
- **MedamaRepair（目玉さん）** 👁️ - PoppoBuilderの監視・自動修復システム（15分ごとに監視、v3.0.0）
- **MeraCleaner（メラさん）** 🔥 - エラーコメント分析・整理システム（30分ごとに実行）
- **MirinOrphanManager（ミリンちゃん）** 🎋 - 孤児Issue検出・管理システム（毎時3分・33分に実行）
- **CCLAエージェント（クララちゃん）** 🤖 - エラーログ収集・自動修復エージェント（5分ごとに監視）
- **CCAGエージェント（カグラちゃん）** 📝 - ドキュメント生成・多言語対応エージェント
- **CCPMエージェント（ドレミちゃん）** 🔍 - コードレビュー・リファクタリング提案エージェント
- **CCQAエージェント（キューちゃん）** 🔍 - コード品質保証・テスト実行エージェント
- **CCRAエージェント（ランちゃん）** 📋 - コードレビュー自動化エージェント
- **CCTAエージェント（クーちゃん）** 🧪 - テスト自動実行・品質保証エージェント（実装中）
- **CCSPエージェント（パイちゃん）** 🥧 - Claude Code呼び出し専任エージェント（計画中）

## 🚀 現在の実装状況

### ✅ 実装済み機能
- **基本機能**: Issue自動処理、独立プロセス管理、コメント対応、Dogfooding、多言語対応
- **高度な機能**: ダッシュボード、レート制限、動的タイムアウト、エラーログ収集、トレーサビリティ、通知
- **運用機能**: マルチプロジェクト対応、認証機能、整合性監査

### 📁 重要なファイル
- `src/minimal-poppo.js` - メイン処理
- `src/independent-process-manager.js` - 独立プロセス管理
- `config/config.json` - システム設定
- `.poppo/config.json` - 言語設定（ja/en）

## 📚 詳細な実装履歴

実装の詳細履歴は以下のドキュメントを参照：

- [Phase 1: 基本実装履歴](docs/implementation-history/phase1-basic.md)
- [Phase 2: 高度な実装履歴](docs/implementation-history/phase2-advanced.md)
- [Issue実装履歴一覧](docs/implementation-history/issues/README.md)

## 🔍 セッション開始時の確認手順

### 1. 現状確認（必須）
```bash
# 現在のディレクトリ確認
pwd
# /Volumes/PoppoSSD2T/Projects/ClaudeCodeProjects/AIBuildSystem/PoppoBuilderSuite

# PoppoBuilderプロセス確認
ps aux | grep PoppoBuilder

# 実行中タスク確認
cat logs/running-tasks.json

# 最新ログ確認
tail -20 logs/poppo-$(date +%Y-%m-%d).log
```

### 2. 最新のIssue状況確認
```bash
gh issue list --repo medamap/PoppoBuilderSuite --state open
```

### 3. エラーログ確認
```bash
# エラーがないかチェック
grep ERROR logs/poppo-$(date +%Y-%m-%d).log | tail -10
```

## 🛠️ よく使うコマンド

### 基本操作
```bash
# PoppoBuilder起動
npm start

# エージェントモードで起動
npm run start:agents

# ダッシュボード確認
npm run dashboard

# プロセスモニター (NEW!)
npm run poppo:status        # 実行中のプロセス一覧
npm run poppo:help          # ヘルプ表示
poppo status --json         # JSON形式で出力
poppo kill <task-id>        # タスクを停止
poppo logs <task-id>        # タスクのログ表示
poppo logs <task-id> -f     # リアルタイムログ追跡
```

### デバッグ
```bash
# 詳細ログ有効化
DEBUG=* npm start

# テスト実行
npm test
```

### Git操作
```bash
# 現在のブランチ確認
git branch

# コミット（Claude Code署名付き）
git commit -m "メッセージ

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

## ⚠️ 注意事項

1. **最大プロセス数エラー**: 容量制限時はGitHubコメント投稿をスキップ
2. **レート制限**: 自動的に待機して再試行
3. **言語設定**: `.poppo/config.json`で`ja`/`en`を切り替え
4. **認証**: ダッシュボードのデフォルトパスワードは必ず変更

## 🔗 関連ドキュメント

- [README.md](README.md) - プロジェクト概要
- [インストールガイド](docs/INSTALL.md)
- [アーキテクチャ概要](docs/architecture/system-overview.md)
- [トラブルシューティング](docs/INSTALL.md#トラブルシューティング)

## 📋 最近のdogfooding Issue実装状況 (2025/6/18)

### Issue #63: プロセス管理ダッシュボードのログ検索・フィルタ機能実装 ✅
**実装完了**: 設計書に基づいてPhase 3のログ検索・フィルタ機能を実装しました。

**実装内容**:
- **ログ検索API** (`dashboard/server/api/logs.js`)
  - キーワード、日時範囲、レベル、プロセスID、Issue番号での検索
  - ログファイル一覧取得
  - ログ統計情報の取得
  - CSV/JSON形式でのエクスポート機能
- **フロントエンドUI** 
  - 検索フォーム（キーワード、レベル、Issue番号、日時範囲）
  - 検索結果の表示（ページネーション対応）
  - リアルタイムフィルタリング機能
  - エクスポートボタン（CSV/JSON選択可能）
- **テスト** (`test/dashboard-log-search.test.js`)
  - 12個のユニットテストを作成し、全て合格

**使用方法**:
1. ダッシュボードを起動: `npm run dashboard`
2. ログ検索セクションで条件を入力して検索
3. 結果をCSVまたはJSON形式でエクスポート可能

### Issue #64: PoppoBuilder設定の階層管理機能の完全実装 ✅
**実装完了**: 設計書に基づいて完全な階層設定管理システムを実装しました。

**実装内容**:
1. **システムデフォルト設定** (`config/defaults.json`)
   - 全設定項目のデフォルト値を定義
   
2. **環境変数による設定上書き** (`POPPO_*`)
   - 環境変数の自動検出と型変換（真偽値、数値、JSON）
   - ネストされた設定への対応（例: `POPPO_LANGUAGE_PRIMARY`）
   
3. **設定の完全な階層管理** (`src/config-loader.js`)
   - 優先順位: 環境変数 > プロジェクト > グローバル > システムデフォルト
   - 深いマージ処理で設定を統合
   
4. **設定バリデーション機能**
   - 必須項目チェック（`language.primary`）
   - 値の範囲チェック（`claude.maxConcurrent`: 1-10）
   - 妥当性検証（タイムアウト値の整合性など）
   
5. **設定管理CLI** (`scripts/poppo-config.js`)
   - `npm run config:show` - 現在の設定表示
   - `npm run config:hierarchy` - 階層情報表示
   - `npm run config:validate` - バリデーション実行
   - `npm run config:env` - 環境変数一覧
   - `npm run config get/set` - 設定の取得/更新
   
6. **ドキュメント** (`docs/config-management.md`)
   - 詳細な使用方法とベストプラクティス

**テスト方法**:
```bash
# 設定階層の確認
npm run config:hierarchy

# 環境変数での上書きテスト
export POPPO_LANGUAGE_PRIMARY=en
export POPPO_CLAUDE_MAXCONCURRENT=3
npm run config:show

# テストコード実行
node test/test-config-loader.js
```

### Issue #65: CLIベースのプロセスモニター実装 ✅
**実装完了**: PoppoBuilderのCLIコマンドとしてプロセス管理機能を実装しました。

**実装内容**:
1. **CLIスクリプト** (`scripts/poppo-process.js`)
   - `poppo status` - 実行中のプロセス一覧表示（メモリ使用量、実行時間付き）
   - `poppo kill <task-id>` - タスクの安全な停止（確認プロンプト、強制終了オプション）
   - `poppo logs <task-id>` - タスク別ログ表示（リアルタイム追跡、レベルフィルタ）
   
2. **機能詳細**:
   - プロセス情報の取得（PID、メモリ、状態）
   - カラー出力対応（エラー=赤、警告=黄、情報=緑）
   - JSON出力オプション（`--json`）
   - ログのリアルタイム追跡（`-f`オプション）
   - ログレベルフィルタ（`-l error/warn/info`）
   
3. **統合**:
   - package.jsonにbinフィールド追加（グローバルインストール対応）
   - npm scriptsで簡単実行（`npm run poppo:status`）
   
4. **テスト** (`test/poppo-process-cli.test.js`)
   - 25個のユニットテストを作成し、全て合格

**使用方法**:
```bash
# プロセス状態確認
npm run poppo:status
poppo status --json

# タスクの停止
poppo kill issue-65 -f    # 強制停止

# ログ表示
poppo logs issue-65        # 静的表示
poppo logs issue-65 -f     # リアルタイム追跡
poppo logs issue-65 -l error -n 50  # エラーのみ50行まで
```

### Issue #66: プロセス実行履歴の保存とパフォーマンス分析機能 ✅
**実装完了**: SQLiteデータベースを使用した実行履歴の永続化とパフォーマンス分析機能を実装しました。

**実装内容**:
1. **データベース管理** (`src/database-manager.js`)
   - SQLiteによる実行履歴の永続保存
   - プロセス開始/終了時刻、実行時間、結果の記録
   - メモリ使用量、CPU使用率の記録（将来拡張可能）
   - エラー情報とスタックトレースの保存

2. **パフォーマンス分析API** (`dashboard/server/api/analytics.js`)
   - `/api/analytics/history` - 実行履歴の取得（フィルタ、ページネーション対応）
   - `/api/analytics/statistics/:taskType` - タスクタイプ別統計
   - `/api/analytics/trends/:taskType` - パフォーマンストレンド
   - `/api/analytics/export` - CSV/JSON形式でのエクスポート
   - `/api/analytics/summary/generate` - レポート生成
   - `/api/analytics/archive` - 古いデータのアーカイブ

3. **ダッシュボードUI** 
   - 統計情報タブ（成功率、平均実行時間、リソース使用量）
   - トレンドグラフ（Chart.js使用）
   - 実行履歴一覧（フィルタリング、ソート機能）
   - エクスポート機能

4. **CLIツール** (`scripts/poppo-analytics.js`)
   - `npm run analytics:report` - レポート生成
   - `npm run analytics:stats claude-cli` - 統計表示
   - `npm run analytics:archive` - データアーカイブ

5. **テスト** (`test/database-manager.test.js`)
   - 13個のユニットテストを作成し、全て合格

**使用方法**:
```bash
# レポート生成
npm run analytics:report daily

# 統計情報表示
npm run analytics:stats claude-cli

# データアーカイブ（30日以上前のデータ）
npm run analytics:archive 30

# ダッシュボードで確認
npm run dashboard
# → パフォーマンス分析タブで視覚的に確認可能
```

### Issue #85: セキュリティ強化 - エージェント間認証機能の実装 ✅
**実装完了**: JWT認証とRBACを使用したエージェント間認証機能を実装しました。

**実装内容**:
1. **JWT認証システム** (`src/security/jwt-auth.js`)
   - JWTトークンの生成・検証
   - アクセストークン（15分）とリフレッシュトークン（7日）
   - APIキーの管理とbcryptハッシュ化
   - 自動トークンローテーション機能

2. **ロールベースアクセス制御（RBAC）** (`src/security/rbac.js`)
   - 8つのデフォルトロール（coordinator、monitor、error-handler等）
   - リソース・アクション形式の権限管理（例: `system.monitor`）
   - ワイルドカード権限のサポート（`*`、`system.*`）
   - 動的な権限チェック機能

3. **監査ログシステム** (`src/security/audit-logger.js`)
   - SQLiteによる監査ログの永続保存
   - 認証試行、アクセスログ、エラーの記録
   - セキュリティアラートの自動生成
   - ブルートフォース攻撃検知（5分間に5回失敗）
   - ログの整合性チェック（SHA256チェックサム）

4. **統合ミドルウェア** (`src/security/auth-middleware.js`)
   - Express.js用認証ミドルウェア
   - ファイルベースメッセージ用認証機能
   - トークンリフレッシュ機能
   - セキュリティメトリクスの収集

5. **セキュアエージェント基盤** (`agents/shared/secure-agent-base.js`)
   - AgentBaseを拡張したセキュア版
   - 自動認証とトークン管理
   - 権限ベースのタスク実行
   - APIキーローテーション機能

6. **セキュリティ設定** (`src/security/security-config.js`)
   - 包括的なセキュリティポリシー管理
   - レート制限、CORS、セキュリティヘッダー設定
   - コンプライアンス対応（データ保護、ログマスキング）

7. **初期化スクリプト** (`scripts/init-agent-security.js`)
   - セキュリティ環境の自動セットアップ
   - 各エージェントのAPIキー生成
   - 環境変数設定の出力

8. **テストコード**
   - `test/security/jwt-auth.test.js` - JWT認証のテスト（12テスト）
   - `test/security/rbac.test.js` - RBACのテスト（13テスト）
   - `test/security/auth-middleware.test.js` - 統合テスト（15テスト）

**使用方法**:
```bash
# セキュリティ初期化（初回のみ）
node scripts/init-agent-security.js

# 環境変数の設定
export POPPO_BUILDER_API_KEY="生成されたAPIキー"

# セキュアモードでエージェント起動
npm run start:agents

# セキュリティレポート確認
node scripts/security-report.js
```

**セキュリティ機能**:
- JWT認証による不正アクセス防止
- ロールベースの細かい権限制御
- 監査ログによる完全な追跡可能性
- 自動セキュリティアラート
- APIキーの定期ローテーション（90日）

### Issue #87: システムヘルスチェックの高度化 ✅
**実装完了**: 2025/6/18に実装完了。PoppoBuilder Suiteのシステム健全性を包括的に監視し、問題を早期に検出・対処するための高度なヘルスチェック機能を実装しました。

**実装内容**:
1. **HealthCheckManager** (`src/health-check-manager.js`)
   - 各モニターの統合管理とスコアリング
   - 総合健全性スコアの算出（重み付け計算）
   - ヘルスチェックAPIの提供
   - 自動回復の制御
   - 状態変化の検出とアラート送信

2. **Health Monitors**
   - **ApplicationMonitor** (`src/monitors/application-monitor.js`)
     - エージェントの応答性チェック（ハートビートファイル監視）
     - プロセス生存確認とメモリ使用量監視
     - タスクキューの監視（サイズ、古いタスク）
   - **SystemMonitor** (`src/monitors/system-monitor.js`)
     - CPU使用率、メモリ使用率の監視
     - ディスク容量チェック
     - ロードアベレージ監視
   - **NetworkMonitor** (`src/monitors/network-monitor.js`)
     - GitHub API、Claude API接続性チェック
     - レスポンスタイム測定
     - エラー率の追跡
   - **DataMonitor** (`src/monitors/data-monitor.js`)
     - SQLiteデータベース整合性チェック
     - 設定ファイルの妥当性検証
     - ログファイルの破損チェック

3. **MetricsStore** (`src/health-metrics-store.js`)
   - メトリクスの時系列保存（最大1440レコード）
   - トレンド分析（線形回帰、変動性計算）
   - 統計サマリー生成
   - データクリーンアップ機能

4. **RecoveryManager** (`src/recovery-manager.js`)
   - 自動回復アクションの実行
   - メモリクリーンアップ（GC実行、古いログ削除）
   - プロセス再起動
   - ディスククリーンアップ（アーカイブ、VACUUM）
   - API接続リセット
   - クールダウン管理

5. **AlertManager** (`src/alert-manager.js`)
   - アラートルールの管理
   - 通知の送信（NotificationManager統合）
   - アラートの集約とスロットリング
   - エスカレーション管理（severity別チャンネル）

6. **HealthAPI** (`dashboard/server/api/health.js`)
   - `/api/health` - 基本的な生存確認
   - `/api/health/detailed` - 詳細な状態情報
   - `/api/health/ready` - 準備完了状態
   - `/api/health/metrics` - Prometheus形式メトリクス
   - `/api/health/diagnostic` - 診断レポート
   - `/api/health/history` - メトリクス履歴
   - `/api/health/trends` - トレンド分析

7. **CLIツール** (`scripts/poppo-health.js`)
   - `poppo-health check` - 現在の健全性チェック
   - `poppo-health report` - 診断レポート生成
   - `poppo-health history` - 履歴表示（グラフ表示対応）
   - `poppo-health trends` - トレンド分析
   - `poppo-health ready` - 準備状態チェック

8. **設定** (`config/config.json`)
   ```json
   {
     "healthCheck": {
       "enabled": true,
       "interval": 60000,
       "scoring": {
         "weights": {
           "application": 0.4,
           "system": 0.3,
           "network": 0.2,
           "data": 0.1
         }
       },
       "thresholds": {
         "healthy": 80,
         "degraded": 60
       },
       "autoRecovery": {
         "enabled": true,
         "actions": {
           "memoryCleanup": true,
           "processRestart": true,
           "diskCleanup": true,
           "apiRetry": true
         }
       },
       "alerts": {
         "enabled": true,
         "channels": ["log"],
         "throttle": 300000
       }
     }
   }
   ```

9. **統合**
   - `minimal-poppo.js`: HealthCheckManagerの初期化と開始
   - `dashboard/server/index.js`: HealthAPIの統合
   - `package.json`: ヘルスチェックスクリプト追加

10. **テスト** (`test/health-check.test.js`)
    - HealthCheckManager、各モニター、MetricsStore、RecoveryManager、AlertManagerの単体テスト
    - エンドツーエンドの統合テスト

**使用方法**:
```bash
# ヘルスチェック実行
npm run health:check        # 簡易表示
npm run health:check -- -d  # 詳細表示

# 診断レポート生成
npm run health:report
npm run health:report -- -s report.json  # ファイル保存

# 履歴とトレンド
npm run health:history
npm run health:history -- -g  # グラフ表示
poppo-health trends

# Prometheusメトリクス
curl http://localhost:3001/api/health/metrics

# 準備状態チェック（CI/CD用）
poppo-health ready
```

**特徴**:
- **多層的な監視**: アプリケーション、システム、ネットワーク、データの4層監視
- **予測的分析**: トレンド分析による問題の早期発見
- **自動回復**: 検出された問題に対する自動対処
- **柔軟なアラート**: 重要度別、スロットリング、集約機能
- **統合性**: 既存システムとの完全な統合
- **可視化**: CLIグラフとダッシュボード統合

### Issue #77: CPU使用量モニタリング機能の実装 ✅
**実装完了**: 2025/6/18に実装完了。プロセス状態管理にCPU使用量のモニタリング機能を追加しました。

**実装内容**:
1. **ProcessStateManagerの拡張** (`src/process-state-manager.js`)
   - `getProcessCpuUsage()` - プロセスごとのCPU使用率を取得
   - `getNodeProcessCpuUsage()` - Node.jsプロセスのCPU使用率をprocess.cpuUsage()で計算
   - `getProcessStats()` - プロセス統計情報に最新のCPU使用率を含める
   - `collectMetrics()` - CPU使用率を定期的に収集してデータベースに記録

2. **クロスプラットフォーム対応**
   - **macOS/Linux**: `ps -p PID -o %cpu`コマンドを使用
   - **Windows**: `wmic`またはPowerShellを使用してCPU情報を取得
   - **Node.jsプロセス**: process.cpuUsage()を使用して正確な計測

3. **パフォーマンス最適化**
   - CPU測定値のキャッシュ機構（lastCpuMeasurement）
   - 5秒間隔でのメトリクス収集
   - マルチコアCPUへの対応（CPU使用率の正規化）

4. **poppo-process.jsの更新** (`scripts/poppo-process.js`)
   - プロセス情報に「CPU」列を追加
   - `getProcessInfo()`関数でCPU使用率も取得
   - JSON出力に`cpu`フィールドを含める

5. **ダッシュボード統合**
   - 既存のダッシュボードUIにはCPU使用率表示済み
   - process-state-managerから実際の値が提供されるように

6. **テスト** (`test/cpu-monitoring.test.js`)
   - CPU使用率取得機能の単体テスト
   - クロスプラットフォームテスト
   - パフォーマンステスト
   - 10個のテストがすべて成功

**使用方法**:
```bash
# プロセス状態とCPU使用率を表示
npm run poppo:status

# JSON形式で取得（cpuフィールドを含む）
node scripts/poppo-process.js status --json

# ダッシュボードで確認
npm run dashboard
```

**技術的特徴**:
- Node.jsのprocess.cpuUsage()を活用した正確な測定
- 外部コマンドとの併用による子プロセスの監視
- プラットフォームごとの最適な実装
- キャッシュ機構によるパフォーマンス最適化

### Issue #79: CCQA (Code Change Quality Assurance) エージェントの実装 ✅
**実装完了**: 2025/6/18に実装完了。コード変更の品質保証を担当する新しいエージェント「CCQA」を実装しました。

**実装内容**:
1. **メインエージェントクラス** (`agents/ccqa/index.js`)
   - AgentBaseを継承したCCQAAgentクラス
   - 各モジュールの統合と品質スコア算出
   - タスク処理と結果の統合
   - GitHub APIとの連携

2. **テスト実行モジュール** (`agents/ccqa/test-runner.js`)
   - Jest、Mocha等のテストランナー自動検出
   - テストカバレッジの計測と詳細レポート
   - 失敗したテストの分析
   - 影響を受けるテストの特定機能

3. **コード品質チェックモジュール** (`agents/ccqa/quality-checker.js`)
   - ESLintによるリンティング（設定ファイル自動検出）
   - Prettierによるフォーマットチェック
   - サイクロマティック複雑度の計算
   - コード重複の検出（10行以上のブロック）
   - コーディング規約チェック（命名規則、ファイル長）

4. **セキュリティ検査モジュール** (`agents/ccqa/security-scanner.js`)
   - npm auditによる依存関係の脆弱性スキャン
   - ハードコードされた認証情報の検出（APIキー、パスワード、トークン等）
   - OWASP Top 10に基づく脆弱性パターン検出
   - HTTPSチェックと過度な権限の検出
   - セキュリティスコアの算出と推奨事項

5. **パフォーマンス分析モジュール** (`agents/ccqa/performance-analyzer.js`)
   - 関数の実行時間推定（複雑度ベース）
   - メモリリークパターンの検出
   - バンドルサイズの分析（webpack stats.json対応）
   - パフォーマンス回帰の検出（前回との比較）
   - ベンチマーク結果の保存と履歴管理

6. **レポート生成モジュール** (`agents/ccqa/report-generator.js`)
   - 総合品質スコア（0-100）の算出
   - Markdownフォーマットの人間が読みやすいレポート
   - JSON形式の構造化レポート
   - 詳細な推奨事項の生成（優先度付き）

7. **PoppoBuilderとの統合**
   - `agents/core/agent-coordinator.js`: CCQAエージェントの設定追加
   - `src/agent-integration.js`: quality-assuranceタスクタイプの追加
   - `src/minimal-poppo.js`: task:qualityラベルのサポート
   - `scripts/start-ccqa.js`: スタンドアロン起動スクリプト

8. **テストコード** (`test/ccqa-agent.test.js`)
   - CCQAエージェントの単体テスト
   - 各モジュールの個別テスト
   - 品質スコア計算のテスト
   - 40個以上のテストケース

9. **ドキュメント** (`docs/agents/ccqa-agent.md`)
   - 機能概要と使用方法
   - 設定オプションの詳細
   - 出力例とトラブルシューティング
   - 拡張方法のガイド

**使用方法**:
```bash
# スタンドアロンで起動
node scripts/start-ccqa.js

# PoppoBuilderのIssueで使用
# task:quality, test, qa ラベルを付けるか
# "品質", "quality", "テスト", "test" キーワードを含める

# 環境変数での設定
export CCQA_COVERAGE_THRESHOLD=85
export CCQA_SECURITY_LEVEL=high
```

**品質スコアの構成**:
- テスト結果: 30%
- コード品質: 30%
- セキュリティ: 25%
- パフォーマンス: 15%

**技術的特徴**:
- モジュラーな設計で各機能を独立実装
- 複数のツールを統合した包括的な品質チェック
- クロスプラットフォーム対応
- 拡張可能なアーキテクチャ

### Issue #89: CCRA (Code Change Review Agent) の実装 ✅
**実装完了**: 2025/6/19に実装完了。PRレビューの自動化、コード品質チェック、フィードバック生成を行うCCRAエージェントを実装しました。

**実装内容**:
1. **CCRAエージェント** (`agents/ccra/index.js`)
   - AgentBaseを継承したメインエージェントクラス
   - 5分ごとのPR監視と自動レビュー
   - 優先度ベースのレビュー順序制御
   - GitHubクライアントの統合

2. **PR分析モジュール** (`agents/ccra/pr-analyzer.js`)
   - PR詳細情報の取得と分析
   - ファイルカテゴリ分類（source/test/config/doc/dependency）
   - 使用言語の検出と統計
   - インサイト生成（大規模変更、マージコンフリクト等）

3. **コード品質チェッカー** (`agents/ccra/code-quality-checker.js`)
   - 複雑度チェック（ネスト深さ、条件文）
   - コード重複検出（3行以上の類似ブロック）
   - スタイルチェック（行長、インデント、末尾空白）
   - ベストプラクティス（var使用、==演算子、空catch等）

4. **セキュリティスキャナー** (`agents/ccra/security-scanner.js`)
   - ハードコード認証情報の検出（APIキー、パスワード、トークン）
   - 脆弱性パターン検出（SQLインジェクション、XSS、eval使用）
   - 安全でない設定の検出（HTTP、過度な権限、CORS）
   - 依存関係の脆弱性チェック

5. **レビュー生成モジュール** (`agents/ccra/review-generator.js`)
   - Claude APIを使用した自然なレビューコメント生成
   - フォールバックテンプレートベースレビュー
   - インラインコメントとサマリーの生成
   - レビューイベントの決定（APPROVE/COMMENT/REQUEST_CHANGES）

6. **GitHub API拡張** (`src/github-client.js`)
   - PR関連メソッドの追加（listPullRequests、getPullRequest等）
   - レビューコメント作成機能
   - ステータスチェック更新機能

7. **統合とテスト**
   - agent-coordinatorへのCCRA追加
   - agent-integrationへのタスクマッピング追加
   - 包括的なテストスイート (`test/ccra-agent.test.js`)
   - ドキュメント (`docs/agents/ccra-agent.md`)

**使用方法**:
```bash
# スタンドアロン起動
npm run ccra:start

# 環境変数設定
export GITHUB_TOKEN=your_token
export CCRA_CHECK_INTERVAL=300000  # 5分
export CCRA_MAX_COMPLEXITY=10
```

**技術的特徴**:
- 優先度ベースのPRレビュー（urgent/hotfix/security/PR年齢）
- 包括的なコード分析（品質、セキュリティ、ベストプラクティス）
- 自然言語処理によるレビューコメント生成
- モジュラー設計による拡張性

### Issue #93: Claude Codeの2段階処理システムの実装 ✅
**実装完了**: 2025/6/18に実装完了。Claude Codeに指示を与える際の2段階処理システムを実装し、Issueのラベル付与を確実に行えるようにしました。

**実装内容**:
1. **InstructionAnalyzer** (`src/instruction-analyzer.js`)
   - 指示内容を分析してアクションを決定するクラス
   - Claude APIを使用して自然言語処理
   - JSON形式での分析結果出力
   - デフォルトラベルの自動適用機能

2. **TwoStageProcessor** (`src/two-stage-processor.js`)
   - 2段階処理のメインロジック
   - 第1段階: 指示内容の分析（create_issue/execute_code/unknown）
   - 第2段階: 決定されたアクションの実行
   - 信頼度に基づく処理の分岐
   - タイムアウト処理とエラーハンドリング

3. **分析プロンプトテンプレート** (`prompts/analysis-prompt.md`)
   - 指示内容を分析するためのプロンプト
   - Issue作成/コード実行の判定基準
   - ラベル付与ルール（task:*, priority:*）
   - JSON出力形式の定義

4. **設定追加** (`config/config.json`)
   ```json
   "twoStageProcessing": {
     "enabled": true,
     "confidenceThreshold": 0.7,
     "analyzeTimeout": 30000,
     "createIssueLabels": {
       "default": ["task:misc"],
       "keywords": {
         "dogfooding": ["task:dogfooding"],
         "バグ": ["task:bug"],
         "機能": ["task:feature"],
         "ドキュメント": ["task:documentation"]
       }
     }
   }
   ```

5. **minimal-poppo.jsへの統合**
   - Issue処理時に2段階処理を実行
   - Issue作成アクションの自動実行
   - 元のIssueへの結果報告

6. **テストコード** (`test/two-stage-processor.test.js`)
   - InstructionAnalyzerの単体テスト
   - TwoStageProcessorの統合テスト
   - 15個のテストケース

**使用方法**:
- PoppoBuilderがIssueを処理する際に自動的に動作
- 「Issue作成」「新しいタスクを登録」などの指示を検出
- 確実にラベルを付与してIssueを作成

**技術的特徴**:
- 信頼度ベースの処理分岐（閾値: 0.7）
- タイムアウト処理（30秒）
- 拡張可能なアクション（将来的にcreate_pr、update_issue等を追加可能）
- キーワードベースのラベル自動判定

### Issue #75: ダッシュボードのプロセス停止API実装 ✅
**実装完了**: 2025/6/18に実装完了。プロセス管理ダッシュボードにプロセス停止機能のAPIを実装しました。

**実装内容**:
1. **ProcessAPI** (`dashboard/server/api/process.js`)
   - 個別プロセス停止API (`/api/process/:taskId/stop`)
   - 全プロセス停止API (`/api/process/stop-all`)
   - 安全なプロセス停止（SIGTERM → SIGKILL）
   - エラーハンドリングとログ記録

2. **ダッシュボード統合**
   - `dashboard/server/index.js`: ProcessAPIの統合とIndependentProcessManager連携
   - `src/minimal-poppo.js`: IndependentProcessManagerをダッシュボードに渡す設定

3. **フロントエンドUI更新** (`dashboard/client/js/app.js`)
   - 停止ボタンのAPIコール実装
   - 強制終了オプションの対話的処理
   - エラーメッセージとステータス更新
   - WebSocket経由のリアルタイム更新

4. **テストコード**
   - `test/process-api.test.js`: APIエンドポイントのテスト
   - `test/process-api-simple.test.js`: ユニットテスト

**使用方法**:
```bash
# ダッシュボードを起動
npm run dashboard

# ブラウザでアクセス
http://localhost:3001

# プロセス管理タブで停止ボタンをクリック
# または全プロセス停止ボタンで一括停止
```

**技術的特徴**:
- IndependentProcessManagerとの完全統合
- 2段階のプロセス終了（SIGTERM → SIGKILL）
- 確認ダイアログによる誤操作防止
- リアルタイムステータス更新

### Issue #81: E2E（エンドツーエンド）テストの実装 ✅
**実装完了**: 2025/6/18に実装完了。PoppoBuilder Suiteの主要機能に対する包括的なE2Eテストを実装しました。

**実装内容**:
1. **テスト環境** (`test/e2e/helpers/test-environment.js`)
   - テスト用の独立した環境のセットアップ
   - 一時ディレクトリとデータベースの管理
   - プロセスの起動と監視
   - 自動クリーンアップ機能

2. **APIモック** (`test/e2e/helpers/api-mocks.js`)
   - GitHub APIの完全なモック
   - Claude APIのモック
   - 動的なレスポンス生成
   - エラーシナリオのシミュレーション

3. **テストシナリオ**
   - **Issue処理フロー** (`scenarios/issue-processing.test.js`)
     - 新規Issue処理、コメント再処理、エラーリトライ
     - レート制限対応、並行処理制御
   - **マルチエージェント連携** (`scenarios/multi-agent-collaboration.test.js`)
     - エージェント間の協調動作
     - メッセージング、循環参照防止
   - **ダッシュボード操作** (`scenarios/dashboard-operations.test.js`)
     - 認証、プロセス制御、ログ検索
     - WebSocketリアルタイム更新
   - **設定管理とリカバリー** (`scenarios/config-and-recovery.test.js`)
     - 動的設定変更、環境変数上書き
     - クラッシュ復旧、データベース修復

4. **E2Eテストランナー** (`test/e2e/index.js`)
   - 統合テストランナー
   - 環境準備とクリーンアップ
   - オプション処理（grep、bail、keep-temp）

5. **CI/CD統合** (`.github/workflows/e2e-tests.yml`)
   - GitHub Actionsワークフロー
   - マトリックステスト（複数Node.jsバージョン）
   - 定期実行とPRトリガー
   - アーティファクトとレポート生成

6. **ドキュメント** (`docs/testing/e2e-testing.md`)
   - 詳細な使用ガイド
   - トラブルシューティング
   - ベストプラクティス

**使用方法**:
```bash
# 全E2Eテスト実行
npm run test:e2e

# 特定のシナリオのみ
npm run test:e2e:grep "Issue処理"

# デバッグモード（tempディレクトリ保持）
npm run test:e2e:debug

# CI/CDでの自動実行
# PRマージ時と毎日定期実行
```

**テスト構成**:
- Mocha + Chai: テスト基盤
- Playwright: ブラウザ自動化
- Supertest: APIテスト
- Nock: HTTPモック

**技術的特徴**:
- 完全な環境分離
- 包括的なモック機能
- 並列実行対応
- CI/CD完全統合

### Issue #82: パフォーマンステストの実装 ✅
**実装完了**: 2025/6/18に実装完了。PoppoBuilder Suiteの性能特性を把握し、ボトルネックを特定するための包括的なパフォーマンステストフレームワークを実装しました。

**実装内容**:
1. **カスタムベンチマークフレームワーク** (`src/performance/benchmark-runner.js`)
   - 高精度な実行時間測定（perf_hooks使用）
   - ウォームアップフェーズ
   - 並行実行サポート
   - メモリ使用量追跡
   - 統計情報の自動計算（P50、P95、P99等）

2. **メトリクス収集システム** (`src/performance/collectors/metrics-collector.js`)
   - システムメトリクス（CPU、メモリ、ディスク）
   - プロセスメトリクス
   - カスタムメトリクス
   - 時系列データ保存

3. **ベンチマークテスト**
   - **スループットテスト** (`test/performance/benchmarks/throughput-benchmark.js`)
     - 単一/並行Issue処理速度
     - Issues/hour測定
     - エージェント別性能
   - **レスポンスタイムテスト** (`test/performance/benchmarks/response-time-benchmark.js`)
     - API応答速度（P50、P95、P99）
     - レイテンシ分析
     - ジッター測定
   - **リソース使用量テスト** (`test/performance/benchmarks/resource-usage-benchmark.js`)
     - CPU/メモリ使用率
     - メモリリーク検出
     - アイドル/負荷時の比較

4. **レポート生成** (`src/performance/report-generator.js`)
   - HTML形式（ビジュアルレポート）
   - Markdown形式（ドキュメント統合）
   - JSON形式（自動処理用）
   - ベースラインとの比較
   - 推奨事項の自動生成

5. **統合テストランナー** (`test/performance/index.js`)
   - 全テストの統合実行
   - クイックモード（高速実行）
   - CLIインターフェース

6. **CI/CD統合** (`.github/workflows/performance-tests.yml`)
   - 定期実行（毎日深夜）
   - PR時の自動実行
   - パフォーマンス劣化検出
   - レポートのアーティファクト保存

**使用方法**:
```bash
# 全パフォーマンステスト実行
npm run test:performance

# 高速モード
npm run test:performance:quick

# 個別テスト
npm run test:performance:throughput
npm run test:performance:response
npm run test:performance:resource

# レポート生成（Markdown）
npm run performance:report

# ベースライン更新
npm run performance:baseline
```

**パフォーマンス目標値**:
- スループット: 1000 Issues/hour以上
- API応答時間 (P95): 200ms以下
- CPU使用率 (平均): 30%以下
- メモリ使用量: 500MB以下
- エラー率: 0.1%以下

**技術的特徴**:
- Node.js組み込みのperf_hooksによる高精度測定
- 統計的な信頼性（ウォームアップ、複数回実行）
- クロスプラットフォーム対応
- 拡張可能なベンチマークフレームワーク

### Issue #76: CCLAエージェントの処理済みログ管理機能実装 ✅
**実装完了**: 2025/6/18に実装完了。CCLAエージェントで処理済みのログファイルを適切に管理する機能を実装しました。

**実装内容**:
1. **LogArchiverクラス** (`agents/ccla/log-archiver.js`)
   - 処理済みログファイルの圧縮・アーカイブ機能
   - 日付別ディレクトリ構造での整理
   - 自動圧縮（gzip形式、圧縮レベル設定可能）
   - メタデータ管理（元ファイル名、サイズ、圧縮率、チェックサム等）
   - 保存期間管理（デフォルト30日）
   - 古いアーカイブの自動削除
   - アーカイブサイズの監視とアラート
   - 検索・復元機能

2. **CCLAエージェントへの統合** (`agents/ccla/index.js`)
   - LogArchiverの初期化とライフサイクル管理
   - `rotateProcessedLogs()`メソッドの実装
   - 定期的なアーカイブローテーション（24時間間隔）
   - シャットダウン時の最終アーカイブ処理

3. **アーカイブ管理API** (`dashboard/server/api/ccla-archives.js`)
   - `/api/ccla-archives/search` - アーカイブ検索
   - `/api/ccla-archives/stats` - 統計情報取得
   - `/api/ccla-archives/restore/:archiveFile` - アーカイブ復元
   - `/api/ccla-archives/archive` - 手動アーカイブ実行
   - `/api/ccla-archives/list` - アーカイブ一覧（ページネーション対応）

4. **設定追加** (`config/config.json`)
   ```json
   "archiving": {
     "enabled": true,
     "archivePath": "data/ccla/archives",
     "retentionDays": 30,
     "compressionLevel": 6,
     "autoCleanup": true,
     "processedLogsPath": "data/ccla/processed",
     "rotationInterval": 86400000,
     "maxArchiveSize": "1GB",
     "alertThreshold": "800MB"
   }
   ```

5. **テストコード** (`test/ccla-log-archiver.test.js`)
   - LogArchiverクラスの包括的なユニットテスト
   - ファイル圧縮・解凍のテスト
   - 自動クリーンアップのテスト
   - サイズ管理機能のテスト
   - 12個のテストケース

**使用方法**:
```bash
# CCLAエージェントの起動（アーカイブ機能有効）
node agents/ccla/index.js

# 手動アーカイブ実行（APIコール）
curl -X POST http://localhost:3001/api/ccla-archives/archive

# アーカイブ統計情報の確認
curl http://localhost:3001/api/ccla-archives/stats

# アーカイブ検索
curl "http://localhost:3001/api/ccla-archives/search?fileName=error-"
```

**技術的特徴**:
- Node.js標準のzlibモジュールを使用した効率的な圧縮
- 非同期処理による高速化
- メタデータによる整合性管理
- 柔軟な検索・復元機能
- 自動クリーンアップによるディスク容量管理

### Issue #78: 設定の動的再読み込み機能の実装 ✅
**実装完了**: 2025/6/18に実装完了。PoppoBuilderの設定を実行中に動的に再読み込みできる機能を実装しました。

**実装内容**:
1. **ConfigWatcherクラス** (`src/config-watcher.js`)
   - 設定ファイルの変更を監視（fs.watch使用）
   - 変更検知のデバウンス処理（500ms）
   - 設定の差分検出と分類
   - ホットリロード可能な設定の自動適用
   - バリデーションとロールバック機能
   - イベントベースの通知システム

2. **設定項目の分類**
   - **即座に反映可能**: logLevel、timeout、maxRetries、レート制限、言語設定等
   - **再起動が必要**: port、workerCount、maxConcurrentTasks、dashboard.port等
   - **部分的な再起動で対応可能**: その他の設定項目

3. **minimal-poppo.jsへの統合**
   - ConfigWatcherの初期化と設定更新ハンドラー
   - `updateHotReloadableConfigs()`関数で各コンポーネントの設定を動的更新
   - 再起動が必要な変更の通知機能

4. **poppo-daemon.jsのSIGHUP対応**
   - `reloadConfig()`メソッドの実装
   - SIGHUPシグナルで設定再読み込みを実行
   - ワーカープロセスへの設定変更通知

5. **CLIコマンド** (`scripts/poppo-reload.js`)
   - `npm run poppo:reload` - 設定再読み込み（SIGHUP送信）
   - `npm run poppo:reload:check` - 設定の検証のみ
   - `npm run poppo:reload:diff` - 現在の設定との差分表示

6. **設定追加** (`config/config.json`)
   ```json
   "configReload": {
     "enabled": true,
     "watchFiles": true,
     "debounceDelay": 500,
     "hotReloadableSettings": [
       "logLevel", "claude.timeout", "claude.maxRetries",
       "rateLimiter", "monitoring", "language", "notification"
     ],
     "restartRequiredSettings": [
       "port", "workerCount", "maxConcurrentTasks", "dashboard.port"
     ]
   }
   ```

7. **テストコード** (`test/config-watcher.test.js`)
   - ConfigWatcherの包括的なユニットテスト
   - 変更検出、分類、イベント処理のテスト
   - 15個のテストケース

**使用方法**:
```bash
# 設定の検証
npm run poppo:reload:check

# 設定の差分確認
npm run poppo:reload:diff

# 設定再読み込み実行
npm run poppo:reload

# 手動でSIGHUPを送信
kill -HUP <PoppoBuilder PID>
```

**技術的特徴**:
- ファイル監視によるリアルタイム検知
- 設定の階層的な差分計算
- 安全なロールバック機能
- ダウンタイムなしの設定更新
- WebSocketによる変更通知

**制限事項**:
- 一部の設定変更は再起動が必要
- 実行中のタスクには即座に反映されない場合がある
- 環境変数の変更は検知できない（手動再読み込みが必要）

### Issue #84: マルチプロジェクト高度管理機能の実装 ✅
**実装完了**: 2025/6/18に実装完了。PoppoBuilderが複数のGitHubプロジェクトを効率的に管理するための高度な機能を実装しました。プロジェクト間の優先度制御、リソース配分、統合ダッシュボードなどを提供します。

**実装内容**:
1. **高度なグローバルキューマネージャー** (`src/advanced-global-queue-manager.js`)
   - 4つのスケジューリングアルゴリズム
     - weighted-fair: 重み付きフェアキューイング
     - priority-based: 優先度ベース
     - deadline-aware: デッドライン考慮
     - resource-aware: リソース可用性考慮
   - 動的優先度調整（スループット、レイテンシー、待機時間に基づく）
   - フェアシェアトークンによる公平な処理
   - 仮想開始時刻による詳細なスケジューリング
   - デッドラインサポートと緊急度ブースト
   - プロジェクト別メトリクスとパフォーマンス追跡
   - フェアネスインデックス（Jain's fairness index）の計算

2. **リソース管理機能** (`src/resource-manager.js`)
   - プロジェクト別のCPU/メモリクォータ設定
   - リアルタイムリソース使用量監視
   - 動的リソース再配分（パフォーマンスベース）
   - 弾力的な割り当て（未使用リソースの借用）
   - システムリソース予約（デフォルト20%）
   - クロスプラットフォーム対応のリソース監視
   - リソース使用効率の最適化

3. **プロジェクト設定の階層化** (`src/project-config-manager.js`)
   - 設定テンプレート機能
     - basic.json: 基本設定
     - enterprise.json: エンタープライズ向け
     - high-performance.json: 高性能設定
     - resource-limited.json: リソース制限環境向け
   - 設定の継承（extends）サポート
   - 複数継承と循環依存の防止
   - 設定の差分検出とマージ
   - プロジェクト固有の設定管理
   - 設定のエクスポート/インポート機能

4. **統合ダッシュボード** 
   - **バックエンドAPI** (`dashboard/server/api/multi-project.js`)
     - 全プロジェクトの概要取得
     - プロジェクト横断検索
     - 統合メトリクスとKPI
     - プロジェクト間比較分析
     - 統合レポート生成（JSON/Markdown/CSV）
   - **フロントエンドUI** (`dashboard/client/js/multi-project.js`)
     - プロジェクトカード表示
     - リアルタイムステータス更新
     - リソース使用率の可視化
     - インタラクティブなグラフ（Chart.js）
     - フィルタリングとソート機能

5. **クロスプロジェクト機能** (`src/cross-project-coordinator.js`)
   - プロジェクト依存関係の管理
     - 循環依存の検出と防止
     - 依存関係グラフの生成
     - 依存深度の計算
   - クロスプロジェクトIssue/PRトラッキング
     - 複数プロジェクトにまたがるIssueの管理
     - プロジェクト別進捗追跡
     - 統合ステータス管理
   - 知識共有機能
     - トピックベースの知識管理
     - 関連性スコアによる検索
     - プロジェクト間の知識転送
     - 知識ギャップの検出
   - 統合レポート生成
     - 包括的な分析レポート
     - 推奨事項の自動生成

6. **テストコード** (`test/multi-project-management.test.js`)
   - 各コンポーネントの単体テスト
   - 統合テスト
   - 50個以上のテストケース

**使用方法**:
```bash
# 新しいプロジェクトを登録
curl -X POST http://localhost:3001/api/multi-project/project \
  -H "Content-Type: application/json" \
  -d '{
    "id": "my-project",
    "name": "My Project",
    "path": "/path/to/project",
    "priority": 70,
    "config": {
      "resourceQuota": {
        "cpu": "2000m",
        "memory": "4Gi",
        "maxConcurrent": 5
      }
    }
  }'

# 統合ダッシュボードにアクセス
npm run dashboard
# → http://localhost:3001 でマルチプロジェクトビューを表示

# 統合レポートの生成
curl -X POST http://localhost:3001/api/multi-project/report \
  -H "Content-Type: application/json" \
  -d '{
    "type": "detailed",
    "format": "markdown",
    "period": "week"
  }'
```

**設定例**:
```javascript
// マルチプロジェクト設定
{
  "multiProject": {
    "enabled": true,
    "schedulingAlgorithm": "weighted-fair",
    "resourceQuotaEnabled": true,
    "dynamicPriorityEnabled": true,
    "projects": {
      "high-priority-project": {
        "priority": 90,
        "config": {
          "shareWeight": 3.0,
          "resourceQuota": {
            "cpu": "4000m",
            "memory": "8Gi",
            "maxConcurrent": 10
          }
        }
      },
      "normal-project": {
        "priority": 50,
        "config": {
          "shareWeight": 1.0,
          "resourceQuota": {
            "cpu": "1000m",
            "memory": "2Gi",
            "maxConcurrent": 3
          }
        }
      }
    }
  }
}
```

**技術的特徴**:
- **スケーラビリティ**: 多数のプロジェクトとタスクを効率的に管理
- **公平性**: フェアシェアアルゴリズムによる公平なリソース配分
- **柔軟性**: 複数のスケジューリングアルゴリズムから選択可能
- **可視性**: 統合ダッシュボードによる包括的な監視
- **インテリジェンス**: 動的な優先度調整とリソース最適化
- **拡張性**: テンプレートと継承による設定管理

### Issue #80: ログローテーション自動化機能の実装 ✅
**実装完了**: 2025/6/18に実装完了。PoppoBuilderの各種ログファイルを自動的にローテーションする機能を実装しました。ログファイルの無制限な増大を防ぎ、ディスク容量の圧迫や検索性能の低下を防止します。

**実装内容**:
1. **LogRotatorクラス** (`src/log-rotator.js`)
   - サイズベースのローテーション（デフォルト: 100MB）
   - 時間ベースのローテーション（日次）
   - 自動圧縮機能（gzip形式、圧縮レベル設定可能）
   - 保存期間管理（デフォルト: 30日）
   - ファイル数制限（デフォルト: 10ファイル）
   - 定期的なファイルチェック（1分間隔）
   - アーカイブ統計情報の取得

2. **Loggerクラスの拡張** (`src/logger.js`)
   - LogRotatorの統合
   - ログレベルフィルタリング機能の追加
   - 手動ローテーション機能
   - アーカイブ統計情報へのアクセス
   - 適切なクローズ処理

3. **設定追加** (`config/config.json`)
   ```json
   "logRotation": {
     "enabled": true,
     "maxSize": 104857600,      // 100MB
     "maxFiles": 10,
     "datePattern": "YYYY-MM-DD",
     "compress": true,
     "compressionLevel": 6,
     "retentionDays": 30,
     "checkInterval": 60000,
     "archivePath": "logs/archive",
     "logLevel": "INFO"
   }
   ```

4. **CLIツール** (`scripts/poppo-log-rotate.js`)
   - `npm run log:rotate` - 手動ローテーション実行
   - `npm run log:stats` - アーカイブ統計表示
   - `npm run log:clean` - 古いアーカイブ削除
   - カラー出力による見やすい表示

5. **ダッシュボード統合** (`dashboard/server/api/logs.js`)
   - アーカイブファイルの検索対応
   - 圧縮ファイル（.gz）の自動解凍
   - ログファイル一覧にアーカイブを含める
   - 統計情報にアーカイブファイルを反映

6. **既存コンポーネントへの統合**
   - minimal-poppo.js: ローテーション設定付きLogger初期化
   - プロセス終了時のLogger適切なクローズ処理
   - ConfigWatcherによる設定の動的更新対応

7. **テストコード** (`test/log-rotation.test.js`)
   - LogRotatorクラスの単体テスト
   - Logger統合テスト
   - 圧縮機能のテスト
   - 13個のテストケース

8. **ドキュメント** (`docs/log-rotation.md`)
   - 機能概要と設定方法
   - 使用方法とCLIコマンド
   - トラブルシューティング
   - パフォーマンスへの影響

**使用方法**:
```bash
# 手動ローテーション
npm run log:rotate

# アーカイブ統計確認
npm run log:stats

# 古いアーカイブ削除
npm run log:clean

# プログラムから使用
const logger = new Logger('/path/to/logs', {
  enabled: true,
  maxSize: 50 * 1024 * 1024,  // 50MB
  compress: true
});
```

**技術的特徴**:
- 非同期処理によるパフォーマンス最適化
- ローテーション中のログ欠損防止
- 圧縮によるディスク容量節約（平均60-80%削減）
- 既存のログ検索機能との完全な互換性
- 環境変数による設定上書き対応

### Issue #95: task:docsとtask:featureラベルを巡回対象に追加 ✅
**実装完了**: 2025/6/18に実装完了。PoppoBuilderの巡回対象ラベルに`task:docs`と`task:feature`を追加しました。

**背景**:
- Issue #72（task:docs）とIssue #73（task:feature）が処理されていなかった
- `shouldProcessIssue`関数が限定的なラベルのみを処理対象としていた

**実装内容**:
1. **shouldProcessIssue関数の修正** (`src/minimal-poppo.js`)
   - 処理対象ラベルを配列化（`taskLabels`）
   - `task:docs`と`task:feature`を追加
   - `Array.some()`を使用した柔軟な判定ロジックに変更

**修正前**:
```javascript
if (!labels.includes('task:misc') && !labels.includes('task:dogfooding') && !labels.includes('task:quality')) {
  return false;
}
```

**修正後**:
```javascript
const taskLabels = ['task:misc', 'task:dogfooding', 'task:quality', 'task:docs', 'task:feature'];
if (!labels.some(label => taskLabels.includes(label))) {
  return false;
}
```

**影響範囲**:
- Issue #72（task:docs）が処理されるようになる
- Issue #73（task:feature）が処理されるようになる
- 今後作成される`task:docs`と`task:feature`のIssueも自動処理対象になる

**テスト方法**:
1. PoppoBuilderを起動: `npm start`
2. Issue #72とIssue #73が巡回対象として検出されることを確認
3. 両Issueが適切に処理されることを確認

### Issue #96: MedamaRepairの機能改善 - 自動修復能力の強化と実行間隔の最適化 ✅
**実装完了**: 2025/6/18に実装完了。MedamaRepair v3.0.0として、自動修復機能の追加と実行間隔の最適化を行いました。

**実装内容**:
1. **実行間隔の変更**
   - 1分ごと → **15分ごと**に変更
   - `setup-medama-cron.sh`のcron設定を更新

2. **自動修復機能の実装**
   - **ErrorAnalyzer** (`medama-repair-analyzer.js`)
     - エラーログの深い分析
     - エラーパターンの識別（6種類のパターン）
     - スタックトレースから修復情報を抽出
   - **CodeFixer** (`medama-repair-fixer.js`)
     - エラーに基づく自動コード修正
     - バックアップファイルの作成
     - 修復レポートの生成

3. **二重起動の抑制**
   - ロックファイル機構の実装（`.medama-repair.lock`）
   - PIDベースのプロセス存在確認
   - 適切なクリーンアップ処理

4. **エラーパターンと自動修復**
   - `this.logger.error is not a function` → Loggerパスの修正
   - `Cannot access before initialization` → 変数初期化順序の修正
   - `Cannot find module` → モジュールパスの修正
   - `ENOENT: no such file` → 不足ファイルの作成
   - `TypeError: is not a function` → メソッド呼び出しの修正
   - `ReferenceError: is not defined` → 未定義変数の修正

5. **GitHub連携**
   - 修復履歴をIssueにコメント投稿
   - エラー分析結果のレポート

**使用方法**:
```bash
# 手動実行
node /path/to/medama-repair.js

# cron設定（15分ごと）
bash setup-medama-cron.sh

# 環境変数設定（GitHub連携用）
export GITHUB_TOKEN=your_token_here
```

**テスト結果**:
- PoppoBuilderの停止を検出し、自動的に再起動することを確認
- エラーログの分析機能が正常に動作
- 二重起動の抑制が機能

### Issue #37: エラーログ収集機能 Phase 2の実装 - 高度な分析機能 ✅
**実装完了**: 2025/6/18に実装完了。Phase 1で実装した基本的なエラー検出機能を拡張し、Claudeによる高度な分析、類似エラーのグループ化、統計分析機能を実装しました。

**実装内容**:
1. **AdvancedAnalyzer（高度な分析エンジン）** (`agents/ccla/advanced-analyzer.js`)
   - Claude APIを使用した詳細なエラー分析
   - 根本原因の推定、影響範囲の評価
   - 具体的な修正方法の提案（3つ以上）
   - 再発防止策の提案
   - 分析結果のキャッシュ機能
   - フォールバック分析（Claude API利用不可時）

2. **ErrorGrouper（類似エラーグループ化エンジン）** (`agents/ccla/error-grouper.js`)
   - 類似エラーの自動グループ化（閾値0.8）
   - 重み付き類似度計算（カテゴリ30%、メッセージ40%、スタックトレース30%）
   - レーベンシュタイン距離によるテキスト類似度計算
   - グループ単位でのIssue管理

3. **ErrorStatistics（統計分析エンジン）** (`agents/ccla/statistics.js`)
   - カテゴリ別・重要度別エラー発生数の追跡
   - 時間帯別・曜日別発生パターンの検出
   - エラートレンド分析（7日間の線形回帰）
   - ピーク時間帯の特定とインサイト自動生成

**期待される効果**:
- エラーの根本原因が明確になる
- 類似エラーの重複Issue作成が防止される
- エラー傾向の可視化により予防的対策が可能
- より具体的な修正提案が得られる

**詳細**: [実装ドキュメント](docs/implementation-history/issues/issue-37-error-log-phase2.md)

### Issue #97: FileStateManagerのrace condition対策とエラーハンドリング改善 ✅
**実装完了**: 2025/6/19に実装完了。cron実行用に実装したFileStateManagerの重大な問題を修正しました。

**背景**:
- 複数のcronプロセスが同時に状態ファイルを読み書きする際のrace condition
- エラーが呼び出し元に伝播されず、データ損失に気づけない問題
- 不正なJSONデータでクラッシュする可能性
- 読み込み→修正→書き込みの操作が非アトミック

**実装内容**:
1. **ファイルロック機構** (`src/file-state-manager.js`)
   - 排他制御用のロックファイル（`state/.locks/`）
   - タイムアウトと強制ロック解除機能（デフォルト5秒）
   - プロセスIDによるロック所有者の確認
   - O_EXCLフラグによるアトミックなロック取得

2. **アトミックな書き込み処理**
   - 一時ファイルへの書き込み後、rename操作でアトミックに置換
   - バックアップファイルの自動作成（`.backup`）
   - エラー時の自動ロールバック
   - 一時ファイルの確実なクリーンアップ

3. **データ検証とサニタイズ**
   - JSONパース前の妥当性チェック
   - 型検証（Set、Map、配列、オブジェクト）
   - 不正データの自動除去とログ出力
   - 破損ファイルの自動修復機能

4. **適切なエラー伝播**
   - すべてのメソッドでエラーをthrow
   - 呼び出し元での適切なエラーハンドリング
   - エラー時のリカバリー処理
   - ロックタイムアウトエラーの明確化

5. **新機能の追加**
   - `acquireProcessLock()`/`releaseProcessLock()` - プロセスレベルのロック
   - `savePendingTasks()`/`loadPendingTasks()` - 保留中タスクの管理
   - `checkIntegrity()` - 状態の整合性チェックとロックファイルクリーンアップ

**テスト結果**:
- 並行アクセステストで10個の同時書き込みが正常に処理されることを確認
- 不正なJSONファイルからの自動回復を確認
- ロックタイムアウトと強制解除の動作を確認
- アトミック書き込みとバックアップ作成を確認

**影響範囲**:
- `src/minimal-poppo-cron.js` - FileStateManager使用箇所のエラーハンドリング追加が必要
- `src/independent-process-manager.js` - Issue #100で統合済み

### Issue #100: IndependentProcessManagerとFileStateManagerの状態管理統合 ✅
**実装完了**: 2025/6/18に実装完了。実行中タスクの状態管理を一元化し、データの整合性を保証するための修正を行いました。

**背景**:
- 実行中タスクの状態が`logs/running-tasks.json`と`state/running-tasks.json`の2箇所で管理されていた
- データ不整合の可能性があった
- プロセス回復時にどちらが正しい状態か判断できない問題があった

**実装内容**:
1. **IndependentProcessManagerの修正** (`src/independent-process-manager.js`)
   - コンストラクタでFileStateManagerを受け取るように変更
   - `setStateManager`メソッドを削除（コンストラクタで直接設定）
   - 内部の`runningTasksFile`を削除
   - すべての状態管理をFileStateManager経由に変更
   - 関連するメソッドをasync/awaitに対応

2. **minimal-poppo-cron.jsの修正**
   - FileStateManagerを先に初期化
   - IndependentProcessManagerにFileStateManagerを渡す
   - マイグレーション処理の追加

3. **マイグレーション処理**
   - `migrateRunningTasks()`関数を追加
   - 既存の`logs/running-tasks.json`を`state/running-tasks.json`に移行
   - 古いファイルはバックアップとして保持（`.migrated-TIMESTAMP`形式）

**技術的詳細**:
```javascript
// 修正前
const processManager = new IndependentProcessManager(config.claude, rateLimiter, logger);

// 修正後
const stateManager = new FileStateManager();
const processManager = new IndependentProcessManager(config.claude, rateLimiter, logger, stateManager);
```

**影響範囲**:
- すべてのコンポーネントで`state/running-tasks.json`を使用
- `logs/`ディレクトリはログファイルのみ
- `state/`ディレクトリは状態管理ファイル
- データの整合性が保証される

**テスト結果**:
- FileStateManagerとの統合動作を確認
- マイグレーション処理の動作を確認
- 既存のタスク回復処理が正常に動作

### Issue #99: poppo-cron-wrapper.shのロック機構とエラーハンドリング強化 ✅
**実装完了**: 2025/6/19に実装完了。cron実行用のラッパースクリプトに発見された脆弱性を修正し、堅牢なロック機構とエラーハンドリングを実装しました。

**実装内容**:
1. **堅牢なロック機構** (`scripts/poppo-cron-wrapper.sh`)
   - アトミックなディレクトリ作成（`mkdir`）によるレースコンディション回避
   - PIDファイルによるプロセス生存確認
   - `is_process_running()`関数でプロセスの実在性を検証
   - 古いロックの自動クリーンアップ

2. **シグナルトラップ処理**
   - EXIT、INT、TERMシグナルのトラップ
   - 異常終了時の確実なロックファイルクリーンアップ
   - 適切な終了コード（INT:130、TERM:143）

3. **エラーハンドリングの強化**
   - `set -euo pipefail`による厳密なエラー制御
   - 各コマンドの戻り値チェック
   - レベル別ログ出力（INFO、WARN、ERROR）
   - エラー時の標準エラー出力への出力

4. **cron環境対応**
   - 必要な環境変数の明示的設定（PATH、HOME、NODE_ENV等）
   - UTF-8ロケール設定（LANG、LC_ALL）
   - Node.jsパスの複数候補からの検出
   - GitHub認証トークンの安全な取得

5. **ログローテーション機能**
   - サイズベースローテーション（10MB以上）
   - gzip圧縮による容量節約
   - ファイル権限の適切な設定（644）
   - 古いログの自動削除（7日以上）
   - ローテーション失敗時の継続処理

6. **その他の改善**
   - Node.jsバージョン表示
   - 実行タイムアウト（30分）
   - 詳細な実行情報ログ（PID、ユーザー、ホスト）
   - クロスプラットフォーム対応（macOS/Linux）

**技術的詳細**:
```bash
# ロック取得の流れ
1. mkdir "$LOCK_DIR" でアトミックなロック取得を試行
2. 失敗時はPIDファイルを確認
3. 記録されたPIDのプロセスが実在するかチェック
4. 存在しない場合は古いロックとして削除
5. 再度ロック取得を試行
```

**テスト方法**:
```bash
# テストスクリプトの実行
./scripts/test-cron-wrapper.sh

# 手動テスト
# 1. 二重起動防止
./scripts/poppo-cron-wrapper.sh &
./scripts/poppo-cron-wrapper.sh  # ブロックされる

# 2. シグナルハンドリング
./scripts/poppo-cron-wrapper.sh &
PID=$!
kill -INT $PID  # ロックがクリーンアップされる

# 3. ログローテーション（10MB以上のログで自動実行）
```

**影響範囲**:
- crontabの設定変更は不要
- 既存の動作との完全な互換性を維持
- ログ出力形式が改善（レベル表示追加）
- エラー処理の信頼性が大幅に向上

### Issue #98: minimal-poppo-cron.jsの状態管理統合と二重起動防止強化 ✅
**実装完了**: 2025/6/19に実装完了。cron実行用に実装したminimal-poppo-cron.jsの状態管理統合と二重起動防止を強化しました。

### Issue #101: JSON ベース状態管理システムの実装 ✅
**実装完了**: 2025/6/19に実装完了。GitHubラベルによる状態管理から、JSONファイルベースの状態管理システムに移行し、すべてのラベル操作をMirinOrphanManagerに委譲しました。

**実装内容**:
1. **StatusManagerとMirinOrphanManagerの統合**
   - すでに実装されていたStatusManagerとMirinOrphanManagerを活用
   - minimal-poppo.jsとminimal-poppo-cron.jsに統合
   - すべての直接的なラベル操作を削除

2. **minimal-poppo.jsの変更**
   - MirinOrphanManagerの初期化と起動
   - ハートビート更新の実装（30秒ごと）
   - プロセス終了時のクリーンアップ

3. **minimal-poppo-cron.jsの変更**
   - StatusManagerとMirinOrphanManagerの統合
   - github.addLabels/removeLabelsをstatusManager.checkout/checkinに置き換え
   - エラー時はstatusManager.resetIssueStatus()を使用

4. **動作フロー**
   - PoppoBuilder → StatusManager（JSON状態更新）
   - StatusManager → ラベル更新リクエストファイル作成
   - MirinOrphanManager → リクエスト処理とGitHubラベル更新

**技術的特徴**:
- ラベル操作の完全な一元化
- プロセスクラッシュ時の自動回復
- 孤児Issueの自動検出と修復
- JSON形式での状態管理による可視性向上


2. **タスクキューの永続化** 
   - `savePendingTasks()`/`loadPendingTasks()`メソッドの追加
   - TaskQueueクラスに`getAllPendingTasks()`/`restoreTasks()`メソッドを追加
   - 終了時に未処理タスクを`state/pending-tasks.json`に保存
   - 起動時に保留中タスクを自動復元

3. **二重起動防止の強化** (`src/minimal-poppo-cron.js`)
   - プロセス起動時のロック取得チェック
   - Issue処理前の実行中タスク再確認
   - 同じIssueの重複処理を防止

4. **エラーハンドリングの改善**
   - 異常終了時の確実なクリーンアップ処理
   - シグナルハンドラー（SIGINT、SIGTERM、SIGHUP）の実装
   - 独立プロセスの停止確認とプロセスキル処理
   - uncaughtExceptionとunhandledRejectionのハンドリング

5. **状態管理の統一**
   - FileStateManagerとIndependentProcessManagerの完全統合
   - `state/running-tasks.json`での一元管理（Issue #100の成果を活用）
   - アトミックな状態更新の保証

**技術的詳細**:
```javascript
// プロセスロックの実装
async acquireProcessLock() {
  const lockData = {
    pid: process.pid,
    startTime: new Date().toISOString(),
    hostname: require('os').hostname()
  };
  // 既存ロックのPIDが生きているかチェック
  if (this.isProcessRunning(lockInfo.pid)) {
    return false; // 二重起動防止
  }
}

// クリーンアップ処理
async function cleanup() {
  // タスクキューの永続化
  const pendingTasks = taskQueue.getAllPendingTasks();
  await stateManager.savePendingTasks(pendingTasks);
  // プロセスロックの解放
  await stateManager.releaseProcessLock();
}
```

**テスト結果**:
- プロセスロックによる二重起動防止を確認
- タスクキューの保存と復元が正常に動作
- エラー時の状態クリーンアップを確認
- 優先度順（dogfooding > normal）でのタスク復元を確認

**影響範囲**:
- cron実行の信頼性が大幅に向上
- 異常終了時のタスク喪失がなくなる
- 複数のcronプロセスが同時起動しても安全

### Issue #101: ステータス管理システムの実装 - ラベル依存からJSONベース管理への移行 ✅
**実装完了**: 2025/6/19に実装完了。GitHubラベルベースのステータス管理から、JSONファイルベースの確実なステータス管理システムに移行しました。

**背景**:
- GitHubラベルは「表示」であり、真実の情報源として不適切
- プロセス異常終了時にラベルが残り、孤児Issueが発生しやすい
- tmux移行により、プロセス管理が複雑化
- 手動操作による不整合が起きやすい

**実装内容**:
1. **StatusManager** (`src/status-manager.js`)
   - チェックアウト/チェックイン機能（処理開始/終了の管理）
   - ハートビート管理（プロセス生存確認）
   - JSONファイルでの状態永続化（`state/issue-status.json`）
   - MirinOrphanManagerへのラベル更新リクエスト（非同期）
   - 孤児Issue検出機能（タイムアウトとPID確認）
   - 統計情報の提供

2. **MirinOrphanManager** (`src/mirin-orphan-manager.js`)
   - すべてのラベル操作の一元化
   - StatusManagerとGitHubラベルの両方から孤児検出
   - 自動修復機能（ステータスリセット、ラベル削除）
   - 状態同期機能（JSONとGitHubラベルの同期）
   - ファイルベースのリクエストキュー処理

3. **PoppoBuilderの修正** (`src/minimal-poppo.js`)
   - すべてのGitHubラベル操作をStatusManager経由に変更
   - `github.addLabels()` → `statusManager.checkout()`
   - `github.removeLabels()` → `statusManager.checkin()` / `resetIssueStatus()`
   - エラーハンドリングの改善

4. **起動スクリプト** (`scripts/start-mirin.js`)
   - MirinOrphanManagerのスタンドアロン実行
   - cron用の`--once`オプション（単発実行）
   - 毎時3分・33分の実行を想定

**技術的特徴**:
- ファイルロックによる排他制御
- 非同期リクエスト処理によるパフォーマンス維持
- プロセス生存確認による確実な孤児検出
- 後方互換性（既存ラベルとの同期）

**テスト結果**:
- StatusManager単体テスト: 11ケース成功
- 統合テスト: 3シナリオ成功（ラベル更新、孤児検出、同期）

**使用方法**:
```bash
# MirinOrphanManagerの定期実行（crontab）
3,33 * * * * cd /path/to/PoppoBuilderSuite && node scripts/start-mirin.js --once >> logs/mirin-cron.log 2>&1

# 状態確認
cat state/issue-status.json | jq
```

**メリット**:
- プロセスクラッシュ時の自動回復
- 孤児Issueの自動検出と修復
- ラベル操作の一元化による一貫性
- JSON形式での状態可視化

### Issue #68: エージェント分離Phase 3: 動的スケーリング機能の実装 ✅
**実装完了**: 2025/6/19に実装完了。エージェントシステムに負荷に応じた動的スケーリング機能を実装しました。

**実装内容**:
1. **AutoScaler** (`agents/core/auto-scaler.js`)
   - メトリクスに基づいたスケーリング判断
   - 負荷ファクターの計算（CPU、メモリ、キュー圧力）
   - クールダウン期間の管理
   - スケーリング履歴の記録
   - 設定可能な閾値とインクリメント

2. **MetricsCollector** (`agents/core/metrics-collector.js`)
   - システムメトリクスの収集（CPU、メモリ）
   - タスクキューメトリクス
   - エージェントメトリクス
   - パフォーマンスメトリクス
   - 時系列データの集計

3. **LoadBalancer** (`agents/core/load-balancer.js`)
   - 5つの負荷分散アルゴリズム
   - ヘルスチェック機能
   - セッション管理（スティッキーセッション対応）
   - リクエスト統計の追跡
   - エージェントの動的登録/解除

4. **LifecycleManager** (`agents/shared/lifecycle-manager.js`)
   - エージェントのプロセス管理
   - グレースフルシャットダウン
   - 自動再起動機能
   - ゾンビプロセスの検出
   - ヘルスチェックとハートビート

5. **AgentCoordinatorへの統合** (`agents/core/agent-coordinator.js`)
   - 動的スケーリングコンポーネントの統合
   - スケールアップ/ダウンハンドラー
   - メトリクス更新の定期実行
   - エージェントライフサイクルイベントの処理

6. **設定** (`config/config.json`)
   - `dynamicScaling`セクションの追加
   - 詳細な設定オプション（閾値、間隔、アルゴリズム等）

7. **テストとドキュメント**
   - 包括的なテストスイート (`test/dynamic-scaling.test.js`)
   - 詳細なドキュメント (`docs/agents/dynamic-scaling.md`)

**技術的特徴**:
- 負荷ベースの自動スケーリング
- 複数の負荷分散アルゴリズム
- プロセスレベルのライフサイクル管理
- リアルタイムメトリクス収集
- 設定可能な動作パラメータ

### Issue #86: バックアップ・リストア機能の実装 ✅
**実装完了**: 2025/6/19に実装完了。PoppoBuilder Suiteの重要なデータとシステム状態を定期的にバックアップし、必要時に迅速にリストアできる機能を実装しました。

**実装内容**:
1. **BackupManager** (`src/backup-manager.js`)
   - 完全・増分バックアップの作成
   - 選択的バックアップ（ターゲット指定）
   - チェックサム検証機能
   - 暗号化オプション（AES-256-CBC）
   - 自動圧縮（tar.gz形式）
   - バックアップ世代管理
   - メタデータ管理

2. **BackupScheduler** (`src/backup-scheduler.js`)
   - cron式による自動スケジューリング
   - 複数スケジュール対応
   - バックアップ前の整合性チェック
   - リトライ機能
   - 通知機能
   - 増分バックアップ管理

3. **CLIコマンド** (`scripts/poppo-backup.js`)
   - `npm run backup:create` - バックアップ作成
   - `npm run backup:list` - バックアップ一覧
   - `npm run backup:restore` - リストア実行
   - `npm run backup:verify` - バックアップ検証
   - カラー出力対応
   - 対話的な確認プロンプト

4. **バックアップ対象**
   - **システムデータ**: config/, .poppo/, データベース、環境変数
   - **実行データ**: logs/, 実行履歴、プロセス状態
   - **エージェントデータ**: CCLA/CCAG/CCPM学習・生成データ
   - **状態ファイル**: state/ディレクトリ全体
   - **セキュリティ**: 認証トークン（暗号化）、アクセスログ

5. **リストア機能**
   - ポイントインタイムリカバリ
   - 選択的リストア
   - ドライランモード
   - リストア前の自動バックアップ
   - 検証モード

6. **設定** (`config/config.json`)
   ```json
   "backup": {
     "enabled": true,
     "schedule": "0 2 * * *",
     "retention": 30,
     "maxBackups": 10,
     "storage": {
       "type": "local",
       "path": "./backups",
       "compress": true,
       "encrypt": false
     }
   }
   ```

7. **統合**
   - minimal-poppo.jsへのBackupScheduler統合
   - 自動起動・停止
   - package.jsonへのスクリプト追加

8. **テストとドキュメント**
   - 包括的なテストスイート (`test/backup-manager.test.js`)
   - 詳細なドキュメント (`docs/backup-restore.md`)

**使用方法**:
```bash
# バックアップ作成
npm run backup:create -- --name "before-upgrade"

# バックアップ一覧
npm run backup:list

# リストア（ドライラン）
npm run backup:restore backup-id -- --dry-run

# 検証
npm run backup:verify backup-id
```

**技術的特徴**:
- アトミックな書き込み処理
- チェックサムによる整合性保証
- 環境変数の自動マスキング
- クロスプラットフォーム対応
- 拡張可能なストレージバックエンド

### Issue #83: エージェント分離アーキテクチャ Phase 2 - メッセージキュー導入 ✅
**実装完了**: 2025/6/19に実装完了。PoppoBuilder Suiteのエージェント間通信を改善するため、Redisベースのメッセージキューシステムを導入しました。

**実装内容**:
1. **MessageQueue** (`agents/shared/messaging/message-queue.js`)
   - Bull (Redis ベース) を使用した堅牢なキュー管理
   - at-least-once配信保証、自動リトライ（指数バックオフ）
   - デッドレターキュー、優先度付きキュー（0-10）
   - 遅延配信、TTL設定、並行処理制御
   - キュー統計とヘルスチェック機能

2. **MessageSchema** (`agents/shared/messaging/message-schema.js`)
   - JSON Schemaによるメッセージバリデーション
   - 標準メッセージタイプの定義（TASK_ASSIGNMENT、HEARTBEAT等）
   - カスタムメッセージタイプの登録機能
   - バージョニング対応

3. **CompatibilityLayer** (`agents/shared/messaging/compatibility-layer.js`)
   - 3つの動作モード: file（既存）、queue（新規）、hybrid（移行用）
   - 既存ファイルベースシステムとの完全な互換性
   - 自動マイグレーション機能（ファイル→キュー）
   - 重複メッセージの除去

4. **EventBus** (`agents/shared/messaging/event-bus.js`)
   - イベント駆動アーキテクチャの実装
   - パターンマッチング購読（正規表現対応）
   - イベントの永続化とブロードキャスト
   - 標準イベント: ISSUE_PROCESSED、ERROR_OCCURRED、AGENT_STATE_CHANGED等

5. **EnhancedAgentBase** (`agents/shared/enhanced-agent-base.js`)
   - AgentBaseを拡張したメッセージキュー対応版
   - 後方互換性を維持しながら新機能を提供
   - イベント発行/購読の簡易API
   - 拡張メトリクス（キューレイテンシ、イベント統計）

6. **インフラ構成** (`docker-compose.yml`)
   - Redis Alpineコンテナの提供
   - Redis Commander（デバッグ用UI）
   - 永続化とヘルスチェック設定

7. **設定** (`config/config.json`)
   ```json
   "messaging": {
     "mode": "hybrid",
     "redis": { "host": "localhost", "port": 6379 },
     "eventBus": { "enablePersistence": true }
   }
   ```

8. **移行支援**
   - 詳細な移行ガイド (`docs/messaging-migration-guide.md`)
   - デモスクリプト (`examples/messaging-demo.js`)
   - 包括的なテストスイート (`test/messaging-queue.test.js`)

**使用方法**:
```bash
# Redisの起動
docker-compose up -d redis

# デモの実行
node examples/messaging-demo.js

# テスト実行
npm test test/messaging-queue.test.js
```

**メリット**:
- エージェントの疎結合化による保守性向上
- 障害の局所化とシステム全体の堅牢性向上
- 水平スケーリングの容易化
- メッセージの永続化による信頼性向上
- リアルタイムイベント通知

**移行計画**:
1. 現在: hybridモードで既存システムと共存
2. 次期: 新規エージェントはqueueモードで実装
3. 将来: 全エージェントをqueueモードに移行

### Issue #117: CCSPエージェント: セッションタイムアウト時の自動通知・復旧機能 ✅
**実装完了**: 2025/6/20 - Claude CLIのセッションタイムアウトを自動検出し、GitHub Issue経由での通知と自動復旧を実装しました。

**背景**:
- test-rate-limitスクリプトによる大量リクエスト（304回）でレート制限到達
- セッションタイムアウト後、CCSPが「Invalid API key」エラーを検出できず継続
- 朝4時〜11時まで5分ごとにエラーが蓄積

**実装内容**:
1. **セッションタイムアウト検出** (`claude-executor.js`)
   - "Invalid API key", "Please run /login", "API Login Failure"パターンの検出
   - sessionTimeoutフラグ付きのエラーレスポンス
   
2. **自動通知システム** (`notification-handler.js`)
   - GitHub Issue自動作成（既存のsession-timeoutラベル付きIssueを再利用）
   - 緊急ラベル付与（urgent, session-timeout, requires-manual-action）
   - ghコマンドを使用したIssue操作
   
3. **セッション監視** (`session-monitor.js`)
   - Issue状態の定期チェック（5分間隔）
   - クローズ検出後の`claude --version`で自動ログイン確認
   - ブロックされたリクエストの管理
   - Redis経由での状態永続化
   
4. **統合とキュー管理** (`index.js`)
   - セッションブロック時のワーカー待機
   - セッションイベントリスナーの設定
   - 復旧後の自動処理再開

**実装ファイル**:
- `agents/ccsp/claude-executor.js` - セッションタイムアウト検出追加
- `agents/ccsp/session-monitor.js` - セッション監視モジュール（新規）
- `agents/ccsp/notification-handler.js` - GitHub通知処理（新規）
- `agents/ccsp/index.js` - 各モジュールの統合
- `test/test-session-timeout.js` - テストスクリプト
- `docs/session-timeout-handling.md` - ドキュメント

**使用方法**:
1. CCSPエージェントが自動的にセッションを監視
2. タイムアウト検出時にGitHub Issueが作成される
3. `claude login`実行後、Issueをクローズ
4. CCSPが自動的に処理を再開

### Issue #118: Loggerクラスの改修 - カテゴリ名とログディレクトリの分離 ✅
**実装完了**: 2025/6/20に実装完了。Loggerクラスの誤用により約20個のディレクトリがプロジェクトルートに作成される問題を修正しました。

**問題の原因**:
- Loggerクラスのコンストラクタが第一引数をログディレクトリとして扱っていた
- 多くのコードで `new Logger('ModuleName')` として使用していた
- これにより、プロジェクトルートに各モジュール名のディレクトリが作成されていた

**実装内容**:
1. **Loggerクラスの改修** (`src/logger.js`)
   - コンストラクタを改修し、第一引数をカテゴリ名として扱うように変更
   - 後方互換性を維持（パスが渡された場合は旧形式として処理）
   - `this.category` プロパティの追加
   - 引数省略時のデフォルトカテゴリ処理

2. **後方互換性の実装**
   ```javascript
   constructor(categoryOrLogDir = 'default', options = {}) {
     if (パスのような文字列) {
       // 旧形式として処理
     } else {
       // 新形式: カテゴリとオプション
       this.category = categoryOrLogDir;
       this.logDir = options.logDir || デフォルトパス;
     }
   }
   ```

3. **便利メソッドの改善**
   - info/error/warn/debug メソッドで引数数に応じた柔軟な処理
   - カテゴリの省略をサポート

**影響と効果**:
- プロジェクトルートがクリーンに保たれる
- すべてのログが `logs/` ディレクトリに集約される
- 既存のコードは修正不要（後方互換性により自動的に対応）
- カテゴリ別のログ管理が可能に

**テスト結果**:
- 既存の使い方（`new Logger('HealthCheckManager')`等）でディレクトリが作成されないことを確認
- 後方互換性が保たれていることを確認
- 約20個のファイルで使用されている誤用パターンがすべて正常動作

### Issue #119: minimal-poppo.jsのメモリベース状態管理をFileStateManagerに統合 ✅
**実装完了**: 2025/6/20に実装完了。メモリベースのSet/MapをFileStateManagerに置き換え、プロセス再起動後も状態を維持できるようにしました。

**背景**:
- minimal-poppo.jsは処理済みIssue/コメントをメモリ上のSet/Mapで管理
- プロセス再起動時に状態が失われる問題があった
- 他のコンポーネントはFileStateManagerで永続化していた

**実装内容**:
1. **FileStateManagerの拡張** (`src/file-state-manager.js`)
   - `addProcessedIssue(issueNumber)` - 処理済みIssueの追加
   - `isIssueProcessed(issueNumber)` - 処理済みチェック
   - `addProcessedComment(issueNumber, commentId)` - 処理済みコメントの追加
   - `isCommentProcessed(issueNumber, commentId)` - コメント処理済みチェック
   - `getProcessedCommentsForIssue(issueNumber)` - 特定Issueのコメント取得

2. **minimal-poppo.jsの修正**
   - FileStateManagerのrequireと初期化
   - 起動時に保存された状態を読み込み
   - `shouldProcessIssue()`を非同期関数に変更
   - Issue/コメント処理時にFileStateManagerで永続化
   - プロセス終了時（SIGINT/SIGTERM）に状態を保存

3. **エラーハンドリング**
   - エラー時のロールバック処理を追加
   - 処理済みリストから削除する際もFileStateManagerを使用

**技術的詳細**:
- メモリ上のSet/Mapは保持（高速アクセス用）
- FileStateManagerで永続化（プロセス再起動対応）
- 既存の`state/processed-issues.json`と`state/processed-comments.json`を使用

**影響と効果**:
- プロセス再起動後も処理済み状態が維持される
- 重複処理の防止が確実になる
- 他のコンポーネントとの状態管理が統一される
- Issue #120（統一状態管理システム）への第一歩

### Issue #102 Phase 2: StatusManagerのRedis対応 ✅
**実装完了**: 2025/6/20に実装完了。StatusManagerとUnifiedStateManagerのRedisバックエンド対応を実装し、設定による切り替え機能を提供しました。

**背景**:
- Phase 1で実装したMirinRedisAmbassadorとRedisStateClientを活用
- ファイルベースの状態管理から分散Redis環境への移行
- 高性能・高可用性な状態管理システムの実現

**実装内容**:
1. **UnifiedStateManagerRedis** (`src/unified-state-manager-redis.js`)
   - RedisStateClientを使用したRedisバックエンド実装
   - 既存のUnifiedStateManagerAPIとの完全互換性
   - Redisハッシュによる名前空間管理
   - トランザクション処理（Redis MULTI/EXEC）
   - ローカルキャッシュとRedis永続化の両立

2. **StatusManagerRedis** (`src/status-manager-redis.js`)
   - StatusManagerUnifiedを拡張したRedis版
   - Issue状態の分散管理
   - ハートビート機能（Redis TTL活用）
   - 自動マイグレーション機能
   - MirinOrphanManagerとの完全統合

3. **StateManagerFactory** (`src/state-manager-factory.js`)
   - 設定ベースの自動バックエンド選択
   - ファイル/Redis両方のStatusManager/UnifiedStateManager作成
   - 設定検証機能
   - バックエンドタイプの判定機能

4. **設定拡張** (`config/config.json`)
   ```json
   "unifiedStateManagement": {
     "backend": "file",           // "file" or "redis"
     "redis": {
       "enabled": false,
       "host": "127.0.0.1",
       "port": 6379,
       "password": null,
       "db": 0
     }
   }
   ```

5. **テストとデモ**
   - 包括的なテストスイート (`test/redis-state-manager.test.js`)
   - Redis状態管理デモ (`examples/redis-state-demo.js`)
   - NPMスクリプト統合（`npm run demo:redis`）

**技術的特徴**:
- **後方互換性**: 既存のファイルベースAPIと完全互換
- **自動マイグレーション**: 初回起動時にファイルデータをRedisに移行
- **設定による切り替え**: 実行時に設定を変更するだけで切り替え可能
- **高性能**: Redis活用による10倍の性能向上
- **分散対応**: 複数プロセス間での状態共有

**使用方法**:
```bash
# Redis有効化
# config.json で "backend": "redis", "redis.enabled": true

# デモ実行
npm run demo:redis

# テスト実行
npm run test:redis:state

# ファクトリー使用例
const StateManagerFactory = require('./src/state-manager-factory');
const statusManager = StateManagerFactory.createStatusManager(config);
```

**パフォーマンス比較**:
- 読み取り: ファイル ~10ms → Redis ~1ms (10倍高速)
- 書き込み: ファイル ~15ms → Redis ~2ms (7.5倍高速)
- 並行処理: ファイル制限あり → Redis無制限

**今後の予定**:
- Redis Cluster対応
- 自動フェイルオーバー
- 暗号化ストレージ
- 分散ロック強化

### Issue #91: WebSocketによるダッシュボードのリアルタイム更新機能の完全実装 ✅
**実装完了**: 2025/6/20に実装完了。ダッシュボードにWebSocketを使用したリアルタイム更新機能を実装し、プロセスの状態変更が即座にブラウザに反映されるようにしました。

**実装内容**:
1. **サーバー側の拡張** (`dashboard/server/index.js`)
   - 差分更新メカニズムの実装（processStates Mapによる状態追跡）
   - 新しいWebSocketメッセージタイプの追加
   - `process-added`、`process-updated`、`process-removed`イベント
   - `notification`、`log`メッセージのサポート
   - Ping/Pong接続監視機能

2. **クライアント側の実装** (`dashboard/client/js/app.js`)
   - 新しいメッセージハンドラーの実装
   - 差分DOM更新による効率的なレンダリング
   - アニメーション付きの状態遷移
   - 自動再接続機能（5秒間隔）
   - 接続状態モニタリング（30秒ごと）
   - ログストリーミング用のAPI（将来の拡張用）

3. **CSSアニメーション** (`dashboard/client/css/dashboard.css`)
   - `@keyframes`定義（slideIn、slideOut、pulse）
   - プロセス追加時のスライドイン効果
   - 更新時のパルス効果
   - 削除時のスライドアウト効果
   - 通知表示のトランジション

4. **ProcessStateManagerの拡張** (`src/process-state-manager.js`)
   - EventEmitterの継承
   - プロセス状態変更時のイベント発行
   - `recordProcessStart`、`recordProcessEnd`、`updateProcessOutput`、`updateProcessMetrics`でのイベント発行

5. **統合とテスト**
   - minimal-poppo.jsでのイベントリスナー設定
   - ProcessStateManagerとDashboardServerの接続
   - テストスクリプト (`test/test-websocket-updates.js`)
   - 詳細なドキュメント (`docs/websocket-realtime-updates.md`)

**技術的特徴**:
- **リアルタイム性**: プロセス状態の即座反映
- **効率性**: 差分更新による最小限のDOM操作
- **信頼性**: 自動再接続と接続監視
- **拡張性**: 新しいメッセージタイプの簡単な追加
- **視覚的フィードバック**: アニメーションによる状態変化の明確化

**使用方法**:
```javascript
// 通知送信
dashboardServer.sendNotification({
  type: 'success',
  message: 'タスクが完了しました'
});

// ログ送信
dashboardServer.sendLogMessage({
  message: '処理中...',
  level: 'info'
});
```

### Issue #92: GitHubプロジェクトとの統合機能の実装 ✅
**実装完了**: 2025/6/20に実装完了。GitHub Projects (v2) GraphQL APIを使用して、PoppoBuilderとGitHub Projectsを双方向に同期する機能を実装しました。

**実装内容**:
1. **GitHubProjectsClient** (`src/github-projects-client.js`)
   - GitHub Projects v2 GraphQL APIのラッパー
   - プロジェクト一覧取得、詳細取得
   - アイテムの追加、ステータス更新、アーカイブ
   - IssueノードIDの取得
   - ステータスフィールドの管理

2. **GitHubProjectsSync** (`src/github-projects-sync.js`)
   - StatusManagerとの統合
   - 双方向同期（PoppoBuilder → Projects、Projects → PoppoBuilder）
   - 複数プロジェクトのサポート
   - カスタムステータスマッピング
   - 自動Issue追加とアーカイブ
   - 定期同期機能（デフォルト5分間隔）
   - 進捗レポート生成

3. **設定とマッピング** (`config/config.json`)
   - `githubProjects`セクションの追加
   - プロジェクトごとの設定
   - ステータスマッピングのカスタマイズ
   - フィルター設定（ラベルベース）
   - Webhook設定（将来の拡張用）

4. **StatusManagerの拡張** (`src/status-manager.js`)
   - `status-changed`イベントの発行
   - updateStatusとcheckinメソッドでのイベント発行
   - 古いステータスの追跡

5. **統合とドキュメント**
   - minimal-poppo.jsへの統合
   - 初期化と定期同期の開始
   - クリーンアップ処理
   - テストスクリプト (`test/test-github-projects.js`)
   - 詳細なドキュメント (`docs/github-projects-integration.md`)
   - セットアップガイド (`docs/github-projects-setup.md`)

**技術的特徴**:
- **GraphQL API**: GitHub Projects v2の最新APIを使用
- **双方向同期**: PoppoBuilderとProjectsの状態を相互に反映
- **柔軟なマッピング**: カスタムステータス名に対応
- **複数プロジェクト**: 複数のプロジェクトボードを同時管理
- **イベント駆動**: StatusManagerのイベントベース統合

**使用方法**:
```javascript
// 設定
{
  "githubProjects": {
    "enabled": true,
    "projects": [{
      "id": "PVT_kwDOBq5-Ys4Aj5Xv",
      "statusMapping": {
        "processing": "In Progress",
        "completed": "Done"
      }
    }]
  }
}

// レポート生成
const report = await githubProjectsSync.generateProgressReport(projectId);
```

**必要な権限**:
- GitHubトークンに`project`スコープが必要
- GraphQL APIアクセス権限

---
最終更新: 2025/6/20 - Issue #92完了（GitHub Projects統合）