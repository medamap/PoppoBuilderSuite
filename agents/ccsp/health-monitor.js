/**
 * ヘルスチェック・モニタリングモジュール
 * 
 * システムの健全性を監視し、定期的にステータスを報告
 */

const os = require('os');

class HealthMonitor {
  constructor(redis, logger) {
    this.redis = redis;
    this.logger = logger;
    this.instanceId = `ccsp:${os.hostname()}:${process.pid}`;
    this.healthKey = `ccsp:health:${this.instanceId}`;
    this.startTime = Date.now();
    
    // ヘルスチェック間隔（30秒）
    this.healthCheckInterval = 30000;
    this.intervalHandle = null;
  }
  
  /**
   * ヘルスチェックを開始
   */
  start() {
    // 初回登録
    this.updateHealth();
    
    // 定期的なヘルスチェック
    this.intervalHandle = setInterval(() => {
      this.updateHealth();
    }, this.healthCheckInterval);
    
    this.logger.info(`Health monitoring started for ${this.instanceId}`);
  }
  
  /**
   * ヘルス情報を更新
   */
  async updateHealth() {
    try {
      const health = this.collectHealthInfo();
      
      // Redisに保存（TTL 60秒）
      await this.redis.setex(
        this.healthKey,
        60,
        JSON.stringify(health)
      );
      
      // インスタンスリストに登録
      await this.redis.hset(
        'ccsp:instances',
        this.instanceId,
        JSON.stringify({
          hostname: os.hostname(),
          pid: process.pid,
          startTime: this.startTime,
          lastUpdate: Date.now()
        })
      );
      
    } catch (error) {
      this.logger.error('Health update failed:', error);
    }
  }
  
  /**
   * ヘルス情報を収集
   */
  collectHealthInfo() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      instanceId: this.instanceId,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      status: 'healthy',
      system: {
        platform: os.platform(),
        nodeVersion: process.version,
        hostname: os.hostname(),
        pid: process.pid
      },
      resources: {
        memory: {
          rss: memUsage.rss,
          heapTotal: memUsage.heapTotal,
          heapUsed: memUsage.heapUsed,
          external: memUsage.external
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system
        },
        loadAverage: os.loadavg()
      }
    };
  }
  
  /**
   * 全インスタンスのヘルス状態を取得
   */
  async getAllInstancesHealth() {
    try {
      const instances = await this.redis.hgetall('ccsp:instances');
      const healthStatus = [];
      
      for (const [instanceId, data] of Object.entries(instances)) {
        const instanceData = JSON.parse(data);
        const healthKey = `ccsp:health:${instanceId}`;
        const health = await this.redis.get(healthKey);
        
        if (health) {
          healthStatus.push({
            ...instanceData,
            health: JSON.parse(health),
            alive: true
          });
        } else {
          // ヘルス情報がない = 死んでいる可能性
          healthStatus.push({
            ...instanceData,
            alive: false,
            lastSeen: new Date(instanceData.lastUpdate).toISOString()
          });
          
          // 5分以上更新がないインスタンスは削除
          if (Date.now() - instanceData.lastUpdate > 300000) {
            await this.redis.hdel('ccsp:instances', instanceId);
            this.logger.warn(`Removed dead instance: ${instanceId}`);
          }
        }
      }
      
      return healthStatus;
      
    } catch (error) {
      this.logger.error('Failed to get all instances health:', error);
      return [];
    }
  }
  
  /**
   * ヘルスチェックエンドポイント用のサマリー
   */
  async getHealthSummary(metricsCollector) {
    const health = this.collectHealthInfo();
    const metrics = metricsCollector ? metricsCollector.getMetrics() : null;
    const instances = await this.getAllInstancesHealth();
    
    return {
      status: 'healthy',
      instance: health,
      metrics: metrics,
      cluster: {
        totalInstances: instances.length,
        aliveInstances: instances.filter(i => i.alive).length,
        instances: instances
      }
    };
  }
  
  /**
   * クリーンアップ
   */
  async cleanup() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }
    
    // インスタンスを削除
    await this.redis.hdel('ccsp:instances', this.instanceId);
    await this.redis.del(this.healthKey);
    
    this.logger.info('Health monitoring stopped');
  }
}

module.exports = HealthMonitor;