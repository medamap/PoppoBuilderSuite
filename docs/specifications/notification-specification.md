# スマホ通知機能 要件定義書

## 1. システム概要

PoppoBuilderにプラグイン可能な通知システムを実装する。各通知プロバイダは独立したモジュールとして実装され、設定により有効/無効を切り替えられる。

## 2. システム構成

### 2.1 モジュール構成

```
src/
├── notifications/
│   ├── notification-manager.js    # 通知管理の中核
│   ├── providers/                 # 通知プロバイダ
│   │   ├── discord-provider.js
│   │   ├── pushover-provider.js
│   │   └── telegram-provider.js
│   └── notification-config.js     # 設定管理
```

### 2.2 クラス設計

#### NotificationManager
- 全体の通知処理を管理
- プロバイダの登録と実行
- 非同期処理とエラーハンドリング

#### NotificationProvider (基底クラス)
- 各プロバイダが実装すべきインターフェース
- `send()`, `validate()`, `isEnabled()` メソッド

#### 各プロバイダクラス
- DiscordProvider
- PushoverProvider  
- TelegramProvider

## 3. 機能仕様

### 3.1 通知送信フロー

1. Issue処理完了時に`NotificationManager.notify()`を呼び出し
2. 有効な全プロバイダに対して並列で通知送信
3. 各プロバイダは独自のAPIを使用して通知
4. エラーは個別にログ記録（全体処理は継続）

### 3.2 設定仕様

#### .poppo/config.json
```json
{
  "notifications": {
    "enabled": true,
    "providers": {
      "discord": {
        "enabled": false,
        "webhookUrl": "${DISCORD_WEBHOOK_URL}",
        "username": "PoppoBuilder",
        "avatarUrl": null,
        "mentions": {
          "success": false,
          "error": true
        }
      },
      "pushover": {
        "enabled": false,
        "appToken": "${PUSHOVER_APP_TOKEN}",
        "userKey": "${PUSHOVER_USER_KEY}",
        "priority": 0,
        "sound": "pushover"
      },
      "telegram": {
        "enabled": false,
        "botToken": "${TELEGRAM_BOT_TOKEN}",
        "chatId": "${TELEGRAM_CHAT_ID}",
        "parseMode": "Markdown",
        "disableNotification": false
      }
    },
    "templates": {
      "success": "✅ Issue #{{issueNumber}} 「{{title}}」の処理が完了しました",
      "error": "❌ Issue #{{issueNumber}} 「{{title}}」の処理中にエラーが発生しました: {{error}}",
      "timeout": "⏱️ Issue #{{issueNumber}} 「{{title}}」の処理がタイムアウトしました"
    },
    "options": {
      "includeExecutionTime": true,
      "includeLabels": true,
      "maxRetries": 3,
      "retryDelay": 1000,
      "timeout": 5000
    }
  }
}
```

### 3.3 環境変数

以下の環境変数をサポート：
- `DISCORD_WEBHOOK_URL`
- `PUSHOVER_APP_TOKEN`
- `PUSHOVER_USER_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

### 3.4 メッセージテンプレート

Handlebars形式のテンプレートをサポート：
- `{{issueNumber}}` - Issue番号
- `{{title}}` - Issueタイトル
- `{{labels}}` - ラベル一覧
- `{{executionTime}}` - 実行時間
- `{{error}}` - エラーメッセージ

## 4. 各プロバイダの仕様

### 4.1 Discord Provider

#### 送信形式
```javascript
{
  "username": "PoppoBuilder",
  "avatar_url": "https://example.com/avatar.png",
  "content": "@everyone Issue処理完了",
  "embeds": [{
    "title": "Issue #123 処理完了",
    "description": "タイトル: テスト",
    "color": 5763719,
    "fields": [
      {"name": "実行時間", "value": "2分30秒", "inline": true},
      {"name": "ラベル", "value": "task:misc", "inline": true}
    ],
    "timestamp": "2025-06-16T12:00:00.000Z"
  }]
}
```

#### 特徴
- リッチな埋め込み表示
- メンション機能（@everyone, @here）
- カラーコード対応

### 4.2 Pushover Provider

#### 送信形式
```javascript
{
  "token": "APP_TOKEN",
  "user": "USER_KEY",
  "title": "PoppoBuilder",
  "message": "Issue #123 処理完了",
  "priority": 0,
  "sound": "pushover",
  "timestamp": 1234567890,
  "url": "https://github.com/medamap/PoppoBuilderSuite/issues/123",
  "url_title": "Issueを開く"
}
```

#### 優先度
- -2: 無音（通知のみ）
- -1: 静音
- 0: 通常（デフォルト）
- 1: 高優先度
- 2: 緊急（要確認応答）

### 4.3 Telegram Provider

#### 送信形式
```javascript
{
  "chat_id": "CHAT_ID",
  "text": "*Issue #123 処理完了*\n\nタイトル: テスト\n実行時間: 2分30秒",
  "parse_mode": "Markdown",
  "disable_notification": false,
  "reply_markup": {
    "inline_keyboard": [[
      {"text": "Issueを開く", "url": "https://github.com/..."}
    ]]
  }
}
```

#### 特徴
- Markdown/HTML形式
- インラインボタン
- リプライキーボード対応

## 5. エラーハンドリング

### 5.1 エラー種別

1. **設定エラー**
   - 必須パラメータ不足
   - 無効な設定値
   
2. **ネットワークエラー**
   - タイムアウト
   - 接続エラー
   
3. **APIエラー**
   - 認証エラー
   - レート制限
   - 無効なリクエスト

### 5.2 リトライ戦略

- 最大3回リトライ（設定可能）
- 指数バックオフ（1秒、2秒、4秒）
- ネットワークエラーのみリトライ

## 6. ログ仕様

### 6.1 ログレベル

- `INFO`: 通知送信成功
- `WARN`: リトライ発生、部分的失敗
- `ERROR`: 通知送信失敗

### 6.2 ログフォーマット

```
[2025-06-16 12:00:00] [INFO] [NotificationManager] 通知送信開始: Issue #123
[2025-06-16 12:00:01] [INFO] [DiscordProvider] 通知送信成功
[2025-06-16 12:00:01] [ERROR] [PushoverProvider] 通知送信失敗: 401 Unauthorized
```

## 7. テスト仕様

### 7.1 単体テスト

- 各プロバイダの送信ロジック
- 設定のバリデーション
- テンプレート処理

### 7.2 統合テスト

- 実際のAPIへの送信（テスト環境）
- エラー時の動作確認
- 複数プロバイダの並列処理

### 7.3 テストコマンド

```bash
# 通知テスト送信
npm run test-notification -- --provider=discord
npm run test-notification -- --all
```

## 8. 移行計画

### Phase 1: Discord Provider
- 最も簡単な実装
- Webhook URLのみで動作
- 1週間で実装完了目標

### Phase 2: Pushover Provider
- 有料アプリだが使いやすい
- API実装は単純
- 1週間で実装完了目標

### Phase 3: Telegram Provider
- Bot作成が必要
- 最も高機能
- 2週間で実装完了目標

## 9. 制限事項

### 9.1 レート制限

- Discord: 30リクエスト/分
- Pushover: 7,500リクエスト/月（無料枠）
- Telegram: 30リクエスト/秒

### 9.2 メッセージサイズ

- Discord: 2000文字（content）、6000文字（embed）
- Pushover: 1024文字
- Telegram: 4096文字

---
作成日: 2025/06/16
作成者: PoppoBuilder Dogfooding Task