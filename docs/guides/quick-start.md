# PoppoBuilder Suite クイックスタートガイド

## 前提条件

- Node.js 18以上
- Claude Code CLI がインストール・設定済み
- GitHub アクセス権限を持つ Git 設定
- macOS、Linux、またはWindows上のWSL2

## 初期セットアップ

### 1. リポジトリのクローン

```bash
cd ~/Projects  # または任意のディレクトリ
git clone https://github.com/medamap/PoppoBuilderSuite.git
cd PoppoBuilderSuite
```

### 2. 依存関係のインストール（利用可能になり次第）

```bash
npm install
```

### 3. Poppoリポジトリの初期化

```bash
# 必要なディレクトリを作成
mkdir -p poppo-repo/{config,tasks,status,results,projects}

# 初期設定を作成
cat > poppo-repo/config/system.json << EOF
{
  "version": "1.0.0",
  "cicd": {
    "pollInterval": 30000,
    "maxConcurrentJobs": 3,
    "defaultTimeout": 300000
  },
  "agents": {
    "ccpm": { "enabled": true },
    "ccag": { "enabled": true },
    "ccra": { "enabled": false },
    "ccta": { "enabled": false },
    "ccma": { "enabled": false }
  }
}
EOF
```

### 4. CICDサービスの起動

```bash
# ターミナルで実行
node cicd/scheduler.js

# 以下のような出力が表示されます：
# [CICD] PoppoBuilder CICD starting...
# [CICD] Polling interval: 30 seconds
# [CICD] Waiting for tasks...
```

## 基本的な使い方

### 1. 最初のタスクを登録

Claude Codeで：
```
ぽっぽ、APIに hello world エンドポイントを追加するタスクを作成して
```

これにより：
1. MCPがコマンドを受信
2. CCGMがpoppo-repo/tasks/にタスクを作成
3. CICDがタスクを検出
4. CCPMが指示書を生成
5. CCAGが変更を実装

### 2. ステータス確認

```
ぽっぽ、現在の状況は？
```

以下の情報が表示されます：
- アクティブなジョブ
- キューにあるタスク
- 最近の完了タスク
- エラー情報

### 3. 結果の確認

```
ぽっぽ、task-001の結果を見せて
```

## プロジェクトの操作

### 1. 新しいプロジェクトの初期化

```
ぽっぽ、ExpressとTypeScriptで「my-api」プロジェクトを初期化して
```

### 2. 機能の追加

```
ぽっぽ、my-apiプロジェクトにユーザー認証を追加して
```

### 3. テストの実行

```
ぽっぽ、my-apiプロジェクトのテストを実行して
```

## セルフホスティング開発

### 1. 機能改善のIssue作成

```
ぽっぽ、Issue作成：タスクファイルにJSONスキーマ検証を追加
```

### 2. PoppoBuilderに実装させる

```
ぽっぽ、Issue #1に取り組んで
```

### 3. レビューとマージ

```
ぽっぽ、Issue #1のPRを見せて
```

## トラブルシューティング

### CICDがタスクを検出しない場合

1. CICDが実行中か確認
2. タスクファイルが正しい形式か確認
3. `cicd/logs/`のログを確認

### エージェントのサブプロセスが失敗する場合

1. `poppo-repo/results/`でエージェント出力を確認
2. Claude Code CLIが動作しているか確認
3. 指示書の形式を確認

### 状態が破損した場合

1. CICDを停止
2. `poppo-repo/status/state.json`を確認
3. 修正またはバックアップから復元
4. CICDを再起動

## 高度な使い方

### カスタムエージェント設定

`poppo-repo/config/agents/{エージェント名}.json`を編集：

```json
{
  "timeout": 600000,
  "retries": 3,
  "environment": {
    "CUSTOM_VAR": "value"
  }
}
```

### 優先タスク

タスク作成時に優先フラグを追加：

```
ぽっぽ、緊急：本番環境のエラーハンドリングのバグを修正して
```

### バッチ操作

関連する複数のタスクを一括登録：

```
ぽっぽ、バッチタスク：
1. すべての依存関係を更新
2. セキュリティ監査を実行
3. 見つかった脆弱性を修正
```

## ベストプラクティス

1. **タスクは集中的に**: 1つの機能につき1タスク
2. **明確な説明を使用**: 要件について具体的に記述
3. **定期的にステータス確認**: 長時間実行タスクを監視
4. **PRをレビュー**: 自動化されていても人間のレビューは重要
5. **状態をバックアップ**: poppo-repoの定期バックアップ

## 次のステップ

- [アーキテクチャ概要](../architecture/system-overview.md)を読む
- [エージェントの役割](../architecture/agents.md)について学ぶ
- PoppoBuilder自体に貢献する！