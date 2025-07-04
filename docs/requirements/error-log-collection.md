# エラーログ収集機能 要求定義書

## 1. 概要

PoppoBuilderの実行中に発生するエラーログを自動的に収集・分析し、GitHub Issueとして登録する機能を実装する。これにより、システムの自己修復サイクルを実現し、品質向上を図る。

## 2. 目的

- **問題の早期発見**: エラーが発生してもユーザーが気づかない可能性があるため、自動検出が必要
- **自己修復**: PoppoBuilder自身がエラーを検出し、Issueとして登録することで自己修復サイクルを実現
- **品質向上**: エラーパターンを分析し、繰り返し発生する問題を根本的に解決

## 3. 機能要求

### 3.1 Phase 1: 基本的なエラー検出とIssue登録

#### 機能要求
- FR1.1: `logs/poppo-*.log`からERROR、FATALレベルのログを自動抽出
- FR1.2: エラーパターンマッチングによる自動分類
- FR1.3: 重複防止機構（ハッシュベース）
- FR1.4: 自動Issue作成機能
- FR1.5: 処理済みエラーの記録と管理

#### エラー分類
- **task:bug**: 明らかなプログラムエラー（TypeError、ReferenceError、SyntaxError等）
- **task:defect**: 動作はするが期待と異なる（タイムアウト、ファイル未検出等）
- **task:spec-issue**: 仕様の矛盾や不明確さ

### 3.2 Phase 2: 高度な分析機能

#### 機能要求
- FR2.1: Claudeによる詳細なエラー分析
- FR2.2: 類似エラーのグループ化
- FR2.3: 根本原因の推定
- FR2.4: 解決策の提案生成
- FR2.5: エラー発生傾向の統計分析

### 3.3 Phase 3: 自動修復機能

#### 機能要求
- FR3.1: 既知のエラーパターンに対する自動修復
- FR3.2: 修正後のテストケース自動生成
- FR3.3: 修復結果の検証とロールバック機能
- FR3.4: 学習型エラーパターン認識

## 4. 非機能要求

### 4.1 性能要求
- NFR1: ログ解析は5分以内に完了すること
- NFR2: メモリ使用量は100MB以下に抑えること

### 4.2 信頼性要求
- NFR3: 重複Issue登録は0件であること
- NFR4: エラー検出率は95%以上であること

### 4.3 保守性要求
- NFR5: エラーパターンは設定ファイルで容易に追加・変更可能であること
- NFR6: ログローテーション機能により、古いログは自動削除されること

## 5. 制約事項

- エージェント分離アーキテクチャ（Issue #27）を活用すること
- 既存のPoppoBuilderシステムと統合可能であること
- GitHub APIのレート制限を考慮すること

## 6. 前提条件

- PoppoBuilderが正常に動作していること
- GitHub APIへのアクセス権限があること
- ログファイルへの読み取り権限があること

## 7. 用語定義

- **CCLA**: Code Change Log Analyzer - ログ収集・分析専門エージェント
- **エラーハッシュ**: エラーメッセージとスタックトレースから生成される一意の識別子
- **ログローテーション**: 古いログファイルを圧縮・削除する仕組み

## 8. 関連文書

- Issue #27: エージェント分離アーキテクチャの実装
- Issue #28: エラーログの収集（本要求の発端）
- Issue #29: コメントコンテキスト拡張の実装