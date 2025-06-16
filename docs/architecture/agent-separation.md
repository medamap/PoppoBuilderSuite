# エージェント分離アーキテクチャ

## 概要

PoppoBuilderの処理を機能別のエージェントに分離し、各エージェントが専門的な処理を担当する分散アーキテクチャです。

## エージェント構成

### 1. PoppoBuilder Core (コーディネーター)
- 全体の統括・調整
- Issueの振り分け
- エージェント間の連携制御
- 最終的な結果の集約

### 2. CCPM (Code Change Process Manager)
- コードレビュー
- 修正提案の生成
- コード品質チェック
- リファクタリング提案

### 3. CCAG (Code Change Assistant Generator)
- ドキュメント生成
- コメント作成
- README/設計書の更新
- 多言語対応

### 4. CCQA (Code Change Quality Assurance) ※Phase 2で実装
- テスト実行
- 品質チェック
- セキュリティ検査
- パフォーマンス分析

## エージェント間通信

### Phase 1: プロセス間通信（IPC）
- 共有ファイルシステムを使用
- JSONファイルによるメッセージ交換
- ポーリングベースの監視

### Phase 2: メッセージキュー
- Redis Pub/Sub または RabbitMQ
- 非同期メッセージング
- イベントドリブンアーキテクチャ

## メッセージフォーマット

```json
{
  "id": "unique-message-id",
  "timestamp": "2025-06-16T10:00:00Z",
  "from": "agent-name",
  "to": "agent-name",
  "type": "request|response|notification",
  "taskId": "issue-27",
  "action": "code-review|generate-docs|etc",
  "payload": {
    // タスク固有のデータ
  },
  "status": "pending|processing|completed|failed",
  "result": {
    // 処理結果
  }
}
```

## ディレクトリ構造

```
agents/
├── core/           # PoppoBuilder Core
├── ccpm/           # Code Change Process Manager
├── ccag/           # Code Change Assistant Generator
└── shared/         # 共有ライブラリ・ユーティリティ
    ├── messaging/  # メッセージング機能
    └── config/     # 共通設定

messages/           # Phase 1でのメッセージ交換用
├── inbox/         # 各エージェントの受信ボックス
└── outbox/        # 各エージェントの送信ボックス
```

## 実装フェーズ

### Phase 1: 基本実装（現在）
1. エージェント基盤クラスの作成
2. CCPM、CCAGエージェントの実装
3. ファイルベースのメッセージング
4. 基本的なタスク振り分け

### Phase 2: メッセージキュー導入
1. Redis/RabbitMQの統合
2. 非同期メッセージング
3. イベントドリブン化

### Phase 3: スケーリング機能
1. 動的エージェント起動
2. 負荷分散
3. ヘルスチェック

### Phase 4: コンテナ化
1. Docker対応
2. Kubernetes統合
3. オートスケーリング

## 利点

1. **専門化**: 各エージェントが特定の機能に特化
2. **スケーラビリティ**: 必要に応じてエージェントを増減
3. **耐障害性**: 一部のエージェントが停止してもシステム継続
4. **メンテナンス性**: 個別にアップデート・再起動可能
5. **パフォーマンス**: 並列処理による高速化

## セキュリティ考慮事項

1. エージェント間の認証
2. メッセージの暗号化（Phase 2以降）
3. アクセス制御
4. 監査ログ

## モニタリング

1. 各エージェントの状態監視
2. メッセージフローの可視化
3. パフォーマンスメトリクス
4. エラー追跡