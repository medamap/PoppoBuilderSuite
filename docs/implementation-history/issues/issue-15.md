# Issue #15: dogfooding自動再起動機能の修正

## 概要
Issue #8で実装した自動再起動機能のラベル判定ロジックを修正。

## 実装日
2025年6月16日

## 問題点
- `task:dogfooding`ラベルの判定が正しく動作していなかった
- `label.name`ではなく`label`を直接参照していたためマッチしない

## 修正内容

### ラベル判定の修正
`src/minimal-poppo.js`の修正前：
```javascript
const isDogfooding = issue.labels.some(label => label === 'task:dogfooding');
```

修正後：
```javascript
const isDogfooding = issue.labels.some(label => label.name === 'task:dogfooding');
```

### 動作確認の強化
```javascript
logger.logInfo('Issueラベル情報', {
  issueNumber: issue.number,
  labels: issue.labels.map(l => l.name),
  isDogfooding: isDogfooding
});
```

## テスト結果

### 修正前のログ
```
[ERROR] dogfoodingラベルが検出されません
labels: [object Object],[object Object]
isDogfooding: false
```

### 修正後のログ
```
[INFO] Issueラベル情報
labels: ["task:dogfooding", "enhancement"]
isDogfooding: true
[INFO] DOGFOODINGモードで実行します
```

## 技術的なポイント

1. **オブジェクト構造の理解**
   - GitHub APIはラベルをオブジェクト配列で返す
   - 各ラベルは`{name: "label-name", color: "..."}`の形式

2. **デバッグログの重要性**
   - 実際のデータ構造を確認するログを追加
   - 問題の早期発見に貢献

## 影響範囲
- すべてのdogfoodingタスクが正しく認識されるように
- CLAUDE.mdの自動参照が有効化
- 自動再起動機能が正常動作

## 関連Issue
- Issue #8: 最初の自動再起動実装
- Issue #17: 修正後の動作確認