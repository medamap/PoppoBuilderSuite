const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

/**
 * 高度なエラー分析エンジン
 * CCSPエージェント（パイちゃん）を使用してエラーの詳細分析を行う
 */
class AdvancedAnalyzer {
  constructor(logger) {
    this.logger = logger;
    // Redis接続を追加
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    });
    this.responseQueue = 'ccsp:responses:ccla';
    this.cacheFile = path.join(__dirname, '../../.poppo/analysis-cache.json');
    this.analysisCache = new Map();
  }

  /**
   * 初期化処理
   */
  async initialize() {
    // キャッシュの読み込み
    try {
      const data = await fs.readFile(this.cacheFile, 'utf8');
      const cache = JSON.parse(data);
      this.analysisCache = new Map(Object.entries(cache));
      this.logger.info(`${this.analysisCache.size}件の分析キャッシュを読み込みました`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.error(`分析キャッシュの読み込みエラー: ${error.message}`);
      }
    }
  }

  /**
   * Claudeによるエラー分析
   * @param {Object} errorInfo エラー情報
   * @param {Object} context コンテキスト情報
   * @returns {Object} 分析結果
   */
  async analyzeWithClaude(errorInfo, context = {}) {
    try {
      // キャッシュチェック
      const cacheKey = this.generateCacheKey(errorInfo);
      if (this.analysisCache.has(cacheKey)) {
        this.logger.info('キャッシュから分析結果を取得');
        return this.analysisCache.get(cacheKey);
      }

      // 分析プロンプトの構築
      const prompt = this.buildAnalysisPrompt(errorInfo, context);
      
      // Claudeによる分析実行
      const analysis = await this.executeClaudeAnalysis(prompt);
      
      // 分析結果の構造化
      const structuredAnalysis = {
        rootCause: analysis.rootCause || '不明',
        impactScope: analysis.impactScope || '不明',
        fixSuggestions: analysis.fixSuggestions || [],
        preventionMeasures: analysis.preventionMeasures || [],
        relatedFiles: analysis.relatedFiles || [],
        estimatedFixTime: analysis.estimatedFixTime || '不明',
        confidence: analysis.confidence || 0.5,
        analyzedAt: new Date().toISOString()
      };

      // キャッシュに保存
      this.analysisCache.set(cacheKey, structuredAnalysis);
      await this.saveCache();

      return structuredAnalysis;
    } catch (error) {
      this.logger.error(`Claude分析エラー: ${error.message}`);
      // フォールバック分析
      return this.getFallbackAnalysis(errorInfo);
    }
  }

  /**
   * 分析プロンプトの構築
   */
  buildAnalysisPrompt(errorInfo, context) {
    return `【重要】Claude APIの使用は禁止されています。コード生成や修正提案を行う際は、Claude APIを呼び出すコードを含めないでください。

エラー分析を実行してください。

## エラー情報
- カテゴリ: ${errorInfo.category}
- メッセージ: ${errorInfo.message}
- スタックトレース:
\`\`\`
${errorInfo.stackTrace}
\`\`\`
- 発生日時: ${errorInfo.timestamp}
- ファイル: ${errorInfo.file || '不明'}
- 行番号: ${errorInfo.line || '不明'}

## コンテキスト
- プロジェクト: ${context.projectName || 'PoppoBuilderSuite'}
- 最近の変更: ${context.recentChanges || 'なし'}
- 関連Issue: ${context.relatedIssues?.join(', ') || 'なし'}

## 分析項目
以下の項目について詳細に分析してください：

1. **根本原因の推定** (rootCause)
   - エラーが発生した本質的な原因を特定
   - コードの設計上の問題があれば指摘

2. **影響範囲の評価** (impactScope)
   - このエラーが影響する機能やモジュール
   - ユーザーへの影響度（Critical/High/Medium/Low）

3. **修正方法の提案** (fixSuggestions)
   - 具体的な修正方法を3つ以上提案
   - 各修正方法のメリット・デメリット

4. **再発防止策** (preventionMeasures)
   - 同様のエラーを防ぐための対策
   - テストケースの追加提案

5. **関連ファイル** (relatedFiles)
   - 修正が必要なファイルのリスト

6. **修正時間の見積もり** (estimatedFixTime)
   - 修正にかかる予想時間（例: "30分", "2時間"）

7. **分析の信頼度** (confidence)
   - 0.0〜1.0の範囲で分析の確信度

JSON形式で回答してください。`;
  }

  /**
   * Claudeによる分析実行（パイちゃん経由）
   */
  async executeClaudeAnalysis(prompt) {
    const requestId = uuidv4();
    
    // パイちゃんへのリクエストを作成
    const request = {
      requestId,
      fromAgent: 'ccla',
      type: 'error-analysis',
      prompt: prompt,
      context: {
        workingDirectory: process.cwd(),
        timeout: 600000, // 10分
        priority: 'high'
      },
      timestamp: new Date().toISOString()
    };
    
    this.logger.info(`Sending analysis request to CCSP: ${requestId}`);
    
    try {
      // リクエストをRedis Queueに送信
      await this.redis.lpush('ccsp:requests', JSON.stringify(request));
      
      // レスポンスを待機
      const timeout = Date.now() + 600000; // 10分のタイムアウト
      
      while (Date.now() < timeout) {
        const response = await this.redis.rpop(this.responseQueue);
        
        if (response) {
          const parsed = JSON.parse(response);
          
          // 自分のリクエストのレスポンスか確認
          if (parsed.requestId === requestId) {
            if (parsed.success) {
              this.logger.info('Received successful response from CCSP');
              
              // レスポンスからJSON部分を抽出
              const output = parsed.result;
              const jsonMatch = output.match(/```json\n([\s\S]*?)\n```/);
              if (jsonMatch) {
                const analysis = JSON.parse(jsonMatch[1]);
                return analysis;
              } else {
                // JSON形式でない場合の処理
                return this.parseNonJsonResponse(output);
              }
            } else {
              this.logger.error('CCSP returned error:', parsed.error);
              throw new Error(parsed.error || 'CCSP analysis failed');
            }
          } else {
            // 他のリクエストのレスポンスは戻す
            await this.redis.lpush(this.responseQueue, response);
          }
        }
        
        // 100ミリ秒待機
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // タイムアウト
      throw new Error('Timeout waiting for CCSP response');
      
    } catch (error) {
      this.logger.error(`CCSP communication error: ${error.message}`);
      throw error;
    }
  }

  /**
   * 非JSON形式のレスポンスをパース
   */
  parseNonJsonResponse(output) {
    // テキスト形式の分析結果から情報を抽出
    const analysis = {
      rootCause: this.extractSection(output, '根本原因') || '分析結果から抽出できませんでした',
      impactScope: this.extractSection(output, '影響範囲') || 'Medium',
      fixSuggestions: this.extractList(output, '修正方法') || ['手動での確認が必要です'],
      preventionMeasures: this.extractList(output, '再発防止') || ['テストの追加を検討してください'],
      relatedFiles: [],
      estimatedFixTime: '1時間',
      confidence: 0.6
    };
    return analysis;
  }

  /**
   * テキストからセクションを抽出
   */
  extractSection(text, sectionName) {
    const regex = new RegExp(`${sectionName}[:\\s]*([^\\n]+)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : null;
  }

  /**
   * テキストからリストを抽出
   */
  extractList(text, sectionName) {
    const regex = new RegExp(`${sectionName}[:\\s]*([\\s\\S]*?)(?=\\n\\n|$)`, 'i');
    const match = text.match(regex);
    if (!match) return null;
    
    const items = match[1].split('\n')
      .map(line => line.replace(/^[-*•]\s*/, '').trim())
      .filter(line => line.length > 0);
    
    return items.length > 0 ? items : null;
  }

  /**
   * フォールバック分析（Claudeが利用できない場合）
   */
  getFallbackAnalysis(errorInfo) {
    const severity = this.estimateSeverity(errorInfo);
    
    return {
      rootCause: `${errorInfo.category}が発生しました。詳細な分析にはClaude APIが必要です。`,
      impactScope: severity,
      fixSuggestions: [
        'エラーメッセージを確認し、該当箇所のコードを修正してください',
        'スタックトレースから問題のあるファイルと行を特定してください',
        '関連するテストケースを実行して問題を再現してください'
      ],
      preventionMeasures: [
        '同様のコードパターンを検索し、予防的に修正してください',
        'エラーハンドリングを強化してください',
        'ユニットテストを追加してください'
      ],
      relatedFiles: this.extractFilesFromStackTrace(errorInfo.stackTrace),
      estimatedFixTime: severity === 'Critical' ? '2-4時間' : '30分-2時間',
      confidence: 0.3,
      analyzedAt: new Date().toISOString(),
      fallbackAnalysis: true
    };
  }

  /**
   * エラーの重要度を推定
   */
  estimateSeverity(errorInfo) {
    if (errorInfo.type === 'bug' && errorInfo.severity === 'critical') return 'Critical';
    if (errorInfo.type === 'bug' && errorInfo.severity === 'high') return 'High';
    if (errorInfo.type === 'defect' && errorInfo.severity === 'medium') return 'Medium';
    return 'Low';
  }

  /**
   * スタックトレースからファイルを抽出
   */
  extractFilesFromStackTrace(stackTrace) {
    if (!stackTrace) return [];
    
    const filePattern = /at\s+.*?\s+\(([^:)]+):\d+:\d+\)/g;
    const files = new Set();
    let match;
    
    while ((match = filePattern.exec(stackTrace)) !== null) {
      const filePath = match[1];
      if (!filePath.includes('node_modules')) {
        files.add(filePath);
      }
    }
    
    return Array.from(files);
  }

  /**
   * キャッシュキーの生成
   */
  generateCacheKey(errorInfo) {
    const keyData = `${errorInfo.category}:${errorInfo.message}:${errorInfo.file || ''}`;
    return require('crypto').createHash('md5').update(keyData).digest('hex');
  }

  /**
   * キャッシュの保存
   */
  async saveCache() {
    try {
      const cacheData = Object.fromEntries(this.analysisCache);
      await fs.writeFile(this.cacheFile, JSON.stringify(cacheData, null, 2));
    } catch (error) {
      this.logger.error(`キャッシュ保存エラー: ${error.message}`);
    }
  }

  /**
   * 分析結果の要約を生成
   */
  generateAnalysisSummary(analysis) {
    return `
## 詳細分析結果

### 根本原因
${analysis.rootCause}

### 影響範囲
- 重要度: ${analysis.impactScope}
- 関連ファイル: ${analysis.relatedFiles.join(', ') || 'なし'}

### 修正提案
${analysis.fixSuggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}

### 再発防止策
${analysis.preventionMeasures.map((p, i) => `${i + 1}. ${p}`).join('\n')}

### 見積もり
- 修正時間: ${analysis.estimatedFixTime}
- 分析信頼度: ${(analysis.confidence * 100).toFixed(0)}%

---
*この分析は${analysis.fallbackAnalysis ? 'フォールバック分析' : 'Claude'}により生成されました*`;
  }

  /**
   * クリーンアップ処理
   */
  async cleanup() {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}

module.exports = AdvancedAnalyzer;