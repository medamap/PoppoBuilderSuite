# PoppoBuilder トラブルシューティング

## 発生日時: 2025-06-16

## 問題の概要
PoppoBuilderシステムが正常に動作せず、以下の症状が発生している：
- PoppoBuilderプロセスの異常終了
- 孤児プロセスの発生
- GitHub Issueのprocessingラベルが残存
- ダッシュボードのFATALエラー
- ポート競合

## 詳細な問題分析

### 1. プロセス管理の根本的問題

#### 問題の本質
PoppoBuilderが独立プロセス方式（independent-process-manager.js）でタスクを実行しているが、親プロセスとの関係管理が不適切。

#### 症状
- PoppoBuilderメインプロセスが13:07頃に停止
- Issue #29, #30の処理プロセス（PID: 58859, 58868, 59942）が孤児化
- processingラベルが付いたままIssueが放置

#### 根本原因
1. 親子プロセスの関係が適切に管理されていない
2. プロセス終了時のクリーンアップ機構が不完全
3. エラー発生時の適切なリカバリーがない
4. プロセスグループやセッション管理が実装されていない

### 2. ダッシュボードのnullエラー

#### 問題の本質
ダッシュボードサーバーがprocessManagerオブジェクトにアクセスする際、nullを参照している。

#### 症状
```
TypeError: Cannot read properties of null (reading 'getAllProcesses')
at WebSocketServer.<anonymous> (/dashboard/server/index.js:114:40)
```

#### 根本原因
1. processManagerの初期化タイミングの問題
2. WebSocket接続時の状態チェック不足
3. エラー時のフォールバック処理がない

### 3. ポート競合問題

#### 問題の本質
ポート3001が前回のプロセスによって占有されたまま。

#### 症状
```
Error: listen EADDRINUSE: address already in use ::1:3001
```

#### 根本原因
1. 前回のダッシュボードプロセスが正常終了していない
2. プロセス終了時のポート解放処理が不完全
3. 起動前のポートチェックがない

### 4. GitHub Issue状態管理の問題

#### 問題の本質
processingラベルのライフサイクル管理が不完全。

#### 症状
- Issue #20, #23, #28, #29, #30がprocessing状態のまま
- システムのコメントにもprocessingが付いている

#### 根本原因
1. エラー時のラベル更新処理が欠落
2. プロセス異常終了時のクリーンアップなし
3. タイムアウト処理が未実装
4. ラベルの状態遷移ルールが不明確

### 5. ログとエラー処理の問題

#### 問題の本質
エラーが適切にハンドリングされず、システム全体が停止。

#### 症状
- FATALエラーでプロセスが即座に停止
- エラー情報が不十分
- リカバリー不可能

#### 根本原因
1. uncaughtExceptionハンドラーが不適切
2. エラーリカバリー機構がない
3. グレースフルシャットダウン未実装

## 解決策と対処順序

### フェーズ1: 緊急対処（即座に実行）

#### 1.1 孤児プロセスの終了
```bash
# 実行中のタスクプロセスを特定して終了
ps aux | grep -E "task-issue|wrapper-issue" | grep -v grep | awk '{print $2}' | xargs kill -9
```

#### 1.2 ポート3001の解放
```bash
# ポート3001を使用しているプロセスを終了
lsof -ti:3001 | xargs kill -9
```

#### 1.3 processingラベルのクリーンアップ
- GitHub APIを使用して手動でラベルを削除
- 各Issueの状態を確認して適切なラベルに更新

### フェーズ2: 短期的修正（本日中に実装）

#### 2.1 ダッシュボードのnullチェック追加
```javascript
// dashboard/server/index.js の修正
if (!processManager) {
  console.error('ProcessManager not initialized');
  return;
}
```

#### 2.2 基本的なエラーハンドリング改善
- try-catchブロックの追加
- エラー時のフォールバック処理
- ログ出力の改善

#### 2.3 プロセス終了時のクリーンアップ
```javascript
process.on('SIGTERM', async () => {
  await cleanupProcesses();
  await updateGitHubLabels();
  process.exit(0);
});
```

### フェーズ3: 中期的改善（今週中に実装）

#### 3.1 プロセス管理の改善
- プロセスグループの実装
- 親子関係の明確化
- ハートビート機構の追加

#### 3.2 状態管理の強化
- ラベルライフサイクルの定義
- 自動タイムアウト処理
- 状態遷移の監視

#### 3.3 ログシステムの改善
- 構造化ログの実装
- エラートレースの強化
- ログローテーションの改善

