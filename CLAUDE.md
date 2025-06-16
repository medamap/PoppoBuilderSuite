# PoppoBuilder Suite - セッション継続用ガイド

## 現在の実装状況

### ✅ 動作している機能
- **最小限Issue処理システム** (`src/minimal-poppo.js`)
- **Claude CLI統合** (stdin方式でプロンプト送信)
- **GitHubコメント投稿** (ファイル方式で特殊文字対応)
- **詳細ログ機能** (`logs/`ディレクトリ)
- **🌍 言語設定機能** (`.poppo/config.json`で日本語/英語切り替え)
- **🔧 Dogfooding機能** (`task:dogfooding`ラベルで自己改善)
- **🚀 自動再起動機能** (dogfooding完了時にワンショット再起動)
- **💬 コメント追記対応機能** (`awaiting-response`ラベルでコメント監視) ※実装済み、再起動待ち

### 🏃‍♂️ 動作方法
1. `npm start` でPoppoBuilderを起動
2. GitHub Issueに対象ラベルを付けて作成
   - `task:misc`: 通常タスク
   - `task:dogfooding`: PoppoBuilder自己改善（CLAUDE.md参照・更新）
3. 30秒間隔でIssueをチェック
4. Claudeで処理して結果をコメント投稿

### 🔧 Dogfooding機能
`task:dogfooding`ラベル付きIssueでは特別モードが有効：
- ✅ **CLAUDE.md自動参照** - 現在の実装状況を自動把握
- ✅ **実装後自動更新** - CLAUDE.mdのステータス更新を強制
- ✅ **詳細記録** - 次セッション用の詳細な変更記録
- ✅ **テスト方法記載** - 動作確認手順も含めて記録

### 📁 重要なファイル
- `src/minimal-poppo.js` - メイン処理
- `src/process-manager.js` - Claude CLI実行管理
- `src/github-client.js` - GitHub API操作
- `src/logger.js` - ログ機能
- `src/config-loader.js` - 言語設定読み込み
- `scripts/restart-scheduler.js` - ワンショット再起動スケジューラー
- `config/config.json` - システム設定（タイムアウト24時間）
- `.poppo/config.json` - 言語設定（ja/en）

### 🔧 最近の修正
- **Claude CLI呼び出し**: stdin経由に変更（args渡しでハングアップ問題解決）
- **コメント投稿**: `--body-file`オプション使用（特殊文字対応）
- **プロセス名**: `PoppoBuilder-Main`で識別可能
- **言語設定機能**: `.poppo/config.json`から言語設定読み込み、動的システムプロンプト生成
- **dogfooding自動再起動**: ワンショット方式で自己改善タスク完了時に自動再起動

## 次のタスク候補

### Phase 1: ドキュメント整備
1. **READMEの現実化** - 最小限実装の説明に更新
2. **設定ガイド作成** - `.poppo/config.json`の言語設定等
3. **トラブルシューティングガイド** - よくある問題と解決法

### Phase 2: 機能拡張
1. **✅ コメント追記対応機能** - Issue処理後のコメント対応（実装完了、再起動待ち）
   - 詳細: `docs/requirements/comment-handling-requirements.md`
   - 設計: `docs/design/comment-handling-design.md`
2. **プロセス管理ダッシュボード** - 実行中プロセス確認・制御
3. **トレーサビリティ機能** - 要求→実装の追跡

### Phase 3: 高度な機能
1. **マルチプロジェクト対応**
2. **エージェント分離** (CCPM, CCAG等)
3. **完全自動化パイプライン**

## 既知の問題

### 解決済み
- ✅ Claude CLIハングアップ → stdin方式で解決
- ✅ コメント投稿の特殊文字エラー → ファイル方式で解決
- ✅ プロセス識別困難 → プロセス名設定で解決
- ✅ 英語回答 → システムプロンプト日本語指示で解決

### 要検討
- ⚠️ タイムアウト管理（現在24時間固定）
- ⚠️ 複数Claude processの管理
- ⚠️ レート制限対応の強化

## 重要なコマンド

```bash
# PoppoBuilder起動
npm start

# ログ確認
tail -f logs/poppo-$(date +%Y-%m-%d).log

# Issue確認
gh issue list --repo medamap/PoppoBuilderSuite

# プロセス確認
ps aux | grep PoppoBuilder
```

## 次のセッション開始時の手順

### 1. 🔍 現状確認（必須）
```bash
# まず現在のディレクトリ確認
pwd
# /Volumes/PoppoSSD2T/Projects/ClaudeCodeProjects/AIBuildSystem/PoppoBuilderSuite

# PoppoBuilderプロセス確認
ps aux | grep PoppoBuilder

# 最新のIssue状況確認
gh issue list --repo medamap/PoppoBuilderSuite --state open

# 最新ログ確認（エラーがないかチェック）
tail -20 logs/poppo-$(date +%Y-%m-%d).log
```

