# Issue #100: IndependentProcessManagerとFileStateManagerの状態管理統合

## 実装日
2025/6/18

## 概要
実行中タスクの状態が`logs/running-tasks.json`と`state/running-tasks.json`の2箇所で管理されており、不整合が発生する可能性があったため、FileStateManagerを通じた一元管理に統合しました。

## 問題点
1. **状態の重複管理**: IndependentProcessManagerとFileStateManagerが別々のファイルで状態管理
2. **データ不整合**: 片方のみ更新されて同期が取れない
3. **プロセス回復時の混乱**: どちらが正しい状態か判断できない
4. **メンテナンス性の低下**: 2つのファイルを管理する必要がある

## 実装内容

### 1. IndependentProcessManagerの修正
`src/independent-process-manager.js`の主な変更：

```javascript
// 修正前
class IndependentProcessManager {
  constructor(config, rateLimiter, logger) {
    this.runningTasksFile = path.join(__dirname, '../logs/running-tasks.json');
    this.stateManager = null;
  }
  
  setStateManager(stateManager) {
    this.stateManager = stateManager;
  }
}

// 修正後
class IndependentProcessManager {
  constructor(config, rateLimiter, logger, stateManager) {
    this.stateManager = stateManager; // FileStateManagerを直接受け取る
    // runningTasksFileは削除
  }
}
```

### 2. 状態管理メソッドの変更
すべての状態管理をFileStateManager経由に変更：

```javascript
// 修正前
getRunningTasks() {
  return JSON.parse(fs.readFileSync(this.runningTasksFile));
}

// 修正後
async getRunningTasks() {
  return await this.stateManager.loadRunningTasks();
}
```

### 3. minimal-poppo-cron.jsの修正
初期化順序の変更：

```javascript
// FileStateManagerを先に初期化
const stateManager = new FileStateManager();

// IndependentProcessManagerにFileStateManagerを渡す
const processManager = new IndependentProcessManager(
  config.claude, 
  rateLimiter, 
  logger,
  stateManager  // 追加
);
```

### 4. マイグレーション処理の実装
```javascript
async function migrateRunningTasks() {
  const oldPath = path.join(__dirname, '../logs/running-tasks.json');
  const newPath = path.join(__dirname, '../state/running-tasks.json');
  
  if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
    console.log('📦 既存のrunning-tasksをstate/ディレクトリにマイグレート中...');
    const data = fs.readFileSync(oldPath, 'utf8');
    await stateManager.saveRunningTasks(JSON.parse(data));
    
    // 古いファイルをバックアップとして保持
    const backupPath = oldPath + '.migrated-' + new Date().toISOString();
    fs.renameSync(oldPath, backupPath);
  }
}
```

## 変更ファイル
- `src/independent-process-manager.js` - 状態管理をFileStateManager経由に変更
- `src/minimal-poppo-cron.js` - 初期化順序の変更とマイグレーション処理の追加
- `test/test-integration-simple.js` - 統合テストの作成
- `CLAUDE.md` - 実装状況の更新

## テスト結果
1. FileStateManagerとの統合動作を確認
2. マイグレーション処理が正常に動作
3. 既存のタスク回復処理が正常に動作
4. 新規タスクの追加・削除が正常に動作

## 影響範囲
- すべてのコンポーネントで`state/running-tasks.json`を使用
- `logs/`ディレクトリはログファイルのみに統一
- `state/`ディレクトリは状態管理ファイルに統一
- データの整合性が保証される

## 今後の課題
- パフォーマンステストの実施
- 大量タスク時の動作確認
- エラーハンドリングのさらなる改善