### フェーズ4: 長期的改善（今月中に検討・実装）

#### 4.1 アーキテクチャの見直し
- プロセス管理方式の再検討
- メッセージキューの導入検討
- 分散システムへの移行検討

#### 4.2 監視・回復機能
- ヘルスチェック機能
- 自動リカバリー機構
- アラート通知システム

#### 4.3 自己修復機能
- エラーパターンの学習
- 自動修復スクリプト
- 予防的メンテナンス

## 実施記録

### 2025-06-16 10:41
- 問題の初期調査開始
- TroubleShoot.md作成

### 2025-06-16 10:48
- フェーズ1: 緊急対処を実施
  - 孤児プロセスを確認（現在のClaude以外は見つからず）
  - ポート3001の確認（使用プロセスなし）
  - processingラベルの確認（既にクリーンアップ済み）

### 2025-06-16 10:56
- フェーズ2: 短期的修正を実施
  - ダッシュボードのnullチェック追加
    - minimal-poppo.jsでProcessStateManagerを適切に初期化
    - DashboardServerにprocessStateManagerインスタンスを渡すよう修正
  - 基本的なエラーハンドリング改善
    - uncaughtExceptionハンドラーでグレースフルシャットダウンを実装
  - プロセス終了時のクリーンアップ追加
    - SIGTERMハンドラーを追加
    - グレースフルシャットダウン関数を実装
    - ProcessStateManagerにstop()メソッドを追加

### 2025-06-16 11:13
- ダッシュボードのWebSocket null pointer問題の追加修正
  - 根本原因: dashboard無効時もstart()が呼ばれていた
  - dashboard/server/index.jsに追加の安全チェック実装済み確認
    - setupWebSocket()でwssの存在確認
    - WebSocket接続時のstateManagerチェック強化
    - 各メソッドでの状態確認
  - minimal-poppo.jsにダッシュボード起動条件追加済み確認
    - config.dashboard.enabledがtrueの場合のみstart()を呼ぶ
  - 一時的な回避策: config.jsonでdashboard.enabled: falseに設定

### 実施予定
- [x] フェーズ1: 緊急対処
- [x] フェーズ2: 短期的修正
- [ ] フェーズ3: 中期的改善
- [ ] フェーズ4: 長期的改善

## 修正後の動作確認

### 推奨される確認手順

1. **PoppoBuilderの再起動**
```bash
cd /Volumes/PoppoSSD2T/Projects/ClaudeCodeProjects/AIBuildSystem/PoppoBuilderSuite
npm start
```

2. **ダッシュボードの確認**
```bash
# 別ターミナルで
open http://localhost:3001
```

3. **テストIssueの作成**
```bash
gh issue create --title "トラブルシューティング後の動作確認" --body "システムが正常に動作していることを確認してください" --label "task:misc" --repo medamap/PoppoBuilderSuite
```

4. **グレースフルシャットダウンのテスト**
```bash
# Ctrl+C でSIGINTを送信して正常終了を確認
```

## 今後の改善推奨事項

1. **独立プロセス管理の見直し**
   - プロセスグループの実装
   - 親子関係の明確化

2. **エラー回復機能の実装**
   - 自動リトライ機構
   - エラーパターンの学習

3. **監視機能の強化**
   - ヘルスチェックAPI
   - アラート通知

## 追加記録

### 2025-06-17 01:07（ユーザー: 寝ている間の対応）
- **状況確認**
  - processingラベル付きIssue: #32, #34, #35の3つ
  - 実行中プロセス: 
    - Issue #32: PID 67597 (wrapper-issue-32.js)
    - Issue #34: PID 67588 (wrapper-issue-34.js)
    - Issue #35: プロセスなし（孤立）
  - PoppoBuilder本体は正常稼働中（PID 63684）

- **実施内容**
  - Issue #35の孤立したprocessingラベルを削除
  - Issue #32と#34は現在処理中のため監視継続
  - maxConcurrent=2の制限により、Issue #36は待機中

- **観察事項**
  - 独立プロセス方式が正常に機能している
  - dogfoodingタスクが複数キューイングされている
  - ダッシュボードは無効化されたまま安定稼働

## 関連ファイル
- `/logs/poppo-2025-06-16.log` - メインプロセスログ
- `/logs/processes-2025-06-16.log` - プロセス管理ログ
- `/dashboard/server/index.js` - ダッシュボードサーバー
- `/src/independent-process-manager.js` - プロセス管理
- `/src/minimal-poppo.js` - メインプロセス
- `/src/process-state-manager.js` - プロセス状態管理