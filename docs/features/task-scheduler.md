# Task Scheduler
タスクスケジューラー

## 概要

Task Schedulerは、PoppoBuilder Suiteにおいて複数のプロジェクト間でタスクを効率的に振り分けるためのコンポーネントです。様々なスケジューリング戦略をサポートし、プロジェクトの優先度、重み、負荷状況などを考慮して最適なタスク配分を実現します。

## 特徴

- **複数のスケジューリング戦略**: ラウンドロビン、優先度、重み付き、公平配分
- **動的な戦略切り替え**: 実行時に戦略を変更可能
- **並行実行制限**: プロジェクトごとの最大並行タスク数を設定
- **フェアネス保証**: Jain's fairness indexによる公平性の測定
- **詳細なメトリクス**: タスクの配分状況や実行統計を追跡

## インストール

Task Schedulerは PoppoBuilder Suite の一部として提供されています。

```javascript
const TaskScheduler = require('poppo-builder-suite/lib/core/task-scheduler');
```

## 基本的な使い方

### 1. スケジューラーの初期化

```javascript
const scheduler = new TaskScheduler({
  strategy: 'round-robin',              // デフォルト戦略
  defaultPriority: 50,                  // デフォルトプロジェクト優先度
  maxConcurrentPerProject: 5,           // プロジェクトごとのデフォルト最大並行数
  fairShareWindow: 60000                // フェアシェア計算の時間窓（ミリ秒）
});

await scheduler.initialize();
```

### 2. プロジェクトの登録

```javascript
scheduler.registerProject('web-frontend', {
  priority: 80,           // 優先度（0-100）
  weight: 2.0,           // 重み（weighted戦略で使用）
  maxConcurrent: 10,     // 最大並行実行数
  metadata: {            // 任意のメタデータ
    team: 'frontend',
    environment: 'production'
  }
});
```

### 3. タスクのスケジューリング

```javascript
const task = {
  id: 'issue-123',
  type: 'bug-fix',
  priority: 75,
  metadata: {
    labels: ['urgent', 'customer-reported']
  }
};

const assignedProjectId = await scheduler.scheduleTask(task);
console.log(`Task assigned to: ${assignedProjectId}`);
```

### 4. タスクの完了通知

```javascript
// タスクが完了したら通知
scheduler.taskCompleted(assignedProjectId, 'issue-123', 1500); // 1500ms で完了
```

## スケジューリング戦略

### Round Robin (round-robin)

プロジェクトを順番に巡回してタスクを割り当てます。

```javascript
scheduler.setStrategy('round-robin');
```

**特徴:**
- シンプルで公平
- プロジェクトの優先度を考慮しない
- 各プロジェクトに均等にタスクを配分

### Priority Based (priority)

プロジェクトの優先度に基づいてタスクを割り当てます。

```javascript
scheduler.setStrategy('priority');
```

**特徴:**
- 高優先度プロジェクトを優先
- 負荷が高い場合は次の優先度のプロジェクトへ
- スタベーション防止機能付き

### Weighted Distribution (weighted)

プロジェクトの重みに基づいて確率的にタスクを割り当てます。

```javascript
scheduler.setStrategy('weighted');
```

**特徴:**
- 重みに比例した確率で選択
- 統計的に重みに応じた配分を実現
- 短期的な偏りを許容し、長期的な公平性を保証

### Fair Share (fair-share)

すべてのプロジェクトに公平にタスクを配分します。

```javascript
scheduler.setStrategy('fair-share');
```

**特徴:**
- 期待シェアと実際のシェアの差を最小化
- 過去の実行履歴を考慮
- 動的な調整により公平性を維持

## 高度な使い方

### プロジェクトの動的更新

```javascript
// 優先度の更新
scheduler.updateProjectPriority('web-frontend', 90);

// 重みの更新
scheduler.updateProjectWeight('web-frontend', 3.0);

// プロジェクトの削除
scheduler.unregisterProject('old-project');
```

