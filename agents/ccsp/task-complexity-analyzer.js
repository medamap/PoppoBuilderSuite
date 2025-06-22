/**
 * タスク複雑度分析器
 * タスクの複雑度を分析し、Claude Codeの使用が適切かを判定
 */

const fs = require('fs').promises;
const path = require('path');

class TaskComplexityAnalyzer {
  constructor() {
    // 複雑度の重み付け
    this.weights = {
      fileCount: 0.15,
      lineCount: 0.15,
      dependencies: 0.10,
      taskType: 0.20,
      description: 0.15,
      history: 0.10,
      codePatterns: 0.15
    };
    
    // タスクタイプごとの基本スコア
    this.taskTypeScores = {
      'architecture-design': 0.9,
      'complex-refactoring': 0.85,
      'performance-optimization': 0.8,
      'security-audit': 0.8,
      'debug-analysis': 0.75,
      'project-analysis': 0.75,
      'test-generation': 0.7,
      'code-generation': 0.65,
      'documentation-generation': 0.6,
      'simple-fix': 0.3,
      'config-update': 0.2
    };
  }

  /**
   * タスクの複雑度を分析
   */
  async analyze(task) {
    const analysis = {
      score: 0,
      factors: {},
      recommendation: '',
      estimatedTokens: 0,
      details: {}
    };

    // 各要素のスコアを計算
    analysis.factors.fileCount = await this.analyzeFileCount(task);
    analysis.factors.lineCount = await this.analyzeLineCount(task);
    analysis.factors.dependencies = await this.analyzeDependencies(task);
    analysis.factors.taskType = this.analyzeTaskType(task);
    analysis.factors.description = this.analyzeDescription(task);
    analysis.factors.history = await this.analyzeHistory(task);
    analysis.factors.codePatterns = await this.analyzeCodePatterns(task);

    // 総合スコアを計算
    analysis.score = this.calculateTotalScore(analysis.factors);
    
    // トークン数を推定
    analysis.estimatedTokens = await this.estimateTokenCount(task, analysis);
    
    // 推奨事項を生成
    analysis.recommendation = this.generateRecommendation(analysis);
    
    return analysis;
  }

  /**
   * ファイル数による複雑度
   */
  async analyzeFileCount(task) {
    if (!task.files || task.files.length === 0) {
      return 0.5; // デフォルト値
    }

    const count = task.files.length;
    
    if (count >= 20) return 1.0;
    if (count >= 10) return 0.8;
    if (count >= 5) return 0.6;
    if (count >= 2) return 0.4;
    
    return 0.2;
  }

  /**
   * コード行数による複雑度
   */
  async analyzeLineCount(task) {
    if (!task.projectPath) return 0.5;

    try {
      let totalLines = 0;
      
      if (task.files && task.files.length > 0) {
        for (const file of task.files) {
          const filePath = path.join(task.projectPath, file);
          try {
            const content = await fs.readFile(filePath, 'utf8');
            totalLines += content.split('\n').length;
          } catch (error) {
            // ファイルが読めない場合は無視
          }
        }
      }
      
      if (totalLines >= 10000) return 1.0;
      if (totalLines >= 5000) return 0.8;
      if (totalLines >= 1000) return 0.6;
      if (totalLines >= 500) return 0.4;
      
      return 0.2;
    } catch (error) {
      return 0.5; // エラーの場合はデフォルト値
    }
  }