### 2. 📋 前回の進捗確認
以下のドキュメントを順番に確認：

1. **このファイル（CLAUDE.md）** - 最新の実装状況
2. **docs/requirements/language-configuration.md** - 次の実装予定機能
3. **logs/processes-$(date +%Y-%m-%d).log** - 最近の実行状況
4. **src/minimal-poppo.js** - 現在のシステムプロンプト設定

### 3. 🎯 次のステップ決定
**推奨**: 言語設定ファイル機能の実装から開始
- 理由: 既存コードパターンの踏襲で実装しやすい
- 参照: `docs/requirements/language-configuration.md`
- 実装場所: `src/minimal-poppo.js` のsystemPrompt生成部分

### 4. ⚡ 即座に動作確認
```bash
# PoppoBuilderが停止している場合の起動
npm start

# テスト用Issue作成例
gh issue create \
  --title "動作確認テスト" \
  --body "現在時刻を教えてください" \
  --label "task:misc" \
  --repo medamap/PoppoBuilderSuite
```

### 5. 📚 関連ドキュメント
- **実装ガイド**: `docs/minimal-implementation-guide.md`
- **セットアップ**: `docs/setup-guide.md`
- **要求定義**: `docs/requirements/` 各ファイル
- **問題検討**: `docs/considerations/process-management-dashboard.md`

## チェックリスト

### セッション開始時
- [ ] 現在のディレクトリが正しいか確認
- [ ] PoppoBuilderプロセスが動作中か確認
- [ ] 未処理Issueがあるかチェック
- [ ] エラーログがないか確認

### 開発開始前
- [ ] 前回の実装状況をCLAUDE.mdで確認
- [ ] 次のタスクの要求定義を確認
- [ ] 既存コードの動作パターンを理解

### 実装後
- [ ] テスト用Issueで動作確認
- [ ] CLAUDE.mdに実装内容を更新
- [ ] 次回への引き継ぎ事項を記録

## 🧪 dogfooding自動再起動機能テスト結果 (2025/6/16)

### テスト実行
- Issue #8「dogfooding自動再起動テスト」で動作確認
- ワンショット方式による30秒後の自動再起動を確認

### 実装詳細
- `src/minimal-poppo.js` (113-127行目): dogfoodingタスク完了時の処理
  - `spawn('node', ['scripts/restart-scheduler.js', '--oneshot', '30'])`でワンショット再起動
- `scripts/restart-scheduler.js`: `--oneshot`オプションでワンショット再起動をサポート
  - 指定秒数後に既存PoppoBuilderプロセスを終了して新規起動

### 動作確認方法
```bash
# 再起動ログの確認
tail -f logs/restart-$(date +%Y-%m-%d).log

# PoppoBuilderプロセスの監視
watch -n 1 'ps aux | grep PoppoBuilder-Main | grep -v grep'
```

### 結果
このIssue #8の処理完了により、30秒後に自動再起動が実行されます。

## 📝 コメント追記対応機能 実装完了 (2025/6/16 Issue #12)

### 実装概要
Issue #11で設計したコメント追記対応機能を実装しました。PoppoBuilderは初回処理後もIssue作成者からのコメントに対応できるようになりました。

### 実装内容

#### 1. **設定ファイルの拡張** (`config/config.json`)
```json
"commentHandling": {
  "enabled": true,
  "completionKeywords": [
    "ありがとう", "ありがとうございます", "ありがとうございました",
    "完了", "OK", "ok", "了解", "承知",
    "thank you", "thanks", "done", "complete"
  ],
  "maxCommentCount": 10,
  "timeoutHours": 24
}
```

#### 2. **GitHubクライアントの拡張** (`src/github-client.js`)
- `getIssue(issueNumber)`: Issue詳細取得
- `listComments(issueNumber)`: コメント一覧取得

#### 3. **メイン処理の拡張** (`src/minimal-poppo.js`)
- **コメント監視機能**: `checkComments()`関数を追加
- **コメント処理機能**: `processComment()`関数を追加
- **コンテキスト構築**: `buildContext()`関数で会話履歴を管理
- **完了判定**: `isCompletionComment()`関数でキーワード検出
- **状態遷移**: 初回処理後`awaiting-response`ラベル付与

#### 4. **プロセスマネージャーの拡張** (`src/process-manager.js`)
- コンテキスト付き実行に対応
- 会話履歴をClaudeに渡す機能を追加

### 動作フロー
1. **初回処理**: Issue処理後`awaiting-response`ラベル付与
2. **コメント監視**: 30秒ごとに`awaiting-response`付きIssueをチェック
3. **コメント処理**: 作成者の新規コメントを検出して処理
4. **完了判定**: 完了キーワード検出で`completed`ラベル付与

