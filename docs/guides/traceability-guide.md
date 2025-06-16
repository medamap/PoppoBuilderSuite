# トレーサビリティ機能使用ガイド

## 概要

PoppoBuilder Suiteのトレーサビリティ機能は、要求から実装、テストまでの追跡可能性を確保し、変更時の影響範囲を自動分析する強力なツールです。

## 機能概要

### Phase 1: 基本機能（実装済み）
- ID自動採番システム（PBS-REQ-001形式）
- 双方向リンク管理
- YAMLベースのデータ永続化
- 整合性チェック機能
- トレーサビリティマトリックス生成

### Phase 2: 変更影響分析（実装済み）
- 変更時の影響範囲自動分析
- 影響度レベル表示（High/Medium/Low）
- 更新必要箇所の特定
- 推奨アクションの生成
- 詳細影響分析レポート

## 使用方法

### 基本コマンド

#### アイテムの追加
```bash
npm run trace add <phase> <title>

# 例
npm run trace add REQ "ユーザー認証機能"
npm run trace add SPEC "OAuth2認証仕様"
npm run trace add IMP "認証モジュール実装"
```

#### リンクの作成
```bash
npm run trace link <from-id> <to-id> [link-type]

# 例
npm run trace link PBS-SPEC-001 PBS-REQ-001 implements
npm run trace link PBS-IMP-001 PBS-SPEC-001
```

#### アイテム一覧の表示
```bash
# 全アイテムを表示
npm run trace list

# フェーズ別に表示
npm run trace list REQ
npm run trace list SPEC
```

#### トレーサビリティマトリックスの生成
```bash
npm run trace matrix
# → traceability-matrix.md が生成されます
```

#### 整合性チェック
```bash
npm run trace check
# 未実装の要求、テストのない実装などを検出
```

### 影響分析コマンド

#### 変更影響分析
```bash
npm run trace impact <item-id> [change-type]

# 変更時の影響を分析
npm run trace impact PBS-REQ-001 modify

# 削除時の影響を分析
npm run trace impact PBS-SPEC-001 delete

# 追加時の影響を分析
npm run trace impact PBS-IMP-003 add
```

#### 総合影響分析
```bash
npm run trace analyze <item-id>
# 各変更タイプごとの影響サマリーを表示
```

### 更新・削除操作

#### アイテムの更新
```bash
npm run trace update <item-id> <field> <value>

# 例
npm run trace update PBS-REQ-001 title "改善されたユーザー認証機能"
npm run trace update PBS-IMP-001 status "completed"
npm run trace update PBS-SPEC-001 description "詳細な認証フロー"
```

#### アイテムの削除
```bash
npm run trace delete <item-id>
# 削除前に影響分析が実行され、確認が求められます
```

## フェーズとリンクタイプ

### フェーズ
- `REQ` - 要求定義
- `SPEC` - 要件定義  
- `HLD` - 概要設計（High Level Design）
- `DLD` - 詳細設計（Detailed Design）
- `IMP` - 実装
- `TEST` - テスト

### リンクタイプ
- `implements` - 実装関係（デフォルト）
- `references` - 参照関係
- `derives_from` - 派生関係
- `conflicts_with` - 競合関係
- `supersedes` - 置き換え関係

## ID形式

すべてのアイテムには自動的にIDが付与されます：
```
PBS-<PHASE>-<連番>

例：
- PBS-REQ-001  (要求定義001)
- PBS-SPEC-001 (要件定義001)
- PBS-IMP-001  (実装001)
```

## 影響分析の解釈

### 影響度レベル
- **High**: 直接的な実装関係があり、必ず確認・更新が必要
- **Medium**: 関連があり、更新を検討すべき
- **Low**: 間接的な影響のみ、念のため確認

### 影響要因
1. **フェーズ間の関係**: 上流の変更は下流に大きな影響
2. **リンクタイプ**: implementsやconflicts_withは強い影響
3. **距離**: 直接リンクは影響大、間接リンクは影響小

## 実用例

### 新機能追加のワークフロー
```bash
# 1. 要求を追加
npm run trace add REQ "通知機能の実装"
# → PBS-REQ-002

# 2. 要件を定義
npm run trace add SPEC "リアルタイム通知仕様"
# → PBS-SPEC-003

# 3. リンクを作成
npm run trace link PBS-SPEC-003 PBS-REQ-002

# 4. 実装を追加
npm run trace add IMP "WebSocket通知モジュール"
# → PBS-IMP-003

# 5. 実装と要件をリンク
npm run trace link PBS-IMP-003 PBS-SPEC-003

# 6. マトリックスで確認
npm run trace matrix
```

### 要求変更時の影響確認
```bash
# 1. 変更前に影響を分析
npm run trace impact PBS-REQ-001 modify

# 2. 影響レポートを確認
# - 影響を受けるアイテムのリスト
# - 更新が必要な箇所
# - 推奨アクション

# 3. 要求を更新
npm run trace update PBS-REQ-001 title "改善された認証機能"

# 4. 影響を受けるアイテムを順次更新
```

### 不要になったアイテムの削除
```bash
# 1. 削除影響を事前分析
npm run trace impact PBS-SPEC-002 delete

# 2. 削除を実行（確認あり）
npm run trace delete PBS-SPEC-002
# → 影響分析結果が表示され、確認を求められます
```

## データの保存場所

- **トレーサビリティデータ**: `.poppo/traceability.yaml`
- **マトリックス**: `traceability-matrix.md`
- **影響分析レポート**: `impact-analysis-<ID>-<timestamp>.md`

## ベストプラクティス

1. **こまめな更新**: 実装やドキュメント変更時は必ずトレーサビリティも更新
2. **定期的な整合性チェック**: `npm run trace check`で問題を早期発見
3. **変更前の影響分析**: 大きな変更前は必ず`impact`コマンドで確認
4. **適切なリンクタイプの使用**: デフォルトの`implements`以外も活用
5. **説明の追加**: 重要なアイテムには`description`を設定

## トラブルシューティング

### リンクエラーが発生する場合
- 両方のアイテムが存在することを確認: `npm run trace list`
- IDが正しいことを確認（大文字小文字も区別されます）

### 影響分析が期待と異なる場合
- リンク関係を確認: `npm run trace matrix`
- 整合性をチェック: `npm run trace check`

### データが消えた場合
- `.poppo/traceability.yaml`のバックアップから復元
- Gitでバージョン管理している場合は`git checkout`で復元