  /**
   * 依存関係の複雑度
   */
  async analyzeDependencies(task) {
    if (!task.projectPath) return 0.5;

    try {
      const packageJsonPath = path.join(task.projectPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      
      const depCount = Object.keys(packageJson.dependencies || {}).length +
                      Object.keys(packageJson.devDependencies || {}).length;
      
      if (depCount >= 100) return 1.0;
      if (depCount >= 50) return 0.8;
      if (depCount >= 20) return 0.6;
      if (depCount >= 10) return 0.4;
      
      return 0.2;
    } catch (error) {
      return 0.5; // package.jsonがない場合
    }
  }

  /**
   * タスクタイプによる複雑度
   */
  analyzeTaskType(task) {
    const type = task.type || 'unknown';
    return this.taskTypeScores[type] || 0.5;
  }

  /**
   * 説明文の複雑度分析
   */
  analyzeDescription(task) {
    const description = task.description || '';
    const body = task.body || '';
    const text = `${description} ${body}`.toLowerCase();
    
    // 複雑性を示すキーワード
    const complexKeywords = [
      'architecture', 'refactor', 'redesign', 'optimize', 'performance',
      'security', 'vulnerability', 'migration', 'integration', 'complex',
      'entire', 'whole', 'all', 'system', 'framework', 'debug', 'analyze',
      'investigate', 'multi', 'cross', 'distributed'
    ];
    
    let score = 0.3; // 基本スコア
    
    // キーワードの出現回数をカウント
    complexKeywords.forEach(keyword => {
      if (text.includes(keyword)) {
        score += 0.05;
      }
    });
    
    // 説明文の長さも考慮
    if (text.length > 500) score += 0.2;
    else if (text.length > 200) score += 0.1;
    
    return Math.min(score, 1.0);
  }

  /**
   * 過去の履歴による複雑度
   */
  async analyzeHistory(task) {
    // Issue/PRのコメント数や変更履歴を分析
    if (!task.comments) return 0.5;
    
    const commentCount = task.comments.length;
    
    if (commentCount >= 20) return 0.9;
    if (commentCount >= 10) return 0.7;
    if (commentCount >= 5) return 0.5;
    
    return 0.3;
  }

  /**
   * コードパターンの複雑度
   */
  async analyzeCodePatterns(task) {
    if (!task.projectPath || !task.files) return 0.5;
    
    let complexityScore = 0.3;
    
    try {
      // ファイルの拡張子から判断
      const extensions = task.files.map(f => path.extname(f).toLowerCase());
      
      // 複雑な拡張子
      const complexExtensions = ['.ts', '.tsx', '.jsx', '.vue', '.rs', '.go', '.cpp'];
      const hasComplexFiles = extensions.some(ext => complexExtensions.includes(ext));
      
      if (hasComplexFiles) complexityScore += 0.2;
      
      // 設定ファイルの存在
      const configFiles = task.files.filter(f => 
        f.includes('config') || f.includes('webpack') || 
        f.includes('babel') || f.includes('tsconfig')
      );
      
      if (configFiles.length > 0) complexityScore += 0.1;
      
      // テストファイルの存在
      const testFiles = task.files.filter(f => 
        f.includes('test') || f.includes('spec') || f.includes('.test.')
      );
      
      if (testFiles.length > 0) complexityScore += 0.1;
      
    } catch (error) {
      // エラーは無視
    }
    
    return Math.min(complexityScore, 1.0);
  }

  /**
   * 総合スコアを計算
   */
  calculateTotalScore(factors) {
    let totalScore = 0;
    
    Object.entries(factors).forEach(([factor, score]) => {
      totalScore += score * (this.weights[factor] || 0);
    });
    
    return Math.min(Math.max(totalScore, 0), 1);
  }

  /**
   * トークン数を推定
   */
  async estimateTokenCount(task, analysis) {
    let baseTokens = 1000; // 基本的なプロンプトのトークン数
    
    // タスクの説明文
    const textLength = (task.description || '').length + (task.body || '').length;
    baseTokens += Math.floor(textLength / 4); // 約4文字で1トークン
    
    // ファイル内容の推定
    if (task.files && task.files.length > 0) {
      // 各ファイルの推定トークン数
      baseTokens += task.files.length * 500; // ファイルあたり平均500トークン
      
      // 複雑度に基づく追加トークン
      baseTokens += Math.floor(analysis.score * 10000);
    }
    
    return baseTokens;
  }

  /**
   * 推奨事項を生成
   */
  generateRecommendation(analysis) {
    const { score, estimatedTokens } = analysis;
    
    if (score >= 0.8) {
      return 'このタスクは非常に複雑です。Claude Codeの使用を強く推奨します。';
    } else if (score >= 0.7) {
      return 'このタスクは複雑です。Claude Codeの使用が適切です。';
    } else if (score >= 0.5) {
      return 'このタスクは中程度の複雑さです。Claude Codeの使用を検討してください。';
    } else {
      return 'このタスクは比較的シンプルです。他のエージェントでの処理が可能です。';
    }
  }

  /**
   * クイックスコア（簡易判定用）
   */
  quickScore(task) {
    // タスクタイプのみで簡易判定
    const type = task.type || 'unknown';
    return this.taskTypeScores[type] || 0.5;
  }
}

module.exports = TaskComplexityAnalyzer;