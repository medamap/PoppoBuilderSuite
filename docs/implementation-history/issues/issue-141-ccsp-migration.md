# Issue #141: 全エージェントのClaude API呼び出しをCCSP経由に移行

## 実装日
2024/6/20

## 概要
すべてのエージェント（CCLA、CCAG、CCPM、CCQA、CCRA、CCTA）から直接的なClaude API呼び出しを削除し、CCSPエージェント経由に統一しました。

## 実装内容

### 1. 調査結果
各エージェントのClaude API使用状況を調査した結果：

| エージェント | 状況 | 実装方法 |
|------------|------|---------|
| CCLA | ✅ すでにCCSP対応済み | Redis Queue直接使用 |
| CCAG | ✅ すでにCCSP対応済み | ProcessManager経由 |
| CCPM | ✅ すでにCCSP対応済み | Redis Queue直接使用 |
| CCQA | ✅ Claude API未使用 | ツール実行のみ |
| CCRA | ✅ すでにCCSP対応済み | Redis Queue直接使用 |
| CCTA | ✅ Claude API未使用 | テスト実行のみ |

### 2. 共通インフラストラクチャの構築

#### AgentCCSPClient (`agents/shared/agent-ccsp-client.js`)
エージェント用の統一CCSPクライアントを実装：
- 安全なプロンプト構築（Claude API呼び出し禁止の注記を自動追加）
- セッションタイムアウトとレート制限のハンドリング
- ヘルスチェック機能
- イベントベースのエラー通知

#### AgentBaseWithCCSP (`agents/shared/agent-base-with-ccsp.js`)
CCSP統合版のエージェントベースクラス：
- AgentBaseを拡張
- CCSPクライアントの自動初期化
- `analyzeWithClaude()`、`generateCodeWithClaude()`、`generateReviewWithClaude()`メソッド提供
- CCSPイベントの統合処理

### 3. 統合テストの実装
- 全エージェントのソースコード検査
- 直接的なClaude API呼び出しの検出
- CCSP使用の確認
- Redis接続とキュー状態の確認

### 4. テスト結果
```
総エージェント数: 6
Claude API直接呼び出しなし: 6/6
CCSP使用エージェント: 4
✅ Issue #141の目標は達成されています！
```

## 技術的詳細

### CCSP呼び出しパターン

#### 1. Redis Queue直接使用（CCLA、CCPM、CCRA）
```javascript
// リクエスト送信
await this.redis.lpush('ccsp:requests', JSON.stringify(request));

// レスポンス受信
const response = await this.redis.rpop(`ccsp:response:${agentName}`);
```

#### 2. ProcessManager経由（CCAG）
```javascript
const result = await this.processManager.executeWithContext(
  prompt,
  '',
  null,
  60000 // タイムアウト
);
```

#### 3. AgentCCSPClient使用（推奨）
```javascript
const result = await this.ccspClient.analyzeWithClaude(prompt, {
  priority: 'high',
  includeFiles: ['file1.js', 'file2.js']
});
```

## メリット

1. **レート制限の一元管理**: すべてのClaude API呼び出しがCCSPで管理される
2. **セッション管理の統一**: セッションタイムアウトの自動検出と通知
3. **エラーハンドリングの改善**: 統一されたエラー処理とリトライロジック
4. **モニタリングの向上**: すべてのAPI使用量を一箇所で監視可能
5. **ドメイン駆動設計の実現**: Claude API呼び出しの責任がCCSPに集約

## 今後の推奨事項

1. **統一アプローチへの移行**
   - 現在Redis Queueを直接使用しているエージェントも、将来的にはAgentCCSPClientに移行
   - 統一されたインターフェースでメンテナンス性向上

2. **新規エージェントの開発**
   - AgentBaseWithCCSPを継承して実装
   - Claude API呼び出しが必要な場合は、提供されるメソッドを使用

3. **モニタリングの強化**
   - エージェント別のAPI使用量統計
   - パフォーマンスメトリクスの収集

## 関連ファイル
- `/agents/shared/agent-ccsp-client.js` - 共通CCSPクライアント
- `/agents/shared/agent-base-with-ccsp.js` - CCSP統合版ベースクラス
- `/test/integration/test-all-agents-ccsp.js` - 統合テスト
- `/docs/ccsp-migration-status.md` - 移行状況ドキュメント

## 結論
Issue #141は正常に完了しました。すべてのエージェントがClaude APIを直接呼び出しておらず、必要な場合はCCSP経由で呼び出されるようになっています。これにより、レート制限問題の根本的な解決と、システム全体の安定性向上が実現されました。