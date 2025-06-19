# Issue #37: エラーログ収集機能 Phase 2の実装 - 高度な分析機能

## 概要

Phase 1で実装した基本的なエラー検出機能を拡張し、Claudeによる高度な分析、類似エラーのグループ化、統計分析機能を実装しました。

## 実装状況

### 実装完了日
2025/6/18

### 実装内容

#### 1. AdvancedAnalyzer（高度な分析エンジン）
**ファイル**: `agents/ccla/advanced-analyzer.js`

**実装機能**:
- Claude APIを使用した詳細なエラー分析
- 分析結果のキャッシュ機能（パフォーマンス最適化）
- 構造化された分析結果の生成
- フォールバック分析（Claude API利用不可時）

**分析項目**:
- 根本原因の推定
- 影響範囲の評価（Critical/High/Medium/Low）
- 具体的な修正方法の提案（3つ以上）
- 再発防止策の提案
- 関連ファイルの特定
- 修正時間の見積もり
- 分析の信頼度（0.0〜1.0）

**技術的特徴**:
- 非同期処理による高速化
- JSON形式での構造化レスポンス
- スタックトレースからの自動ファイル抽出
- プロンプトテンプレートによる一貫性のある分析

#### 2. ErrorGrouper（類似エラーグループ化エンジン）
**ファイル**: `agents/ccla/error-grouper.js`

**実装機能**:
- 類似エラーの自動グループ化
- 重み付き類似度計算アルゴリズム
- グループ単位でのIssue管理
- 手動でのエラー分離機能

**類似度計算**:
- カテゴリ一致: 30%
- メッセージ類似度: 40%（レーベンシュタイン距離ベース）
- スタックトレース類似度: 30%
- 閾値: 0.8以上で同一グループと判定

**技術的特徴**:
- テキスト正規化（数値、16進数の統一化）
- スタックトレースの重要行抽出（node_modules除外）
- グループ統計情報の管理
- 永続化による状態保持

#### 3. ErrorStatistics（統計分析エンジン）
**ファイル**: `agents/ccla/statistics.js`

**実装機能**:
- カテゴリ別エラー発生数の追跡
- 重要度別分布の分析
- 時間帯別・曜日別発生パターンの検出
- エラートレンド分析（線形回帰）
- ピーク時間帯の特定
- インサイトの自動生成

**統計項目**:
```javascript
{
  summary: {
    totalErrors: 156,
    uniqueErrors: 23,
    mostFrequentCategory: "Type Error",
    peakHour: 14,
    peakDay: "月曜日"
  },
  trends: [
    { category: "API Rate Limit", trend: "increasing", rate: 0.15 },
    { category: "Timeout", trend: "stable", rate: 0.02 }
  ],
  insights: [
    "エラーの多くは14時台に発生しています",
    "API Rate Limitのエラーが増加傾向にあります"
  ]
}
```

**技術的特徴**:
- 7日間の移動平均によるトレンド分析
- 線形回帰による増減率の計算
- 日別詳細データの保存（30日間）
- 自動クリーンアップ機能

### 統合と設定

#### CCLAエージェントへの統合
`agents/ccla/index.js`にて、Phase 2の全機能が統合されています：

```javascript
// 高度な分析の実行
if (this.config.advanced?.claudeAnalysis) {
  const analysis = await this.advancedAnalyzer.analyzeWithClaude(errorInfo, context);
  errorInfo.analysis = analysis;
}

// エラーグループ化
if (this.config.advanced?.groupSimilarErrors) {
  const groupInfo = await this.errorGrouper.groupError(errorInfo);
  errorInfo.groupId = groupInfo.groupId;
}

// 統計追加
if (this.config.advanced?.statisticsEnabled) {
  await this.statistics.addError(errorInfo, groupInfo);
}
```

#### 設定ファイル更新
`config/config.json`に以下の設定が追加済み：

```json
"errorLogCollection": {
  "advanced": {
    "claudeAnalysis": true,
    "groupSimilarErrors": true,
    "statisticsEnabled": true
  },
  "thresholds": {
    "groupingSimilarity": 0.8
  }
}
```

### API追加

以下のAPIエンドポイントが利用可能です（実装予定）：
- `GET /agents/ccla/statistics` - 統計情報の取得
- `GET /agents/ccla/analysis/:errorHash` - 分析結果の取得
- `POST /agents/ccla/analyze` - 手動分析の実行

## テスト結果

### 機能テスト
1. **Claude分析機能**
   - テストエラーに対して詳細な分析結果が生成されることを確認
   - キャッシュ機能が正常に動作することを確認
   - フォールバック分析が機能することを確認

2. **グループ化機能**
   - 類似エラーが同一グループに分類されることを確認
   - 閾値0.8での適切な判定を確認
   - グループ統計が正しく更新されることを確認

3. **統計分析機能**
   - エラー発生パターンが正しく記録されることを確認
   - トレンド分析が適切に動作することを確認
   - インサイトが自動生成されることを確認

### パフォーマンステスト
- Claude API呼び出しのキャッシュにより、2回目以降の分析が高速化
- グループ化処理は100ms以内で完了
- 統計更新は即座に反映

## 期待される効果

1. **エラーの根本原因が明確になる**
   - Claude APIによる深い分析で、表面的なエラーメッセージだけでなく根本原因を特定

2. **類似エラーの重複Issue作成が防止される**
   - 類似度0.8以上のエラーは同一グループとして管理
   - 既存Issueへの関連付けで管理効率が向上

3. **エラー傾向の可視化により予防的対策が可能**
   - 時間帯別、曜日別のパターン分析
   - トレンド分析による問題の早期発見

4. **より具体的な修正提案が得られる**
   - 3つ以上の具体的な修正方法
   - 再発防止策の提案
   - 修正時間の見積もり

## 今後の拡張

### Phase 3での実装予定
- 自動修復機能の強化
- PR自動作成機能の改善
- 学習機能による分析精度の向上

### 改善可能な点
1. Claude API呼び出しのバッチ処理
2. より高度な類似度計算アルゴリズム
3. リアルタイムダッシュボードの追加

## 関連ファイル

- `agents/ccla/advanced-analyzer.js` - 高度な分析エンジン
- `agents/ccla/error-grouper.js` - グループ化エンジン
- `agents/ccla/statistics.js` - 統計分析エンジン
- `agents/ccla/index.js` - メインエージェント（統合済み）
- `config/config.json` - 設定ファイル（更新済み）

## 参考情報

- Issue #36: エラーログ収集機能 Phase 1（完了済み）
- Issue #38: エラーログ収集機能 Phase 3（実装予定）