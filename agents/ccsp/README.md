# CCSPエージェント（パイちゃん）

Claude Code SPawner - PoppoBuilderファミリーのClaude Code呼び出し専任エージェント

## 概要

パイちゃんは、PoppoBuilderファミリー全体のClaude Code呼び出しを一元管理するエージェントです。
Redis Queueを介して他のエージェントからのリクエストを受け取り、Claude CLIを実行して結果を返します。

## 主な機能

- Claude Code呼び出しの一元管理
- レート制限の自動検出と待機処理
- 同時実行数の制限（最大2）
- "Execute error%"の自動リカバリー
- 特殊文字を含むプロンプトの安全な処理

## 起動方法

```bash
# 依存関係のインストール
cd agents/ccsp
npm install

# 起動
npm start

# または
node index.js
```

## Redis Queue仕様

### リクエストキュー: `ccsp:requests`

```json
{
  "requestId": "unique-request-id",
  "fromAgent": "ccla",
  "type": "analyze",
  "prompt": "メインプロンプト",
  "systemPrompt": "システムプロンプト（オプション）",
  "includeFiles": ["path/to/file1.md", "path/to/file2.md"],
  "modelPreference": {
    "primary": "sonnet",
    "fallback": "opus"
  },
  "context": {
    "workingDirectory": "/path/to/work",
    "timeout": 300000,
    "priority": "high"
  },
  "timestamp": "2025-01-19T12:00:00Z"
}
```

### レスポンスキュー: `ccsp:responses:{fromAgent}`

```json
{
  "requestId": "unique-request-id",
  "success": true,
  "result": "Claude Codeの実行結果",
  "executionTime": 45000,
  "timestamp": "2025-01-19T12:00:45Z"
}
```

## エラーレスポンス

```json
{
  "requestId": "unique-request-id",
  "success": false,
  "error": "エラーメッセージ",
  "timestamp": "2025-01-19T12:00:45Z"
}
```

## レート制限処理

Claude Codeがレート制限を返した場合（`メッセージ|エポック秒`形式）、パイちゃんは：

1. レート制限を検出
2. 解除時刻まで新規リクエストの処理を停止
3. 解除時刻+1分後に処理を再開

## 環境変数

- `REDIS_HOST`: Redisホスト（デフォルト: localhost）
- `REDIS_PORT`: Redisポート（デフォルト: 6379）

## ログ

ログは以下に出力されます：
- コンソール（カラー表示）
- `../../logs/ccsp.log`

## 注意事項

- Claude CLIがインストールされ、パスが通っている必要があります
- Redisサーバーが起動している必要があります
- 同時実行数は最大2に制限されています（Claude Codeの制約）