const { performance } = require('perf_hooks');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

/**
 * パフォーマンステスター - アプリケーションのパフォーマンステスト
 */
class PerformanceTester {
  constructor(config = {}) {
    this.config = config;
    this.resultsDir = config.resultsDir || 'performance-results';
    this.scenarios = config.scenarios || {};
    this.thresholds = config.performanceThreshold || {
      loadTime: 3000,
      memoryUsage: 100,
      bundleSize: 500
    };
  }
  
  /**
   * パフォーマンステストの実行
   */
  async run(options = {}) {
    const results = {
      timestamp: new Date().toISOString(),
      scenarios: {},
      summary: {},
      success: true
    };
    
    // ディレクトリの準備
    await this.ensureResultsDir();
    
    // シナリオの実行
    const scenarios = options.scenarios || Object.keys(this.scenarios);
    for (const scenarioName of scenarios) {
      try {
        const scenarioResult = await this.runScenario(
          scenarioName,
          options.iterations || 3,
          options.warmup || 1
        );
        results.scenarios[scenarioName] = scenarioResult;
      } catch (error) {
        results.scenarios[scenarioName] = {
          error: error.message,
          success: false
        };
        results.success = false;
      }
    }
    
    // サマリーの計算
    results.summary = this.calculateSummary(results.scenarios);
    
    // ベースラインとの比較
    if (options.baseline) {
      results.comparison = await this.compareWithBaseline(results, options.baseline);
    }
    
    // 結果の保存
    await this.saveResults(results);
    
    // パフォーマンス指標の集計
    results.metrics = await this.collectMetrics();
    
    return results;
  }
  
  /**
   * シナリオの実行
   */
  async runScenario(scenarioName, iterations, warmup) {
    const scenario = this.scenarios[scenarioName] || this.getDefaultScenario(scenarioName);
    const measurements = [];
    
    // ウォームアップ実行
    for (let i = 0; i < warmup; i++) {
      await this.executeScenario(scenario);
    }
    
    // 本番実行
    for (let i = 0; i < iterations; i++) {
      const measurement = await this.executeScenario(scenario);
      measurements.push(measurement);
    }
    
    // 統計計算
    return {
      name: scenarioName,
      iterations,
      measurements,
      stats: this.calculateStats(measurements),
      success: true
    };
  }
  
