# Issue #51, #56: スマホ通知機能

## 概要
スマホ通知機能の実装。Discord、Pushover、Telegramを使用したマルチプラットフォーム対応の通知システムを構築。

## 実装日
2025年6月17日

## 実装内容

### 1. 通知マネージャー
`src/notification-manager.js`：
- マルチプラットフォーム対応の統一インターフェース
- 通知の重要度管理（info/warning/error/critical）
- リトライ機能とフォールバック
- 通知履歴の記録
- レート制限対応

### 2. Discord通知
`src/notifiers/discord-notifier.js`：
- Webhook URLを使用した通知
- リッチエンベッドメッセージ
- 色分けによる重要度表示
- メンション機能（@everyone, @here）

### 3. Pushover通知
`src/notifiers/pushover-notifier.js`：
- ネイティブプッシュ通知
- 優先度設定（-2〜2）
- 音声アラート選択
- デバイス指定送信
- 緊急通知の確認要求

### 4. Telegram通知
`src/notifiers/telegram-notifier.js`：
- Bot APIを使用
- Markdownフォーマット対応
- グループ/チャンネル送信
- ファイル添付機能

### 5. 設定
`config/config.json`：
```json
"notifications": {
  "enabled": true,
  "providers": {
    "discord": {
      "enabled": true,
      "webhookUrl": "YOUR_WEBHOOK_URL",
      "mentions": {
        "error": "@here",
        "critical": "@everyone"
      }
    },
    "pushover": {
      "enabled": true,
      "userKey": "YOUR_USER_KEY",
      "apiToken": "YOUR_API_TOKEN",
      "devices": ["iPhone", "iPad"],
      "sounds": {
        "error": "siren",
        "critical": "emergency"
      }
    },
    "telegram": {
      "enabled": true,
      "botToken": "YOUR_BOT_TOKEN",
      "chatId": "YOUR_CHAT_ID"
    }
  },
  "triggers": {
    "issueProcessed": true,
    "errorOccurred": true,
    "processTimeout": true,
    "rateLimitHit": true
  }
}
```

## 通知トリガー

### 自動通知イベント
1. **Issue処理完了**
   - 成功/失敗の結果
   - 処理時間
   - Issue番号とタイトル

2. **エラー発生**
   - エラーレベル別通知
   - スタックトレース（criticalのみ）
   - 自動修復の試行結果

3. **プロセスタイムアウト**
   - タイムアウトしたIssue情報
   - 経過時間
   - 推奨アクション

4. **レート制限**
   - API種別（GitHub/Claude）
   - リセット時刻
   - 待機時間

### 通知フォーマット例

#### Discord
```
🚨 **エラー発生**
**Issue**: #123 - テスト実装
**エラー**: TypeError: Cannot read property 'name' of undefined
**重要度**: High
**時刻**: 2025-06-17 10:30:00
**対処**: 自動修復を試行中...
```

#### Pushover
```
PoppoBuilder Alert
Error in Issue #123
Type: TypeError
Priority: High
Action: Auto-repair attempting
```

#### Telegram
```
🚨 *PoppoBuilder エラー*

*Issue*: #123 - テスト実装
*エラー*: `TypeError`
*重要度*: High
*対処*: 自動修復試行中

[詳細を見る](https://github.com/...)
```

## テスト方法

### 通知テスト
```bash
node test/test-notifications.js

# 個別テスト
npm run test:notify discord "テストメッセージ"
npm run test:notify pushover "テストメッセージ"
npm run test:notify telegram "テストメッセージ"
```

### 統合テスト
PoppoBuilder起動後、エラーを意図的に発生させて通知を確認：
```bash
# エラーログを手動で追加
echo "[ERROR] Test error for notification" >> logs/poppo-$(date +%Y-%m-%d).log
```

## 実装のポイント

### セキュリティ
- APIキーは環境変数から読み込み
- Webhook URLの検証
- 通知内容のサニタイズ

### 信頼性
- 通知失敗時の自動リトライ（3回まで）
- 複数プロバイダーへの同時送信
- 通知履歴による重複防止

### パフォーマンス
- 非同期通知送信
- バッチ処理対応
- レート制限の考慮

## 成果
- リアルタイムでの問題検知
- 迅速な対応が可能
- 運用の透明性向上
- チーム全体での情報共有

## 技術的な詳細

### 通知の優先度マッピング
```javascript
{
  info: { discord: "🔵", pushover: -1, telegram: "ℹ️" },
  warning: { discord: "🟡", pushover: 0, telegram: "⚠️" },
  error: { discord: "🔴", pushover: 1, telegram: "🚨" },
  critical: { discord: "🟣", pushover: 2, telegram: "💀" }
}
```

### エラーハンドリング
- 通知サービスダウン時のフォールバック
- ネットワークエラーの適切な処理
- 設定ミスの検出と警告

## 今後の拡張予定
- Slack連携
- Email通知
- カスタムWebhook対応
- 通知テンプレートのカスタマイズ
- 通知スケジューリング

## 関連ドキュメント
- **設定ガイド**: `docs/guides/notification-setup.md`
- **APIリファレンス**: `docs/api/notification-api.md`
- **テストスクリプト**: `test/test-notifications.js`

## 関連Issue
- Issue #23: プロセス管理ダッシュボード（通知との連携）
- Issue #30, #32: エラーログ収集（エラー通知のトリガー）