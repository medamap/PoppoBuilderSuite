/**
 * プロンプト生成器
 * タスクと複雑度分析に基づいて最適なプロンプトを生成
 */

const fs = require('fs').promises;
const path = require('path');

class PromptGenerator {
  constructor() {
    // プロンプトテンプレート
    this.templates = {
      'architecture-design': this.architectureTemplate,
      'complex-refactoring': this.refactoringTemplate,
      'debug-analysis': this.debugTemplate,
      'code-generation': this.codeGenerationTemplate,
      'performance-optimization': this.performanceTemplate,
      'security-audit': this.securityTemplate,
      'test-generation': this.testGenerationTemplate,
      'documentation-generation': this.documentationTemplate,
      'default': this.defaultTemplate
    };
  }

  /**
   * プロンプトを生成
   */
  async generate(task, complexityAnalysis) {
    const template = this.templates[task.type] || this.templates.default;
    const context = await this.gatherContext(task);
    
    const prompt = template.call(this, {
      task,
      complexity: complexityAnalysis,
      context
    });
    
    return this.enhancePrompt(prompt, task, complexityAnalysis);
  }

  /**
   * コンテキスト情報を収集
   */
  async gatherContext(task) {
    const context = {
      projectInfo: await this.getProjectInfo(task.projectPath),
      recentChanges: await this.getRecentChanges(task),
      relatedFiles: await this.getRelatedFiles(task),
      existingPatterns: await this.detectPatterns(task)
    };
    
    return context;
  }

