# 言語設定機能の要求定義

## 作成日: 2025/6/15
## ステータス: 要求定義

## 概要
PoppoBuilderの回答言語を設定可能にし、一貫した言語でユーザーとのやり取りを行う機能。

## 詳細要求

### 1. 設定管理
- **設定場所**: プロジェクト固有の設定ファイル (`.poppo/config.json`)
- **デフォルト言語**: 日本語
- **対応言語**: 日本語、英語（将来的に他言語も追加可能）

### 2. 設定ファイル形式
```json
{
  "language": {
    "primary": "ja",
    "fallback": "en"
  },
  "systemPrompt": {
    "enforceLanguage": true,
    "customInstructions": ""
  }
}
```

### 3. システムプロンプトへの反映
言語設定に基づいてシステムプロンプトに以下を自動追加：

```
重要: 回答は必ず${primary_language}で行ってください。
- 日本語が設定されている場合: すべての回答、コメント、説明を日本語で記述
- 英語が設定されている場合: すべての回答、コメント、説明を英語で記述
- コードコメントや変数名も指定言語に従う
```

### 4. 言語別システムプロンプト例

#### 日本語設定時
```
重要: あなたは PoppoBuilder の自動実行エージェントです。
すべての回答、コメント、説明は日本語で行ってください。

以下のルールに従ってください：
1. デフォルトの作業ブランチは 'work/poppo-builder' です
2. 回答はすべて日本語で記述してください
3. コードコメントも日本語で記述してください
...
```

#### 英語設定時
```
Important: You are PoppoBuilder's automated execution agent.
Provide all responses, comments, and explanations in English.

Follow these rules:
1. The default working branch is 'work/poppo-builder'
2. All responses must be written in English
3. Code comments should also be written in English
...
```

### 5. 設定変更方法

#### 手動設定
```bash
# プロジェクトの言語を日本語に設定
echo '{"language":{"primary":"ja"}}' > .poppo/config.json

# プロジェクトの言語を英語に設定  
echo '{"language":{"primary":"en"}}' > .poppo/config.json
```

#### Issue経由での設定変更
```
タイトル: 言語設定変更
内容: PoppoBuilderの回答言語を英語に変更してください
ラベル: task:config
```

### 6. 実装の考慮事項

#### 設定読み込み優先順位
1. プロジェクト設定 (`.poppo/config.json`)
2. ユーザーグローバル設定 (`~/.poppo/config.json`)
3. システムデフォルト (日本語)

#### システムプロンプト生成
```javascript
function generateSystemPrompt(config) {
  const language = config.language?.primary || 'ja';
  const languageInstructions = {
    ja: 'すべての回答、コメント、説明は日本語で行ってください。',
    en: 'Provide all responses, comments, and explanations in English.'
  };
  
  return `
重要: あなたは PoppoBuilder の自動実行エージェントです。
${languageInstructions[language]}

以下のルールに従ってください：
...
`;
}
```

### 7. 段階的実装

#### Phase 1: 基本言語設定
- `.poppo/config.json` からの言語設定読み込み
- システムプロンプトへの言語指示追加

#### Phase 2: 動的言語変更
- Issue経由での言語設定変更
- 設定変更時の即座反映

#### Phase 3: 高度な言語機能
- 多言語対応拡張
- 地域別設定（ja-JP, en-US等）
- 混在モード（コードは英語、説明は日本語等）

## 期待される効果
- 一貫した言語でのユーザー体験
- 国際化対応の基盤構築
- チーム開発時の言語統一