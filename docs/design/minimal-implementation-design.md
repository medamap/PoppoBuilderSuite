# 最小限実装の設計

## 概要
最小限のIssue処理機能を実装するための具体的な設計。

## 実装スコープ

### Phase 1で実装するもの
1. **Issue読み取り**: 作者のmisc Issueのみ
2. **Claude実行**: 最大2プロセスまで
3. **結果報告**: Issueコメントで返信
4. **レート制限**: エラー時は指定時刻まで待機

### Phase 1で実装しないもの
- フェーズ管理（要求定義→要件定義→...）
- ブランチ管理
- PR作成
- 状態永続化（メモリ内のみ）

## ディレクトリ構造
```
poppo-builder-suite/
├── src/
│   ├── minimal-poppo.js     # メインスクリプト
│   ├── github-client.js     # GitHub操作
│   ├── process-manager.js   # Claude実行管理
│   └── rate-limiter.js      # レート制限処理
├── config/
│   └── config.json          # 設定ファイル
└── package.json
```

## 設定ファイル
```json
{
  "github": {
    "owner": "medamap",
    "repo": "PoppoBuilderSuite"
  },
  "claude": {
    "maxConcurrent": 2,
    "timeout": 300000
  },
  "polling": {
    "interval": 30000
  }
}
```

## エラーハンドリング

### レート制限の検出
```javascript
// "rate limit reached|1234567890" 形式を検出
function parseRateLimit(error) {
  const match = error.match(/rate.*limit.*reached.*\|(\d+)/i);
  if (match) {
    return {
      isRateLimit: true,
      resetTime: parseInt(match[1]) * 1000 // エポック秒→ミリ秒
    };
  }
  return { isRateLimit: false };
}
```

## 処理フロー
1. 30秒ごとにIssueをポーリング
2. 作者の `task:misc` ラベル付きIssueを検出
3. `processing` ラベルを付けて処理開始
4. Claudeで実行（最大2並行）
5. 結果をコメントで報告
6. `completed` ラベルを付けて完了
7. レート制限エラーの場合は全処理を一時停止