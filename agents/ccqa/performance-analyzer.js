const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const path = require('path');
const fs = require('fs').promises;
const Logger = require('../../src/logger');

/**
 * パフォーマンス分析モジュール
 */
class PerformanceAnalyzer {
  constructor(config = {}) {
    this.config = config;
    this.logger = new Logger('CCQA-PerformanceAnalyzer');
    
    // パフォーマンス閾値
    this.thresholds = {
      performanceRegressionThreshold: config.performanceRegressionThreshold || 10, // 10%以上の劣化
      memoryLeakThreshold: config.memoryLeakThreshold || 50, // 50MB以上の増加
      executionTimeThreshold: config.executionTimeThreshold || 5000, // 5秒以上
      bundleSizeIncreaseThreshold: config.bundleSizeIncreaseThreshold || 10 // 10%以上の増加
    };
    
    // ベンチマーク結果の保存場所
    this.benchmarkDir = path.join(process.cwd(), '.poppo', 'benchmarks');
  }
  
  /**
   * 初期化
   */
  async initialize() {
    this.logger.info('PerformanceAnalyzerを初期化中...');
    
    // ベンチマークディレクトリの作成
    await fs.mkdir(this.benchmarkDir, { recursive: true });
    
    // 利用可能なツールの確認
    this.availableTools = await this.detectPerformanceTools();
    this.logger.info(`利用可能なツール: ${Object.keys(this.availableTools).join(', ')}`);
  }
  
  /**
   * パフォーマンスツールの検出
   */
  async detectPerformanceTools() {
    const tools = {};
    
    // Node.js組み込みのperformance API
    tools.nodePerf = true;
    
    // メモリプロファイリング
    try {
      const v8Profiler = require('v8-profiler-next');
      tools.v8Profiler = true;
    } catch (error) {
      this.logger.debug('v8-profilerは利用できません');
    }
    
    // webpack-bundle-analyzer
    try {
      await execAsync('npx webpack-bundle-analyzer --version');
      tools.bundleAnalyzer = true;
    } catch (error) {
      this.logger.debug('webpack-bundle-analyzerは利用できません');
    }
    
    return tools;
  }
  
  /**
   * パフォーマンス分析の実行
   */
  async analyzePerformance(projectDir, changedFiles = []) {
    this.logger.info(`パフォーマンス分析を実行: ${projectDir}`);
    
    const results = {
      regressions: [],
      memoryLeaks: [],
      executionTime: {},
      bundleSize: {},
      recommendations: []
    };
    
    try {
      // 1. 実行時間の計測
      const execTimeResults = await this.measureExecutionTime(projectDir, changedFiles);
      results.executionTime = execTimeResults;
      
      // 2. メモリ使用量の分析
      const memoryResults = await this.analyzeMemoryUsage(projectDir, changedFiles);
      results.memoryLeaks = memoryResults.leaks;
      results.memoryProfile = memoryResults.profile;
      
      // 3. バンドルサイズの分析
      if (await this.hasWebpackConfig(projectDir)) {
        const bundleResults = await this.analyzeBundleSize(projectDir);
        results.bundleSize = bundleResults;
      }
      
      // 4. パフォーマンス回帰の検出
      results.regressions = await this.detectPerformanceRegressions(results);
      
      // 5. 最適化の提案
      results.recommendations = this.generateOptimizationRecommendations(results);
      
      // ベンチマーク結果の保存
      await this.saveBenchmarkResults(results);
      
      return results;
      
    } catch (error) {
      this.logger.error(`パフォーマンス分析エラー: ${error.message}`);
      return results;
    }
  }
  
  /**
   * 実行時間の計測
   */
  async measureExecutionTime(projectDir, changedFiles) {
    const results = {
      functions: [],
      criticalPaths: [],
      totalTime: 0
    };
    
    // 変更されたファイルから関数を抽出して計測（簡易版）
    for (const file of changedFiles) {
      if (!file.endsWith('.js') && !file.endsWith('.ts')) continue;
      
      try {
        const filePath = path.join(projectDir, file);
        const content = await fs.readFile(filePath, 'utf8');
        
        // 関数の抽出と実行時間の推定
        const functions = this.extractFunctions(content);
        
        for (const func of functions) {
          // パフォーマンスマークを使用した計測（実際の実装では動的に実行）
          const estimatedTime = this.estimateExecutionTime(func);
          
          results.functions.push({
            file,
            name: func.name,
            line: func.line,
            estimatedTime,
            complexity: func.complexity
          });
          
          // 閾値を超える関数を記録
          if (estimatedTime > this.thresholds.executionTimeThreshold) {
            results.criticalPaths.push({
              file,
              function: func.name,
              time: estimatedTime,
              issue: 'Slow execution'
            });
          }
        }
      } catch (error) {
        this.logger.warn(`実行時間計測エラー (${file}): ${error.message}`);
      }
    }
    
    // 総実行時間の計算
    results.totalTime = results.functions.reduce((sum, f) => sum + f.estimatedTime, 0);
    
    return results;
  }
  
