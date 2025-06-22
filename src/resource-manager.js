const EventEmitter = require('events');
const os = require('os');
const { createLogger } = require('./logger');

/**
 * リソース管理クラス
 * プロジェクトごとのCPU/メモリクォータ管理と
 * 動的なリソース再配分を実装
 */
class ResourceManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.logger = createLogger('ResourceManager');
    
    // 設定
    this.config = {
      enableQuota: config.enableQuota !== false,
      enableDynamicAllocation: config.enableDynamicAllocation !== false,
      monitoringInterval: config.monitoringInterval || 5000, // 5秒
      reallocationInterval: config.reallocationInterval || 60000, // 1分
      systemReservePercent: config.systemReservePercent || 20, // システム予約20%
      defaultQuota: {
        cpu: config.defaultCpuQuota || '1000m',
        memory: config.defaultMemoryQuota || '1Gi',
        maxConcurrent: config.defaultMaxConcurrent || 3
      },
      ...config
    };
    
    // リソース状態
    this.systemResources = {
      totalCpu: os.cpus().length,
      totalMemory: os.totalmem(),
      availableCpu: os.cpus().length,
      availableMemory: os.freemem()
    };
    
    // プロジェクト別のクォータと使用状況
    this.projectQuotas = new Map();
    this.projectUsage = new Map();
    this.processResourceMap = new Map(); // プロセスIDとリソース使用量のマッピング
    
    // 動的割り当て状態
    this.allocationState = {
      lastReallocation: Date.now(),
      allocationHistory: [],
      performanceMetrics: new Map()
    };
    
    // モニタリングタイマー
    this.monitoringTimer = null;
    this.reallocationTimer = null;
  }

  /**
   * リソースマネージャーを初期化
   */
  async initialize() {
    try {
      // システムリソースを更新
      await this.updateSystemResources();
      
      // 利用可能なリソースを計算
      this.calculateAvailableResources();
      
      this.logger.info('リソースマネージャーを初期化しました', {
        totalCpu: this.systemResources.totalCpu,
        totalMemory: this.formatMemory(this.systemResources.totalMemory),
        availableCpu: this.systemResources.availableCpu,
        availableMemory: this.formatMemory(this.systemResources.availableMemory)
      });
      
      return true;
    } catch (error) {
      this.logger.error('初期化エラー:', error);
      throw error;
    }
  }

  /**
   * プロジェクトのクォータを設定
   */
  setProjectQuota(projectId, quota) {
    const normalizedQuota = {
      cpu: this.parseCpuValue(quota.cpu || this.config.defaultQuota.cpu),
      memory: this.parseMemoryValue(quota.memory || this.config.defaultQuota.memory),
      maxConcurrent: quota.maxConcurrent || this.config.defaultQuota.maxConcurrent,
      priority: quota.priority || 50,
      elastic: quota.elastic !== false // デフォルトで弾力的な割り当てを許可
    };
    
    this.projectQuotas.set(projectId, normalizedQuota);
    
    // 使用状況の初期化
    if (!this.projectUsage.has(projectId)) {
      this.projectUsage.set(projectId, {
        cpu: 0,
        memory: 0,
        concurrent: 0,
        processes: new Set()
      });
    }
    
    this.logger.info('プロジェクトクォータを設定しました', {
      projectId,
      quota: normalizedQuota
    });
    
    this.emit('quotaSet', { projectId, quota: normalizedQuota });
  }

  /**
   * リソースを割り当て
   */
  async allocateResources(projectId, processId, requested = {}) {
    if (!this.config.enableQuota) {
      return { allocated: true, resources: requested };
    }
    
    const quota = this.projectQuotas.get(projectId);
    if (!quota) {
      this.logger.warn('クォータが設定されていません', { projectId });
      return { allocated: false, reason: 'No quota set' };
    }
    
    const usage = this.projectUsage.get(projectId);
    const requestedCpu = this.parseCpuValue(requested.cpu || '100m');
    const requestedMemory = this.parseMemoryValue(requested.memory || '256Mi');
    
    // 並行実行数チェック
    if (usage.concurrent >= quota.maxConcurrent) {
      this.logger.warn('並行実行数の上限に達しています', {
        projectId,
        current: usage.concurrent,
        max: quota.maxConcurrent
      });
      return { allocated: false, reason: 'Concurrent limit reached' };
    }
    
    // CPUクォータチェック
    if (usage.cpu + requestedCpu > quota.cpu) {
      if (!quota.elastic || !await this.tryElasticAllocation(projectId, 'cpu', requestedCpu)) {
        this.logger.warn('CPUクォータを超過しています', {
          projectId,
          requested: requestedCpu,
          used: usage.cpu,
          quota: quota.cpu
        });
        return { allocated: false, reason: 'CPU quota exceeded' };
      }
    }
    
    // メモリクォータチェック
    if (usage.memory + requestedMemory > quota.memory) {
      if (!quota.elastic || !await this.tryElasticAllocation(projectId, 'memory', requestedMemory)) {
        this.logger.warn('メモリクォータを超過しています', {
          projectId,
          requested: this.formatMemory(requestedMemory),
          used: this.formatMemory(usage.memory),
          quota: this.formatMemory(quota.memory)
        });
        return { allocated: false, reason: 'Memory quota exceeded' };
      }
    }
    
    // システムリソースチェック
    if (!this.checkSystemResources(requestedCpu, requestedMemory)) {
      return { allocated: false, reason: 'Insufficient system resources' };
    }
    
    // リソースを割り当て
    usage.cpu += requestedCpu;
    usage.memory += requestedMemory;
    usage.concurrent++;
    usage.processes.add(processId);
    
    // プロセスとリソースのマッピング
    this.processResourceMap.set(processId, {
      projectId,
      cpu: requestedCpu,
      memory: requestedMemory,
      allocatedAt: Date.now()
    });
    
    // システムリソースを更新
    this.systemResources.availableCpu -= requestedCpu;
    this.systemResources.availableMemory -= requestedMemory;
    
    this.logger.info('リソースを割り当てました', {
      projectId,
      processId,
      cpu: requestedCpu,
      memory: this.formatMemory(requestedMemory)
    });
    
    this.emit('resourcesAllocated', {
      projectId,
      processId,
      resources: { cpu: requestedCpu, memory: requestedMemory }
    });
    
    return {
      allocated: true,
      resources: {
        cpu: requestedCpu,
        memory: requestedMemory
      }
    };
  }

  /**
   * リソースを解放
   */
  async releaseResources(processId) {
    const allocation = this.processResourceMap.get(processId);
    if (!allocation) {
      this.logger.warn('プロセスのリソース割り当てが見つかりません', { processId });
      return;
    }
    
    const { projectId, cpu, memory } = allocation;
    const usage = this.projectUsage.get(projectId);
    
    if (usage) {
      usage.cpu = Math.max(0, usage.cpu - cpu);
      usage.memory = Math.max(0, usage.memory - memory);
      usage.concurrent = Math.max(0, usage.concurrent - 1);
      usage.processes.delete(processId);
    }
    
    // システムリソースを回復
    this.systemResources.availableCpu += cpu;
    this.systemResources.availableMemory += memory;
    
    // マッピングを削除
    this.processResourceMap.delete(processId);
    
    this.logger.info('リソースを解放しました', {
      projectId,
      processId,
      cpu,
      memory: this.formatMemory(memory)
    });
    
    this.emit('resourcesReleased', {
      projectId,
      processId,
      resources: { cpu, memory }
    });
  }

  /**
   * 弾力的な割り当てを試行
   */
  async tryElasticAllocation(projectId, resourceType, requested) {
    if (!this.config.enableDynamicAllocation) {
      return false;
    }
    
    // 他のプロジェクトから未使用のリソースを借りる
    const availableFromOthers = this.findAvailableResources(projectId, resourceType, requested);
    
    if (availableFromOthers >= requested) {
      this.logger.info('弾力的な割り当てを実行します', {
        projectId,
        resourceType,
        requested
      });
      
      // 一時的にクォータを拡張
      const quota = this.projectQuotas.get(projectId);
      if (resourceType === 'cpu') {
        quota.cpu += requested;
      } else {
        quota.memory += requested;
      }
      
      // 割り当て履歴に記録
      this.allocationState.allocationHistory.push({
        timestamp: Date.now(),
        projectId,
        resourceType,
        amount: requested,
        type: 'elastic'
      });
      
      return true;
    }
    
    return false;
  }

  /**
   * 利用可能なリソースを探す
   */
  findAvailableResources(requestingProjectId, resourceType, requested) {
    let available = 0;
    
    for (const [projectId, quota] of this.projectQuotas) {
      if (projectId === requestingProjectId) continue;
      
      const usage = this.projectUsage.get(projectId);
      if (!usage) continue;
      
      if (resourceType === 'cpu') {
        const unused = quota.cpu - usage.cpu;
        available += Math.max(0, unused);
      } else {
        const unused = quota.memory - usage.memory;
        available += Math.max(0, unused);
      }
    }
    
    return available;
  }

  /**
   * システムリソースをチェック
   */
  checkSystemResources(cpu, memory) {
    return (
      this.systemResources.availableCpu >= cpu &&
      this.systemResources.availableMemory >= memory
    );
  }

  /**
   * システムリソースを更新
   */
  async updateSystemResources() {
    const cpus = os.cpus();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    
    // CPU使用率を計算
    const cpuUsage = await this.calculateCpuUsage();
    const availableCpu = this.systemResources.totalCpu * (1 - cpuUsage);
    
    this.systemResources = {
      totalCpu: cpus.length,
      totalMemory,
      availableCpu,
      availableMemory: freeMemory
    };
  }

  /**
   * CPU使用率を計算
   */
  async calculateCpuUsage() {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });
    
    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 1 - (idle / total);
    
    return usage;
  }

  /**
   * 利用可能なリソースを計算
   */
  calculateAvailableResources() {
    const reservePercent = this.config.systemReservePercent / 100;
    
    // システム予約分を除いた利用可能リソース
    this.systemResources.availableCpu = 
      this.systemResources.totalCpu * (1 - reservePercent);
    this.systemResources.availableMemory = 
      this.systemResources.totalMemory * (1 - reservePercent);
  }

  /**
   * リソース使用状況を取得
   */
  getResourceUsage(projectId = null) {
    if (projectId) {
      const usage = this.projectUsage.get(projectId);
      const quota = this.projectQuotas.get(projectId);
      
      if (!usage || !quota) {
        return null;
      }
      
      return {
        cpu: {
          used: usage.cpu,
          quota: quota.cpu,
          percentage: (usage.cpu / quota.cpu) * 100
        },
        memory: {
          used: usage.memory,
          quota: quota.memory,
          percentage: (usage.memory / quota.memory) * 100
        },
        concurrent: {
          used: usage.concurrent,
          quota: quota.maxConcurrent,
          percentage: (usage.concurrent / quota.maxConcurrent) * 100
        },
        processes: Array.from(usage.processes)
      };
    }
    
    // 全体の使用状況
    const totalUsage = {
      cpu: 0,
      memory: 0,
      concurrent: 0
    };
    
    for (const usage of this.projectUsage.values()) {
      totalUsage.cpu += usage.cpu;
      totalUsage.memory += usage.memory;
      totalUsage.concurrent += usage.concurrent;
    }
    
    return {
      system: {
        cpu: {
          total: this.systemResources.totalCpu,
          available: this.systemResources.availableCpu,
          used: totalUsage.cpu,
          percentage: (totalUsage.cpu / this.systemResources.totalCpu) * 100
        },
        memory: {
          total: this.systemResources.totalMemory,
          available: this.systemResources.availableMemory,
          used: totalUsage.memory,
          percentage: (totalUsage.memory / this.systemResources.totalMemory) * 100
        }
      },
      projects: this.getAllProjectUsage()
    };
  }

  /**
   * 全プロジェクトの使用状況を取得
   */
  getAllProjectUsage() {
    const projectUsage = {};
    
    for (const [projectId, usage] of this.projectUsage) {
      const quota = this.projectQuotas.get(projectId);
      if (!quota) continue;
      
      projectUsage[projectId] = {
        cpu: {
          used: usage.cpu,
          quota: quota.cpu,
          percentage: (usage.cpu / quota.cpu) * 100
        },
        memory: {
          used: usage.memory,
          quota: quota.memory,
          percentage: (usage.memory / quota.memory) * 100
        },
        concurrent: {
          used: usage.concurrent,
          quota: quota.maxConcurrent,
          percentage: (usage.concurrent / quota.maxConcurrent) * 100
        },
        processes: usage.processes.size
      };
    }
    
    return projectUsage;
  }

  /**
   * 動的なリソース再配分
   */
  async performDynamicReallocation() {
    if (!this.config.enableDynamicAllocation) {
      return;
    }
    
    this.logger.info('動的リソース再配分を開始します');
    
    // 各プロジェクトのパフォーマンスメトリクスを収集
    const projectMetrics = await this.collectPerformanceMetrics();
    
    // 再配分が必要かチェック
    const reallocationNeeded = this.checkReallocationNeed(projectMetrics);
    
    if (!reallocationNeeded) {
      this.logger.info('リソース再配分は不要です');
      return;
    }
    
    // 新しい割り当てを計算
    const newAllocations = this.calculateOptimalAllocations(projectMetrics);
    
    // 割り当てを適用
    await this.applyNewAllocations(newAllocations);
    
    // 履歴に記録
    this.allocationState.lastReallocation = Date.now();
    this.allocationState.allocationHistory.push({
      timestamp: Date.now(),
      type: 'dynamic',
      allocations: newAllocations
    });
    
    this.logger.info('動的リソース再配分を完了しました', { newAllocations });
    this.emit('resourcesReallocated', { allocations: newAllocations });
  }

  /**
   * パフォーマンスメトリクスを収集
   */
  async collectPerformanceMetrics() {
    const metrics = new Map();
    
    for (const [projectId, usage] of this.projectUsage) {
      const quota = this.projectQuotas.get(projectId);
      if (!quota) continue;
      
      // 使用率
      const cpuUtilization = usage.cpu / quota.cpu;
      const memoryUtilization = usage.memory / quota.memory;
      const concurrentUtilization = usage.concurrent / quota.maxConcurrent;
      
      // パフォーマンス指標（仮の値、実際はタスク完了率などから計算）
      const throughput = Math.random() * 100; // TODO: 実際のスループットを取得
      const latency = Math.random() * 1000; // TODO: 実際のレイテンシーを取得
      
      metrics.set(projectId, {
        cpuUtilization,
        memoryUtilization,
        concurrentUtilization,
        throughput,
        latency,
        priority: quota.priority
      });
    }
    
    return metrics;
  }

  /**
   * 再配分が必要かチェック
   */
  checkReallocationNeed(metrics) {
    // 使用率の偏りをチェック
    const utilizationValues = [];
    
    for (const metric of metrics.values()) {
      utilizationValues.push(metric.cpuUtilization);
    }
    
    if (utilizationValues.length < 2) {
      return false;
    }
    
    // 標準偏差を計算
    const mean = utilizationValues.reduce((a, b) => a + b) / utilizationValues.length;
    const variance = utilizationValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / utilizationValues.length;
    const stdDev = Math.sqrt(variance);
    
    // 標準偏差が0.2を超える場合は再配分が必要
    return stdDev > 0.2;
  }

  /**
   * 最適な割り当てを計算
   */
  calculateOptimalAllocations(metrics) {
    const allocations = new Map();
    
    // 総リソース量
    const totalCpu = this.systemResources.totalCpu * (1 - this.config.systemReservePercent / 100);
    const totalMemory = this.systemResources.totalMemory * (1 - this.config.systemReservePercent / 100);
    
    // 重み付き配分
    let totalWeight = 0;
    const weights = new Map();
    
    for (const [projectId, metric] of metrics) {
      // 優先度とパフォーマンスに基づく重み
      const weight = metric.priority * (1 + metric.throughput / 100);
      weights.set(projectId, weight);
      totalWeight += weight;
    }
    
    // 新しい割り当てを計算
    for (const [projectId, weight] of weights) {
      const ratio = weight / totalWeight;
      const currentQuota = this.projectQuotas.get(projectId);
      
      allocations.set(projectId, {
        cpu: Math.floor(totalCpu * ratio * 1000) / 1000, // 小数点3桁
        memory: Math.floor(totalMemory * ratio),
        maxConcurrent: Math.max(1, Math.floor(currentQuota.maxConcurrent * ratio * 2))
      });
    }
    
    return allocations;
  }

  /**
   * 新しい割り当てを適用
   */
  async applyNewAllocations(allocations) {
    for (const [projectId, allocation] of allocations) {
      const currentQuota = this.projectQuotas.get(projectId);
      if (!currentQuota) continue;
      
      // 段階的に変更（急激な変更を避ける）
      const smoothingFactor = 0.5;
      
      currentQuota.cpu = currentQuota.cpu * (1 - smoothingFactor) + allocation.cpu * smoothingFactor;
      currentQuota.memory = currentQuota.memory * (1 - smoothingFactor) + allocation.memory * smoothingFactor;
      currentQuota.maxConcurrent = Math.round(
        currentQuota.maxConcurrent * (1 - smoothingFactor) + allocation.maxConcurrent * smoothingFactor
      );
      
      this.logger.info('プロジェクトのクォータを更新しました', {
        projectId,
        newQuota: {
          cpu: currentQuota.cpu,
          memory: this.formatMemory(currentQuota.memory),
          maxConcurrent: currentQuota.maxConcurrent
        }
      });
    }
  }

  /**
   * リソースモニタリングを開始
   */
  async startMonitoring() {
    if (this.monitoringTimer) {
      return;
    }
    
    this.logger.info('リソースモニタリングを開始します');
    
    // 定期的なシステムリソース更新
    this.monitoringTimer = setInterval(async () => {
      try {
        await this.updateSystemResources();
        this.emit('resourcesUpdated', this.getResourceUsage());
      } catch (error) {
        this.logger.error('リソースモニタリングエラー:', error);
      }
    }, this.config.monitoringInterval);
    
    // 定期的な再配分
    if (this.config.enableDynamicAllocation) {
      this.reallocationTimer = setInterval(async () => {
        try {
          await this.performDynamicReallocation();
        } catch (error) {
          this.logger.error('リソース再配分エラー:', error);
        }
      }, this.config.reallocationInterval);
    }
  }

  /**
   * リソースモニタリングを停止
   */
  async stopMonitoring() {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
    
    if (this.reallocationTimer) {
      clearInterval(this.reallocationTimer);
      this.reallocationTimer = null;
    }
    
    this.logger.info('リソースモニタリングを停止しました');
  }

  /**
   * CPU値をパース
   */
  parseCpuValue(cpuString) {
    if (typeof cpuString === 'number') {
      return cpuString;
    }
    
    if (cpuString.endsWith('m')) {
      return parseInt(cpuString) / 1000;
    }
    return parseFloat(cpuString);
  }

  /**
   * メモリ値をパース
   */
  parseMemoryValue(memoryString) {
    if (typeof memoryString === 'number') {
      return memoryString;
    }
    
    const units = {
      'Ki': 1024,
      'Mi': 1024 * 1024,
      'Gi': 1024 * 1024 * 1024,
      'Ti': 1024 * 1024 * 1024 * 1024
    };
    
    for (const [unit, multiplier] of Object.entries(units)) {
      if (memoryString.endsWith(unit)) {
        return parseInt(memoryString) * multiplier;
      }
    }
    
    return parseInt(memoryString);
  }

  /**
   * メモリをフォーマット
   */
  formatMemory(bytes) {
    const units = ['B', 'Ki', 'Mi', 'Gi', 'Ti'];
    let value = bytes;
    let unitIndex = 0;
    
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    
    return `${value.toFixed(2)}${units[unitIndex]}`;
  }

  /**
   * デバッグ情報を取得
   */
  getDebugInfo() {
    return {
      config: this.config,
      systemResources: this.systemResources,
      projectQuotas: Object.fromEntries(this.projectQuotas),
      projectUsage: Object.fromEntries(this.projectUsage),
      processResourceMap: Object.fromEntries(this.processResourceMap),
      allocationState: this.allocationState
    };
  }
}

module.exports = ResourceManager;