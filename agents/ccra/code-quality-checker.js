const { execSync } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

/**
 * コード品質チェックモジュール
 * 複雑度、重複、スタイル、ベストプラクティスをチェック
 */
class CodeQualityChecker {
  constructor(logger) {
    this.logger = logger;
  }
  
  /**
   * コード品質をチェック
   */
  async check(pr, files) {
    const results = {
      overall: {
        score: 100,
        issues: []
      },
      complexity: [],
      duplication: [],
      style: [],
      bestPractices: [],
      fileMetrics: {}
    };
    
    // 各ファイルをチェック
    for (const file of files) {
      if (this.shouldCheckFile(file)) {
        const fileResults = await this.checkFile(file);
        
        // 結果を統合
        results.complexity.push(...fileResults.complexity);
        results.duplication.push(...fileResults.duplication);
        results.style.push(...fileResults.style);
        results.bestPractices.push(...fileResults.bestPractices);
        results.fileMetrics[file.filename] = fileResults.metrics;
        
        // スコアを更新
        results.overall.score = Math.min(results.overall.score, fileResults.score);
      }
    }
    
    // 全体的な問題をまとめる
    results.overall.issues = this.summarizeIssues(results);
    
    return results;
  }
  
  /**
   * ファイルをチェックすべきか判定
   */
  shouldCheckFile(file) {
    // 削除されたファイルはチェックしない
    if (file.status === 'removed') return false;
    
    // ソースコードファイルのみチェック
    const checkExtensions = ['.js', '.jsx', '.ts', '.tsx'];
    return checkExtensions.some(ext => file.filename.endsWith(ext));
  }
  
  /**
   * 個別ファイルのチェック
   */
  async checkFile(file) {
    const results = {
      score: 100,
      complexity: [],
      duplication: [],
      style: [],
      bestPractices: [],
      metrics: {}
    };
    
    try {
      // ファイル内容の解析（patchから）
      if (file.patch) {
        // 複雑度チェック
        const complexityIssues = this.checkComplexity(file);
        results.complexity.push(...complexityIssues);
        
        // コード重複チェック
        const duplicationIssues = this.checkDuplication(file);
        results.duplication.push(...duplicationIssues);
        
        // スタイルチェック
        const styleIssues = this.checkStyle(file);
        results.style.push(...styleIssues);
        
        // ベストプラクティスチェック
        const bestPracticeIssues = this.checkBestPractices(file);
        results.bestPractices.push(...bestPracticeIssues);
        
        // メトリクスの計算
        results.metrics = this.calculateMetrics(file);
        
        // スコアの計算
        const totalIssues = 
          complexityIssues.length + 
          duplicationIssues.length + 
          styleIssues.length + 
          bestPracticeIssues.length;
        
        results.score = Math.max(0, 100 - (totalIssues * 5));
      }
      
    } catch (error) {
      this.logger.error(`ファイル ${file.filename} のチェックエラー: ${error.message}`);
    }
    
    return results;
  }
  
