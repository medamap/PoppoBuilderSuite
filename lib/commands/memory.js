/**
 * Memory Command - Issue #123
 * CLI interface for memory monitoring and optimization
 */

const chalk = require('chalk');
const MemoryManager = require('../../src/memory-manager');

class MemoryCommand {
  constructor() {
    this.memoryManager = null;
  }

  async execute(action = 'status', options = {}) {
    try {
      switch (action) {
        case 'status':
        case 'show':
          await this.showMemoryStatus(options);
          break;
        case 'monitor':
          await this.startMonitoring(options);
          break;
        case 'gc':
        case 'garbage-collect':
          await this.forceGarbageCollection();
          break;
        case 'snapshot':
          await this.takeHeapSnapshot(options);
          break;
        case 'report':
          await this.generateReport(options);
          break;
        case 'history':
          await this.showMemoryHistory(options);
          break;
        case 'analyze':
          await this.analyzeMemoryUsage(options);
          break;
        case 'optimize':
          await this.optimizeMemory(options);
          break;
        default:
          this.showUsage();
      }
    } catch (error) {
      console.error(chalk.red('Memory command error:'), error.message);
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  }

  /**
   * Show current memory status
   */
  async showMemoryStatus(options) {
    console.log(chalk.bold('\n🔍 Memory Status'));
    console.log(chalk.gray('─'.repeat(60)));

    const memUsage = process.memoryUsage();
    const osMemory = this.getSystemMemoryInfo();

    // Process Memory
    console.log(chalk.cyan('\nProcess Memory:'));
    const processData = [
      ['RSS (Resident Set Size)', this.formatBytes(memUsage.rss)],
      ['Heap Total', this.formatBytes(memUsage.heapTotal)],
      ['Heap Used', this.formatBytes(memUsage.heapUsed)],
      ['External', this.formatBytes(memUsage.external)],
      ['Array Buffers', this.formatBytes(memUsage.arrayBuffers || 0)]
    ];

    // Display process data in a simple table format
    processData.forEach(([metric, value]) => {
      console.log(`  ${chalk.cyan(metric.padEnd(25))}: ${chalk.white(value)}`);
    });

    // System Memory
    console.log(chalk.cyan('System Memory:'));
    const systemData = [
      ['Total', this.formatBytes(osMemory.total)],
      ['Free', this.formatBytes(osMemory.free)],
      ['Used', this.formatBytes(osMemory.used)],
      ['Usage %', `${osMemory.percentage.toFixed(1)}%`]
    ];

    // Display system data in a simple format
    systemData.forEach(([metric, value]) => {
      console.log(`  ${chalk.cyan(metric.padEnd(25))}: ${chalk.white(value)}`);
    });

    // Heap Statistics (if available)
    try {
      const v8 = require('v8');
      const heapStats = v8.getHeapStatistics();
      
      console.log(chalk.cyan('V8 Heap Statistics:'));
      const heapData = [
        ['Heap Size Limit', this.formatBytes(heapStats.heap_size_limit)],
        ['Total Heap Size', this.formatBytes(heapStats.total_heap_size)],
        ['Used Heap Size', this.formatBytes(heapStats.used_heap_size)],
        ['Total Physical Size', this.formatBytes(heapStats.total_physical_size)],
        ['Malloced Memory', this.formatBytes(heapStats.malloced_memory)]
      ];

      // Display heap data in a simple format
      heapData.forEach(([metric, value]) => {
        console.log(`  ${chalk.cyan(metric.padEnd(25))}: ${chalk.white(value)}`);
      });

      // Heap usage percentage
      const heapUsagePercent = (heapStats.used_heap_size / heapStats.heap_size_limit) * 100;
      const heapColor = heapUsagePercent > 85 ? chalk.red : heapUsagePercent > 70 ? chalk.yellow : chalk.green;
      console.log(`${chalk.cyan('Heap Usage:')} ${heapColor(heapUsagePercent.toFixed(1) + '%')}`);

    } catch (error) {
      console.log(chalk.dim('V8 heap statistics not available'));
    }

    // Memory manager status (if available)
    if (this.memoryManager) {
      const status = this.memoryManager.getMemoryStatus();
      console.log(chalk.cyan('\nMemory Manager:'));
      console.log(`Status: ${status.isRunning ? chalk.green('Running') : chalk.red('Stopped')}`);
      console.log(`GC Count: ${status.stats.gcCount}`);
      console.log(`Leaks Detected: ${status.stats.leaksDetected}`);
      console.log(`Recovery Actions: ${status.stats.recoveryActions}`);
    }

    if (options.json) {
      console.log('\n' + chalk.dim('JSON Output:'));
      console.log(JSON.stringify({
        process: memUsage,
        system: osMemory,
        timestamp: new Date().toISOString()
      }, null, 2));
    }
  }

  /**
   * Start real-time memory monitoring
   */
  async startMonitoring(options) {
    console.log(chalk.bold('🔄 Starting Memory Monitoring'));
    console.log(chalk.gray('Press Ctrl+C to stop\n'));

    const interval = options.interval || 5000; // 5 seconds default
    const showGraph = options.graph || false;

    let history = [];
    const maxHistory = 20;

    const monitor = setInterval(() => {
      const memUsage = process.memoryUsage();
      const timestamp = new Date();
      
      // Clear screen (optional)
      if (options.clear) {
        console.clear();
      }

      console.log(`${chalk.dim(timestamp.toLocaleTimeString())} - ${chalk.cyan('Heap:')} ${this.formatBytes(memUsage.heapUsed)} / ${this.formatBytes(memUsage.heapTotal)}`);

      if (showGraph) {
        history.push(memUsage.heapUsed);
        if (history.length > maxHistory) {
          history.shift();
        }
        this.drawSimpleGraph(history);
      }

    }, interval);

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      clearInterval(monitor);
      console.log(chalk.yellow('\n\nMonitoring stopped.'));
      process.exit(0);
    });
  }

  /**
   * Force garbage collection
   */
  async forceGarbageCollection() {
    if (!global.gc) {
      console.log(chalk.yellow('⚠️  Garbage collection not exposed'));
      console.log(chalk.dim('Start Node.js with --expose-gc flag to enable manual GC'));
      return;
    }

    console.log(chalk.bold('🗑️  Forcing Garbage Collection...'));
    
    const before = process.memoryUsage();
    const startTime = Date.now();
    
    global.gc();
    
    const after = process.memoryUsage();
    const duration = Date.now() - startTime;
    const freed = before.heapUsed - after.heapUsed;

    console.log(chalk.green('✅ Garbage collection completed'));
    console.log(`Duration: ${duration}ms`);
    console.log(`Memory freed: ${this.formatBytes(freed)}`);
    console.log(`Heap before: ${this.formatBytes(before.heapUsed)}`);
    console.log(`Heap after: ${this.formatBytes(after.heapUsed)}`);
  }

  /**
   * Take heap snapshot
   */
  async takeHeapSnapshot(options) {
    try {
      const v8 = require('v8');
      
      console.log(chalk.bold('📸 Taking Heap Snapshot...'));
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `heap-snapshot-${timestamp}.heapsnapshot`;
      const outputPath = options.output || `./heap-snapshots/${filename}`;
      
      // Ensure directory exists
      const fs = require('fs');
      const path = require('path');
      const dir = path.dirname(outputPath);
      
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      v8.writeHeapSnapshot(outputPath);
      
      const stats = fs.statSync(outputPath);
      const sizeKB = Math.round(stats.size / 1024);
      
      console.log(chalk.green('✅ Heap snapshot created'));
      console.log(`File: ${outputPath}`);
      console.log(`Size: ${sizeKB}KB`);
      console.log(chalk.dim('\nTo analyze:'));
      console.log(chalk.dim('1. Open Chrome DevTools'));
      console.log(chalk.dim('2. Go to Memory tab'));
      console.log(chalk.dim('3. Load the .heapsnapshot file'));
      
    } catch (error) {
      console.error(chalk.red('❌ Failed to create heap snapshot:'), error.message);
    }
  }

  /**
   * Generate memory report
   */
  async generateReport(options) {
    console.log(chalk.bold('📊 Generating Memory Report...'));

    const report = {
      timestamp: new Date().toISOString(),
      system: {
        platform: process.platform,
        nodeVersion: process.version,
        arch: process.arch,
        uptime: process.uptime()
      },
      memory: {
        process: process.memoryUsage(),
        system: this.getSystemMemoryInfo()
      }
    };

    // Add V8 heap statistics if available
    try {
      const v8 = require('v8');
      report.memory.heap = v8.getHeapStatistics();
      report.memory.heapSpaces = v8.getHeapSpaceStatistics();
    } catch (error) {
      // V8 stats not available
    }

    // Add memory manager data if available
    if (this.memoryManager) {
      report.memoryManager = this.memoryManager.getMemoryStatus();
    }

    const outputFormat = options.format || 'json';
    const outputFile = options.output || `memory-report-${Date.now()}.${outputFormat}`;

    if (outputFormat === 'json') {
      const fs = require('fs').promises;
      await fs.writeFile(outputFile, JSON.stringify(report, null, 2));
      console.log(chalk.green(`✅ JSON report saved: ${outputFile}`));
    } else if (outputFormat === 'markdown') {
      const markdown = this.generateMarkdownReport(report);
      const fs = require('fs').promises;
      await fs.writeFile(outputFile.replace('.json', '.md'), markdown);
      console.log(chalk.green(`✅ Markdown report saved: ${outputFile.replace('.json', '.md')}`));
    }

    if (!options.quiet) {
      console.log('\n' + chalk.bold('📈 Memory Summary:'));
      console.log(`Heap Used: ${this.formatBytes(report.memory.process.heapUsed)}`);
      console.log(`RSS: ${this.formatBytes(report.memory.process.rss)}`);
      console.log(`System Usage: ${report.memory.system.percentage.toFixed(1)}%`);
    }
  }

  /**
   * Show memory history
   */
  async showMemoryHistory(options) {
    if (!this.memoryManager) {
      console.log(chalk.yellow('⚠️  Memory manager not available'));
      console.log(chalk.dim('Start with memory monitoring enabled to view history'));
      return;
    }

    const { history, analysis } = this.memoryManager.getMemoryHistory(options.samples || 20);
    
    console.log(chalk.bold('📈 Memory Usage History'));
    console.log(chalk.gray('─'.repeat(60)));

    if (history.length === 0) {
      console.log(chalk.dim('No memory history available'));
      return;
    }

    // Show recent entries
    history.slice(-10).forEach(entry => {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      const heap = this.formatBytes(entry.process.heapUsed);
      const rss = this.formatBytes(entry.process.rss);
      console.log(`${chalk.dim(time)} - Heap: ${chalk.cyan(heap)}, RSS: ${chalk.blue(rss)}`);
    });

    if (analysis) {
      console.log(chalk.bold('\n📊 Analysis:'));
      console.log(`Time span: ${analysis.timeSpanMinutes} minutes`);
      console.log(`Heap growth: ${this.formatBytes(analysis.heapGrowthMB * 1024 * 1024)}`);
      console.log(`Average heap: ${this.formatBytes(analysis.avgHeapUsedMB * 1024 * 1024)}`);
      console.log(`Trend: ${analysis.trend === 'increasing' ? chalk.red('📈 Increasing') : chalk.green('📊 Stable')}`);
    }
  }

  /**
   * Analyze memory usage patterns
   */
  async analyzeMemoryUsage(options) {
    console.log(chalk.bold('🔬 Memory Usage Analysis'));
    console.log(chalk.gray('─'.repeat(60)));

    const memUsage = process.memoryUsage();
    const recommendations = [];

    // Analyze heap usage
    try {
      const v8 = require('v8');
      const heapStats = v8.getHeapStatistics();
      const heapUsagePercent = (heapStats.used_heap_size / heapStats.heap_size_limit) * 100;

      console.log(chalk.cyan('\n🧮 Heap Analysis:'));
      
      if (heapUsagePercent > 85) {
        console.log(chalk.red(`⚠️  High heap usage: ${heapUsagePercent.toFixed(1)}%`));
        recommendations.push('Consider increasing heap size with --max-old-space-size');
        recommendations.push('Review code for memory leaks');
      } else if (heapUsagePercent > 70) {
        console.log(chalk.yellow(`⚡ Moderate heap usage: ${heapUsagePercent.toFixed(1)}%`));
        recommendations.push('Monitor heap growth over time');
      } else {
        console.log(chalk.green(`✅ Normal heap usage: ${heapUsagePercent.toFixed(1)}%`));
      }

      // Analyze heap spaces
      const heapSpaces = v8.getHeapSpaceStatistics();
      console.log(chalk.cyan('\n📦 Heap Space Breakdown:'));
      heapSpaces.forEach(space => {
        const usagePercent = (space.space_used_size / space.space_size) * 100;
        const color = usagePercent > 80 ? chalk.red : usagePercent > 60 ? chalk.yellow : chalk.green;
        console.log(`  ${space.space_name}: ${color(usagePercent.toFixed(1) + '%')} (${this.formatBytes(space.space_used_size)})`);
      });

    } catch (error) {
      console.log(chalk.dim('V8 heap analysis not available'));
    }

    // GC recommendations
    console.log(chalk.cyan('\n🗑️  Garbage Collection:'));
    if (!global.gc) {
      console.log(chalk.yellow('⚠️  Manual GC not available'));
      recommendations.push('Start with --expose-gc for manual garbage collection');
    } else {
      console.log(chalk.green('✅ Manual GC available'));
    }

    // System memory analysis
    const osMemory = this.getSystemMemoryInfo();
    console.log(chalk.cyan('\n💻 System Memory:'));
    if (osMemory.percentage > 90) {
      console.log(chalk.red(`⚠️  Critical system memory usage: ${osMemory.percentage.toFixed(1)}%`));
      recommendations.push('System memory critically low - consider adding more RAM');
    } else if (osMemory.percentage > 80) {
      console.log(chalk.yellow(`⚡ High system memory usage: ${osMemory.percentage.toFixed(1)}%`));
      recommendations.push('Monitor system memory usage');
    } else {
      console.log(chalk.green(`✅ Normal system memory usage: ${osMemory.percentage.toFixed(1)}%`));
    }

    // Show recommendations
    if (recommendations.length > 0) {
      console.log(chalk.bold('\n💡 Recommendations:'));
      recommendations.forEach((rec, index) => {
        console.log(`${chalk.cyan((index + 1) + '.')} ${rec}`);
      });
    } else {
      console.log(chalk.green('\n✅ No immediate memory concerns detected'));
    }
  }

  /**
   * Optimize memory usage
   */
  async optimizeMemory(options) {
    console.log(chalk.bold('⚡ Memory Optimization'));
    console.log(chalk.gray('─'.repeat(60)));

    const actions = [];

    // Force garbage collection if available
    if (global.gc) {
      console.log('🗑️  Running garbage collection...');
      const before = process.memoryUsage().heapUsed;
      global.gc();
      const after = process.memoryUsage().heapUsed;
      const freed = before - after;
      
      if (freed > 0) {
        console.log(chalk.green(`✅ Freed ${this.formatBytes(freed)} through GC`));
        actions.push(`GC freed ${this.formatBytes(freed)}`);
      } else {
        console.log(chalk.dim('No memory freed through GC'));
      }
    }

    // Clear require cache (if requested)
    if (options.clearCache) {
      console.log('🧹 Clearing require cache...');
      const beforeCount = Object.keys(require.cache).length;
      Object.keys(require.cache).forEach(key => {
        delete require.cache[key];
      });
      const afterCount = Object.keys(require.cache).length;
      console.log(chalk.green(`✅ Cleared ${beforeCount - afterCount} cached modules`));
      actions.push(`Cleared ${beforeCount - afterCount} cached modules`);
    }

    // Set process priority (if requested)
    if (options.lowPriority) {
      try {
        process.setpriority && process.setpriority(10); // Lower priority
        console.log(chalk.green('✅ Set process to low priority'));
        actions.push('Set low priority');
      } catch (error) {
        console.log(chalk.yellow('⚠️  Could not set process priority'));
      }
    }

    if (actions.length === 0) {
      console.log(chalk.yellow('⚠️  No optimization actions taken'));
      console.log(chalk.dim('Use --clear-cache or --low-priority for more aggressive optimization'));
    } else {
      console.log(chalk.green(`\n✅ Optimization completed: ${actions.join(', ')}`));
    }
  }

  /**
   * Get system memory information
   */
  getSystemMemoryInfo() {
    const os = require('os');
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
   * Format bytes to human readable format
   */
  formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
  }

  /**
   * Draw simple ASCII graph
   */
  drawSimpleGraph(data) {
    const width = 40;
    const height = 8;
    
    if (data.length < 2) return;
    
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    
    console.log(chalk.dim('\nMemory Usage Graph:'));
    for (let y = height - 1; y >= 0; y--) {
      let line = '';
      for (let x = 0; x < Math.min(data.length, width); x++) {
        const value = data[data.length - width + x] || data[x];
        const normalized = (value - min) / range;
        const level = normalized * (height - 1);
        
        if (Math.round(level) === y) {
          line += '█';
        } else {
          line += ' ';
        }
      }
      console.log(chalk.cyan(line));
    }
    console.log(chalk.dim('─'.repeat(Math.min(data.length, width))));
  }

  /**
   * Generate markdown report
   */
  generateMarkdownReport(report) {
    const timestamp = new Date(report.timestamp).toLocaleString();
    
    return `# Memory Report

Generated: ${timestamp}

## System Information
- Platform: ${report.system.platform}
- Node.js: ${report.system.nodeVersion}
- Architecture: ${report.system.arch}
- Uptime: ${Math.round(report.system.uptime)}s

## Process Memory
- RSS: ${this.formatBytes(report.memory.process.rss)}
- Heap Total: ${this.formatBytes(report.memory.process.heapTotal)}
- Heap Used: ${this.formatBytes(report.memory.process.heapUsed)}
- External: ${this.formatBytes(report.memory.process.external)}

## System Memory
- Total: ${this.formatBytes(report.memory.system.total)}
- Free: ${this.formatBytes(report.memory.system.free)}
- Used: ${this.formatBytes(report.memory.system.used)}
- Usage: ${report.memory.system.percentage.toFixed(1)}%

${report.memory.heap ? `## V8 Heap Statistics
- Heap Size Limit: ${this.formatBytes(report.memory.heap.heap_size_limit)}
- Total Heap Size: ${this.formatBytes(report.memory.heap.total_heap_size)}
- Used Heap Size: ${this.formatBytes(report.memory.heap.used_heap_size)}
- Total Physical Size: ${this.formatBytes(report.memory.heap.total_physical_size)}
` : ''}

${report.memoryManager ? `## Memory Manager Status
- Running: ${report.memoryManager.isRunning}
- GC Count: ${report.memoryManager.stats.gcCount}
- Leaks Detected: ${report.memoryManager.stats.leaksDetected}
- Recovery Actions: ${report.memoryManager.stats.recoveryActions}
` : ''}
`;
  }

  /**
   * Show usage information
   */
  showUsage() {
    console.log(`
${chalk.bold('Usage:')}
  poppobuilder memory [action] [options]

${chalk.bold('Actions:')}
  status                       Show current memory status (default)
  monitor                      Start real-time memory monitoring
  gc                          Force garbage collection
  snapshot                    Take heap snapshot
  report                      Generate detailed memory report
  history                     Show memory usage history
  analyze                     Analyze memory usage patterns
  optimize                    Optimize memory usage

${chalk.bold('Options:')}
  --json                      Output in JSON format
  --interval <ms>             Monitoring interval (default: 5000)
  --graph                     Show simple graph in monitor mode
  --clear                     Clear screen in monitor mode
  --output <file>             Output file for reports/snapshots
  --format <format>           Report format (json, markdown)
  --samples <n>               Number of history samples
  --clear-cache               Clear require cache during optimization
  --low-priority              Set process to low priority
  --quiet                     Minimal output
  --verbose                   Verbose output

${chalk.bold('Examples:')}
  poppobuilder memory                          # Show memory status
  poppobuilder memory monitor --interval 2000 # Monitor every 2 seconds
  poppobuilder memory monitor --graph          # Monitor with graph
  poppobuilder memory gc                       # Force garbage collection
  poppobuilder memory snapshot                 # Take heap snapshot
  poppobuilder memory report --format markdown # Generate markdown report
  poppobuilder memory analyze                  # Analyze memory patterns
  poppobuilder memory optimize --clear-cache   # Optimize with cache clear
`);
  }
}

module.exports = MemoryCommand;