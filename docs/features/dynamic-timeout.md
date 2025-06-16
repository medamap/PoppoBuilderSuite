# 動的タイムアウト管理機能

## 概要

PoppoBuilderの動的タイムアウト管理機能は、タスクの種類や複雑度に応じてタイムアウト時間を自動的に調整する機能です。これにより、簡単なタスクは素早く処理し、複雑なタスクには十分な時間を確保することができます。

## 機能の特徴

### 1. タスク複雑度の自動判定

Issue本文から以下の要素を分析して複雑度を判定します：

- **本文の長さ**: 文字数に基づくスコア（最大10点）
- **コードブロック数**: 各ブロックにつき2点
- **リンク数**: 各リンクにつき0.5点
- **画像数**: 各画像につき1点
- **リストアイテム数**: 各アイテムにつき0.3点
- **ラベルスコア**: 
  - `complex`: 10点
  - `feature`: 5点
  - `documentation`: 3点
  - `bug`: 2点

複雑度レベル:
- **simple**: スコア10未満
- **moderate**: スコア10〜20
- **complex**: スコア20以上

### 2. タスクタイプ別のデフォルトタイムアウト

```json
{
  "misc": 30分,
  "dogfooding": 2時間,
  "documentation": 1時間,
  "complex": 6時間,
  "feature": 2時間,
  "bug": 1時間
}
```

### 3. 実行履歴に基づく学習

- 各タスクタイプの平均実行時間を記録
- 履歴がある場合、デフォルト値と履歴の中間値を採用
- 学習の影響を緩やかにすることで安定性を確保

### 4. タイムアウト延長機能

実行中のタスクが追加時間を必要とする場合、現在のタイムアウトの50%を延長できます。

## 設定

`config/config.json`で以下の設定が可能です：

```json
{
  "dynamicTimeout": {
    "enabled": true,                    // 機能の有効/無効
    "minTimeout": 600000,              // 最小タイムアウト（10分）
    "maxTimeout": 86400000,            // 最大タイムアウト（24時間）
    "timeoutProfiles": {               // タスクタイプ別デフォルト値
      "misc": 1800000,                 // 30分
      "dogfooding": 7200000,           // 2時間
      "documentation": 3600000,        // 1時間
      "complex": 21600000,             // 6時間
      "feature": 7200000,              // 2時間
      "bug": 3600000                   // 1時間
    },
    "complexityFactors": {
      "enableLearning": true,          // 学習機能の有効/無効
      "learningWeight": 0.5            // 学習の重み（0.0〜1.0）
    }
  }
}
```

## 使用例

### 1. シンプルなタスク

```
Issue内容: "現在時刻を教えてください"
複雑度: simple (スコア: 0.16)
タスクタイプ: misc
計算されたタイムアウト: 24分（30分 × 0.8）
```

### 2. 複雑なタスク

```
Issue内容: 長い説明文、複数のコードブロック、リンク、画像を含む
複雑度: complex (スコア: 29.56)
タスクタイプ: complex
ラベル: task:complex, feature
計算されたタイムアウト: 720分（360分 × 2.0）
```

### 3. 学習による調整

```
タスクタイプ: misc
過去の平均実行時間: 15分
デフォルト: 30分
調整後: 21分（(30分 + 15分×1.5) / 2）
```

## 実行履歴

実行履歴は`logs/execution-history.json`に保存されます：

```json
{
  "taskTypes": {
    "misc": {
      "count": 10,
      "totalTime": 9000000,
      "averageExecutionTime": 900000,
      "successCount": 8,
      "timeoutCount": 1,
      "errorCount": 1
    }
  },
  "complexityHistory": [
    {
      "taskId": "issue-123",
      "timestamp": "2025-06-16T10:00:00.000Z",
      "taskType": "misc",
      "complexity": 5.2,
      "complexityLevel": "simple",
      "executionTime": 900000,
      "status": "completed"
    }
  ]
}
```

## 統計情報

PoppoBuilder起動時に統計情報が表示されます：

```
📊 タイムアウト統計: {
  "taskTypes": {
    "misc": {
      "count": 10,
      "successRate": "80.0%",
      "averageExecutionTime": "15分",
      "timeoutRate": "10.0%"
    },
    "dogfooding": {
      "count": 5,
      "successRate": "100.0%",
      "averageExecutionTime": "45分",
      "timeoutRate": "0.0%"
    }
  },
  "overallStats": {
    "totalTasks": 15,
    "successRate": "86.7%",
    "averageExecutionTime": "25分",
    "timeoutRate": "6.7%"
  }
}
```

## 今後の拡張予定

1. **機械学習による予測精度向上**
   - より多くの特徴量を考慮
   - タスク間の類似度による予測

2. **プロセス間通信によるリアルタイム延長**
   - 実行中のタスクからの延長リクエスト
   - 進捗状況に基づく動的調整

3. **詳細なメトリクス収集**
   - CPU/メモリ使用率との相関分析
   - 時間帯による実行時間の変動分析

4. **カスタムルールの定義**
   - 特定のキーワードによるタイムアウト調整
   - ユーザー定義の複雑度判定ルール