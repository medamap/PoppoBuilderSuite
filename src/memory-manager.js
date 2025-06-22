/**
 * Memory Manager - Issue #123: メモリ使用量の監視と最適化機能の実装
 * 
 * Comprehensive memory monitoring and optimization system:
 * - Real-time memory usage tracking
 * - Memory leak detection
 * - Automatic garbage collection optimization
 * - Memory pressure response
 * - Heap dump generation and analysis
 */

const EventEmitter = require('events');
const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const v8 = require('v8');

class MemoryManager extends EventEmitter {
  constructor(config = {}, logger = null) {
    super();
    
    this.config = {
      enabled: config.enabled !== false,
      checkInterval: config.checkInterval || 60000, // 1 minute
      memoryThreshold: config.memoryThreshold || 500, // MB
      heapThreshold: config.heapThreshold || 0.85, // 85% of heap limit
      gcInterval: config.gcInterval || 300000, // 5 minutes
      leakDetectionSamples: config.leakDetectionSamples || 5,
      autoRecoveryEnabled: config.autoRecoveryEnabled !== false,
      heapSnapshotEnabled: config.heapSnapshotEnabled || false,
      heapSnapshotPath: config.heapSnapshotPath || './heap-snapshots',
      ...config
    };
    
    this.logger = logger;
    this.isRunning = false;
    this.intervals = [];
    
    // Memory tracking data
    this.memoryHistory = [];
    this.maxHistorySize = 100;
    this.lastGCTime = Date.now();
    
    // Memory statistics
    this.stats = {
      totalAllocations: 0,
      totalDeallocations: 0,
      gcCount: 0,
      leaksDetected: 0,
      recoveryActions: 0
    };
    
    // Leak detection state
    this.leakDetection = {
      consecutiveIncreases: 0,
      lastMemoryUsage: 0,
      suspiciousPatterns: []
    };
    
    // Event handlers
    this.setupEventHandlers();
    
    this.log('MemoryManager initialized', {
      config: this.config,
      nodeVersion: process.version,
      platform: process.platform
    });
  }
  
  /**
   * Start memory monitoring
   */
  async start() {
    if (this.isRunning || !this.config.enabled) {
      return;
    }
    
    this.isRunning = true;
    this.log('Starting memory monitoring...');
    
    // Create heap snapshot directory
    if (this.config.heapSnapshotEnabled) {
      await this.ensureHeapSnapshotDirectory();
    }
    
    // Start memory monitoring interval
    this.intervals.push(
      setInterval(() => this.collectMemoryMetrics(), this.config.checkInterval)
    );
    
    // Start automatic GC interval (if GC is exposed)
    if (global.gc && this.config.gcInterval > 0) {
      this.intervals.push(
        setInterval(() => this.performGarbageCollection(), this.config.gcInterval)
      );
    }
    
    // Start heap snapshot interval (if enabled)
    if (this.config.heapSnapshotEnabled && this.config.heapSnapshotInterval) {
      this.intervals.push(
        setInterval(() => this.takeHeapSnapshot(), this.config.heapSnapshotInterval)
      );
    }
    
    this.emit('started');
    this.log('Memory monitoring started successfully');
  }
  
  /**
   * Stop memory monitoring
   */
  stop() {
    if (!this.isRunning) {
      return;
    }
    
    this.isRunning = false;
    
    // Clear all intervals
    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals = [];
    
    this.emit('stopped');
    this.log('Memory monitoring stopped');
  }
  
  /**
   * Collect current memory metrics
   */
  collectMemoryMetrics() {
    try {
      const memUsage = process.memoryUsage();
      const systemMem = this.getSystemMemoryInfo();
      const heapStats = this.getHeapStatistics();
      
      const timestamp = Date.now();
      const memoryData = {
        timestamp,
        process: {
          rss: memUsage.rss,
          heapTotal: memUsage.heapTotal,
          heapUsed: memUsage.heapUsed,
          external: memUsage.external,
          arrayBuffers: memUsage.arrayBuffers
        },
        system: systemMem,
        heap: heapStats,
        gcStats: this.getGCStatistics()
      };
      
      // Add to history
      this.addToHistory(memoryData);
      
      // Check for memory pressure
      this.checkMemoryPressure(memoryData);
      
      // Check for memory leaks
      this.detectMemoryLeaks(memoryData);
      
      // Emit metrics event
      this.emit('metrics', memoryData);
      
      return memoryData;
      
    } catch (error) {
      this.log('Error collecting memory metrics', { error: error.message }, 'error');
      return null;
    }
  }
  
