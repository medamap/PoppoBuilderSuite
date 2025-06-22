# PoppoBuilder Suite ドキュメント

PoppoBuilder Suiteの包括的なドキュメントです。目的に応じて必要なドキュメントを参照してください。

## 📚 目次

### 🚀 はじめに
- [クイックスタートガイド](quick-start.md) - 5分でPoppoBuilderを始める
- [インストールガイド](INSTALL.md) ([English](INSTALL_en.md)) - 詳細なセットアップ手順
- [セットアップガイド](setup-guide.md) ([English](setup-guide_en.md)) - 環境構築の詳細

### 🎯 機能別ガイド
- [メモリ管理ガイド](features/memory-management-guide.md) - メモリ使用量の監視と最適化
- [エラーハンドリングガイド](features/error-handling-guide.md) - エラー処理とリカバリー
- [テストフレームワーク活用ガイド](features/testing-guide.md) - テストの実行と開発
- [ダッシュボード操作ガイド](features/dashboard-guide.md) - Webダッシュボードの使い方
- [動的タイムアウト](features/dynamic-timeout.md) ([English](features/dynamic-timeout_en.md))
- [レート制限](features/rate-limiting.md) - API制限への対応

### 📖 APIリファレンス
- [CLIコマンドリファレンス](api/cli-reference.md) - 全コマンドの詳細
- [設定オプション詳細](config-management.md) - 設定ファイルの完全ガイド
- [イベントとフック](api/events-and-hooks.md) - カスタマイズポイント
- [プラグイン開発ガイド](api/plugin-development.md) - 拡張機能の作成

### 🛠️ トラブルシューティング
- [トラブルシューティングガイド](troubleshooting.md) - よくある問題と解決方法
- [エラーハンドリング](error-handling.md) - エラーの詳細と対処法
- [セッションタイムアウト対処](session-timeout-handling.md) - 長時間実行時の問題
- [既知の問題](troubleshoot/) - 特定のエラーへの対処

### 💡 ベストプラクティス
- [ベストプラクティス集](best-practices.md) - 推奨される使用方法
- [セキュリティガイドライン](security/agent-authentication.md) - セキュアな運用
- [パフォーマンスチューニング](performance-tuning.md) - 最適化のヒント
- [マルチプロジェクト運用](guides/multi-project-guide.md) ([English](guides/multi-project-guide_en.md))

### 🏗️ アーキテクチャ
- [システム概要](architecture/system-overview.md) ([English](architecture/system-overview_en.md))
- [エージェント分離アーキテクチャ](architecture/agent-separation.md) ([English](architecture/agent-separation_en.md))
- [エージェント通信プロトコル](design/agent-communication-protocol.md) ([English](design/agent-communication-protocol_en.md))
- [状態管理システム](unified-state-management.md) - JSONベースの状態管理

### 🤖 エージェント
- [CCQAエージェント](agents/ccqa-agent.md) - コード品質保証
- [CCRAエージェント](agents/ccra-agent.md) - コードレビュー自動化
- [CCTAエージェント](agents/ccta-agent.md) - テスト自動実行
- [動的スケーリング](agents/dynamic-scaling.md) - エージェントの自動スケール

### 🧪 テスト
- [E2Eテスト](testing/e2e-testing.md) - エンドツーエンドテスト
- [統合テスト](testing/integration-testing.md) - コンポーネント間テスト
- [パフォーマンステスト](testing/performance-testing.md) - 性能測定

### 📋 要件定義・設計
- [要件定義](requirements/) - 各機能の要件
- [設計書](design/) - 詳細設計ドキュメント
- [実装履歴](implementation-history/) - 過去の実装記録

### 🔧 高度な機能
- [バックアップ・リストア](backup-restore.md) - データの保護
- [ログローテーション](log-rotation.md) - ログ管理
- [通知機能](guides/notification-guide.md) - Slack/Email通知
- [トレーサビリティ](guides/traceability-guide.md) ([English](guides/traceability-guide_en.md))
- [GitHub Projects連携](github-projects-integration.md) - プロジェクト管理

### 🌐 その他
- [メッセージング移行ガイド](messaging-migration-guide.md) - Redisキューへの移行
- [Redis状態管理](redis-state-management.md) - Redisを使用した状態管理
- [WebSocketリアルタイム更新](websocket-realtime-updates.md) - リアルタイム通信

## 🔍 ドキュメントの探し方

### 目的別
- **すぐに使い始めたい** → [クイックスタートガイド](quick-start.md)
- **詳しくインストールしたい** → [インストールガイド](INSTALL.md)
- **エラーが出た** → [トラブルシューティング](troubleshooting.md)
- **設定を変更したい** → [設定オプション詳細](config-management.md)
- **コマンドを知りたい** → [CLIコマンドリファレンス](api/cli-reference.md)
- **拡張したい** → [プラグイン開発ガイド](api/plugin-development.md)

### レベル別
- **初級者** → クイックスタート、インストールガイド
- **中級者** → 機能別ガイド、APIリファレンス
- **上級者** → アーキテクチャ、設計書、プラグイン開発

## 📝 ドキュメントへの貢献

ドキュメントの改善提案は大歓迎です！
- 誤字・脱字の修正
- より分かりやすい説明への改善
- 新しい使用例の追加
- 図表の追加

改善提案はGitHub Issueでお知らせください。
