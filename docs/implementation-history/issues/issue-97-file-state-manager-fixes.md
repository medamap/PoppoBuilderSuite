# Issue #97: FileStateManagerのrace condition対策とエラーハンドリング改善

## 実装日
2025/6/18

## 概要
cron実行用に実装したFileStateManagerに複数の重大な問題が発見されたため、修正を実装しました。

## 実装内容

### 1. ファイルロック機構の実装
- 排他制御用のロックファイルを使用
- タイムアウトと強制ロック解除機能
- プロセスIDによるロック所有者の確認
- `acquireLock()` / `releaseLock()` メソッドの追加

### 2. アトミックな書き込み処理
- 一時ファイルへの書き込み後、rename操作でアトミックに置換
- バックアップファイルの作成
- エラー時の自動ロールバック
- `atomicWrite()` メソッドの追加

### 3. データ検証とサニタイズ
- JSONパース前の妥当性チェック
- 型検証（Set、Map、配列、オブジェクト）
- 不正データの自動除去とログ出力
- 各読み込みメソッドでの検証追加

### 4. 適切なエラー伝播
- すべてのメソッドでエラーをthrow
- 呼び出し元での適切なエラーハンドリング
- エラー時のリカバリー処理

### 5. minimal-poppo-cron.jsの更新
- FileStateManagerのエラーに対する適切なハンドリング追加
- 初期化失敗時のプロセス終了
- 各状態保存操作でのエラーハンドリング

## 変更ファイル
- `src/file-state-manager.js` - 主要な修正（ロック機構、アトミック書き込み、データ検証）
- `src/minimal-poppo-cron.js` - エラーハンドリングの追加
- `test/test-file-state-manager.js` - テストスクリプトの作成

## テスト結果
- 10個の同時書き込みテスト: ✅ 成功
- 不正JSONの自動修復: ✅ 成功
- ロックタイムアウト: ✅ 成功（古いロックの強制削除）
- アトミック書き込み: ✅ 成功（バックアップ作成確認）
- 整合性チェック: ✅ 成功
- 古いタスクのクリーンアップ: ✅ 成功

## 技術的詳細

### ファイルロック実装
```javascript
async acquireLock(filePath, timeout = 5000) {
  const lockFile = path.join(this.lockDir, `${path.basename(filePath)}.lock`);
  const startTime = Date.now();
  
  while (true) {
    try {
      // O_EXCL フラグでアトミックにファイル作成
      const fd = await fs.open(lockFile, 'wx');
      await fd.write(Buffer.from(String(process.pid)));
      await fd.close();
      return lockFile;
    } catch (error) {
      // ロック取得処理...
    }
  }
}
```

### アトミック書き込み
```javascript
async atomicWrite(filePath, content) {
  const tempFile = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const backupFile = `${filePath}.backup`;
  
  // 一時ファイルに書き込み → アトミックに置換
  await fs.writeFile(tempFile, content, 'utf8');
  await fs.rename(tempFile, filePath);
}
```

## 影響範囲
- `src/minimal-poppo-cron.js` - エラーハンドリングの追加により、状態管理の信頼性が向上
- cron実行時の複数プロセスからの同時アクセスが安全に

## 今後の課題
- パフォーマンステストの実施
- ロックタイムアウト値の調整
- より詳細なエラーログの追加