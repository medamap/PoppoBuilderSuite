# Issue #27: エージェント分離アーキテクチャ

## 概要
エージェント分離アーキテクチャの実装（CCPM, CCAG等）。単一プロセスで行っていた処理を機能別エージェントに分離する基盤を実装。

## 実装日
2025年6月16日

## 実装内容

### 1. エージェント基盤クラス
`agents/shared/agent-base.js`：
- すべてのエージェントが継承する基底クラス
- メッセージングシステム（ファイルベース）
- ハートビート機能
- タスク管理機能
- 自動ポーリング機能

### 2. CCPMエージェント
`agents/ccpm/index.js` - Code Change Process Manager（コードレビュー専門）：
- **機能**:
  - コードレビュー（静的解析 + Claude分析）
  - リファクタリング提案
  - セキュリティ監査
- **特徴**:
  - パターンベースの問題検出
  - Claudeによる高度な分析
  - 詳細なレビュー結果の生成

### 3. CCAGエージェント
`agents/ccag/index.js` - Code Change Assistant Generator（ドキュメント生成専門）：
- **機能**:
  - APIドキュメント生成
  - コメント作成
  - README更新
  - ドキュメント翻訳（日英）
- **特徴**:
  - 多言語対応（ja/en）
  - テンプレートベース生成
  - Claudeによる自然な文章生成

### 4. エージェントコーディネーター
`agents/core/agent-coordinator.js`：
- エージェントのライフサイクル管理
- タスクの振り分けと負荷分散
- エージェント間通信の調整
- ヘルスチェックと自動再起動

### 5. 統合インターフェース
`src/agent-integration.js`：
- minimal-poppo.jsとの統合
- Issueからタスクタイプへのマッピング
- 結果の統合とレポート生成

## ディレクトリ構造
```
agents/
├── core/               # コーディネーター
│   └── agent-coordinator.js
├── ccpm/              # Code Change Process Manager
│   └── index.js
├── ccag/              # Code Change Assistant Generator
│   └── index.js
└── shared/            # 共有コンポーネント
    └── agent-base.js

messages/              # エージェント間通信用
├── core/
│   ├── inbox/
│   └── outbox/
├── ccpm/
│   ├── inbox/
│   └── outbox/
└── ccag/
    ├── inbox/
    └── outbox/
```

## 設定
`config/config.json`：
```json
"agentMode": {
  "enabled": false,    // デフォルトは無効
  "pollingInterval": 3000,
  "autoRestart": true,
  "taskMapping": {
    "labels": { ... },
    "keywords": { ... }
  }
}
```

## 使用方法

### エージェントモードでの起動
```bash
npm run start:agents
# または
node scripts/start-agents.js
```

### 通常モードでの起動（従来通り）
```bash
npm start
```

### テスト実行
```bash
node test/test-agent-mode.js
```

## 動作確認済み項目
- ✅ エージェント基盤クラスの実装
- ✅ CCPM/CCAGエージェントの実装
- ✅ ファイルベースメッセージング
- ✅ エージェント間通信プロトコル
- ✅ タスク振り分けと負荷分散
- ✅ ハートビートによる死活監視
- ✅ エラー時の自動再起動
- ✅ 既存システムとの統合

## 技術的な詳細

### メッセージングシステム
- **Phase 1**: ファイルベース（JSON）
- **ポーリング間隔**: 3秒（コーディネーター）、5秒（エージェント）
- **メッセージ形式**: 標準化されたJSONフォーマット
- **非同期処理**: Promise/async-awaitベース

### タスクマッピング
- **ラベルベース**: `review` → `code-review`タスク
- **キーワードベース**: 本文に「レビュー」→ `code-review`タスク
- **複数タスク**: 1つのIssueから複数のタスクを生成可能

## 成果
- 機能の分離により保守性が向上
- 並列処理による処理効率の改善
- 専門エージェントによる高品質な処理
- 水平スケーリングの基盤確立

## 今後の拡張（Phase 2-4）
- **Phase 2**: メッセージキュー導入（Redis/RabbitMQ）
- **Phase 3**: 動的スケーリング機能
- **Phase 4**: Docker/Kubernetes対応

## 注意事項
- エージェントモードはデフォルトで無効
- 有効化するには`config.json`で`agentMode.enabled: true`に設定
- または`npm run start:agents`で一時的に有効化して起動
- エージェントプロセスは自動的に子プロセスとして管理される

## 関連ドキュメント
- **アーキテクチャ設計**: `docs/architecture/agent-separation.md`
- **通信プロトコル**: `docs/design/agent-communication-protocol.md`

## 関連Issue
- Issue #30, #32: エラーログ収集Phase 1（CCLAエージェントの追加）
- Issue #37: エラーログ収集Phase 2（CCLAエージェントの拡張）