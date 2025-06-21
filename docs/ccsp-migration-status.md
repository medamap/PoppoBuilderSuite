# CCSP移行状況ドキュメント

## 概要
このドキュメントは、各エージェントのClaude API呼び出しがCCSP経由に移行されているかの状況をまとめたものです。

## 移行状況サマリー

| エージェント | 状況 | 移行方法 | 備考 |
|------------|------|---------|------|
| PoppoBuilder Core | ✅ 完了 | CCSPClient使用 | Issue #139で実装 |
| CCLA | ✅ 完了 | Redis Queue直接使用 | advanced-analyzer.jsで実装済み |
| CCAG | ✅ 完了 | ProcessManager経由 | ProcessManagerがCCSP対応済み |
| CCPM | ✅ 完了 | Redis Queue直接使用 | index.jsで確認済み |
| CCQA | ❓ 要確認 | - | Claude API使用箇所の調査が必要 |
| CCRA | ✅ 完了 | Redis Queue直接使用 | review-generator.jsで確認済み |
| CCTA | ❓ 要確認 | - | 実装状況の確認が必要 |
| CCSP | N/A | - | Claude CLI呼び出しの中心 |

## 詳細分析

### ✅ PoppoBuilder Core
- **ファイル**: 
  - `src/process-manager.js`
  - `src/independent-process-manager.js`
  - `src/rate-limit-handler.js`
- **実装**: CCSPClientを使用してすべてのClaude CLI呼び出しを置き換え
- **Issue**: #139で完了

### ✅ CCLA (Claude Code Log Analyzer)
- **ファイル**: `agents/ccla/advanced-analyzer.js`
- **実装**: Redis Queueに直接リクエストを送信
- **特徴**: 
  - `ccsp:requests`キューを使用
  - レスポンスを`ccsp:response:ccla`から取得
  - すでにCCSP経由で動作

### ✅ CCAG (Claude Code API Generator)
- **ファイル**: `agents/ccag/index.js`
- **実装**: ProcessManager経由で間接的にCCSPを使用
- **特徴**:
  - `processManager.executeWithContext`を使用
  - ProcessManagerがCCSP対応済みのため、自動的にCCSP経由

### ✅ CCPM (Claude Code Performance Monitor)
- **ファイル**: `agents/ccpm/index.js`
- **実装**: Redis Queue直接使用（確認済み）
- **特徴**: CCLAと同様の実装パターン

### ✅ CCRA (Code Change Review Agent)
- **ファイル**: `agents/ccra/review-generator.js`
- **実装**: Redis Queue直接使用（確認済み）
- **特徴**: `ccsp:requests`キューを使用

### ❓ CCQA (Code Change Quality Assurance)
- **調査必要**: Claude API使用箇所の特定が必要
- **推奨**: AgentBaseWithCCSPを継承して統一

### ❓ CCTA (Code Change Test Agent)
- **状態**: 実装状況の確認が必要
- **推奨**: AgentBaseWithCCSPを継承して実装

## 共通インフラストラクチャ

### 1. AgentCCSPClient
- **場所**: `agents/shared/agent-ccsp-client.js`
- **目的**: エージェント用の統一CCSPクライアント
- **機能**:
  - 安全なプロンプト構築（Claude API呼び出し禁止の注記追加）
  - エラーハンドリング（セッションタイムアウト、レート制限）
  - ヘルスチェック機能

### 2. AgentBaseWithCCSP
- **場所**: `agents/shared/agent-base-with-ccsp.js`
- **目的**: CCSP統合版のエージェントベースクラス
- **機能**:
  - AgentBaseを拡張
  - CCSPクライアントの自動初期化
  - Claude分析用の便利メソッド

## 推奨事項

1. **統一アプローチ**: 
   - 新しいエージェントはAgentBaseWithCCSPを継承
   - 既存エージェントも段階的に移行

2. **直接Redis使用の段階的廃止**:
   - 現在直接Redisキューを使用しているエージェントも、将来的にはAgentCCSPClientに移行
   - 統一されたエラーハンドリングとモニタリング

3. **テストの実装**:
   - 各エージェントのCCSP統合テスト
   - モックCCSPレスポンスを使用した単体テスト

## 次のステップ

1. CCQAとCCTAの実装状況を調査
2. 必要に応じてAgentBaseWithCCSPに移行
3. 統合テストの実装
4. ドキュメントの更新

## 結論

主要なエージェント（CCLA、CCAG、CCPM、CCRA）はすでにCCSP経由でClaude APIを使用しており、Issue #141の主要な目標は達成されています。残りのエージェント（CCQA、CCTA）の確認と、共通インフラストラクチャの活用を進めることで、完全な移行が完了します。