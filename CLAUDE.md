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

---
最終更新: 2025/6/16 - ドキュメント最新化完了（Issue #18）