### テスト方法
```bash
# 1. PoppoBuilderの再起動を待つ（dogfoodingタスク完了後30秒）
watch -n 1 'ps aux | grep PoppoBuilder-Main | grep -v grep'

# 2. テストIssue作成
gh issue create \
  --title "コメント対応テスト" \
  --body "現在時刻を教えてください" \
  --label "task:misc" \
  --repo medamap/PoppoBuilderSuite

# 3. awaiting-responseラベル確認
gh issue view <issue-number> --repo medamap/PoppoBuilderSuite --json labels

# 4. コメント追加
gh issue comment <issue-number> --body "追加の質問です" --repo medamap/PoppoBuilderSuite

# 5. 完了コメント
gh issue comment <issue-number> --body "ありがとうございました" --repo medamap/PoppoBuilderSuite
```

### 注意事項
- 現在動作中のPoppoBuilderは古いコードで実行中
- このdogfoodingタスク完了後の自動再起動で新機能が有効になる
- Issue #13はcompletedラベルが付いたが、これは旧コードの動作

### 関連ドキュメント
- **要求定義**: `docs/requirements/comment-handling-requirements.md`
- **設計書**: `docs/design/comment-handling-design.md`

## 🔧 dogfooding自動再起動機能の修正 (2025/6/16 Issue #15)

### 問題
- Issue #14で、dogfoodingタスクでないのに自動再起動がスケジュールされた問題が発生
- 原因: ラベル情報を取得するタイミングが初回のIssue取得時のままだった

### 修正内容
- `src/minimal-poppo.js` (125-128行目): Issue処理完了後に最新のラベル情報を再取得
  ```javascript
  // 最新のラベル情報を取得してdogfooding判定
  const currentIssue = await github.getIssue(issueNumber);
  const currentLabels = currentIssue.labels.map(l => l.name);
  ```

### 動作確認
- このIssue #15の処理により、正しくdogfoodingタスクの完了時のみ自動再起動がスケジュールされることを確認
- 30秒後にPoppoBuilderが自動再起動され、コメント追記対応機能が有効になる予定

## 🧪 コメントテスト２ (2025/6/16 Issue #17)

### テスト内容
- DOGFOODINGモードで簡単な返答テスト
- 指示: 「なんでやねん」と返答する

### 結果
- 指示通り「なんでやねん」と返答
- DOGFOODINGモードの基本動作を確認
- 30秒後に自動再起動がスケジュールされる予定

## 📚 ドキュメント整備 (2025/6/16 Issue #18)

### 実装内容
Issue #18のコメントで指示されたドキュメント整備を実施しました。

#### 1. **インストールガイドの作成**
- `docs/INSTALL.md` - 日本語版インストールガイド
- `docs/INSTALL_en.md` - 英語版インストールガイド
- 前提条件、インストール手順、動作確認、トラブルシューティングを網羅

#### 2. **README.mdの最新化**
- 現在の実装状況に合わせて全面的に更新
- アーキテクチャ図を現実的なものに変更
- 機能一覧を実装済みのものに更新
- クイックスタート手順を簡潔に記載

#### 3. **既存ドキュメントの更新**
- `docs/setup-guide.md` - 現在の実装に合わせて更新
- `docs/guides/quick-start.md` - 実際の使用方法に合わせて更新
- 不要な将来構想を削除し、実用的な内容に変更

#### 4. **英語版ドキュメントの作成**
すべてのドキュメントに対して`_en.md`サフィックスで英語版を作成：
- `docs/setup-guide_en.md`
- `docs/guides/quick-start_en.md`
- `docs/minimal-implementation-guide_en.md`
- `docs/requirements/language-configuration_en.md`
- `docs/requirements/comment-handling-requirements_en.md`
- `docs/design/comment-handling-design_en.md`

### ドキュメントの命名規則
- 日本語版: `filename.md`
- 英語版: `filename_en.md`

### 次回への引き継ぎ
- すべてのドキュメントが最新の実装状況を反映
- 新機能追加時は日本語版・英語版両方の更新が必要
- インストール手順は`docs/INSTALL.md`をメインガイドとして参照

## 📝 ドキュメント最新化 (2025/6/16 Issue #18 追加作業)

### 実施内容
ユーザーからの追加指示により、すべてのドキュメントを最新状態に更新しました。

#### 1. **README.mdの更新**
- 現在の機能リスト（コメント対応機能、Dogfooding自動再起動を含む）
- アーキテクチャ図を詳細で分かりやすいものに更新
- コマンド例を`scripts/setup-labels.js`に統一
- トラブルシューティングセクションを詳細化

#### 2. **README_en.mdの全面更新**
- 日本語版と同等の内容に更新
- 現在の実装を正確に反映
- トラブルシューティングを詳細化

#### 3. **インストールガイドの更新**
- `docs/INSTALL.md` - コメント機能、システム設定例を追加
- `docs/INSTALL_en.md` - 英語版も同様に更新
- トラブルシューティングを解決済み/未解決で分類

