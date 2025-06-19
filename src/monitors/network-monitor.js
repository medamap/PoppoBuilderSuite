const https = require('https');
const { URL } = require('url');
const Logger = require('../logger');

/**
 * ネットワークモニター
 * 外部APIへの接続性とレスポンスタイムを監視
 */
class NetworkMonitor {
  constructor(config) {
    this.config = config;
    this.logger = new Logger('NetworkMonitor');
    
    // 監視対象のエンドポイント
    this.endpoints = {
      github: {
        name: 'GitHub API',
        url: 'https://api.github.com',
        timeout: 5000,
        critical: true
      },
      claude: {
        name: 'Claude API',
        url: 'https://api.anthropic.com/v1/messages',
        timeout: 5000,
        critical: true,
        needsAuth: true
      }
    };
    
    // しきい値の設定
    this.thresholds = {
      responseTime: {
        good: 200,     // ms
        warning: 500,  // ms
        critical: 1000 // ms
      },
      errorRate: {
        warning: 10,   // %
        critical: 50   // %
      }
    };
    
    // 統計情報の保持
    this.stats = {
      requests: {},
      errors: {},
      responseTimes: {}
    };
    
    // 各エンドポイントの統計を初期化
    for (const key of Object.keys(this.endpoints)) {
      this.stats.requests[key] = 0;
      this.stats.errors[key] = 0;
      this.stats.responseTimes[key] = [];
    }
  }
  
  /**
   * ネットワーク層のヘルスチェック
   */
  async check() {
    const startTime = Date.now();
    
    try {
      const details = {
        endpoints: {},
        overallLatency: 0,
        errorRate: 0,
        issues: []
      };
      
      // 各エンドポイントをチェック
      const checks = [];
      for (const [key, endpoint] of Object.entries(this.endpoints)) {
        checks.push(this.checkEndpoint(key, endpoint, details));
      }
      
      await Promise.all(checks);
      
      // 全体的なメトリクスを計算
      this.calculateOverallMetrics(details);
      
      // 問題の検出
      this.detectIssues(details);
      
      // スコアの計算
      const score = this.calculateScore(details);
      
      // ステータスの判定
      const status = score >= 80 ? 'healthy' : score >= 60 ? 'degraded' : 'unhealthy';
      
      return {
        status,
        score,
        details,
        checkDuration: Date.now() - startTime
      };
      
    } catch (error) {
      this.logger.error('ネットワークチェックエラー:', error);
      return {
        status: 'error',
        score: 0,
        error: error.message,
        checkDuration: Date.now() - startTime
      };
    }
  }
  
  /**
   * 個別エンドポイントのチェック
   */
  async checkEndpoint(key, endpoint, details) {
    const startTime = Date.now();
    
    try {
      // リクエストを送信
      const response = await this.makeRequest(endpoint);
      const responseTime = Date.now() - startTime;
      
      // 統計を更新
      this.stats.requests[key]++;
      this.stats.responseTimes[key].push(responseTime);
      
      // 最新の10個のレスポンスタイムのみ保持
      if (this.stats.responseTimes[key].length > 10) {
        this.stats.responseTimes[key].shift();
      }
      
      // 結果を記録
      details.endpoints[key] = {
        name: endpoint.name,
        status: 'online',
        responseTime,
        statusCode: response.statusCode,
        avgResponseTime: this.calculateAverage(this.stats.responseTimes[key])
      };
      
    } catch (error) {
      // エラーの場合
      this.stats.requests[key]++;
      this.stats.errors[key]++;
      
      details.endpoints[key] = {
        name: endpoint.name,
        status: 'offline',
        error: error.message,
        responseTime: Date.now() - startTime
      };
      
      if (endpoint.critical) {
        details.issues.push(`${endpoint.name}への接続に失敗しました: ${error.message}`);
      }
    }
  }
  
