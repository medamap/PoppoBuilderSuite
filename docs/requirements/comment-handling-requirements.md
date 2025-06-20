# コメント追記対応機能 要求定義

## 1. 背景と課題

### 現状の問題点
- 現在のPoppoBuilderは、Issueのdescription（本文）のみを処理対象としている
- Issueに初回処理を行い`completed`ラベルが付いた後は、新たなコメントが追加されても反応しない
- Issue作成者（オーナー）が追加の要望や質問をコメントしても、それに対応できない

### ビジネスニーズ
- Issueの処理後も、作成者との継続的な対話を可能にする
- 追加の質問や修正依頼に柔軟に対応できるようにする
- より自然なインタラクションを実現する

## 2. 要求事項

### 機能要求

#### FR-1: コメント監視機能
- `completed`ラベルが付いたIssueでも、新規コメントを監視する
- Issue作成者（オーナー）のコメントのみを処理対象とする
- PoppoBuilder自身のコメントは無視する

#### FR-2: 状態管理の拡張
- 新しいラベル「`awaiting-response`」を導入
- 状態遷移：
  - 初回処理完了時: `processing` → `awaiting-response`
  - コメント追加時: `awaiting-response` → `processing`
  - コメント処理完了時: `processing` → `awaiting-response`
  - 最終的な完了時: `awaiting-response` → `completed`

#### FR-3: コメント処理機能
- 新規コメントを検出した際、そのコメント内容をClaudeに送信
- 以前の処理コンテキストを保持（Issue本文 + 過去のやり取り）
- コメントへの返信として処理結果を投稿

#### FR-4: 完了判定機能
- オーナーが明示的に完了を示すコメント（例：「ありがとう」「完了」「OK」）を投稿した場合
- または一定期間（設定可能）新規コメントがない場合
- `completed`ラベルを付けて処理を終了

### 非機能要求

#### NFR-1: パフォーマンス
- コメント監視の頻度は既存のポーリング間隔（30秒）を維持
- 大量のコメントがあるIssueでも効率的に処理

#### NFR-2: 信頼性
- コメント処理中にエラーが発生しても、Issue全体の処理は継続
- 重複処理を防ぐメカニズムを実装

#### NFR-3: 互換性
- 既存の`task:misc`および`task:dogfooding`ラベルとの互換性を維持
- 現在の処理フローを大きく変更しない

## 3. 制約事項

### 技術的制約
- GitHub APIのレート制限を考慮
- 現在のポーリングベースのアーキテクチャを維持

### 運用制約
- Issueごとの最大コメント処理回数を設定可能にする（無限ループ防止）
- タイムアウト設定により長期間放置されたIssueは自動的に`completed`

## 4. 受け入れ基準

### AC-1: 基本的なコメント処理
- `awaiting-response`ラベルが付いたIssueに新規コメントが追加された場合、それを検出し処理できること

### AC-2: 状態遷移の正確性
- ラベルの状態遷移が設計通りに動作すること
- 同時実行時も状態の整合性が保たれること

### AC-3: コンテキストの保持
- 過去のやり取りを踏まえた適切な応答ができること

### AC-4: 終了条件の動作
- 明示的な完了指示または期限切れで適切に処理が終了すること

## 5. 実装時のキーワード

次回この機能を実装する際は、以下のキーワードで依頼してください：

- **「コメント追記対応機能の実装」**
- **「Issue #11 の実装」**
- **「awaiting-responseラベル機能の実装」**
- **「コメント監視機能の追加」**

## 6. 参考情報

### 関連ファイル
- `src/minimal-poppo.js` - メイン処理ロジック
- `src/github-client.js` - GitHub API操作
- `config/config.json` - 設定ファイル

### 考慮事項
- 将来的にWebhook対応への移行も検討
- より高度なコンテキスト管理（会話履歴の要約など）の可能性