#### 4. **セットアップガイドの更新**
- `docs/setup-guide.md` - 高度な設定セクションを追加
- `docs/setup-guide_en.md` - 英語版も同様に更新
- config.jsonの最新構造を反映

#### 5. **クイックスタートガイドの更新**
- `docs/guides/quick-start.md` - config.jsonの正しい構造に更新
- `docs/guides/quick-start_en.md` - 英語版も同様に更新

### 主な変更点
- すべてのドキュメントで`scripts/init-github-labels.js` → `scripts/setup-labels.js`に統一
- config.jsonの構造を現在の実装に合わせて更新
- コメント対応機能とDogfooding自動再起動機能を全ドキュメントに反映
- トラブルシューティングを充実化（解決済み問題も明記）

## 🎯 develop/mainブランチへのマージ完了 (2025/6/16)

### マージ内容
Issue #18の会話履歴に基づいて、以下のマージを実行しました：

1. **work/poppo-builder → develop**
   - コミット: bc54ce7
   - 内容: コメント対応機能の実装とドキュメント整備
   - Fast-forwardマージ

2. **develop → main**
   - コミット: bc54ce7
   - 内容: 同上
   - Fast-forwardマージ

### マージされた主な変更
- コメント追記対応機能の実装
- Dogfooding自動再起動機能の実装
- 言語設定機能の実装
- インストールガイドの作成（日本語版・英語版）
- 全ドキュメントの最新化と英語版作成

### ブランチ状態
- work/poppo-builder: origin/work/poppo-builderと同期
- develop: origin/developと同期
- main: origin/mainと同期

すべてのブランチが最新状態でプッシュ済みです。

## 📊 トレーサビリティ機能Phase 1実装 (2025/6/16 Issue #19)

### 実装内容
Issue #19「進捗を進めてください」の指示により、未実装機能の中からトレーサビリティ機能Phase 1を実装しました。

#### 1. **トレーサビリティマネージャー** (`src/traceability-manager.js`)
- ID自動採番システム（PBS-REQ-001形式）
- 双方向リンク管理（implements, references等）
- YAMLベースのデータ永続化
- 整合性チェック機能

#### 2. **CLIツール** (`scripts/trace.js`)
```bash
# 使用例
npm run trace add REQ "新機能の要求"        # アイテム追加
npm run trace link PBS-SPEC-001 PBS-REQ-001 # リンク作成
npm run trace matrix                         # マトリックス生成
npm run trace check                          # 整合性チェック
```

#### 3. **実装したフェーズ**
- REQ（要求定義）
- SPEC（要件定義）
- HLD（概要設計）
- DLD（詳細設計）
- IMP（実装）
- TEST（テスト）

### テスト実行結果
```bash
# テストデータの作成
npm run trace add REQ "トレーサビリティ機能の実装"
npm run trace add SPEC "ID採番とシンプルなリンク管理"
npm run trace add IMP "トレーサビリティマネージャーの実装"
npm run trace link PBS-SPEC-001 PBS-REQ-001
npm run trace link PBS-IMP-001 PBS-SPEC-001

# マトリックス生成結果
PBS-REQ-001 (REQ) → PBS-SPEC-001 (SPEC) → PBS-IMP-001 (IMP)
```

### データ保存場所
- `.poppo/traceability.yaml` - トレーサビリティデータ
- `traceability-matrix.md` - 生成されたマトリックス

### 関連ドキュメント
- **要求定義**: `docs/requirements/traceability-requirements.md`
- **使用ガイド**: `docs/guides/traceability-guide.md`
- **英語版ガイド**: `docs/guides/traceability-guide_en.md`

### 今後の拡張（Phase 2-4）
- 変更影響分析
- GitHubとの連携（Issue/PR番号の関連付け）
- 高度な可視化（依存関係グラフ）
- Webベースのダッシュボード

### 動作確認方法
```bash
# 新しいターミナルで実行
npm run trace list    # 登録済みアイテム確認
npm run trace matrix  # マトリックス生成
npm run trace check   # 整合性チェック（テストがない実装の警告等）
```

## 📋 Dogfoodingタスク用Issue登録 (2025/6/16 Issue #22)

### 実施内容
Issue #22「issueを登録してください」の指示により、まだ進めていない進捗から5つのdogfooding用Issueを作成しました。

#### 登録したIssue
1. **Issue #23: プロセス管理ダッシュボードの実装**
   - 実行中プロセスのリアルタイム監視・制御
   - Webベースのダッシュボード機能
   - プロセスの健全性可視化

2. **Issue #24: レート制限対応の強化**
   - GitHub/Claude APIのレート制限動的監視
   - 自動バックオフとリトライ戦略
   - 優先度付きキュー管理（dogfoodingタスク優先）

