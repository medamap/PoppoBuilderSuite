const AgentBase = require('../shared/agent-base');
const ProcessManager = require('../../src/process-manager');
const fs = require('fs').promises;
const path = require('path');

/**
 * CCAG (Code Change Assistant Generator)
 * ドキュメント生成、コメント作成、多言語対応を担当
 */
class CCAGAgent extends AgentBase {
  constructor(config = {}) {
    super('CCAG', config);
    
    this.processManager = new ProcessManager();
    
    // ドキュメントテンプレート
    this.templates = {
      readme: this.getReadmeTemplate(),
      design: this.getDesignTemplate(),
      api: this.getApiTemplate()
    };
    
    // 言語設定
    this.supportedLanguages = ['ja', 'en'];
    this.defaultLanguage = 'ja';
  }
  
  /**
   * 初期化処理
   */
  async onInitialize() {
    this.logger.info('CCAG エージェントの専用初期化を実行中...');
    
    // 言語設定の読み込み
    try {
      const configPath = path.join(__dirname, '../../.poppo/config.json');
      const configContent = await fs.readFile(configPath, 'utf8');
      const config = JSON.parse(configContent);
      this.defaultLanguage = config.language || 'ja';
    } catch (error) {
      this.logger.warn('言語設定の読み込みに失敗。デフォルト設定を使用します。');
    }
  }
  
  /**
   * タスク処理のメイン実装
   */
  async processTask(message) {
    const { taskType, context, payload } = message;
    
    this.logger.info(`タスク処理開始: ${taskType} (${message.taskId})`);
    
    switch (taskType) {
      case 'generate-docs':
        return await this.generateDocumentation(context, payload);
        
      case 'create-comment':
        return await this.createComment(context, payload);
        
      case 'update-readme':
        return await this.updateReadme(context, payload);
        
      case 'translate-docs':
        return await this.translateDocumentation(context, payload);
        
      default:
        throw new Error(`未対応のタスクタイプ: ${taskType}`);
    }
  }
  
  /**
   * ドキュメント生成
   */
  async generateDocumentation(context, payload) {
    const { targetFiles, docType, outputDir } = payload;
    const generatedDocs = [];
    
    await this.reportProgress(context.taskId, 10, 'ドキュメント生成を開始します');
    
    for (let i = 0; i < targetFiles.length; i++) {
      const file = targetFiles[i];
      await this.reportProgress(
        context.taskId,
        10 + (80 * (i / targetFiles.length)),
        `ファイルを分析中: ${path.basename(file)}`
      );
      
      try {
        const content = await fs.readFile(file, 'utf8');
        const analysis = await this.analyzeCodeForDocs(file, content);
        
        const docContent = await this.generateDocContent(
          analysis,
          docType || 'api',
          this.defaultLanguage
        );
        
        const docPath = path.join(
          outputDir || 'docs/generated',
          `${path.basename(file, '.js')}.md`
        );
        
        await fs.mkdir(path.dirname(docPath), { recursive: true });
        await fs.writeFile(docPath, docContent);
        
        generatedDocs.push({
          sourceFile: file,
          docFile: docPath,
          docType,
          language: this.defaultLanguage
        });
        
      } catch (error) {
        this.logger.error(`ドキュメント生成エラー: ${file} - ${error.message}`);
      }
    }
    
    await this.reportProgress(context.taskId, 100, 'ドキュメント生成完了');
    
    return {
      success: true,
      docsGenerated: generatedDocs.length,
      documents: generatedDocs,
      summary: `${generatedDocs.length}件のドキュメントを生成しました`
    };
  }
  
