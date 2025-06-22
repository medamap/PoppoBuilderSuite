# Issue #70: 同一Issueに対する重複処理の抑制機能

## 概要
PoppoBuilderで同一Issueに対して複数のプロセスが同時に起動されることを防ぐ機能の実装状況をまとめたドキュメントです。

## 実装日
2025年6月17日

## 実装内容

### 1. ラベルベースの重複チェック

#### shouldProcessIssue関数（`src/minimal-poppo.js`）
```javascript
function shouldProcessIssue(issue) {
  // ... 他のチェック ...

  // completed, processing, awaiting-responseラベルがあればスキップ
  if (labels.includes('completed') || labels.includes('processing') || labels.includes('awaiting-response')) {
    return false;
  }

  return true;
}
```

- `processing`ラベルが付いているIssueは処理対象から除外
- これにより、処理中のIssueに対する重複処理を防止

### 2. processingラベルの管理

#### processIssue関数（`src/minimal-poppo.js`）
```javascript
async function processIssue(issue) {
  const issueNumber = issue.number;
  
  // 処理開始前に処理済みとして記録（二重起動防止）
  processedIssues.add(issueNumber);

  try {
    // processingラベルを追加
    await github.addLabels(issueNumber, ['processing']);
    
    // 処理実行...
    
  } catch (error) {
    // エラー時はprocessingラベルを削除（再試行可能に）
    await github.removeLabels(issueNumber, ['processing']);
    processedIssues.delete(issueNumber);
  }
}
```

### 3. メモリ内での重複管理

#### processedIssues Set（`src/minimal-poppo.js`）
```javascript
// 処理済みIssueを記録（メモリ内）
const processedIssues = new Set();
```

- 同一プロセス内での重複処理を防止
- PoppoBuilder再起動時はクリアされる（ラベルベースのチェックがメイン）

## 動作フロー

1. **Issue検出フェーズ**
   - ポーリング時に`shouldProcessIssue`でフィルタリング
   - `processing`ラベルが付いているIssueはスキップ

2. **処理開始フェーズ**
   - `processedIssues.add(issueNumber)`で記録
   - `processing`ラベルを即座に追加
   - 他のポーリングサイクルから見えないようにする

3. **処理中フェーズ**
   - 独立プロセスとしてClaude CLIを実行
   - PoppoBuilder再起動時も`processing`ラベルで保護

4. **処理完了フェーズ**
   - `processing`ラベルを削除
   - `completed`または`awaiting-response`ラベルを追加

## テスト結果

`test/test-duplicate-prevention.js`で以下のテストケースを実装・検証：

1. **processingラベルによるスキップ** ✅
   - processingラベルがある場合、shouldProcessIssueがfalseを返す

2. **processedIssues Setの動作** ✅
   - 同じIssue番号は一度しか処理されない

3. **ラベル管理フロー** ✅
   - 処理開始時にprocessingラベルが追加される
   - 処理完了時にprocessingラベルが削除される

4. **実行中タスクの管理** ✅
   - タスクの追加と削除が正しく動作

5. **並行処理シミュレーション** ✅
   - 複数の処理要求が来ても1回だけ処理される

## 効果

1. **リソース使用量の削減**
   - 同じIssueに対する重複プロセス起動を防止
   - CPU・メモリの無駄遣いを削減

2. **処理の整合性向上**
   - 同一Issueに対する競合状態を防止
   - 処理結果の一貫性を保証

3. **システムの安定性向上**
   - プロセス数の制限により安定性が向上
   - レート制限への負荷も軽減

## 制限事項

1. **メモリ内Setの制限**
   - PoppoBuilder再起動時にクリアされる
   - ただし、ラベルベースのチェックでカバー

2. **ラベル同期の遅延**
   - GitHub APIの遅延により、稀に重複が発生する可能性
   - 実用上は問題ないレベル

## 今後の改善案

1. **永続的な状態管理**
   - FileStateManagerとの統合による永続化
   - より確実な重複防止

2. **分散環境対応**
   - 複数のPoppoBuilderインスタンスでの協調
   - 分散ロックの実装

3. **メトリクスの追加**
   - 重複防止の効果測定
   - パフォーマンス影響の可視化

## 追加の実装（Issue #101以降）

### IssueLockManagerによる強化（2025/6/19）
- ファイルベースのロック機構（`.poppo/locks/`ディレクトリ）
- プロセスクラッシュ時の自動ロック解放
- PIDベースのプロセス生存確認
- タイムアウト機能（デフォルト30分）

### StatusManagerによる状態管理（2025/6/19）
- JSONファイルベースの状態管理（`state/issue-status.json`）
- チェックアウト/チェックイン機能
- ハートビート管理（30秒ごと）
- MirinOrphanManagerと連携した孤児Issue検出

これらの実装により、より堅牢な重複処理抑制が実現されています。