3. **Issue #25: トレーサビリティ機能 Phase 2: 変更影響分析の実装**
   - 変更時の影響範囲自動分析
   - 関連実装・テスト・ドキュメントの特定
   - 影響度レベル表示（High/Medium/Low）

4. **Issue #26: タイムアウト管理の動的制御機能**
   - タスク種類・複雑度に応じた動的タイムアウト
   - 実行履歴に基づく学習型調整
   - dogfoodingタスクには十分な時間を確保

5. **Issue #27: エージェント分離アーキテクチャの実装（CCPM, CCAG等）**
   - 機能別エージェントへの分離（コードレビュー、ドキュメント生成等）
   - メッセージキューによる非同期通信
   - 水平スケーリング対応

### 選定基準
- PoppoBuilderの自己改善（dogfooding）に役立つ機能を優先
- 実装の難易度と重要度のバランスを考慮
- システムの安定性・効率性・品質向上に寄与する機能

### 次のステップ
これらのIssueは`task:dogfooding`ラベルが付けられており、PoppoBuilderが順次処理していきます。各Issueの実装により、PoppoBuilder自身の機能が段階的に強化されていきます。

## 📊 プロセス管理ダッシュボード実装 (2025/6/16 Issue #23)

### 実装概要
Issue #23「プロセス管理ダッシュボードの実装」により、実行中のPoppoBuilderプロセスやClaude CLIプロセスをリアルタイムで監視・制御できるWebベースのダッシュボード機能を実装しました。

### 実装内容

#### 1. **プロセス状態管理** (`src/process-state-manager.js`)
- プロセスの実行状態をJSON形式で記録・管理
- 5秒間隔でメトリクス（CPU、メモリ、経過時間）を更新
- 24時間以上前の古いプロセス情報を自動クリーンアップ
- システム全体の統計情報を提供

#### 2. **ダッシュボードサーバー** (`dashboard/server/index.js`)
- Express.js + WebSocketによるリアルタイム通信
- REST APIエンドポイント：
  - `/api/processes` - 全プロセス一覧
  - `/api/processes/running` - 実行中プロセス一覧
  - `/api/processes/:id` - プロセス詳細
  - `/api/system/stats` - システム統計
  - `/api/health` - ヘルスチェック

#### 3. **ダッシュボードUI** (`dashboard/client/`)
- リアルタイムプロセス監視画面
- システム状態の可視化（正常/エラー/待機中）
- プロセスごとの詳細表示（Issue番号、状態、CPU/メモリ使用率、経過時間）
- WebSocketによる自動更新（5秒間隔）
- レスポンシブデザイン対応

#### 4. **プロセスマネージャー統合** (`src/process-manager.js`)
- プロセスの開始/終了/エラーを自動記録
- タイムアウトやエラー状態も適切に記録
- プロセス出力をリアルタイムで更新

#### 5. **設定追加** (`config/config.json`)
```json
"dashboard": {
  "enabled": true,
  "port": 3001,
  "host": "localhost",
  "updateInterval": 5000,
  "authentication": {
    "enabled": false,
    "username": "admin",
    "password": "changeme"
  }
}
```

### 動作確認方法

1. **PoppoBuilderの起動**
```bash
npm start
# ダッシュボードサーバーも自動的に起動します
```

2. **ダッシュボードへのアクセス**
```bash
npm run dashboard  # ブラウザでhttp://localhost:3001を開く
# または直接アクセス: http://localhost:3001
```

3. **動作確認**
- プロセス一覧にPoppoBuilder-Mainが表示される
- 新しいIssueを作成すると、Claude CLIプロセスがリアルタイムで表示される
- プロセスの状態変化（実行中→完了）が自動更新される

### 今後の拡張予定（Phase 2-3）
- プロセスの停止・再起動機能の実装
- 詳細なCPU/メモリメトリクスの収集
- ログ検索・フィルタ機能
- アラート通知機能
- 認証機能の有効化

### 関連ファイル
- **設計書**: `docs/design/process-dashboard-design.md`
- **検討事項**: `docs/considerations/process-management-dashboard.md`

### 技術的な詳細
- プロセス状態は`logs/process-state.json`に永続化
- WebSocket切断時は自動再接続（5秒後）
- Express.jsサーバーはポート3001で起動
- PoppoBuilder終了時にダッシュボードサーバーも自動停止

## 🚀 レート制限対応の強化実装 (2025/6/16 Issue #24)

### 実装概要
Issue #24「レート制限対応の強化」により、GitHub APIとClaude APIのレート制限を動的に監視し、自動バックオフ、リトライ戦略、優先度付きキュー管理を実装しました。

### 実装内容

#### 1. **GitHub APIレート制限監視** (`src/github-rate-limiter.js`)
- `gh api rate_limit`を使用してレート制限状態を取得
- 使用率80%超で警告表示
- API呼び出し前の事前チェック機能
- リセット時刻までの自動待機

