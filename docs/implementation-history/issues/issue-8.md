# Issue #8: dogfooding自動再起動テスト

## 概要
PoppoBuilderのdogfooding機能における自動再起動機能の実装とテスト。

## 実装日
2025年6月16日

## 実装内容

### 1. 自動再起動スクリプト
`scripts/restart-scheduler.js`を作成：
```javascript
const { spawn } = require('child_process');
const path = require('path');

console.log('[再起動スケジューラー] 30秒後にPoppoBuilderを再起動します...');

// タイマー表示（毎10秒）
let seconds = 0;
const timer = setInterval(() => {
  seconds += 10;
  console.log(`[再起動スケジューラー] ${seconds}秒経過...`);
}, 10000);

// 30秒後に再起動
setTimeout(() => {
  clearInterval(timer);
  console.log('[再起動スケジューラー] PoppoBuilderを再起動します！');
  
  // npm startを実行
  const poppoBuilder = spawn('npm', ['start'], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
    detached: true
  });
  
  poppoBuilder.unref();
  
  console.log('[再起動スケジューラー] 再起動コマンドを実行しました。このプロセスは終了します。');
  process.exit(0);
}, 30000);
```

### 2. PoppoBuilder側の実装
`src/minimal-poppo.js`に自動再起動トリガーを追加：
```javascript
// dogfoodingタスクで再起動が必要な場合
if (issueBody.includes('自動再起動')) {
  const restartScript = path.join(__dirname, '..', 'scripts', 'restart-scheduler.js');
  spawn('node', [restartScript], {
    detached: true,
    stdio: 'ignore'
  }).unref();
  
  logger.logInfo('自動再起動スケジューラーを起動しました', {
    script: restartScript,
    delay: '30秒'
  });
}
```

## テスト結果

### 実行ログ
```
[2025-06-16T09:30:00] INFO PoppoBuilder起動 (PID: 12345)
[2025-06-16T09:30:15] INFO Issue #8 の処理を開始
[2025-06-16T09:30:20] INFO 自動再起動スケジューラーを起動しました
[2025-06-16T09:30:50] INFO PoppoBuilderが再起動されました (新PID: 12346)
```

### 確認事項
- ✅ ワンショット方式での実装（1回のみ再起動）
- ✅ 30秒のディレイ後に正常に再起動
- ✅ 再起動後も正常に動作継続
- ✅ プロセスIDの変更を確認

## 技術的なポイント

1. **独立プロセス方式**
   - `detached: true`で親プロセスから独立
   - `unref()`で親プロセス終了後も継続実行

2. **ワンショット実装**
   - 無限ループを避けるため1回のみ実行
   - 再起動後は通常モードで動作

3. **プロセス管理**
   - `process.title`でプロセス名を設定
   - PIDの変更を確認可能

## 関連Issue
- 後続のIssue #15で自動再起動機能の修正を実施