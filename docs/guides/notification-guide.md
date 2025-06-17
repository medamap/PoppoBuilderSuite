# スマホ通知機能ガイド

## 概要
PoppoBuilderの処理結果をスマートフォンに通知する機能です。Discord、Pushover、Telegramの3つのサービスに対応しています。

## 設定方法

### 1. Discord通知の設定

1. DiscordでWebhookを作成
   - サーバー設定 → 連携サービス → Webhook → 新しいWebhookを作成
   - Webhook URLをコピー

2. 環境変数を設定
   ```bash
   export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
   ```

3. config.jsonで有効化
   ```json
   {
     "notifications": {
       "enabled": true,
       "providers": {
         "discord": {
           "enabled": true,
           "webhookUrl": ""  // 環境変数から自動読み込み
         }
       }
     }
   }
   ```

### 2. Pushover通知の設定

1. Pushoverアカウントを作成
   - https://pushover.net でアカウント作成
   - User Keyを取得
   - 新しいApplicationを作成してAPI Tokenを取得

2. 環境変数を設定
   ```bash
   export PUSHOVER_API_TOKEN="your-api-token"
   export PUSHOVER_USER_KEY="your-user-key"
   ```

3. config.jsonで有効化
   ```json
   {
     "notifications": {
       "enabled": true,
       "providers": {
         "pushover": {
           "enabled": true,
           "apiToken": "",  // 環境変数から自動読み込み
           "userKey": ""    // 環境変数から自動読み込み
         }
       }
     }
   }
   ```

### 3. Telegram通知の設定

1. Telegram Botを作成
   - @BotFatherに `/newbot` コマンドを送信
   - Bot名とusernameを設定
   - Bot Tokenを取得

2. Chat IDを取得
   - Botにメッセージを送信
   - `https://api.telegram.org/bot<YourBOTToken>/getUpdates` にアクセス
   - chat.idを確認

3. 環境変数を設定
   ```bash
   export TELEGRAM_BOT_TOKEN="your-bot-token"
   export TELEGRAM_CHAT_ID="your-chat-id"
   ```

4. config.jsonで有効化
   ```json
   {
     "notifications": {
       "enabled": true,
       "providers": {
         "telegram": {
           "enabled": true,
           "botToken": "",  // 環境変数から自動読み込み
           "chatId": ""     // 環境変数から自動読み込み
         }
       }
     }
   }
   ```

## 通知イベントの設定

config.jsonで通知するイベントを選択できます：

```json
{
  "notifications": {
    "events": {
      "taskStarted": true,     // タスク開始時
      "taskCompleted": true,   // タスク完了時
      "taskFailed": true,      // タスク失敗時
      "errorOccurred": true,   // エラー発生時
      "rateLimit": true,       // レート制限時
      "autoRepair": true       // 自動修復時
    }
  }
}
```

## テンプレートのカスタマイズ

通知メッセージのテンプレートをカスタマイズできます：

```json
{
  "notifications": {
    "templates": {
      "task_completed": {
        "title": "✅ タスク完了",
        "body": "Issue #{{issueNumber}} ({{title}}) の処理が完了しました！"
      }
    }
  }
}
```

利用可能なプレースホルダー：
- `{{issueNumber}}` - Issue番号
- `{{title}}` - Issueタイトル
- `{{repository}}` - リポジトリ名
- `{{url}}` - Issue/PRのURL
- `{{error}}` - エラーメッセージ
- `{{message}}` - 汎用メッセージ

## テスト方法

通知機能が正しく設定されているかテストします：

```bash
# 環境変数を設定してテスト
export DISCORD_WEBHOOK_URL="..."
npm run test:notifications
```

## トラブルシューティング

### 通知が届かない場合

1. **環境変数の確認**
   ```bash
   echo $DISCORD_WEBHOOK_URL
   echo $PUSHOVER_API_TOKEN
   echo $TELEGRAM_BOT_TOKEN
   ```

2. **ログの確認**
   ```bash
   tail -f logs/poppo-$(date +%Y-%m-%d).log | grep NotificationManager
   ```

3. **ネットワーク接続の確認**
   - ファイアウォールやプロキシの設定を確認
   - APIエンドポイントへのアクセスを確認

### エラーメッセージの対処

- `"Invalid webhook URL"` - Discord Webhook URLの形式を確認
- `"User not found"` - Pushover User Keyを確認
- `"Unauthorized"` - API Token/Bot Tokenの有効性を確認
- `"Rate limit exceeded"` - 少し時間を置いてから再試行

## セキュリティ上の注意

- APIキーやトークンは環境変数で管理し、コードにハードコードしない
- config.jsonにはトークンを直接記載しない
- .envファイルを使用する場合は.gitignoreに追加
- トークンが漏洩した場合は速やかに無効化・再生成

## 使用例

```bash
# PoppoBuilderを起動（通知機能有効）
npm start

# コンソール出力例
PoppoBuilder が起動しました
📢 通知機能: 有効 (Discord, Telegram)

# Issue処理時の通知
[INFO] Discord: タスク処理開始 - Issue #123 の処理を開始しました
[INFO] Telegram: タスク処理開始 - Issue #123 の処理を開始しました
```