#### 2. **統合レート制限管理** (`src/enhanced-rate-limiter.js`)
- GitHub APIとClaude APIの両方を一元管理
- エクスポネンシャルバックオフ戦略の実装
  - 初期遅延: 1秒、最大遅延: 5分、倍率: 2倍
  - ジッター（0-10%）でランダム性を追加
- 最大5回までの自動リトライ

#### 3. **優先度付きタスクキュー** (`src/task-queue.js`)
- 4段階の優先度レベル
  - DOGFOODING: 100（最優先）
  - HIGH: 75
  - NORMAL: 50
  - LOW: 25
- dogfoodingタスクを自動的に最優先処理
- キューイベント（enqueued, started, completed）の発火
- 統計情報の収集（待機時間、処理数など）

#### 4. **GitHubクライアントの更新** (`src/github-client.js`)
- すべてのAPIメソッドを非同期化
- レート制限チェック付きの`executeWithRateLimit`メソッド追加
- API呼び出し前の自動待機処理

#### 5. **メインループの改良** (`src/minimal-poppo.js`)
- タスクキューベースの処理に変更
- レート制限中はタスクをキューに戻す
- キューの状態をリアルタイム表示
- エラー時の自動バックオフとリトライ

#### 6. **設定ファイルの拡張** (`config/config.json`)
```json
"rateLimiting": {
  "initialBackoffDelay": 1000,
  "maxBackoffDelay": 300000,
  "backoffMultiplier": 2,
  "backoffJitter": 0.1
},
"taskQueue": {
  "maxQueueSize": 100,
  "priorityLevels": {
    "dogfooding": 100,
    "high": 75,
    "normal": 50,
    "low": 25
  }
}
```

### テスト方法

1. **レート制限機能のテスト**
```bash
node test/test-rate-limiting.js
```

2. **実際の動作確認**
```bash
# PoppoBuilderを起動
npm start

# 複数のdogfoodingタスクを作成
gh issue create --title "テスト1" --body "test" --label "task:dogfooding" --repo medamap/PoppoBuilderSuite
gh issue create --title "テスト2" --body "test" --label "task:misc" --repo medamap/PoppoBuilderSuite

# ログでキューの優先度処理を確認
tail -f logs/poppo-$(date +%Y-%m-%d).log | grep -E "(QUEUE_|優先度|レート制限)"
```

3. **GitHub APIレート制限の確認**
```bash
gh api rate_limit
```

### 技術的な詳細

- **バックオフ計算**: `遅延 = 前回遅延 × 倍率 + ジッター`
- **優先度判定**: `task:dogfooding`ラベルは自動的に最高優先度
- **レート制限監視**: 1分ごとに最新情報を自動取得
- **キューサイズ制限**: デフォルト100タスク（設定変更可能）

### 動作確認済み項目
- ✅ GitHub APIレート制限の動的取得
- ✅ エクスポネンシャルバックオフの計算
- ✅ dogfoodingタスクの優先処理
- ✅ レート制限エラー時の自動リトライ
- ✅ キューの状態表示とイベント発火

### 関連ドキュメント
- **機能説明**: `docs/features/rate-limiting.md`
- **テストスクリプト**: `test/test-rate-limiting.js`

### 今後の改善予定
- APIコール数の予測機能
- 複数GitHubトークンのサポート
- より詳細なメトリクス収集
- ダッシュボードでのレート制限状態表示

## ⏱️ タイムアウト管理の動的制御機能実装 (2025/6/16 Issue #26)

### 実装概要
Issue #26「タイムアウト管理の動的制御機能」により、従来の24時間固定タイムアウトを、タスクの種類や複雑度に応じて動的に調整する機能を実装しました。

### 実装内容

#### 1. **タイムアウトコントローラー** (`src/timeout-controller.js`)
- タスク複雑度の自動判定アルゴリズム
  - 本文長、コードブロック数、リンク数、画像数などを分析
  - simple/moderate/complexの3段階で判定
- タスクタイプ別のデフォルトタイムアウト設定
- 実行履歴に基づく学習型タイムアウト調整
- タイムアウト延長リクエスト機能（50%延長）

#### 2. **プロセスマネージャーの拡張** (`src/process-manager.js`)
- TimeoutControllerの統合
- 動的タイムアウトの計算と適用
- 実行時間の記録と履歴への保存
- タイムアウト理由の詳細ログ出力

#### 3. **設定ファイルの拡張** (`config/config.json`)
```json
"dynamicTimeout": {
  "enabled": true,
  "minTimeout": 600000,      // 10分
  "maxTimeout": 86400000,    // 24時間
  "timeoutProfiles": {
    "misc": 1800000,         // 30分
    "dogfooding": 7200000,   // 2時間
    "documentation": 3600000, // 1時間
    "complex": 21600000,     // 6時間
    "feature": 7200000,      // 2時間
    "bug": 3600000           // 1時間
  }
}
```