### メトリクスの取得

```javascript
// 全体のメトリクス
const metrics = scheduler.getMetrics();
console.log(`総スケジュール数: ${metrics.totalScheduled}`);
console.log(`フェアネススコア: ${metrics.fairnessScore}`);

// プロジェクト別の統計
const projectStats = scheduler.getProjectStats('web-frontend');
console.log(`完了タスク数: ${projectStats.tasksCompleted}`);
console.log(`平均実行時間: ${projectStats.totalExecutionTime / projectStats.tasksCompleted}ms`);
```

### カスタム戦略の実装

```javascript
class CustomStrategy {
  constructor(scheduler) {
    this.scheduler = scheduler;
    this.name = 'custom';
  }
  
  async schedule(task, context) {
    const { projects, stats } = context;
    // カスタムロジックを実装
    return selectedProjectId;
  }
  
  reset() {
    // 状態をリセット
  }
}

// カスタム戦略を登録
scheduler.registerStrategy('custom', new CustomStrategy(scheduler));
scheduler.setStrategy('custom');
```

## イベント

Task Schedulerは以下のイベントを発行します：

```javascript
// プロジェクト登録時
scheduler.on('project-registered', ({ projectId, project }) => {
  console.log(`Project registered: ${projectId}`);
});

// タスクスケジュール時
scheduler.on('task-scheduled', ({ task, projectId }) => {
  console.log(`Task ${task.id} scheduled to ${projectId}`);
});

// タスク完了時
scheduler.on('task-completed', ({ projectId, taskId, executionTime }) => {
  console.log(`Task ${taskId} completed in ${executionTime}ms`);
});

// 戦略変更時
scheduler.on('strategy-changed', ({ from, to }) => {
  console.log(`Strategy changed from ${from} to ${to}`);
});
```

## 設定オプション

| オプション | 型 | デフォルト | 説明 |
|-----------|-----|-----------|------|
| strategy | string | 'round-robin' | 初期スケジューリング戦略 |
| defaultPriority | number | 50 | プロジェクトのデフォルト優先度 |
| maxConcurrentPerProject | number | 5 | プロジェクトごとのデフォルト最大並行数 |
| fairShareWindow | number | 60000 | フェアシェア計算の時間窓（ミリ秒） |
| schedulerId | string | 'default' | スケジューラーの識別子 |

## ベストプラクティス

1. **適切な戦略の選択**
   - 均等配分が必要: `round-robin` または `fair-share`
   - 優先度が重要: `priority`
   - 柔軟な配分: `weighted`

2. **プロジェクトの設定**
   - 適切な `maxConcurrent` を設定してリソースを管理
   - 優先度は0-100の範囲で設定
   - 重みは相対的な値（例: 1.0, 2.0, 3.0）

3. **パフォーマンス**
   - 大量のプロジェクトがある場合は `priority` 戦略が効率的
   - メトリクス履歴は定期的にクリーンアップ

4. **監視**
   - フェアネススコアを定期的にチェック
   - プロジェクト別の統計を監視
   - 必要に応じて戦略を調整

## トラブルシューティング

### タスクが特定のプロジェクトに偏る

- フェアネススコアをチェック
- `fair-share` 戦略への切り替えを検討
- プロジェクトの重みや優先度を調整

### プロジェクトがタスクを受け取らない

- プロジェクトがアクティブか確認
- `maxConcurrent` の設定を確認
- 現在の並行実行数をチェック

### パフォーマンスの問題

- スケジューリング決定履歴のサイズを確認
- 不要なプロジェクトを削除
- より単純な戦略（`round-robin`）を検討

## 関連ドキュメント

- [Process Pool Manager](../architecture/process-pool-manager.md)
- [Global Configuration](../global-configuration.md)
- [Multi-Project Guide](../guides/multi-project-guide.md)