  /**
   * プロジェクト情報を取得
   */
  async getProjectInfo(projectPath) {
    if (!projectPath) return null;
    
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      
      return {
        name: packageJson.name,
        version: packageJson.version,
        description: packageJson.description,
        main: packageJson.main,
        scripts: Object.keys(packageJson.scripts || {}),
        dependencies: Object.keys(packageJson.dependencies || {}),
        devDependencies: Object.keys(packageJson.devDependencies || {})
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 最近の変更を取得
   */
  async getRecentChanges(task) {
    // GitHubのコメントから最近の変更を抽出
    if (!task.comments || task.comments.length === 0) return [];
    
    const recentChanges = task.comments
      .slice(-5) // 最新5件
      .map(comment => ({
        author: comment.author,
        date: comment.created_at,
        summary: comment.body.substring(0, 200)
      }));
    
    return recentChanges;
  }

  /**
   * 関連ファイルを取得
   */
  async getRelatedFiles(task) {
    if (!task.files || task.files.length === 0) return [];
    
    // ファイルをカテゴリ別に分類
    const categorized = {
      source: [],
      test: [],
      config: [],
      documentation: []
    };
    
    task.files.forEach(file => {
      if (file.includes('test') || file.includes('spec')) {
        categorized.test.push(file);
      } else if (file.includes('config') || file.endsWith('.json')) {
        categorized.config.push(file);
      } else if (file.endsWith('.md') || file.includes('doc')) {
        categorized.documentation.push(file);
      } else {
        categorized.source.push(file);
      }
    });
    
    return categorized;
  }

  /**
   * パターンを検出
   */
  async detectPatterns(task) {
    if (!task.projectPath || !task.files) return {};
    
    const patterns = {
      framework: null,
      testRunner: null,
      buildTool: null,
      style: null
    };
    
    // フレームワークの検出
    const files = task.files.map(f => f.toLowerCase());
    if (files.some(f => f.includes('react'))) patterns.framework = 'React';
    else if (files.some(f => f.includes('vue'))) patterns.framework = 'Vue';
    else if (files.some(f => f.includes('angular'))) patterns.framework = 'Angular';
    
    // テストランナーの検出
    if (files.some(f => f.includes('jest'))) patterns.testRunner = 'Jest';
    else if (files.some(f => f.includes('mocha'))) patterns.testRunner = 'Mocha';
    else if (files.some(f => f.includes('vitest'))) patterns.testRunner = 'Vitest';
    
    return patterns;
  }

  /**
   * プロンプトを強化
   */
  enhancePrompt(basePrompt, task, complexityAnalysis) {
    let enhanced = basePrompt;
    
    // 制約事項を追加
    enhanced += '\n\n## 制約事項\n';
    enhanced += '- 既存のコードスタイルとパターンに従ってください\n';
    enhanced += '- エラーハンドリングを適切に実装してください\n';
    enhanced += '- 必要に応じてテストコードも作成してください\n';
    
    // 複雑度に応じた追加指示
    if (complexityAnalysis.score > 0.8) {
      enhanced += '- このタスクは非常に複雑です。段階的なアプローチを取ってください\n';
      enhanced += '- 各ステップで確認を行いながら進めてください\n';
    }
    
    // ファイル数が多い場合の指示
    if (task.files && task.files.length > 10) {
      enhanced += '- 多数のファイルが関係しています。影響範囲を慎重に確認してください\n';
    }
    
    return enhanced;
  }

  // テンプレート関数

  architectureTemplate({ task, complexity, context }) {
    return `# アーキテクチャ設計タスク

## 概要
${task.description || task.body}

## プロジェクト情報
${context.projectInfo ? JSON.stringify(context.projectInfo, null, 2) : 'なし'}

## 要求事項
1. 現在のアーキテクチャを分析し、問題点を特定してください
2. 改善案を提案してください
3. 実装計画を作成してください
4. 影響範囲とリスクを評価してください

## 関連ファイル
${JSON.stringify(context.relatedFiles, null, 2)}

## 複雑度分析
- スコア: ${complexity.score}
- 推定トークン: ${complexity.estimatedTokens}
`;
  }

  refactoringTemplate({ task, complexity, context }) {
    return `# リファクタリングタスク

## 概要
${task.description || task.body}

## 目的
コードの品質を向上させ、保守性を高める

## リファクタリング対象
${task.files ? task.files.join('\n') : '指定なし'}

## 既存のパターン
${JSON.stringify(context.existingPatterns, null, 2)}

## 要求事項
1. コードの重複を削除してください
2. 複雑度を下げてください
3. 命名を改善してください
4. SOLID原則に従ってください
5. 既存のテストが通ることを確認してください

## 注意事項
- 外部APIの変更は避けてください
- 段階的にリファクタリングを進めてください
`;
  }

  debugTemplate({ task, complexity, context }) {
    return `# デバッグ分析タスク

## 問題の説明
${task.description || task.body}

## エラー情報
${task.errorInfo ? JSON.stringify(task.errorInfo, null, 2) : '詳細なし'}

## 最近の変更
${JSON.stringify(context.recentChanges, null, 2)}

## 調査手順
1. エラーの再現手順を確認してください
2. スタックトレースを分析してください
3. 関連するコードを調査してください
4. 根本原因を特定してください
5. 修正案を提示してください
6. 修正後のテストを作成してください

## デバッグのヒント
- ログ出力を追加して問題を特定してください
- エッジケースを考慮してください
- 類似の問題が他の箇所にないか確認してください
`;
  }

  codeGenerationTemplate({ task, complexity, context }) {
    return `# コード生成タスク

## 概要
${task.description || task.body}

## 要求仕様
${task.requirements ? JSON.stringify(task.requirements, null, 2) : '詳細は説明文を参照'}

## プロジェクトコンテキスト
${context.projectInfo ? JSON.stringify(context.projectInfo, null, 2) : 'なし'}

## 生成するコード
1. 仕様に基づいて実装してください
2. エラーハンドリングを含めてください
3. 適切なコメントを追加してください
4. ユニットテストを作成してください

## コーディング規約
- 既存のコードスタイルに従ってください
- ESLint/Prettierの設定に準拠してください
- TypeScriptを使用する場合は型定義を含めてください
`;
  }

  performanceTemplate({ task, complexity, context }) {
    return `# パフォーマンス最適化タスク

## 概要
${task.description || task.body}

## 現在のパフォーマンス問題
${task.performanceMetrics ? JSON.stringify(task.performanceMetrics, null, 2) : '測定データなし'}

## 最適化の目標
1. 現在のボトルネックを特定してください
2. パフォーマンスプロファイリングを実施してください
3. 最適化案を提案してください
4. 実装してください
5. ビフォー・アフターの比較を行ってください

## 考慮事項
- 可読性を損なわないようにしてください
- 過度な最適化は避けてください
- メモリ使用量も考慮してください
`;
  }

  securityTemplate({ task, complexity, context }) {
    return `# セキュリティ監査タスク

## 概要
${task.description || task.body}

## 監査対象
${task.files ? task.files.join('\n') : 'プロジェクト全体'}

## セキュリティチェック項目
1. 認証・認可の実装を確認してください
2. 入力検証を確認してください
3. SQLインジェクション対策を確認してください
4. XSS対策を確認してください
5. CSRF対策を確認してください
6. 機密情報の取り扱いを確認してください
7. 依存関係の脆弱性を確認してください

## レポート形式
- 発見した脆弱性をリストアップしてください
- 各脆弱性の深刻度を評価してください
- 修正方法を提案してください
- 修正コードを実装してください
`;
  }

  testGenerationTemplate({ task, complexity, context }) {
    return `# テスト生成タスク

## 概要
${task.description || task.body}

## テスト対象
${task.files ? task.files.join('\n') : '指定なし'}

## テストフレームワーク
${context.existingPatterns.testRunner || '自動検出'}

## テスト要件
1. ユニットテストを作成してください
2. 正常系・異常系の両方をカバーしてください
3. エッジケースを考慮してください
4. モックを適切に使用してください
5. カバレッジ80%以上を目指してください

## テストの構成
- Arrange-Act-Assertパターンに従ってください
- 分かりやすいテスト名を付けてください
- 必要に応じて統合テストも作成してください
`;
  }

  documentationTemplate({ task, complexity, context }) {
    return `# ドキュメント生成タスク

## 概要
${task.description || task.body}

## ドキュメント対象
${task.files ? task.files.join('\n') : 'プロジェクト全体'}

## ドキュメントの種類
1. APIドキュメント
2. 使用方法ガイド
3. アーキテクチャ説明
4. コントリビューションガイド

## 要求事項
- 分かりやすく簡潔に記述してください
- コード例を含めてください
- 図表を使用して視覚的に説明してください（Mermaid推奨）
- 初心者にも理解できるように書いてください

## フォーマット
- Markdown形式で作成してください
- 目次を含めてください
- セクションを適切に分けてください
`;
  }

  defaultTemplate({ task, complexity, context }) {
    return `# タスク

## 概要
${task.description || task.body}

## タイプ
${task.type || '不明'}

## 関連ファイル
${task.files ? task.files.join('\n') : 'なし'}

## プロジェクト情報
${context.projectInfo ? JSON.stringify(context.projectInfo, null, 2) : 'なし'}

## 要求事項
タスクの説明に基づいて適切に実装してください。

## 注意事項
- 既存のコードスタイルに従ってください
- エラーハンドリングを含めてください
- 必要に応じてテストも作成してください
`;
  }
}

module.exports = PromptGenerator;