  /**
   * コードを分析してドキュメント用情報を抽出
   */
  async analyzeCodeForDocs(filePath, content) {
    // 関数の抽出
    const functionRegex = /(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>/g;
    const functions = [];
    let match;
    
    while ((match = functionRegex.exec(content)) !== null) {
      functions.push({
        name: match[1] || match[3],
        params: (match[2] || match[4]).split(',').map(p => p.trim()).filter(p => p),
        isAsync: content.substring(match.index - 10, match.index).includes('async')
      });
    }
    
    // クラスの抽出
    const classRegex = /class\s+(\w+)(?:\s+extends\s+(\w+))?\s*{/g;
    const classes = [];
    
    while ((match = classRegex.exec(content)) !== null) {
      classes.push({
        name: match[1],
        extends: match[2] || null
      });
    }
    
    // JSDocコメントの抽出
    const jsdocRegex = /\/\*\*[\s\S]*?\*\//g;
    const jsdocs = content.match(jsdocRegex) || [];
    
    return {
      filePath,
      functions,
      classes,
      jsdocs,
      lineCount: content.split('\n').length
    };
  }
  
  /**
   * ドキュメントコンテンツの生成
   */
  async generateDocContent(analysis, docType, language) {
    const { filePath, functions, classes, jsdocs } = analysis;
    
    const prompt = `
以下のコード分析結果から${language === 'ja' ? '日本語' : '英語'}で${docType}ドキュメントを生成してください。

ファイル: ${filePath}
関数: ${functions.map(f => f.name).join(', ')}
クラス: ${classes.map(c => c.name).join(', ')}
JSDocコメント数: ${jsdocs.length}

ドキュメントタイプ: ${docType}
要求事項:
- 明確で分かりやすい説明
- 使用例を含める
- パラメータと戻り値の説明
- 注意事項や制限事項があれば記載
`;
    
    try {
      const result = await this.processManager.executeWithContext(
        prompt,
        '',
        null,
        60000 // 1分のタイムアウト
      );
      
      return result.output;
    } catch (error) {
      this.logger.error(`ドキュメント生成エラー: ${error.message}`);
      
      // フォールバック：基本的なテンプレートを使用
      return this.generateFallbackDoc(analysis, docType, language);
    }
  }
  
  /**
   * フォールバックドキュメントの生成
   */
  generateFallbackDoc(analysis, docType, language) {
    const { filePath, functions, classes } = analysis;
    const isJapanese = language === 'ja';
    
    let content = `# ${path.basename(filePath)}\n\n`;
    
    if (isJapanese) {
      content += `## 概要\n\nこのファイルには以下の要素が含まれています：\n\n`;
    } else {
      content += `## Overview\n\nThis file contains the following elements:\n\n`;
    }
    
    if (classes.length > 0) {
      content += isJapanese ? `### クラス\n\n` : `### Classes\n\n`;
      classes.forEach(cls => {
        content += `- **${cls.name}**`;
        if (cls.extends) {
          content += ` (extends ${cls.extends})`;
        }
        content += '\n';
      });
      content += '\n';
    }
    
    if (functions.length > 0) {
      content += isJapanese ? `### 関数\n\n` : `### Functions\n\n`;
      functions.forEach(func => {
        content += `- **${func.name}(${func.params.join(', ')})**`;
        if (func.isAsync) {
          content += ' (async)';
        }
        content += '\n';
      });
    }
    
    return content;
  }
  
  /**
   * コメント作成
   */
  async createComment(context, payload) {
    const { issueNumber, commentType, additionalContext, language } = payload;
    
    await this.reportProgress(context.taskId, 20, 'コメントを生成中...');
    
    const lang = language || this.defaultLanguage;
    const commentPrompt = this.buildCommentPrompt(commentType, additionalContext, lang);
    
    try {
      const result = await this.processManager.executeWithContext(
        commentPrompt,
        '',
        null,
        30000 // 30秒のタイムアウト
      );
      
      await this.reportProgress(context.taskId, 100, 'コメント生成完了');
      
      return {
        success: true,
        comment: result.output,
        metadata: {
          issueNumber,
          commentType,
          language: lang,
          generatedAt: new Date().toISOString()
        }
      };
      
    } catch (error) {
      this.logger.error(`コメント生成エラー: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * コメントプロンプトの構築
   */
  buildCommentPrompt(commentType, context, language) {
    const isJapanese = language === 'ja';
    
    switch (commentType) {
      case 'task-completed':
        return isJapanese
          ? `タスクが完了しました。以下の内容で完了報告コメントを作成してください：\n${context}`
          : `Task has been completed. Create a completion report comment with the following context:\n${context}`;
          
      case 'error-occurred':
        return isJapanese
          ? `エラーが発生しました。以下の内容でエラー報告コメントを作成してください：\n${context}`
          : `An error occurred. Create an error report comment with the following context:\n${context}`;
          
      case 'progress-update':
        return isJapanese
          ? `作業の進捗報告コメントを作成してください：\n${context}`
          : `Create a progress update comment:\n${context}`;
          
      default:
        return isJapanese
          ? `以下の内容でコメントを作成してください：\n${context}`
          : `Create a comment with the following context:\n${context}`;
    }
  }
  
  /**
   * README更新
   */
  async updateReadme(context, payload) {
    const { readmePath, updates, language } = payload;
    
    await this.reportProgress(context.taskId, 10, 'READMEを読み込み中...');
    
    const lang = language || this.defaultLanguage;
    const targetPath = readmePath || (lang === 'ja' ? 'README.md' : 'README_en.md');
    
    let currentContent = '';
    try {
      currentContent = await fs.readFile(targetPath, 'utf8');
    } catch (error) {
      this.logger.info('既存のREADMEが見つかりません。新規作成します。');
      currentContent = this.templates.readme[lang];
    }
    
    await this.reportProgress(context.taskId, 30, '更新内容を分析中...');
    
    const updatePrompt = `
現在のREADME:
\`\`\`markdown
${currentContent}
\`\`\`

更新内容:
${JSON.stringify(updates, null, 2)}

以下の要件でREADMEを更新してください：
- 既存の構造を維持
- 新機能や変更を適切なセクションに追加
- ${lang === 'ja' ? '日本語' : '英語'}で記述
- 明確で分かりやすい説明
`;
    
    await this.reportProgress(context.taskId, 50, 'READMEを更新中...');
    
    try {
      const result = await this.processManager.executeWithContext(
        updatePrompt,
        '',
        null,
        60000 // 1分のタイムアウト
      );
      
      await fs.writeFile(targetPath, result.output);
      
      await this.reportProgress(context.taskId, 100, 'README更新完了');
      
      return {
        success: true,
        filePath: targetPath,
        updates: updates.length,
        language: lang
      };
      
    } catch (error) {
      this.logger.error(`README更新エラー: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * ドキュメント翻訳
   */
  async translateDocumentation(context, payload) {
    const { sourceFile, targetLanguage, outputPath } = payload;
    
    await this.reportProgress(context.taskId, 10, 'ソースファイルを読み込み中...');
    
    const content = await fs.readFile(sourceFile, 'utf8');
    const fromLang = sourceFile.includes('_en') ? 'en' : 'ja';
    const toLang = targetLanguage || (fromLang === 'ja' ? 'en' : 'ja');
    
    if (fromLang === toLang) {
      throw new Error('翻訳元と翻訳先の言語が同じです');
    }
    
    await this.reportProgress(context.taskId, 30, '翻訳を実行中...');
    
    const translatePrompt = `
以下のドキュメントを${fromLang === 'ja' ? '日本語から英語' : '英語から日本語'}に翻訳してください。
技術用語は適切に翻訳し、コード例はそのまま維持してください。

\`\`\`markdown
${content}
\`\`\`
`;
    
    try {
      const result = await this.processManager.executeWithContext(
        translatePrompt,
        '',
        null,
        90000 // 1.5分のタイムアウト
      );
      
      const targetPath = outputPath || sourceFile.replace(
        fromLang === 'ja' ? '.md' : '_en.md',
        toLang === 'ja' ? '.md' : '_en.md'
      );
      
      await fs.writeFile(targetPath, result.output);
      
      await this.reportProgress(context.taskId, 100, '翻訳完了');
      
      return {
        success: true,
        sourceFile,
        targetFile: targetPath,
        fromLanguage: fromLang,
        toLanguage: toLang,
        characterCount: result.output.length
      };
      
    } catch (error) {
      this.logger.error(`翻訳エラー: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * READMEテンプレートの取得
   */
  getReadmeTemplate() {
    return {
      ja: `# プロジェクト名

## 概要

プロジェクトの簡単な説明をここに記載します。

## 機能

- 機能1
- 機能2
- 機能3

## インストール

\`\`\`bash
npm install
\`\`\`

## 使い方

\`\`\`bash
npm start
\`\`\`

## ライセンス

MIT
`,
      en: `# Project Name

## Overview

Brief description of the project goes here.

## Features

- Feature 1
- Feature 2
- Feature 3

## Installation

\`\`\`bash
npm install
\`\`\`

## Usage

\`\`\`bash
npm start
\`\`\`

## License

MIT
`
    };
  }
  
  /**
   * 設計書テンプレートの取得
   */
  getDesignTemplate() {
    return {
      ja: `# 設計書

## 1. 概要

### 1.1 目的

### 1.2 スコープ

## 2. アーキテクチャ

### 2.1 全体構成

### 2.2 コンポーネント

## 3. 詳細設計

### 3.1 データモデル

### 3.2 API設計

## 4. 実装方針

## 5. テスト計画
`,
      en: `# Design Document

## 1. Overview

### 1.1 Purpose

### 1.2 Scope

## 2. Architecture

### 2.1 Overall Structure

### 2.2 Components

## 3. Detailed Design

### 3.1 Data Model

### 3.2 API Design

## 4. Implementation Strategy

## 5. Test Plan
`
    };
  }
  
  /**
   * APIドキュメントテンプレートの取得
   */
  getApiTemplate() {
    return {
      ja: `# API ドキュメント

## エンドポイント一覧

### 1. エンドポイント名

- **メソッド**: GET/POST/PUT/DELETE
- **パス**: /api/endpoint
- **説明**: エンドポイントの説明

#### リクエスト

\`\`\`json
{
  "param1": "value1",
  "param2": "value2"
}
\`\`\`

#### レスポンス

\`\`\`json
{
  "result": "success",
  "data": {}
}
\`\`\`
`,
      en: `# API Documentation

## Endpoint List

### 1. Endpoint Name

- **Method**: GET/POST/PUT/DELETE
- **Path**: /api/endpoint
- **Description**: Endpoint description

#### Request

\`\`\`json
{
  "param1": "value1",
  "param2": "value2"
}
\`\`\`

#### Response

\`\`\`json
{
  "result": "success",
  "data": {}
}
\`\`\`
`
    };
  }
  
  /**
   * タスク実行時間の見積もり
   */
  estimateTaskDuration(message) {
    const { taskType, payload } = message;
    
    switch (taskType) {
      case 'generate-docs':
        const fileCount = payload.targetFiles?.length || 1;
        return Math.min(fileCount * 120000, 3600000); // ファイルあたり2分、最大1時間
        
      case 'create-comment':
        return 60000; // 1分
        
      case 'update-readme':
        return 180000; // 3分
        
      case 'translate-docs':
        return 300000; // 5分
        
      default:
        return 180000; // デフォルト3分
    }
  }
}

// エージェントの起動
if (require.main === module) {
  const agent = new CCAGAgent();
  
  agent.initialize().catch(error => {
    console.error('エージェント起動エラー:', error);
    process.exit(1);
  });
  
  // グレースフルシャットダウン
  process.on('SIGINT', async () => {
    console.log('\nシャットダウン中...');
    await agent.shutdown();
    process.exit(0);
  });
}

module.exports = CCAGAgent;