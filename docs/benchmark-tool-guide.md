# 統合パフォーマンスベンチマークツール - Issue #134

PoppoBuilder Suite用の包括的なパフォーマンス測定・分析ツールです。

## 🚀 概要

UnifiedBenchmarkRunnerは、既存のPerformanceMonitor、LoadTester、CCSPベンチマークを統合し、PoppoBuilder Suite全体の包括的なパフォーマンス測定を実行します。

## 📊 ベンチマークタイプ

### 1. Performance（パフォーマンス監視）
- **概要**: システムリソースの使用状況とアプリケーション性能を監視
- **測定項目**:
  - CPU使用率（平均、ピーク値）
  - メモリ使用率（ヒープ、RSS、外部メモリ）
  - イベントループ遅延
  - ガベージコレクション統計
  - 操作別パフォーマンス追跡

### 2. Load（負荷テスト）
- **概要**: 同時接続数とスループプットのテスト
- **測定項目**:
  - 負荷、ストレス、スパイク、耐久テスト
  - スループプット（requests/second）
  - 応答時間（平均、P50、P95、P99）
  - エラー率とボトルネック分析

### 3. Agents（エージェント性能）
- **概要**: CCLA、CCAG、CCPMエージェントの個別性能測定
- **測定項目**:
  - エージェント別応答時間
  - 成功率とエラー率
  - 並行処理能力
  - リクエスト処理効率

### 4. Redis（Redis操作性能）
- **概要**: Redisデータベース操作のパフォーマンステスト
- **測定項目**:
  - SET、GET、キュー操作の応答時間
  - スループプット（operations/second）
  - データサイズ別性能
  - 接続プール効率

### 5. System（システムベンチマーク）
- **概要**: システムリソースの基本性能測定
- **測定項目**:
  - CPU集約処理（数学計算性能）
  - メモリ集約処理（オブジェクト生成・破棄）
  - ネットワークI/O（並行リクエスト処理）
  - ディスクI/O（ファイル読み書き性能）

## 🛠️ 使用方法

### CLIコマンド

```bash
# 基本的なベンチマーク実行
npm run benchmark:run

# 短時間テスト（開発用）
npm run benchmark:run -- --short

# 完全テスト（CI/CD用）
npm run benchmark:full

# 特定のベンチマークのみ実行
npm run benchmark:performance
npm run benchmark:load
npm run benchmark:agents
npm run benchmark:system

# クイックテスト
npm run benchmark:quick --type performance

# レポート一覧
npm run benchmark:reports
```

### プログラマティック使用

```javascript
const UnifiedBenchmarkRunner = require('./lib/performance/unified-benchmark-runner');

const runner = new UnifiedBenchmarkRunner({
  benchmarkTypes: ['performance', 'system'],
  shortTest: true,
  outputDir: './reports/benchmarks',
  reportFormat: 'both' // json, html, both
});

await runner.initialize();
const results = await runner.runFullBenchmarkSuite();
console.log('総合スコア:', results.overallScore);
```

## ⚙️ 設定オプション

### 基本設定

```javascript
{
  benchmarkTypes: ['performance', 'load', 'agents', 'redis', 'system'],
  reportFormat: 'both', // json, html, both
  outputDir: './reports/benchmarks',
  shortTest: false,     // 短時間テストモード
  fullTest: false       // 完全テストモード
}
```

### 詳細設定

```javascript
{
  performance: {
    duration: 120000,        // 測定時間（ミリ秒）
    metricsInterval: 1000    // メトリクス収集間隔
  },
  load: {
    maxUsers: 50,           // 最大同時ユーザー数
    duration: 180000,       // テスト時間
    scenarios: ['load', 'stress'] // テストシナリオ
  },
  agents: {
    testAgents: ['ccla', 'ccag', 'ccpm'], // テスト対象エージェント
    requestCount: 1000      // リクエスト数
  },
  redis: {
    enabled: true,          // Redisテスト有効/無効
    operationTypes: ['set', 'get', 'queue'], // 操作タイプ
    dataSize: [1024, 10240, 102400] // データサイズ（バイト）
  },
  system: {
    includeMemoryProfiling: true,  // メモリプロファイリング
    includeCpuProfiling: true,     // CPUプロファイリング
    includeNetworkTest: true       // ネットワークテスト
  }
}
```

## 📈 レポート

### 総合スコア

各ベンチマークタイプの結果を統合して0-100点のスコアを算出：