  /**
   * HTTPSリクエストの実行
   */
  makeRequest(endpoint) {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint.url);
      
      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'GET',
        timeout: endpoint.timeout,
        headers: {
          'User-Agent': 'PoppoBuilder-HealthCheck/1.0'
        }
      };
      
      // 認証が必要な場合
      if (endpoint.needsAuth && endpoint.name.includes('Claude')) {
        const apiKey = this.config?.claude?.apiKey || process.env.ANTHROPIC_API_KEY;
        if (apiKey) {
          options.headers['x-api-key'] = apiKey;
          options.headers['anthropic-version'] = '2023-06-01';
        }
      }
      
      const req = https.request(options, (res) => {
        // レスポンスデータは読み捨てる
        res.on('data', () => {});
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers
          });
        });
      });
      
      req.on('error', (error) => {
        reject(error);
      });
      
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      
      req.end();
    });
  }
  
  /**
   * 全体的なメトリクスの計算
   */
  calculateOverallMetrics(details) {
    let totalRequests = 0;
    let totalErrors = 0;
    let totalResponseTime = 0;
    let activeEndpoints = 0;
    
    for (const [key, endpoint] of Object.entries(details.endpoints)) {
      if (this.stats.requests[key] > 0) {
        totalRequests += this.stats.requests[key];
        totalErrors += this.stats.errors[key];
        
        if (endpoint.status === 'online') {
          totalResponseTime += endpoint.avgResponseTime || endpoint.responseTime;
          activeEndpoints++;
        }
      }
    }
    
    // 平均レスポンスタイム
    details.overallLatency = activeEndpoints > 0 
      ? Math.round(totalResponseTime / activeEndpoints)
      : 0;
    
    // エラー率
    details.errorRate = totalRequests > 0
      ? Math.round((totalErrors / totalRequests) * 100)
      : 0;
    
    // 統計情報を追加
    details.stats = {
      totalRequests,
      totalErrors,
      uptime: process.uptime()
    };
  }
  
  /**
   * 問題の検出
   */
  detectIssues(details) {
    // レスポンスタイムチェック
    for (const [key, endpoint] of Object.entries(details.endpoints)) {
      if (endpoint.status === 'online') {
        if (endpoint.responseTime >= this.thresholds.responseTime.critical) {
          details.issues.push(`${endpoint.name}のレスポンスが非常に遅いです（${endpoint.responseTime}ms）`);
        } else if (endpoint.responseTime >= this.thresholds.responseTime.warning) {
          details.issues.push(`${endpoint.name}のレスポンスが遅くなっています（${endpoint.responseTime}ms）`);
        }
      }
    }
    
    // エラー率チェック
    if (details.errorRate >= this.thresholds.errorRate.critical) {
      details.issues.push(`ネットワークエラー率が危険レベルです（${details.errorRate}%）`);
    } else if (details.errorRate >= this.thresholds.errorRate.warning) {
      details.issues.push(`ネットワークエラー率が高くなっています（${details.errorRate}%）`);
    }
    
    // 全エンドポイントがオフラインの場合
    const allOffline = Object.values(details.endpoints).every(ep => ep.status === 'offline');
    if (allOffline) {
      details.issues.push('すべての外部APIに接続できません。ネットワーク接続を確認してください。');
    }
  }
  
  /**
   * ネットワーク層のスコア計算
   */
  calculateScore(details) {
    let score = 100;
    
    // エンドポイントの可用性によるスコア
    for (const [key, endpoint] of Object.entries(details.endpoints)) {
      const endpointConfig = this.endpoints[key];
      
      if (endpoint.status === 'offline') {
        // クリティカルなエンドポイントは大きくスコアを下げる
        score -= endpointConfig.critical ? 30 : 15;
      } else {
        // レスポンスタイムによるスコア減少
        if (endpoint.responseTime >= this.thresholds.responseTime.critical) {
          score -= 15;
        } else if (endpoint.responseTime >= this.thresholds.responseTime.warning) {
          score -= 8;
        } else if (endpoint.responseTime >= this.thresholds.responseTime.good) {
          score -= 3;
        }
      }
    }
    
    // エラー率によるスコア減少
    if (details.errorRate >= this.thresholds.errorRate.critical) {
      score -= 20;
    } else if (details.errorRate >= this.thresholds.errorRate.warning) {
      score -= 10;
    }
    
    // 全体的なレイテンシによるスコア減少
    if (details.overallLatency >= this.thresholds.responseTime.critical) {
      score -= 10;
    } else if (details.overallLatency >= this.thresholds.responseTime.warning) {
      score -= 5;
    }
    
    // スコアを0-100の範囲に制限
    return Math.max(0, Math.min(100, score));
  }
  
  /**
   * 平均値の計算
   */
  calculateAverage(array) {
    if (array.length === 0) return 0;
    const sum = array.reduce((a, b) => a + b, 0);
    return Math.round(sum / array.length);
  }
  
  /**
   * ネットワーク統計のリセット
   */
  resetStats() {
    for (const key of Object.keys(this.endpoints)) {
      this.stats.requests[key] = 0;
      this.stats.errors[key] = 0;
      this.stats.responseTimes[key] = [];
    }
  }
}

module.exports = NetworkMonitor;