  /**
   * 複雑度をチェック
   */
  checkComplexity(file) {
    const issues = [];
    const lines = file.patch.split('\n');
    
    // 簡易的な複雑度チェック
    let functionDepth = 0;
    let maxDepth = 0;
    let currentFunction = null;
    let functionStartLine = 0;
    
    lines.forEach((line, index) => {
      // 追加された行のみチェック
      if (!line.startsWith('+') || line.startsWith('+++')) return;
      
      const codeLine = line.substring(1).trim();
      
      // 関数の開始を検出
      if (codeLine.match(/function\s+\w+|=>\s*{|function\s*\(/)) {
        functionDepth++;
        if (!currentFunction) {
          currentFunction = codeLine;
          functionStartLine = index;
        }
      }
      
      // ブロックの開始
      if (codeLine.includes('{')) {
        functionDepth++;
        maxDepth = Math.max(maxDepth, functionDepth);
      }
      
      // ブロックの終了
      if (codeLine.includes('}')) {
        functionDepth--;
        
        // 関数の終了
        if (functionDepth === 0 && currentFunction) {
          // 複雑度が高い場合は警告
          if (maxDepth > 4) {
            issues.push({
              file: file.filename,
              line: functionStartLine,
              type: 'complexity',
              severity: maxDepth > 6 ? 'error' : 'warning',
              message: `関数の複雑度が高すぎます（深さ: ${maxDepth}）`,
              suggestion: '関数を分割してシンプルにすることを検討してください'
            });
          }
          
          currentFunction = null;
          maxDepth = 0;
        }
      }
      
      // 条件文の複雑度
      const conditions = (codeLine.match(/if|else|switch|case|while|for/g) || []).length;
      if (conditions > 2) {
        issues.push({
          file: file.filename,
          line: index,
          type: 'complexity',
          severity: 'warning',
          message: '1行に複数の条件文があります',
          suggestion: '条件を分割して可読性を向上させてください'
        });
      }
    });
    
    return issues;
  }
  
  /**
   * コード重複をチェック
   */
  checkDuplication(file) {
    const issues = [];
    const lines = file.patch.split('\n')
      .filter(line => line.startsWith('+') && !line.startsWith('+++'))
      .map(line => line.substring(1).trim());
    
    // 連続する同じような行を検出
    const minDuplicationLength = 3;
    
    for (let i = 0; i < lines.length - minDuplicationLength; i++) {
      const block = lines.slice(i, i + minDuplicationLength);
      
      // 同じブロックが他の場所にあるかチェック
      for (let j = i + minDuplicationLength; j < lines.length - minDuplicationLength; j++) {
        const compareBlock = lines.slice(j, j + minDuplicationLength);
        
        if (this.areBlocksSimilar(block, compareBlock)) {
          issues.push({
            file: file.filename,
            line: i,
            type: 'duplication',
            severity: 'warning',
            message: `コードの重複が検出されました（${minDuplicationLength}行以上）`,
            suggestion: '共通処理を関数やモジュールに抽出することを検討してください'
          });
          
          // 同じ箇所を複数回報告しない
          i += minDuplicationLength;
          break;
        }
      }
    }
    
    return issues;
  }
  
  /**
   * コードブロックの類似性を判定
   */
  areBlocksSimilar(block1, block2) {
    // 空行やコメントを除外
    const normalize = (lines) => lines
      .filter(line => line && !line.startsWith('//') && !line.startsWith('/*'))
      .map(line => line.replace(/\s+/g, ' '));
    
    const normalized1 = normalize(block1);
    const normalized2 = normalize(block2);
    
    if (normalized1.length !== normalized2.length) return false;
    
    // 80%以上一致したら類似とみなす
    let matches = 0;
    for (let i = 0; i < normalized1.length; i++) {
      if (normalized1[i] === normalized2[i]) {
        matches++;
      }
    }
    
    return matches / normalized1.length >= 0.8;
  }
  
  /**
   * スタイルをチェック
   */
  checkStyle(file) {
    const issues = [];
    const lines = file.patch.split('\n');
    
    lines.forEach((line, index) => {
      if (!line.startsWith('+') || line.startsWith('+++')) return;
      
      const codeLine = line.substring(1);
      
      // 行の長さチェック
      if (codeLine.length > 120) {
        issues.push({
          file: file.filename,
          line: index,
          type: 'style',
          severity: 'info',
          message: `行が長すぎます（${codeLine.length}文字）`,
          suggestion: '120文字以内に収めることを推奨します'
        });
      }
      
      // インデントチェック（スペース2つまたは4つ）
      const leadingSpaces = codeLine.match(/^(\s*)/)[1];
      if (leadingSpaces.length % 2 !== 0) {
        issues.push({
          file: file.filename,
          line: index,
          type: 'style',
          severity: 'info',
          message: '不規則なインデント',
          suggestion: 'スペース2つまたは4つでインデントしてください'
        });
      }
      
      // 末尾の空白
      if (codeLine.endsWith(' ') || codeLine.endsWith('\t')) {
        issues.push({
          file: file.filename,
          line: index,
          type: 'style',
          severity: 'info',
          message: '行末に不要な空白があります',
          suggestion: '行末の空白を削除してください'
        });
      }
      
      // console.logの使用
      if (codeLine.includes('console.log') && !file.filename.includes('test')) {
        issues.push({
          file: file.filename,
          line: index,
          type: 'style',
          severity: 'warning',
          message: 'console.logが使用されています',
          suggestion: '本番コードではloggerを使用してください'
        });
      }
    });
    
    return issues;
  }
  
  /**
   * ベストプラクティスをチェック
   */
  checkBestPractices(file) {
    const issues = [];
    const lines = file.patch.split('\n');
    
    lines.forEach((line, index) => {
      if (!line.startsWith('+') || line.startsWith('+++')) return;
      
      const codeLine = line.substring(1).trim();
      
      // エラーハンドリングの欠如
      if (codeLine.includes('.catch(') && codeLine.includes('{}')) {
        issues.push({
          file: file.filename,
          line: index,
          type: 'best_practice',
          severity: 'error',
          message: '空のcatchブロック',
          suggestion: 'エラーを適切に処理またはログ出力してください'
        });
      }
      
      // == の使用（=== を推奨）
      if (codeLine.match(/[^=!]==[^=]/)) {
        issues.push({
          file: file.filename,
          line: index,
          type: 'best_practice',
          severity: 'warning',
          message: '== の使用が検出されました',
          suggestion: '厳密等価演算子 === の使用を推奨します'
        });
      }
      
      // varの使用
      if (codeLine.match(/\bvar\s+/)) {
        issues.push({
          file: file.filename,
          line: index,
          type: 'best_practice',
          severity: 'warning',
          message: 'varの使用が検出されました',
          suggestion: 'constまたはletの使用を推奨します'
        });
      }
      
      // 未使用の変数（簡易チェック）
      const varDeclaration = codeLine.match(/(?:const|let|var)\s+(\w+)\s*=/);
      if (varDeclaration) {
        const varName = varDeclaration[1];
        // 以降の行で使用されているかチェック（簡易的）
        const futureLines = lines.slice(index + 1, Math.min(index + 20, lines.length));
        const isUsed = futureLines.some(l => l.includes(varName));
        
        if (!isUsed && !varName.startsWith('_')) {
          issues.push({
            file: file.filename,
            line: index,
            type: 'best_practice',
            severity: 'info',
            message: `未使用の可能性がある変数: ${varName}`,
            suggestion: '未使用の変数は削除するか、_プレフィックスを付けてください'
          });
        }
      }
      
      // async/awaitの適切な使用
      if (codeLine.includes('async') && !codeLine.includes('await')) {
        // 関数定義行の場合、本体をチェックする必要がある
        const nextLines = lines.slice(index + 1, Math.min(index + 10, lines.length));
        const hasAwait = nextLines.some(l => l.includes('await'));
        
        if (!hasAwait) {
          issues.push({
            file: file.filename,
            line: index,
            type: 'best_practice',
            severity: 'info',
            message: 'asyncキーワードがありますがawaitが使用されていません',
            suggestion: 'awaitが不要な場合はasyncを削除してください'
          });
        }
      }
    });
    
    return issues;
  }
  
  /**
   * ファイルメトリクスを計算
   */
  calculateMetrics(file) {
    const lines = file.patch.split('\n');
    const addedLines = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
    const removedLines = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;
    
    return {
      linesAdded: addedLines,
      linesRemoved: removedLines,
      totalChanges: addedLines + removedLines,
      changeRatio: removedLines > 0 ? addedLines / removedLines : addedLines
    };
  }
  
  /**
   * 問題をまとめる
   */
  summarizeIssues(results) {
    const summary = [];
    
    // 重大度別に集計
    const severityCounts = {
      error: 0,
      warning: 0,
      info: 0
    };
    
    const allIssues = [
      ...results.complexity,
      ...results.duplication,
      ...results.style,
      ...results.bestPractices
    ];
    
    allIssues.forEach(issue => {
      severityCounts[issue.severity]++;
    });
    
    if (severityCounts.error > 0) {
      summary.push({
        type: 'summary',
        severity: 'error',
        message: `${severityCounts.error}個の重大な問題が見つかりました`
      });
    }
    
    if (severityCounts.warning > 0) {
      summary.push({
        type: 'summary',
        severity: 'warning',
        message: `${severityCounts.warning}個の警告があります`
      });
    }
    
    if (severityCounts.info > 0) {
      summary.push({
        type: 'summary',
        severity: 'info',
        message: `${severityCounts.info}個の改善提案があります`
      });
    }
    
    return summary;
  }
}

module.exports = CodeQualityChecker;