- **80-100点**: 優秀（緑）
- **60-79点**: 良好（黄）
- **40-59点**: 要改善（オレンジ）
- **0-39点**: 問題あり（赤）

### 推奨事項

パフォーマンス結果に基づいて自動的に改善提案を生成：

- **CPU使用率が高い場合**: 処理の最適化、分散化
- **メモリ使用率が高い場合**: メモリリーク確認、GC最適化
- **応答時間が長い場合**: スケーラビリティ改善
- **エラー率が高い場合**: エラーハンドリング強化

### 出力形式

#### JSON形式
```json
{
  "title": "PoppoBuilder Suite - 統合パフォーマンスベンチマーク",
  "overallScore": 75,
  "executionInfo": {
    "startTime": "2024-01-01T00:00:00.000Z",
    "endTime": "2024-01-01T00:10:00.000Z",
    "totalDuration": 600000,
    "testMode": "full",
    "benchmarkTypes": ["performance", "load", "system"]
  },
  "results": {
    "performance": { /* 詳細な結果 */ },
    "load": { /* 詳細な結果 */ },
    "system": { /* 詳細な結果 */ }
  },
  "recommendations": [
    {
      "category": "performance",
      "severity": "medium",
      "message": "CPU使用率が高いです",
      "suggestion": "CPU集約的な処理の分散化"
    }
  ],
  "systemInfo": {
    "nodeVersion": "v18.x.x",
    "platform": "darwin",
    "cpuCount": 8,
    "totalMemory": "16GB"
  }
}
```

#### HTML形式
見やすいWebページ形式のレポートが生成されます：
- 総合スコアの大きな表示
- ベンチマーク結果のカード表示
- 推奨事項のハイライト
- システム情報の詳細

## 🔧 トラブルシューティング

### よくある問題

1. **BigInt serialization エラー**
   - 原因: パフォーマンス測定でBigIntが使用される
   - 解決: 自動的にBigIntを文字列に変換してからJSON化

2. **メモリ不足エラー**
   - 原因: 大量のテストデータ生成
   - 解決: `shortTest: true` オプションを使用

3. **タイムアウトエラー**
   - 原因: 長時間の測定
   - 解決: より短い `duration` 設定を使用

### パフォーマンス最適化

1. **短時間テストモード**
   ```javascript
   { shortTest: true }  // テスト時間とデータサイズを削減
   ```

2. **特定のベンチマークのみ実行**
   ```javascript
   { benchmarkTypes: ['performance'] }  // 必要なテストのみ
   ```

3. **Redis無効化**
   ```javascript
   { redis: { enabled: false } }  // Redis接続が不要な場合
   ```

## 🎯 CI/CD統合

### GitHub Actions例

```yaml
name: Performance Benchmark
on:
  schedule:
    - cron: '0 2 * * *'  # 毎日深夜2時に実行
  
jobs:
  benchmark:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run benchmark:full
      - uses: actions/upload-artifact@v3
        with:
          name: benchmark-reports
          path: reports/benchmarks/
```

## 📋 実装詳細

### アーキテクチャ

```
UnifiedBenchmarkRunner
├── PerformanceMonitor    # 既存のパフォーマンス監視
├── LoadTester           # 既存の負荷テスト
├── AgentBenchmark       # エージェント別テスト
├── RedisBenchmark       # Redis操作テスト
└── SystemBenchmark      # システムリソーステスト
```

### 拡張ポイント

1. **新しいベンチマークタイプの追加**
   ```javascript
   async runCustomBenchmark() {
     // カスタムベンチマーク実装
   }
   ```

2. **レポート形式の追加**
   ```javascript
   async generateCustomReport() {
     // カスタムレポート生成
   }
   ```

3. **メトリクスの追加**
   ```javascript
   collectCustomMetrics() {
     // カスタムメトリクス収集
   }
   ```

## 🚧 今後の拡張予定

1. **リアルタイムモニタリング**: WebSocketベースのリアルタイム監視
2. **比較分析**: 過去のベンチマーク結果との比較
3. **アラート機能**: 性能劣化の自動検出と通知
4. **カスタムテスト**: ユーザー定義のベンチマーク追加
5. **分散テスト**: 複数ノードでの分散ベンチマーク

---

このドキュメントは Issue #134 の実装内容を説明しています。
詳細な使用方法や設定については、各ベンチマークモジュールのドキュメントも参照してください。