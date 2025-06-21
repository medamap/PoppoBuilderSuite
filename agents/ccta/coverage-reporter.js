const fs = require('fs').promises;
const path = require('path');
const { createCoverageMap } = require('istanbul-lib-coverage');
const libReport = require('istanbul-lib-report');
const reports = require('istanbul-reports');

/**
 * カバレッジレポーター - テストカバレッジの分析とレポート生成
 */
class CoverageReporter {
  constructor(config = {}) {
    this.config = config;
    this.coverageThreshold = config.coverageThreshold || {
      global: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80
      }
    };
    this.coverageDir = config.coverageDir || 'coverage';
  }
  
  /**
   * カバレッジの分析
   */
  async analyze(coverageData, options = {}) {
    if (!coverageData) {
      return {
        available: false,
        message: 'カバレッジデータが利用できません'
      };
    }
    
    try {
      // カバレッジマップの作成
      const coverageMap = await this.createCoverageMap(coverageData);
      
      // サマリーの生成
      const summary = coverageMap.getCoverageSummary();
      
      // 閾値チェック
      const meetsThreshold = this.checkThreshold(summary, options.threshold || this.coverageThreshold);
      
      // 詳細レポート生成（オプション）
      if (options.detailed) {
        await this.generateDetailedReport(coverageMap);
      }
      
      // バッジデータの生成
      const badge = this.generateBadgeData(summary);
      
      // ファイル別カバレッジ
      const fileCoverage = this.getFileCoverage(coverageMap);
      
      return {
        available: true,
        summary: {
          lines: summary.lines.pct,
          statements: summary.statements.pct,
          functions: summary.functions.pct,
          branches: summary.branches.pct
        },
        meetsThreshold,
        violations: meetsThreshold ? [] : this.getThresholdViolations(summary),
        badge,
        fileCoverage,
        uncoveredLines: this.getUncoveredLines(coverageMap)
      };
      
    } catch (error) {
      console.error('カバレッジ分析エラー:', error);
      return {
        available: false,
        error: error.message
      };
    }
  }
  
  /**
   * 現在のカバレッジを取得
   */
  async getCurrent() {
    try {
      const coverageFile = path.join(this.coverageDir, 'coverage-final.json');
      const coverageData = JSON.parse(await fs.readFile(coverageFile, 'utf8'));
      return await this.analyze(coverageData);
    } catch (error) {
      return {
        available: false,
        error: 'カバレッジファイルが見つかりません'
      };
    }
  }
  
  /**
   * ベースラインカバレッジを取得
   */
  async getBaseline(branch) {
    try {
      const baselineFile = path.join(this.coverageDir, `baseline-${branch}.json`);
      const coverageData = JSON.parse(await fs.readFile(baselineFile, 'utf8'));
      return await this.analyze(coverageData);
    } catch (error) {
      return {
        available: false,
        error: 'ベースラインカバレッジが見つかりません'
      };
    }
  }
  
  /**
   * カバレッジの比較
   */
  compare(current, baseline) {
    if (!current.available || !baseline.available) {
      return {
        compared: false,
        message: 'カバレッジデータが不完全です'
      };
    }
    
    const metrics = ['lines', 'statements', 'functions', 'branches'];
    const comparison = {
      improved: false,
      maintained: true,
      decreased: false,
      changes: {}
    };
    
    for (const metric of metrics) {
      const currentValue = current.summary[metric];
      const baselineValue = baseline.summary[metric];
      const diff = currentValue - baselineValue;
      
      comparison.changes[metric] = {
        current: currentValue,
        baseline: baselineValue,
        diff: diff,
        improved: diff > 0,
        decreased: diff < 0
      };
      
      if (diff > 0) comparison.improved = true;
      if (diff < 0) {
        comparison.decreased = true;
        comparison.maintained = false;
      }
    }
    
    // ファイル別の変更
    comparison.decreasedFiles = this.getDecreasedCoverageFiles(
      current.fileCoverage,
      baseline.fileCoverage
    );
    
    comparison.uncoveredLines = current.uncoveredLines;
    
    return comparison;
  }
  
  /**
   * カバレッジマップの作成
   */
  async createCoverageMap(coverageData) {
    const coverageMap = createCoverageMap({});
    
    if (typeof coverageData === 'string') {
      // ファイルパスの場合
      const data = JSON.parse(await fs.readFile(coverageData, 'utf8'));
      Object.keys(data).forEach(filename => {
        coverageMap.addFileCoverage(data[filename]);
      });
    } else if (typeof coverageData === 'object') {
      // オブジェクトの場合
      Object.keys(coverageData).forEach(filename => {
        coverageMap.addFileCoverage(coverageData[filename]);
      });
    }
    
    return coverageMap;
  }
  
  /**
   * 閾値チェック
   */
  checkThreshold(summary, threshold) {
    const metrics = ['lines', 'statements', 'functions', 'branches'];
    
    for (const metric of metrics) {
      const actual = summary[metric].pct;
      const required = threshold.global[metric];
      
      if (actual < required) {
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * 閾値違反の取得
   */
  getThresholdViolations(summary) {
    const violations = [];
    const threshold = this.coverageThreshold.global;
    const metrics = ['lines', 'statements', 'functions', 'branches'];
    
    for (const metric of metrics) {
      const actual = summary[metric].pct;
      const required = threshold[metric];
      
      if (actual < required) {
        violations.push({
          metric,
          actual: actual.toFixed(2),
          required,
          diff: (actual - required).toFixed(2)
        });
      }
    }
    
    return violations;
  }
  
  /**
   * 詳細レポートの生成
   */
  async generateDetailedReport(coverageMap) {
    const context = libReport.createContext({
      dir: this.coverageDir,
      watermarks: libReport.getDefaultWatermarks(),
      coverageMap
    });
    
    // HTML レポート
    const htmlReport = reports.create('html', {
      skipEmpty: false,
      skipFull: false
    });
    htmlReport.execute(context);
    
    // テキストサマリー
    const textReport = reports.create('text-summary');
    textReport.execute(context);
    
    // LCOV レポート
    const lcovReport = reports.create('lcovonly', {
      file: 'lcov.info'
    });
    lcovReport.execute(context);
  }
  
  /**
   * バッジデータの生成
   */
  generateBadgeData(summary) {
    const coverage = summary.lines.pct;
    let color = 'red';
    
    if (coverage >= 90) {
      color = 'brightgreen';
    } else if (coverage >= 80) {
      color = 'green';
    } else if (coverage >= 70) {
      color = 'yellow';
    } else if (coverage >= 50) {
      color = 'orange';
    }
    
    return {
      label: 'coverage',
      message: `${coverage.toFixed(1)}%`,
      color,
      style: 'flat',
      url: `https://img.shields.io/badge/coverage-${coverage.toFixed(1)}%25-${color}`
    };
  }
  
  /**
   * ファイル別カバレッジの取得
   */
  getFileCoverage(coverageMap) {
    const files = {};
    
    coverageMap.files().forEach(file => {
      const fileCoverage = coverageMap.fileCoverageFor(file);
      const summary = fileCoverage.toSummary();
      
      files[file] = {
        lines: summary.lines.pct,
        statements: summary.statements.pct,
        functions: summary.functions.pct,
        branches: summary.branches.pct,
        uncoveredLines: fileCoverage.getUncoveredLines()
      };
    });
    
    return files;
  }
  
  /**
   * カバーされていない行数の取得
   */
  getUncoveredLines(coverageMap) {
    let totalUncovered = 0;
    
    coverageMap.files().forEach(file => {
      const fileCoverage = coverageMap.fileCoverageFor(file);
      totalUncovered += fileCoverage.getUncoveredLines().length;
    });
    
    return totalUncovered;
  }
  
  /**
   * カバレッジが低下したファイルの取得
   */
  getDecreasedCoverageFiles(current, baseline) {
    const decreasedFiles = [];
    
    Object.keys(current).forEach(file => {
      if (baseline[file]) {
        const currentCoverage = current[file].lines;
        const baselineCoverage = baseline[file].lines;
        
        if (currentCoverage < baselineCoverage) {
          decreasedFiles.push({
            file,
            current: currentCoverage,
            baseline: baselineCoverage,
            diff: currentCoverage - baselineCoverage
          });
        }
      }
    });
    
    return decreasedFiles;
  }
  
  /**
   * カバレッジ履歴の保存
   */
  async saveCoverageHistory(coverage, metadata = {}) {
    const historyFile = path.join(this.coverageDir, 'coverage-history.json');
    let history = [];
    
    try {
      const existing = await fs.readFile(historyFile, 'utf8');
      history = JSON.parse(existing);
    } catch (error) {
      // ファイルが存在しない場合は新規作成
    }
    
    history.push({
      timestamp: new Date().toISOString(),
      coverage: coverage.summary,
      metadata
    });
    
    // 最新100件のみ保持
    if (history.length > 100) {
      history = history.slice(-100);
    }
    
    await fs.writeFile(historyFile, JSON.stringify(history, null, 2));
  }
}

module.exports = CoverageReporter;