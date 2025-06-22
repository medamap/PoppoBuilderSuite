# CCSP緊急停止機能

## 概要
CCSPエージェント（パイちゃん）に、レート制限やセッションタイムアウトを検出した際に完全に停止する緊急停止機能を実装しました。これにより、エラー発生時の無限再試行を防ぎ、API制限の無駄な消費を防止します。

## 実装内容

### 1. EmergencyStopクラス
`agents/ccsp/emergency-stop.js` に実装された緊急停止管理クラスです。

#### 主な機能:
- レート制限エラーの検出
- セッションタイムアウトの検出
- 緊急停止の実行
- GitHub Issue経由での通知

#### エラーパターン:
```javascript
// レート制限
"Claude AI usage limit reached|1234567890"

// セッションタイムアウト
"Invalid API key"
"Please run /login"
"API Login Failure"
```

### 2. CCSPエージェントへの統合
`agents/ccsp/index.js` に以下の変更を実施:

1. EmergencyStopインスタンスの作成
2. Claude実行結果のエラーチェック
3. 緊急停止の発動

```javascript
// エラーチェックの実装
if (!result.success && result.error) {
  const shouldStop = this.emergencyStop.checkError(result.error);
  if (shouldStop) {
    return; // プロセスが停止される
  }
}
```

### 3. 通知機能の拡張
`agents/ccsp/notification-handler.js` に緊急停止通知機能を追加:

- GitHub Issueの自動作成
- 停止理由の詳細な記載
- 復旧手順の案内

## 動作フロー

1. **エラー検出**
   - ClaudeExecutorがエラーレスポンスを返す
   - EmergencyStopがエラーメッセージをチェック

2. **緊急停止判定**
   - レート制限またはセッションタイムアウトを検出
   - 停止理由と再開時刻を記録

3. **通知送信**
   - NotificationHandlerにより自動通知
   - GitHub Issueが作成される

4. **プロセス停止**
   - 1秒後にプロセスを完全終了
   - exit code 1で終了

## テスト方法

テストスクリプト `test/test-emergency-stop.js` を使用:

```bash
node test/test-emergency-stop.js
```

このスクリプトは以下をシミュレート:
- レート制限エラー
- セッションタイムアウトエラー

**注意**: 実際のClaude APIは呼び出されません（モック使用）

## 復旧手順

### レート制限の場合
1. 指定された時刻まで待機
2. CCSPエージェントを再起動

### セッションタイムアウトの場合
1. ターミナルで `claude login` を実行
2. ログイン完了後、GitHub Issueをクローズ
3. CCSPエージェントを再起動

## 設定とカスタマイズ

現在の設定:
- プロセス終了待機時間: 1秒
- 緊急停止後の自動再開: なし（手動再起動が必要）

## 影響と効果

### Before（問題）
- エラー発生後も2秒ごとに再試行を継続
- レート制限が即座に枯渇
- セッションタイムアウトでも処理を継続

### After（解決）
- エラー検出時に即座に停止
- APIリソースの保護
- 明確な通知と復旧手順
- 無駄な処理の防止

## 関連ファイル
- `agents/ccsp/emergency-stop.js` - 緊急停止クラス
- `agents/ccsp/index.js` - メイン統合
- `agents/ccsp/notification-handler.js` - 通知機能
- `test/test-emergency-stop.js` - テストスクリプト