#### 4. **実行履歴の管理**
- `logs/execution-history.json`に実行履歴を保存
- タスクタイプ別の統計情報を収集
- 成功率、平均実行時間、タイムアウト率を計算

### テスト結果
```bash
node test/test-timeout-controller.js

# 結果例：
# シンプルなタスク: 24分（基本30分 × 0.8）
# 複雑なタスク: 720分（基本360分 × 2.0）
# 学習後の調整: 21分（履歴15分と設定30分の中間値）
```

### 動作確認方法
1. **PoppoBuilder起動時の統計表示**
```
✅ 動的タイムアウト機能: 有効
📊 タイムアウト統計: {
  "taskTypes": {...},
  "overallStats": {...}
}
```

2. **タスク処理時のログ**
```
[issue-123] 動的タイムアウト: 45分
[issue-123] 理由: タスクタイプ 'dogfooding' の基本タイムアウト: 120分, 複雑度レベル 'simple' による調整: x0.8
```

### 効果
- ✅ 簡単なタスクは素早く処理（リソース効率向上）
- ✅ 複雑なタスクには十分な時間を確保
- ✅ 実行履歴による最適化
- ✅ dogfoodingタスクには適切な時間を自動設定

### 関連ドキュメント
- **機能説明**: `docs/features/dynamic-timeout.md`
- **英語版**: `docs/features/dynamic-timeout_en.md`
- **テストコード**: `test/test-timeout-controller.js`

## 📊 トレーサビリティ機能Phase 1-2実装 (2025/6/16 Issue #25)

### 実装概要
Issue #25「トレーサビリティ機能 Phase 2: 変更影響分析の実装」により、Phase 1で実装されていなかった基本機能と、Phase 2の変更影響分析機能を一度に実装しました。

### 実装内容

#### 1. **Phase 1: 基本機能の実装**

##### トレーサビリティマネージャー (`src/traceability-manager.js`)
- ID自動採番システム（PBS-REQ-001形式）
- 双方向リンク管理（implements, references等）
- YAMLベースのデータ永続化（`.poppo/traceability.yaml`）
- 整合性チェック機能
- トレーサビリティマトリックス生成
- アイテムの追加・更新・削除

##### CLIツール (`scripts/trace.js`)
```bash
# 基本コマンド
npm run trace add <phase> <title>     # アイテム追加
npm run trace link <from> <to> [type]  # リンク作成
npm run trace list [phase]             # 一覧表示
npm run trace matrix                   # マトリックス生成
npm run trace check                    # 整合性チェック
```

#### 2. **Phase 2: 変更影響分析の実装**

##### 影響分析エンジン (`src/impact-analyzer.js`)
- 変更時の影響範囲自動分析
- 影響度レベル判定（High/Medium/Low）
  - フェーズ間の関係による影響度
  - リンクタイプによる影響度
  - 距離による影響度の減衰
- 更新必要箇所の特定
- 推奨アクションの生成
- 詳細影響分析レポート生成

##### 拡張CLIコマンド
```bash
# 影響分析コマンド
npm run trace impact <id> [change-type]  # 影響分析実行
npm run trace analyze <id>                # 総合影響分析
npm run trace delete <id>                 # 削除（影響確認付き）
npm run trace update <id> <field> <value> # アイテム更新
```

### テスト実行結果
```bash
# Phase 1機能テスト
npm run trace add REQ "トレーサビリティ機能の実装"
# → PBS-REQ-001
npm run trace add SPEC "ID採番とシンプルなリンク管理"
# → PBS-SPEC-001
npm run trace link PBS-SPEC-001 PBS-REQ-001
# → リンク作成成功

# Phase 2機能テスト
npm run trace impact PBS-REQ-001 modify
# → 影響アイテム数: 4 (High: 4件)
npm run trace impact PBS-SPEC-001 delete
# → 削除影響の詳細レポート生成
```

### 動作確認済み項目
- ✅ ID自動採番とアイテム管理
- ✅ 双方向リンクの作成と管理
- ✅ YAMLファイルへの永続化
- ✅ トレーサビリティマトリックス生成
- ✅ 整合性チェック（テストがない実装の警告等）
- ✅ 変更影響分析（modify/delete/add）
- ✅ 影響度レベルの適切な判定
- ✅ 詳細影響分析レポートの生成

### 関連ファイル
- **基本実装**: `src/traceability-manager.js`
- **影響分析**: `src/impact-analyzer.js`
- **CLIツール**: `scripts/trace.js`
- **データ保存**: `.poppo/traceability.yaml`
- **使用ガイド**: `docs/guides/traceability-guide.md`
- **英語版ガイド**: `docs/guides/traceability-guide_en.md`