  /**
   * Get system memory information
   */
  getSystemMemoryInfo() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    return {
      total: totalMem,
      free: freeMem,
      used: usedMem,
      percentage: (usedMem / totalMem) * 100
    };
  }
  
  /**
   * Get V8 heap statistics
   */
  getHeapStatistics() {
    try {
      const heapStats = v8.getHeapStatistics();
      return {
        totalHeapSize: heapStats.total_heap_size,
        totalHeapSizeExecutable: heapStats.total_heap_size_executable,
        totalPhysicalSize: heapStats.total_physical_size,
        totalAvailableSize: heapStats.total_available_size,
        usedHeapSize: heapStats.used_heap_size,
        heapSizeLimit: heapStats.heap_size_limit,
        mallocedMemory: heapStats.malloced_memory,
        peakMallocedMemory: heapStats.peak_malloced_memory,
        doesZapGarbage: heapStats.does_zap_garbage
      };
    } catch (error) {
      this.log('Error getting heap statistics', { error: error.message }, 'error');
      return {};
    }
  }
  
  /**
   * Get garbage collection statistics
   */
  getGCStatistics() {
    try {
      const heapSpaceStats = v8.getHeapSpaceStatistics();
      return {
        heapSpaces: heapSpaceStats,
        gcCount: this.stats.gcCount
      };
    } catch (error) {
      return { gcCount: this.stats.gcCount };
    }
  }
  
  /**
   * Add memory data to history
   */
  addToHistory(memoryData) {
    this.memoryHistory.push(memoryData);
    
    // Keep only the last N entries
    if (this.memoryHistory.length > this.maxHistorySize) {
      this.memoryHistory.shift();
    }
  }
  
  /**
   * Check for memory pressure and trigger recovery if needed
   */
  checkMemoryPressure(memoryData) {
    const heapUsedMB = memoryData.process.heapUsed / 1024 / 1024;
    const heapTotalMB = memoryData.process.heapTotal / 1024 / 1024;
    const systemUsagePercent = memoryData.system.percentage;
    const heapUsagePercent = memoryData.process.heapUsed / memoryData.heap.heapSizeLimit;
    
    // Check various pressure indicators
    const pressureReasons = [];
    
    if (heapUsedMB > this.config.memoryThreshold) {
      pressureReasons.push(`Heap usage (${heapUsedMB.toFixed(1)}MB) exceeds threshold (${this.config.memoryThreshold}MB)`);
    }
    
    if (heapUsagePercent > this.config.heapThreshold) {
      pressureReasons.push(`Heap usage (${(heapUsagePercent * 100).toFixed(1)}%) exceeds heap threshold (${(this.config.heapThreshold * 100)}%)`);
    }
    
    if (systemUsagePercent > 90) {
      pressureReasons.push(`System memory usage (${systemUsagePercent.toFixed(1)}%) critically high`);
    }
    
    if (pressureReasons.length > 0) {
      this.handleMemoryPressure(memoryData, pressureReasons);
    }
  }
  
  /**
   * Handle memory pressure situations
   */
  async handleMemoryPressure(memoryData, reasons) {
    this.log('Memory pressure detected', { 
      reasons, 
      memoryData: {
        heapUsed: `${(memoryData.process.heapUsed / 1024 / 1024).toFixed(1)}MB`,
        systemUsage: `${memoryData.system.percentage.toFixed(1)}%`
      }
    }, 'warn');
    
    this.emit('memoryPressure', { memoryData, reasons });
    
    if (this.config.autoRecoveryEnabled) {
      await this.executeRecoveryActions(memoryData, reasons);
    }
  }
  
  /**
   * Execute automatic recovery actions
   */
  async executeRecoveryActions(memoryData, reasons) {
    this.log('Executing recovery actions...', {}, 'info');
    this.stats.recoveryActions++;
    
    const actions = [];
    
    try {
      // Action 1: Force garbage collection
      if (global.gc) {
        const beforeGC = process.memoryUsage().heapUsed;
        global.gc();
        const afterGC = process.memoryUsage().heapUsed;
        const freed = (beforeGC - afterGC) / 1024 / 1024;
        
        actions.push(`GC freed ${freed.toFixed(1)}MB`);
        this.stats.gcCount++;
        this.lastGCTime = Date.now();
      }
      
      // Action 2: Clear internal caches (emit event for other components)
      this.emit('clearCaches');
      actions.push('Cache clear requested');
      
      // Action 3: Take emergency heap snapshot
      if (this.config.heapSnapshotEnabled) {
        const snapshotPath = await this.takeHeapSnapshot('emergency');
        actions.push(`Emergency heap snapshot: ${snapshotPath}`);
      }
      
      // Action 4: Emit recovery event for external components
      this.emit('memoryRecovery', { 
        type: 'automatic',
        actions,
        memoryData,
        reasons
      });
      
      this.log('Recovery actions completed', { actions }, 'info');
      
    } catch (error) {
      this.log('Error during recovery actions', { error: error.message }, 'error');
    }
  }
  
  /**
   * Detect potential memory leaks
   */
  detectMemoryLeaks(memoryData) {
    const currentHeapUsed = memoryData.process.heapUsed;
    
    if (this.leakDetection.lastMemoryUsage > 0) {
      const increase = currentHeapUsed - this.leakDetection.lastMemoryUsage;
      const increasePercent = (increase / this.leakDetection.lastMemoryUsage) * 100;
      
      // Detect patterns
      if (increase > 0) {
        this.leakDetection.consecutiveIncreases++;
        
        // Check for sudden spike
        if (increasePercent > 50) {
          this.reportSuspiciousActivity('sudden_spike', {
            increase: `${(increase / 1024 / 1024).toFixed(1)}MB`,
            percentage: `${increasePercent.toFixed(1)}%`,
            timestamp: memoryData.timestamp
          });
        }
        
        // Check for consistent growth
        if (this.leakDetection.consecutiveIncreases >= this.config.leakDetectionSamples) {
          this.reportSuspiciousActivity('consistent_growth', {
            consecutiveIncreases: this.leakDetection.consecutiveIncreases,
            totalIncrease: `${((currentHeapUsed - this.memoryHistory[0]?.process.heapUsed || 0) / 1024 / 1024).toFixed(1)}MB`,
            timestamp: memoryData.timestamp
          });
        }
      } else {
        this.leakDetection.consecutiveIncreases = 0;
      }
    }
    
    this.leakDetection.lastMemoryUsage = currentHeapUsed;
  }
  
  /**
   * Report suspicious memory activity
   */
  reportSuspiciousActivity(type, details) {
    this.stats.leaksDetected++;
    
    const activity = {
      type,
      details,
      timestamp: Date.now()
    };
    
    this.leakDetection.suspiciousPatterns.push(activity);
    
    // Keep only recent patterns
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
    this.leakDetection.suspiciousPatterns = this.leakDetection.suspiciousPatterns
      .filter(pattern => pattern.timestamp > cutoff);
    
    this.log('Suspicious memory activity detected', activity, 'warn');
    this.emit('memoryLeak', activity);
  }
  
  /**
   * Perform garbage collection
   */
  performGarbageCollection() {
    if (!global.gc) {
      return null;
    }
    
    try {
      const before = process.memoryUsage();
      const startTime = Date.now();
      
      global.gc();
      
      const after = process.memoryUsage();
      const duration = Date.now() - startTime;
      const freed = (before.heapUsed - after.heapUsed) / 1024 / 1024;
      
      this.stats.gcCount++;
      this.lastGCTime = Date.now();
      
      const gcResult = {
        duration,
        freedMB: freed,
        before: {
          heapUsed: before.heapUsed,
          heapTotal: before.heapTotal
        },
        after: {
          heapUsed: after.heapUsed,
          heapTotal: after.heapTotal
        }
      };
      
      this.log('Garbage collection completed', gcResult, 'debug');
      this.emit('gc', gcResult);
      
      return gcResult;
      
    } catch (error) {
      this.log('Error during garbage collection', { error: error.message }, 'error');
      return null;
    }
  }
  
  /**
   * Take heap snapshot
   */
  async takeHeapSnapshot(suffix = '') {
    if (!this.config.heapSnapshotEnabled) {
      return null;
    }
    
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `heap-${timestamp}${suffix ? '-' + suffix : ''}.heapsnapshot`;
      const snapshotPath = path.join(this.config.heapSnapshotPath, filename);
      
      await this.ensureHeapSnapshotDirectory();
      
      v8.writeHeapSnapshot(snapshotPath);
      
      const stats = await fs.stat(snapshotPath);
      const sizeKB = Math.round(stats.size / 1024);
      
      this.log('Heap snapshot created', { 
        path: snapshotPath,
        size: `${sizeKB}KB`
      }, 'info');
      
      this.emit('heapSnapshot', { path: snapshotPath, size: stats.size });
      
      return snapshotPath;
      
    } catch (error) {
      this.log('Error taking heap snapshot', { error: error.message }, 'error');
      return null;
    }
  }
  
  /**
   * Ensure heap snapshot directory exists
   */
  async ensureHeapSnapshotDirectory() {
    try {
      await fs.mkdir(this.config.heapSnapshotPath, { recursive: true });
    } catch (error) {
      this.log('Error creating heap snapshot directory', { error: error.message }, 'error');
    }
  }
  
  /**
   * Get current memory status
   */
  getMemoryStatus() {
    const current = this.collectMemoryMetrics();
    const history = this.getMemoryHistory();
    
    return {
      current,
      history,
      stats: this.stats,
      config: this.config,
      isRunning: this.isRunning,
      leakDetection: {
        consecutiveIncreases: this.leakDetection.consecutiveIncreases,
        suspiciousPatterns: this.leakDetection.suspiciousPatterns.length,
        recentPatterns: this.leakDetection.suspiciousPatterns.slice(-5)
      }
    };
  }
  
  /**
   * Get memory history with analysis
   */
  getMemoryHistory(samples = 20) {
    const recentHistory = this.memoryHistory.slice(-samples);
    
    if (recentHistory.length < 2) {
      return { history: recentHistory, analysis: null };
    }
    
    // Calculate trends
    const first = recentHistory[0];
    const last = recentHistory[recentHistory.length - 1];
    const timeSpan = last.timestamp - first.timestamp;
    const heapGrowth = last.process.heapUsed - first.process.heapUsed;
    const avgHeapUsed = recentHistory.reduce((sum, entry) => sum + entry.process.heapUsed, 0) / recentHistory.length;
    
    return {
      history: recentHistory,
      analysis: {
        timeSpanMinutes: Math.round(timeSpan / 60000),
        heapGrowthMB: Math.round(heapGrowth / 1024 / 1024),
        avgHeapUsedMB: Math.round(avgHeapUsed / 1024 / 1024),
        trend: heapGrowth > 0 ? 'increasing' : 'stable'
      }
    };
  }
  
  /**
   * Generate memory report
   */
  generateReport() {
    const status = this.getMemoryStatus();
    const now = new Date();
    
    return {
      timestamp: now.toISOString(),
      system: {
        platform: process.platform,
        nodeVersion: process.version,
        arch: process.arch,
        uptime: process.uptime()
      },
      status,
      recommendations: this.generateRecommendations(status)
    };
  }
  
  /**
   * Generate optimization recommendations
   */
  generateRecommendations(status) {
    const recommendations = [];
    
    if (!status.current) {
      return recommendations;
    }
    
    const heapUsedMB = status.current.process.heapUsed / 1024 / 1024;
    const heapTotalMB = status.current.process.heapTotal / 1024 / 1024;
    const systemUsage = status.current.system.percentage;
    
    // Memory usage recommendations
    if (heapUsedMB > this.config.memoryThreshold) {
      recommendations.push({
        type: 'memory_high',
        priority: 'high',
        message: `Heap usage (${heapUsedMB.toFixed(1)}MB) exceeds threshold`,
        action: 'Consider reducing concurrent operations or increasing memory limit'
      });
    }
    
    if (systemUsage > 80) {
      recommendations.push({
        type: 'system_memory_high',
        priority: 'medium',
        message: `System memory usage at ${systemUsage.toFixed(1)}%`,
        action: 'Monitor other processes and consider scaling resources'
      });
    }
    
    // GC recommendations
    if (!global.gc) {
      recommendations.push({
        type: 'gc_not_exposed',
        priority: 'low',
        message: 'Garbage collection not exposed',
        action: 'Start with --expose-gc flag for better memory management'
      });
    }
    
    // Leak detection recommendations
    if (status.leakDetection.suspiciousPatterns > 0) {
      recommendations.push({
        type: 'potential_leak',
        priority: 'high',
        message: `${status.leakDetection.suspiciousPatterns} suspicious memory patterns detected`,
        action: 'Review recent code changes and enable heap snapshots for analysis'
      });
    }
    
    return recommendations;
  }
  
  /**
   * Setup event handlers
   */
  setupEventHandlers() {
    // Handle process signals for cleanup
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.log('Uncaught exception detected', { error: error.message }, 'error');
      if (this.config.heapSnapshotEnabled) {
        this.takeHeapSnapshot('uncaught-exception');
      }
    });
    
    // Handle unhandled rejections
    process.on('unhandledRejection', (reason) => {
      this.log('Unhandled rejection detected', { reason }, 'error');
      if (this.config.heapSnapshotEnabled) {
        this.takeHeapSnapshot('unhandled-rejection');
      }
    });
  }
  
  /**
   * Log messages with optional structured data
   */
  log(message, data = {}, level = 'info') {
    if (this.logger) {
      this.logger[level](`[MemoryManager] ${message}`, data);
    }
  }
  
  /**
   * Cleanup resources
   */
  destroy() {
    this.stop();
    this.removeAllListeners();
    this.memoryHistory = [];
    this.log('MemoryManager destroyed');
  }
}

module.exports = MemoryManager;