  /**
   * シナリオの実行（単一）
   */
  async executeScenario(scenario) {
    const startTime = performance.now();
    const startMemory = process.memoryUsage();
    
    const result = {
      startTime: new Date().toISOString(),
      metrics: {}
    };
    
    try {
      // アプリケーション起動時間の測定
      if (scenario.type === 'startup') {
        result.metrics.startupTime = await this.measureStartupTime(scenario);
      }
      
      // ページロード時間の測定
      if (scenario.type === 'pageLoad' || scenario.type === 'default') {
        result.metrics.loadTime = await this.measurePageLoadTime(scenario);
      }
      
      // API応答時間の測定
      if (scenario.type === 'api') {
        result.metrics.apiResponse = await this.measureApiResponse(scenario);
      }
      
      // バンドルサイズの測定
      if (scenario.type === 'bundle' || scenario.measureBundle) {
        result.metrics.bundleSize = await this.measureBundleSize();
      }
      
      // カスタム測定
      if (scenario.custom) {
        result.metrics.custom = await scenario.custom();
      }
      
    } catch (error) {
      result.error = error.message;
    }
    
    // 実行時間とメモリ使用量
    const endTime = performance.now();
    const endMemory = process.memoryUsage();
    
    result.duration = endTime - startTime;
    result.memoryDelta = {
      heapUsed: (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024, // MB
      external: (endMemory.external - startMemory.external) / 1024 / 1024,
      rss: (endMemory.rss - startMemory.rss) / 1024 / 1024
    };
    
    return result;
  }
  
  /**
   * 起動時間の測定
   */
  async measureStartupTime(scenario) {
    const command = scenario.command || 'npm';
    const args = scenario.args || ['start'];
    const readyPattern = scenario.readyPattern || /ready|started|listening/i;
    
    return new Promise((resolve, reject) => {
      const startTime = performance.now();
      const child = spawn(command, args, {
        cwd: process.cwd(),
        env: { ...process.env, NODE_ENV: 'production' }
      });
      
      let output = '';
      
      child.stdout.on('data', (data) => {
        output += data.toString();
        if (readyPattern.test(output)) {
          const duration = performance.now() - startTime;
          child.kill();
          resolve(duration);
        }
      });
      
      child.stderr.on('data', (data) => {
        console.error('起動エラー:', data.toString());
      });
      
      setTimeout(() => {
        child.kill();
        reject(new Error('起動タイムアウト'));
      }, 30000); // 30秒タイムアウト
    });
  }
  
  /**
   * ページロード時間の測定（Puppeteerを使用）
   */
  async measurePageLoadTime(scenario) {
    try {
      const puppeteer = require('puppeteer');
      const browser = await puppeteer.launch({ headless: true });
      const page = await browser.newPage();
      
      const url = scenario.url || 'http://localhost:3000';
      const metrics = await page.evaluate(() => {
        return {
          navigationStart: performance.timing.navigationStart,
          domContentLoaded: performance.timing.domContentLoadedEventEnd,
          loadComplete: performance.timing.loadEventEnd
        };
      });
      
      await page.goto(url, { waitUntil: 'networkidle0' });
      
      const loadTime = metrics.loadComplete - metrics.navigationStart;
      
      await browser.close();
      return loadTime;
      
    } catch (error) {
      // Puppeteerが利用できない場合は簡易測定
      return this.measureSimpleLoadTime(scenario);
    }
  }
  
  /**
   * 簡易ロード時間測定
   */
  async measureSimpleLoadTime(scenario) {
    const http = require('http');
    const https = require('https');
    const url = new URL(scenario.url || 'http://localhost:3000');
    const client = url.protocol === 'https:' ? https : http;
    
    return new Promise((resolve, reject) => {
      const startTime = performance.now();
      
      client.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          const duration = performance.now() - startTime;
          resolve(duration);
        });
      }).on('error', reject);
    });
  }
  
  /**
   * API応答時間の測定
   */
  async measureApiResponse(scenario) {
    const endpoints = scenario.endpoints || ['/api/health'];
    const results = {};
    
    for (const endpoint of endpoints) {
      const measurements = [];
      
      // 複数回測定して平均を取る
      for (let i = 0; i < 5; i++) {
        const startTime = performance.now();
        
        try {
          await fetch(`${scenario.baseUrl || 'http://localhost:3000'}${endpoint}`);
          const duration = performance.now() - startTime;
          measurements.push(duration);
        } catch (error) {
          measurements.push(-1); // エラーの場合
        }
      }
      
      results[endpoint] = {
        measurements,
        average: measurements.filter(m => m > 0).reduce((a, b) => a + b, 0) / measurements.length,
        min: Math.min(...measurements.filter(m => m > 0)),
        max: Math.max(...measurements.filter(m => m > 0))
      };
    }
    
    return results;
  }
  
  /**
   * バンドルサイズの測定
   */
  async measureBundleSize() {
    const distDir = path.join(process.cwd(), 'dist');
    const buildDir = path.join(process.cwd(), 'build');
    
    try {
      // ビルド実行
      await this.executeBuild();
      
      // サイズ測定
      const targetDir = await this.fileExists(distDir) ? distDir : buildDir;
      const sizes = await this.calculateDirectorySize(targetDir);
      
      return sizes;
    } catch (error) {
      console.error('バンドルサイズ測定エラー:', error);
      return null;
    }
  }
  
  /**
   * ビルドの実行
   */
  async executeBuild() {
    return new Promise((resolve, reject) => {
      const child = spawn('npm', ['run', 'build'], {
        cwd: process.cwd(),
        env: { ...process.env, NODE_ENV: 'production' }
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ビルド失敗: exit code ${code}`));
        }
      });
      
      child.on('error', reject);
    });
  }
  
  /**
   * ディレクトリサイズの計算
   */
  async calculateDirectorySize(dir) {
    const files = await this.walkDirectory(dir);
    const sizes = {
      total: 0,
      js: 0,
      css: 0,
      images: 0,
      other: 0,
      files: {}
    };
    
    for (const file of files) {
      const stats = await fs.stat(file);
      const size = stats.size / 1024; // KB
      const ext = path.extname(file).toLowerCase();
      
      sizes.total += size;
      sizes.files[file] = size;
      
      if (['.js', '.mjs', '.cjs'].includes(ext)) {
        sizes.js += size;
      } else if (['.css', '.scss', '.sass'].includes(ext)) {
        sizes.css += size;
      } else if (['.jpg', '.png', '.gif', '.svg', '.webp'].includes(ext)) {
        sizes.images += size;
      } else {
        sizes.other += size;
      }
    }
    
    return sizes;
  }
  
  /**
   * ディレクトリの再帰的探索
   */
  async walkDirectory(dir) {
    const files = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        files.push(...await this.walkDirectory(fullPath));
      } else {
        files.push(fullPath);
      }
    }
    
    return files;
  }
  
  /**
   * 統計の計算
   */
  calculateStats(measurements) {
    const values = measurements.map(m => m.duration).filter(v => v > 0);
    
    if (values.length === 0) {
      return { error: 'No valid measurements' };
    }
    
    values.sort((a, b) => a - b);
    
    return {
      count: values.length,
      min: values[0],
      max: values[values.length - 1],
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      median: values[Math.floor(values.length / 2)],
      p90: values[Math.floor(values.length * 0.9)],
      p95: values[Math.floor(values.length * 0.95)],
      p99: values[Math.floor(values.length * 0.99)],
      stdDev: this.calculateStdDev(values)
    };
  }
  
  /**
   * 標準偏差の計算
   */
  calculateStdDev(values) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }
  
  /**
   * サマリーの計算
   */
  calculateSummary(scenarios) {
    const summary = {
      loadTime: null,
      memoryUsage: null,
      bundleSize: null,
      violations: []
    };
    
    // 各シナリオから主要メトリクスを抽出
    Object.values(scenarios).forEach(scenario => {
      if (scenario.stats && scenario.measurements) {
        // ロード時間
        const loadTimes = scenario.measurements
          .filter(m => m.metrics && m.metrics.loadTime)
          .map(m => m.metrics.loadTime);
        
        if (loadTimes.length > 0) {
          summary.loadTime = Math.min(...loadTimes);
        }
        
        // メモリ使用量
        const memoryValues = scenario.measurements
          .filter(m => m.memoryDelta)
          .map(m => m.memoryDelta.heapUsed);
        
        if (memoryValues.length > 0) {
          summary.memoryUsage = Math.max(...memoryValues);
        }
        
        // バンドルサイズ
        const bundleSizes = scenario.measurements
          .filter(m => m.metrics && m.metrics.bundleSize)
          .map(m => m.metrics.bundleSize.total);
        
        if (bundleSizes.length > 0) {
          summary.bundleSize = bundleSizes[0]; // 最初の値を使用
        }
      }
    });
    
    // 閾値チェック
    if (summary.loadTime && summary.loadTime > this.thresholds.loadTime) {
      summary.violations.push({
        metric: 'loadTime',
        actual: summary.loadTime,
        threshold: this.thresholds.loadTime
      });
    }
    
    if (summary.memoryUsage && summary.memoryUsage > this.thresholds.memoryUsage) {
      summary.violations.push({
        metric: 'memoryUsage',
        actual: summary.memoryUsage,
        threshold: this.thresholds.memoryUsage
      });
    }
    
    if (summary.bundleSize && summary.bundleSize > this.thresholds.bundleSize) {
      summary.violations.push({
        metric: 'bundleSize',
        actual: summary.bundleSize,
        threshold: this.thresholds.bundleSize
      });
    }
    
    return summary;
  }
  
  /**
   * ベースラインとの比較
   */
  async compareWithBaseline(results, baselineName) {
    try {
      const baselineFile = path.join(this.resultsDir, `baseline-${baselineName}.json`);
      const baseline = JSON.parse(await fs.readFile(baselineFile, 'utf8'));
      
      const comparison = {
        improved: [],
        degraded: [],
        unchanged: []
      };
      
      // 各メトリクスの比較
      const metrics = ['loadTime', 'memoryUsage', 'bundleSize'];
      
      for (const metric of metrics) {
        const current = results.summary[metric];
        const base = baseline.summary[metric];
        
        if (current && base) {
          const diff = ((current - base) / base) * 100;
          
          if (diff > 5) {
            comparison.degraded.push({
              metric,
              current,
              baseline: base,
              diff: `+${diff.toFixed(2)}%`
            });
          } else if (diff < -5) {
            comparison.improved.push({
              metric,
              current,
              baseline: base,
              diff: `${diff.toFixed(2)}%`
            });
          } else {
            comparison.unchanged.push({
              metric,
              current,
              baseline: base,
              diff: `${diff.toFixed(2)}%`
            });
          }
        }
      }
      
      return comparison;
    } catch (error) {
      return {
        error: 'ベースラインとの比較に失敗しました',
        message: error.message
      };
    }
  }
  
  /**
   * パフォーマンストレンドの取得
   */
  async getTrends() {
    try {
      const historyFile = path.join(this.resultsDir, 'performance-history.json');
      const history = JSON.parse(await fs.readFile(historyFile, 'utf8'));
      
      // 最新30件のデータからトレンドを計算
      const recent = history.slice(-30);
      
      return {
        loadTime: this.calculateTrend(recent.map(r => r.summary.loadTime)),
        memoryUsage: this.calculateTrend(recent.map(r => r.summary.memoryUsage)),
        bundleSize: this.calculateTrend(recent.map(r => r.summary.bundleSize))
      };
    } catch (error) {
      return null;
    }
  }
  
  /**
   * トレンドの計算（線形回帰）
   */
  calculateTrend(values) {
    const validValues = values.filter(v => v !== null && v !== undefined);
    
    if (validValues.length < 2) {
      return { trend: 'insufficient_data' };
    }
    
    const n = validValues.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = validValues;
    
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
    const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    return {
      trend: slope > 0.01 ? 'increasing' : slope < -0.01 ? 'decreasing' : 'stable',
      slope,
      intercept,
      current: y[y.length - 1],
      predicted: slope * n + intercept
    };
  }
  
  /**
   * デフォルトシナリオの取得
   */
  getDefaultScenario(name) {
    const defaults = {
      default: {
        type: 'pageLoad',
        url: 'http://localhost:3000',
        measureBundle: true
      },
      startup: {
        type: 'startup',
        command: 'npm',
        args: ['start'],
        readyPattern: /ready|started|listening/i
      },
      api: {
        type: 'api',
        baseUrl: 'http://localhost:3000',
        endpoints: ['/api/health', '/api/status']
      },
      bundle: {
        type: 'bundle'
      }
    };
    
    return defaults[name] || defaults.default;
  }
  
  /**
   * 結果の保存
   */
  async saveResults(results) {
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const resultFile = path.join(this.resultsDir, `performance-${timestamp}.json`);
    
    await fs.writeFile(resultFile, JSON.stringify(results, null, 2));
    
    // 履歴の更新
    await this.updateHistory(results);
  }
  
  /**
   * 履歴の更新
   */
  async updateHistory(results) {
    const historyFile = path.join(this.resultsDir, 'performance-history.json');
    let history = [];
    
    try {
      const existing = await fs.readFile(historyFile, 'utf8');
      history = JSON.parse(existing);
    } catch (error) {
      // ファイルが存在しない場合は新規作成
    }
    
    history.push({
      timestamp: results.timestamp,
      summary: results.summary,
      success: results.success
    });
    
    // 最新100件のみ保持
    if (history.length > 100) {
      history = history.slice(-100);
    }
    
    await fs.writeFile(historyFile, JSON.stringify(history, null, 2));
  }
  
  /**
   * メトリクスの収集
   */
  async collectMetrics() {
    return {
      loadTime: this.thresholds.loadTime,
      memoryUsage: this.thresholds.memoryUsage,
      bundleSize: this.thresholds.bundleSize
    };
  }
  
  /**
   * ディレクトリの確認と作成
   */
  async ensureResultsDir() {
    try {
      await fs.mkdir(this.resultsDir, { recursive: true });
    } catch (error) {
      // ディレクトリが既に存在する場合は無視
    }
  }
  
  /**
   * ファイル存在チェック
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = PerformanceTester;