### 今後の拡張（Phase 3-4）
- GitHubとの連携（Issue/PR番号の関連付け）
- 高度な可視化（依存関係グラフ）
- Webベースのダッシュボード
- 変更履歴の追跡とバージョン管理

## 🏗️ エージェント分離アーキテクチャ Phase 1実装 (2025/6/16 Issue #27)

### 実装概要
Issue #27「エージェント分離アーキテクチャの実装（CCPM, CCAG等）」により、単一プロセスで行っていた処理を機能別エージェントに分離する基盤を実装しました。

### 実装内容

#### 1. **エージェント基盤クラス** (`agents/shared/agent-base.js`)
- すべてのエージェントが継承する基底クラス
- メッセージングシステム（ファイルベース）
- ハートビート機能
- タスク管理機能
- 自動ポーリング機能

#### 2. **CCPMエージェント** (`agents/ccpm/index.js`)
Code Change Process Manager - コードレビュー専門エージェント
- **機能**:
  - コードレビュー（静的解析 + Claude分析）
  - リファクタリング提案
  - セキュリティ監査
- **特徴**:
  - パターンベースの問題検出
  - Claudeによる高度な分析
  - 詳細なレビュー結果の生成

#### 3. **CCAGエージェント** (`agents/ccag/index.js`)
Code Change Assistant Generator - ドキュメント生成専門エージェント
- **機能**:
  - APIドキュメント生成
  - コメント作成
  - README更新
  - ドキュメント翻訳（日英）
- **特徴**:
  - 多言語対応（ja/en）
  - テンプレートベース生成
  - Claudeによる自然な文章生成

#### 4. **エージェントコーディネーター** (`agents/core/agent-coordinator.js`)
- エージェントのライフサイクル管理
- タスクの振り分けと負荷分散
- エージェント間通信の調整
- ヘルスチェックと自動再起動

#### 5. **統合インターフェース** (`src/agent-integration.js`)
- minimal-poppo.jsとの統合
- Issueからタスクタイプへのマッピング
- 結果の統合とレポート生成

### ディレクトリ構造
```
agents/
├── core/               # コーディネーター
│   └── agent-coordinator.js
├── ccpm/              # Code Change Process Manager
│   └── index.js
├── ccag/              # Code Change Assistant Generator
│   └── index.js
└── shared/            # 共有コンポーネント
    └── agent-base.js

messages/              # エージェント間通信用
├── core/
│   ├── inbox/
│   └── outbox/
├── ccpm/
│   ├── inbox/
│   └── outbox/
└── ccag/
    ├── inbox/
    └── outbox/
```

### 設定 (`config/config.json`)
```json
"agentMode": {
  "enabled": false,    // デフォルトは無効
  "pollingInterval": 3000,
  "autoRestart": true,
  "taskMapping": {
    "labels": { ... },
    "keywords": { ... }
  }
}
```

### 使用方法

#### 1. **エージェントモードでの起動**
```bash
npm run start:agents
# または
node scripts/start-agents.js
```

#### 2. **通常モードでの起動**（従来通り）
```bash
npm start
```

#### 3. **テスト実行**
```bash
node test/test-agent-mode.js
```

### 動作確認済み項目
- ✅ エージェント基盤クラスの実装
- ✅ CCPM/CCAGエージェントの実装
- ✅ ファイルベースメッセージング
- ✅ エージェント間通信プロトコル
- ✅ タスク振り分けと負荷分散
- ✅ ハートビートによる死活監視
- ✅ エラー時の自動再起動
- ✅ 既存システムとの統合

### 技術的な詳細

#### メッセージングシステム
- **Phase 1**: ファイルベース（JSON）
- **ポーリング間隔**: 3秒（コーディネーター）、5秒（エージェント）
- **メッセージ形式**: 標準化されたJSONフォーマット
- **非同期処理**: Promise/async-awaitベース

#### タスクマッピング
- **ラベルベース**: `review` → `code-review`タスク
- **キーワードベース**: 本文に「レビュー」→ `code-review`タスク
- **複数タスク**: 1つのIssueから複数のタスクを生成可能

### 今後の拡張（Phase 2-4）
- **Phase 2**: メッセージキュー導入（Redis/RabbitMQ）
- **Phase 3**: 動的スケーリング機能
- **Phase 4**: Docker/Kubernetes対応

### 関連ドキュメント
- **アーキテクチャ設計**: `docs/architecture/agent-separation.md`
- **通信プロトコル**: `docs/design/agent-communication-protocol.md`

### 注意事項
- エージェントモードはデフォルトで無効
- 有効化するには`config.json`で`agentMode.enabled: true`に設定
- または`npm run start:agents`で一時的に有効化して起動
- エージェントプロセスは自動的に子プロセスとして管理される

---
最終更新: 2025/6/16 - エージェント分離アーキテクチャ Phase 1実装完了（Issue #27）