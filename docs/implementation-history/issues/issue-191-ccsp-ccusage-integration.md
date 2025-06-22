# Issue #191: CCSPエージェントとccusageの統合

## 概要
PoppoBuilderのメインダッシュボードにCCSPエージェントのトークン使用量を表示する機能を実装しました。

## 実装内容

### 1. 既存のccusage統合の確認
調査の結果、CCSPエージェントには既に包括的なccusage統合が実装されていることを確認：
- `agents/ccsp/ccusage-prototype.js` - プロトタイプ実装
- `agents/ccsp/usage-monitor.js` - 使用量監視
- `agents/ccsp/usage-monitor-factory.js` - ファクトリー
- `agents/ccsp/.poppobuilder/ccsp/usage-data/` - 使用量データの保存先

### 2. ダッシュボードへの統合

#### HTMLの更新（`dashboard/client/index.html`）
- トークン使用量セクションを追加
- 統計表示（本日、今週、今月、累計）
- 使用量グラフ用のCanvas要素
- 更新ボタンとCCSP詳細へのリンクボタン

#### CSSの追加（`dashboard/client/css/dashboard.css`）
```css
.token-usage {
    background: #fff;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    margin-bottom: 20px;
}

.token-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 15px;
}

.token-usage-chart {
    height: 250px;
    background: #f8f9fa;
    padding: 15px;
    border-radius: 6px;
}
```

#### i18n対応
- `dashboard/client/i18n/ja.json` - 日本語翻訳を追加
- `dashboard/client/i18n/en.json` - 英語翻訳を追加

### 3. バックエンドAPIの実装

#### トークン使用量API（`dashboard/server/api/token-usage.js`）
- `/api/token-usage/usage` - 集計データの取得
  - 本日、今週、今月、累計のトークン使用量
  - 過去7日間の日別履歴
- `/api/token-usage/details` - 詳細データの取得
  - 期間指定での詳細な使用履歴
  - モデル別、タスク別の使用量

#### サーバー統合（`dashboard/server/index.js`）
```javascript
const TokenUsageAPI = require('./api/token-usage');
this.app.use('/api/token-usage', TokenUsageAPI);
```

### 4. フロントエンドの実装

#### JavaScript更新（`dashboard/client/js/app.js`）
- `updateTokenUsage()` - APIからデータ取得と表示更新
- `formatTokenCount()` - トークン数のフォーマット（K、M表記）
- `updateTokenUsageChart()` - Chart.jsを使用したグラフ描画
- 5分ごとの自動更新
- エラーハンドリング

## 技術的特徴

### データソース
- CCSPエージェントが生成する使用量データファイルを直接読み込み
- `agents/ccsp/.poppobuilder/ccsp/usage-data/*.json`形式のファイルを解析

### パフォーマンス
- ファイルシステムベースの軽量な実装
- 必要な期間のデータのみを読み込み
- フロントエンドでのキャッシュなし（常に最新データを表示）

### グラフ表示
- Chart.jsを使用した折れ線グラフ
- 過去7日間の日別使用量を表示
- レスポンシブデザイン対応

## 使用方法

1. ダッシュボードを起動
```bash
npm run dashboard
```

2. ブラウザでアクセス
```
http://localhost:3001
```

3. トークン使用量セクションで確認
- 統計情報の確認
- グラフでトレンドを把握
- 「CCSP詳細」ボタンでCCSP専用ダッシュボードへ

## 今後の拡張可能性

1. **アラート機能**
   - 使用量の急増を検知して通知
   - 閾値設定によるアラート

2. **詳細分析**
   - モデル別の使用量表示
   - タスクタイプ別の分析
   - コスト計算機能

3. **履歴管理**
   - 長期間のデータアーカイブ
   - 月次レポート生成
   - CSVエクスポート機能

## 関連ファイル
- `dashboard/client/index.html` - HTML更新
- `dashboard/client/css/dashboard.css` - スタイル追加
- `dashboard/client/js/app.js` - フロントエンド実装
- `dashboard/server/api/token-usage.js` - API実装
- `dashboard/server/index.js` - API統合
- `dashboard/client/i18n/ja.json` - 日本語翻訳
- `dashboard/client/i18n/en.json` - 英語翻訳