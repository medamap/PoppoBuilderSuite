# CCSPエージェント: セッションタイムアウト処理

## 概要

CCSPエージェント（パイちゃん）は、Claude CLIのセッションタイムアウトを自動的に検出し、GitHub Issue経由でユーザーに通知する機能を持っています。これにより、無駄なリトライによるトークン消費を防ぎ、迅速な対応が可能になります。

## 機能

### 1. セッションタイムアウト検出

以下のエラーメッセージを検出します：
- `Invalid API key`
- `Please run /login`
- `API Login Failure`

### 2. 自動通知

セッションタイムアウトを検出すると：
1. すべてのリクエスト処理を一時停止
2. GitHub Issueを自動作成（または既存のIssueを再利用）
3. 緊急通知ラベルを付与（`urgent`, `session-timeout`, `requires-manual-action`）

### 3. 自動復旧

1. 5分ごとにIssueの状態を確認
2. Issueがクローズされたら、Claude CLIの動作確認を実行
3. ログイン成功を確認したら、処理を自動再開

## アーキテクチャ

```
claude-executor.js
    ↓ セッションエラー検出
session-monitor.js
    ↓ Issue作成リクエスト
notification-handler.js
    ↓ GitHub API
GitHub Issue
```

### 主要コンポーネント

#### 1. claude-executor.js
- セッションタイムアウトエラーの検出
- エラー情報の構造化

#### 2. session-monitor.js
- セッション状態の管理
- Issue監視とログイン確認
- ブロックされたリクエストの管理

#### 3. notification-handler.js
- GitHub Issue の作成と管理
- Issue状態の確認
- コメントの追加

## 設定

現在、設定はコード内にハードコードされています：

```javascript
// session-monitor.js
this.config = {
  issueCheckInterval: 5 * 60 * 1000,  // 5分
  initialCheckDelay: 30 * 1000,       // 30秒
  maxRetries: 3
};
```

## 使用方法

### 1. 通常運用

CCSPエージェントを起動するだけで、自動的にセッション監視が開始されます：

```bash
node agents/ccsp/index.js
```

### 2. セッションタイムアウト時

1. CCSPがセッションタイムアウトを検出
2. GitHub Issueが自動作成される
3. ローカル環境で `claude login` を実行
4. ログイン完了後、GitHub Issueをクローズ
5. CCSPが自動的に処理を再開

### 3. テスト

テストスクリプトが用意されています：

```bash
# Claude CLIをログアウト
claude logout

# テストスクリプトを実行
node test/test-session-timeout.js
```

## トラブルシューティング

### Issue が作成されない

1. GitHub CLIが正しくインストールされているか確認
   ```bash
   gh --version
   ```

2. GitHub認証が有効か確認
   ```bash
   gh auth status
   ```

### 自動復旧しない

1. Redisの状態を確認
   ```bash
   redis-cli get ccsp:session:state
   ```

2. CCSPのログを確認
   ```bash
   tail -f logs/ccsp.log | grep -i session
   ```

### ログインしてもブロックが解除されない

1. `claude --version` が正常に動作するか確認
2. Issueが正しくクローズされているか確認
3. 必要に応じてCCSPを再起動

## 状態の確認

### Redis キー

- `ccsp:session:state` - セッション状態
- `ccsp:session:issue` - Issue情報
- `ccsp:notifications` - 通知キュー

### 確認コマンド

```bash
# セッション状態
redis-cli get ccsp:session:state | jq

# Issue情報
redis-cli get ccsp:session:issue | jq

# 通知キューの長さ
redis-cli llen ccsp:notifications
```

## 今後の改善点

1. **設定の外部化**: config.jsonでの設定管理
2. **複数の通知方法**: Slack、メールなどの追加
3. **自動ログイン**: セキュアな方法での実装検討
4. **メトリクス**: セッションタイムアウトの頻度追跡
5. **より詳細なログ**: デバッグ用の詳細情報