  /**
   * 関数の抽出（簡易版）
   */
  extractFunctions(code) {
    const functions = [];
    
    // 関数宣言のパターン
    const patterns = [
      /function\s+(\w+)\s*\([^)]*\)\s*{/g,
      /(\w+)\s*:\s*function\s*\([^)]*\)\s*{/g,
      /(\w+)\s*=\s*function\s*\([^)]*\)\s*{/g,
      /(\w+)\s*=\s*\([^)]*\)\s*=>\s*{/g,
      /async\s+function\s+(\w+)\s*\([^)]*\)\s*{/g
    ];
    
    const lines = code.split('\n');
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(code)) !== null) {
        const lineNumber = code.substring(0, match.index).split('\n').length;
        const functionName = match[1];
        
        // 関数の複雑度を簡易計算
        const functionBody = this.extractFunctionBody(code, match.index);
        const complexity = this.calculateComplexity(functionBody);
        
        functions.push({
          name: functionName,
          line: lineNumber,
          complexity,
          body: functionBody
        });
      }
    }
    
    return functions;
  }
  
  /**
   * 関数本体の抽出（簡易版）
   */
  extractFunctionBody(code, startIndex) {
    let braceCount = 0;
    let inFunction = false;
    let body = '';
    
    for (let i = startIndex; i < code.length; i++) {
      const char = code[i];
      
      if (char === '{') {
        braceCount++;
        inFunction = true;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0 && inFunction) {
          return body;
        }
      }
      
      if (inFunction) {
        body += char;
      }
    }
    
    return body;
  }
  
  /**
   * 複雑度の計算（簡易版）
   */
  calculateComplexity(code) {
    let complexity = 1;
    
    const patterns = [
      /\bif\s*\(/g,
      /\bfor\s*\(/g,
      /\bwhile\s*\(/g,
      /\bcase\s+/g,
      /\?\s*[^:]+:/g
    ];
    
    for (const pattern of patterns) {
      const matches = code.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }
    
    return complexity;
  }
  
  /**
   * 実行時間の推定（簡易版）
   */
  estimateExecutionTime(func) {
    // 複雑度に基づいた推定
    const baseTime = 10; // 基本時間（ミリ秒）
    const complexityFactor = 50; // 複雑度ごとの追加時間
    
    // ループがある場合は大幅に増加
    if (func.body.includes('for') || func.body.includes('while')) {
      return baseTime + (func.complexity * complexityFactor * 10);
    }
    
    // 非同期処理がある場合
    if (func.body.includes('await') || func.body.includes('Promise')) {
      return baseTime + (func.complexity * complexityFactor * 5);
    }
    
    return baseTime + (func.complexity * complexityFactor);
  }
  
  /**
   * メモリ使用量の分析
   */
  async analyzeMemoryUsage(projectDir, changedFiles) {
    const results = {
      leaks: [],
      profile: {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        arrayBuffers: 0
      }
    };
    
    try {
      // 現在のメモリ使用量を取得
      const memoryUsage = process.memoryUsage();
      results.profile = {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024),
        arrayBuffers: Math.round(memoryUsage.arrayBuffers / 1024 / 1024)
      };
      
      // メモリリークの可能性を検出（簡易版）
      for (const file of changedFiles) {
        if (!file.endsWith('.js') && !file.endsWith('.ts')) continue;
        
        try {
          const filePath = path.join(projectDir, file);
          const content = await fs.readFile(filePath, 'utf8');
          
          // メモリリークのパターンを検出
          const leakPatterns = [
            {
              pattern: /setInterval\s*\([^)]+\)/g,
              type: 'Uncleared interval',
              message: 'setIntervalがクリアされていない可能性があります'
            },
            {
              pattern: /addEventListener\s*\([^)]+\)/g,
              type: 'Event listener leak',
              message: 'イベントリスナーが削除されていない可能性があります'
            },
            {
              pattern: /global\.\w+\s*=/g,
              type: 'Global variable',
              message: 'グローバル変数への代入はメモリリークの原因になります'
            },
            {
              pattern: /new\s+Array\s*\(\s*\d{7,}\s*\)/g,
              type: 'Large array',
              message: '大きな配列がメモリを消費している可能性があります'
            }
          ];
          
          for (const leakPattern of leakPatterns) {
            const matches = content.match(leakPattern.pattern);
            if (matches) {
              for (const match of matches) {
                const lineNumber = content.substring(0, content.indexOf(match)).split('\n').length;
                results.leaks.push({
                  file,
                  line: lineNumber,
                  type: leakPattern.type,
                  message: leakPattern.message,
                  code: match
                });
              }
            }
          }
          
        } catch (error) {
          this.logger.warn(`メモリ分析エラー (${file}): ${error.message}`);
        }
      }
      
    } catch (error) {
      this.logger.error(`メモリ使用量分析エラー: ${error.message}`);
    }
    
    return results;
  }
  
  /**
   * バンドルサイズの分析
   */
  async analyzeBundleSize(projectDir) {
    const results = {
      totalSize: 0,
      chunks: [],
      largeModules: []
    };
    
    try {
      // webpackのstats.jsonを探す
      const statsPath = path.join(projectDir, 'stats.json');
      
      try {
        const statsContent = await fs.readFile(statsPath, 'utf8');
        const stats = JSON.parse(statsContent);
        
        // チャンクサイズの分析
        if (stats.chunks) {
          for (const chunk of stats.chunks) {
            results.chunks.push({
              name: chunk.names.join(', '),
              size: chunk.size,
              modules: chunk.modules?.length || 0
            });
            results.totalSize += chunk.size;
          }
        }
        
        // 大きなモジュールの検出
        if (stats.modules) {
          const largeModules = stats.modules
            .filter(m => m.size > 100000) // 100KB以上
            .sort((a, b) => b.size - a.size)
            .slice(0, 10);
          
          results.largeModules = largeModules.map(m => ({
            name: m.name,
            size: m.size,
            reasons: m.reasons?.length || 0
          }));
        }
        
      } catch (error) {
        // stats.jsonが存在しない場合は、distフォルダのサイズを計測
        const distPath = path.join(projectDir, 'dist');
        try {
          const distSize = await this.calculateDirectorySize(distPath);
          results.totalSize = distSize;
        } catch (error) {
          this.logger.debug('distフォルダが見つかりません');
        }
      }
      
    } catch (error) {
      this.logger.error(`バンドルサイズ分析エラー: ${error.message}`);
    }
    
    return results;
  }
  
  /**
   * webpackの設定ファイルが存在するか確認
   */
  async hasWebpackConfig(projectDir) {
    const configFiles = ['webpack.config.js', 'webpack.config.json'];
    
    for (const file of configFiles) {
      try {
        await fs.access(path.join(projectDir, file));
        return true;
      } catch (error) {
        // ファイルが存在しない
      }
    }
    
    return false;
  }
  
  /**
   * ディレクトリサイズの計算
   */
  async calculateDirectorySize(dirPath) {
    let totalSize = 0;
    
    async function getSize(filePath) {
      const stats = await fs.stat(filePath);
      
      if (stats.isDirectory()) {
        const entries = await fs.readdir(filePath);
        for (const entry of entries) {
          await getSize(path.join(filePath, entry));
        }
      } else {
        totalSize += stats.size;
      }
    }
    
    await getSize(dirPath);
    return totalSize;
  }
  
  /**
   * パフォーマンス回帰の検出
   */
  async detectPerformanceRegressions(currentResults) {
    const regressions = [];
    
    try {
      // 前回のベンチマーク結果を読み込む
      const previousResults = await this.loadPreviousBenchmark();
      
      if (previousResults) {
        // 実行時間の比較
        if (currentResults.executionTime.totalTime > 0 && previousResults.executionTime?.totalTime > 0) {
          const timeIncrease = ((currentResults.executionTime.totalTime - previousResults.executionTime.totalTime) / 
                               previousResults.executionTime.totalTime) * 100;
          
          if (timeIncrease > this.thresholds.performanceRegressionThreshold) {
            regressions.push({
              type: 'execution_time',
              metric: 'Total execution time',
              previous: previousResults.executionTime.totalTime,
              current: currentResults.executionTime.totalTime,
              increase: `${timeIncrease.toFixed(1)}%`,
              severity: timeIncrease > 50 ? 'high' : 'medium'
            });
          }
        }
        
        // バンドルサイズの比較
        if (currentResults.bundleSize.totalSize > 0 && previousResults.bundleSize?.totalSize > 0) {
          const sizeIncrease = ((currentResults.bundleSize.totalSize - previousResults.bundleSize.totalSize) / 
                               previousResults.bundleSize.totalSize) * 100;
          
          if (sizeIncrease > this.thresholds.bundleSizeIncreaseThreshold) {
            regressions.push({
              type: 'bundle_size',
              metric: 'Bundle size',
              previous: previousResults.bundleSize.totalSize,
              current: currentResults.bundleSize.totalSize,
              increase: `${sizeIncrease.toFixed(1)}%`,
              severity: sizeIncrease > 30 ? 'high' : 'medium'
            });
          }
        }
        
        // メモリ使用量の比較
        if (currentResults.memoryProfile && previousResults.memoryProfile) {
          const memoryIncrease = currentResults.memoryProfile.heapUsed - previousResults.memoryProfile.heapUsed;
          
          if (memoryIncrease > this.thresholds.memoryLeakThreshold) {
            regressions.push({
              type: 'memory_usage',
              metric: 'Heap memory usage',
              previous: previousResults.memoryProfile.heapUsed,
              current: currentResults.memoryProfile.heapUsed,
              increase: `${memoryIncrease} MB`,
              severity: 'high'
            });
          }
        }
      }
      
    } catch (error) {
      this.logger.warn(`ベンチマーク比較エラー: ${error.message}`);
    }
    
    return regressions;
  }
  
  /**
   * 前回のベンチマーク結果を読み込む
   */
  async loadPreviousBenchmark() {
    try {
      const benchmarkFile = path.join(this.benchmarkDir, 'latest.json');
      const content = await fs.readFile(benchmarkFile, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }
  
  /**
   * ベンチマーク結果の保存
   */
  async saveBenchmarkResults(results) {
    try {
      const timestamp = new Date().toISOString();
      const benchmarkData = {
        timestamp,
        ...results
      };
      
      // 最新の結果を保存
      await fs.writeFile(
        path.join(this.benchmarkDir, 'latest.json'),
        JSON.stringify(benchmarkData, null, 2)
      );
      
      // タイムスタンプ付きのバックアップも保存
      await fs.writeFile(
        path.join(this.benchmarkDir, `benchmark-${timestamp.replace(/[:.]/g, '-')}.json`),
        JSON.stringify(benchmarkData, null, 2)
      );
      
    } catch (error) {
      this.logger.error(`ベンチマーク保存エラー: ${error.message}`);
    }
  }
  
  /**
   * 最適化の推奨事項を生成
   */
  generateOptimizationRecommendations(results) {
    const recommendations = [];
    
    // 実行時間が長い関数
    if (results.executionTime.criticalPaths.length > 0) {
      recommendations.push({
        type: 'execution_time',
        priority: 'high',
        message: `${results.executionTime.criticalPaths.length}個の関数で実行時間が長くなっています`,
        action: '関数の最適化、非同期処理の活用、アルゴリズムの改善を検討してください',
        details: results.executionTime.criticalPaths
      });
    }
    
    // メモリリーク
    if (results.memoryLeaks.length > 0) {
      recommendations.push({
        type: 'memory_leak',
        priority: 'critical',
        message: `${results.memoryLeaks.length}箇所でメモリリークの可能性があります`,
        action: 'イベントリスナーの削除、タイマーのクリア、参照の解放を確認してください',
        details: results.memoryLeaks
      });
    }
    
    // バンドルサイズ
    if (results.bundleSize.largeModules && results.bundleSize.largeModules.length > 0) {
      recommendations.push({
        type: 'bundle_size',
        priority: 'medium',
        message: '大きなモジュールがバンドルサイズを増加させています',
        action: 'コード分割、動的インポート、Tree Shakingの活用を検討してください',
        details: results.bundleSize.largeModules
      });
    }
    
    // パフォーマンス回帰
    if (results.regressions.length > 0) {
      const highSeverity = results.regressions.filter(r => r.severity === 'high');
      if (highSeverity.length > 0) {
        recommendations.push({
          type: 'regression',
          priority: 'critical',
          message: `${highSeverity.length}件の重大なパフォーマンス低下が検出されました`,
          action: '変更をレビューし、パフォーマンスへの影響を確認してください',
          details: highSeverity
        });
      }
    }
    
    return recommendations;
  }
}

module.exports = PerformanceAnalyzer;