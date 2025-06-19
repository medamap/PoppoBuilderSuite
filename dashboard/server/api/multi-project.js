const express = require('express');
const router = express.Router();
const { createLogger } = require('../../../src/logger');

const logger = createLogger('MultiProjectAPI');

/**
 * マルチプロジェクト統合ダッシュボードAPI
 * プロジェクト横断的な情報表示と管理機能を提供
 */

// グローバル変数（実際はDBや別サービスから取得）
let advancedQueueManager = null;
let resourceManager = null;
let projectConfigManager = null;

/**
 * マネージャーのインスタンスを設定
 */
function setupManagers(managers) {
  advancedQueueManager = managers.advancedQueueManager;
  resourceManager = managers.resourceManager;
  projectConfigManager = managers.projectConfigManager;
}

/**
 * GET /api/multi-project/overview
 * 全プロジェクトの概要を取得
 */
router.get('/overview', async (req, res) => {
  try {
    if (!advancedQueueManager) {
      return res.status(503).json({ error: 'Queue manager not initialized' });
    }

    // キューの状態を取得
    const queueStatus = advancedQueueManager.getDetailedQueueStatus();
    
    // リソース使用状況を取得
    const resourceUsage = resourceManager ? resourceManager.getResourceUsage() : null;
    
    // プロジェクト設定サマリーを取得
    const configSummary = projectConfigManager ? 
      projectConfigManager.getConfigSummary() : null;
    
    // レスポンスを構築
    const overview = {
      timestamp: new Date().toISOString(),
      queue: {
        algorithm: queueStatus.algorithm,
        totalTasks: queueStatus.queueSize,
        runningTasks: queueStatus.runningTasks,
        projectCount: queueStatus.projects
      },
      resources: resourceUsage ? {
        system: resourceUsage.system,
        totalAllocated: {
          cpu: Object.values(resourceUsage.projects || {})
            .reduce((sum, p) => sum + (p.cpu?.used || 0), 0),
          memory: Object.values(resourceUsage.projects || {})
            .reduce((sum, p) => sum + (p.memory?.used || 0), 0)
        }
      } : null,
      projects: {},
      metrics: queueStatus.schedulingMetrics,
      statistics: queueStatus.statistics
    };
    
    // プロジェクト別の詳細情報
    for (const [projectId, stats] of Object.entries(queueStatus.projectStats || {})) {
      overview.projects[projectId] = {
        name: stats.name,
        priority: stats.priority,
        tasks: {
          queued: stats.queued,
          running: stats.running,
          completed: stats.statistics?.completedTasks || 0,
          failed: stats.statistics?.failedTasks || 0
        },
        resources: resourceUsage?.projects?.[projectId] || null,
        performance: {
          avgExecutionTime: stats.statistics?.averageExecutionTime || 0,
          avgWaitTime: stats.statistics?.averageWaitTime || 0,
          throughput: stats.metrics?.throughput || 0
        },
        config: configSummary?.projects?.[projectId] || null
      };
    }
    
    res.json(overview);
  } catch (error) {
    logger.error('Overview API error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/multi-project/projects
 * プロジェクト一覧を取得
 */
router.get('/projects', async (req, res) => {
  try {
    if (!advancedQueueManager) {
      return res.status(503).json({ error: 'Queue manager not initialized' });
    }

    const projects = [];
    const queueStatus = advancedQueueManager.getDetailedQueueStatus();
    
    for (const [projectId, project] of advancedQueueManager.projects) {
      const stats = queueStatus.projectStats?.[projectId] || {};
      const resourceUsage = resourceManager ? 
        resourceManager.getResourceUsage(projectId) : null;
      
      projects.push({
        id: projectId,
        name: project.name,
        path: project.path,
        priority: project.priority,
        config: project.config,
        status: {
          active: stats.running > 0,
          health: calculateProjectHealth(stats, resourceUsage)
        },
        statistics: {
          ...project.statistics,
          currentQueued: stats.queued || 0,
          currentRunning: stats.running || 0
        },
        resources: resourceUsage,
        registeredAt: project.registeredAt,
        lastActivity: project.lastActivity
      });
    }
    
    // ソートオプション
    const sortBy = req.query.sortBy || 'name';
    const sortOrder = req.query.sortOrder || 'asc';
    
    projects.sort((a, b) => {
      let aVal = a[sortBy];
      let bVal = b[sortBy];
      
      if (sortBy.includes('.')) {
        const keys = sortBy.split('.');
        aVal = keys.reduce((obj, key) => obj?.[key], a);
        bVal = keys.reduce((obj, key) => obj?.[key], b);
      }
      
      const result = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      return sortOrder === 'asc' ? result : -result;
    });
    
    res.json({
      total: projects.length,
      projects
    });
  } catch (error) {
    logger.error('Projects API error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/multi-project/project/:projectId
 * 特定プロジェクトの詳細を取得
 */
router.get('/project/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    
    if (!advancedQueueManager) {
      return res.status(503).json({ error: 'Queue manager not initialized' });
    }

    const project = advancedQueueManager.projects.get(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const queueStatus = advancedQueueManager.getDetailedQueueStatus();
    const stats = queueStatus.projectStats?.[projectId] || {};
    const resourceUsage = resourceManager ? 
      resourceManager.getResourceUsage(projectId) : null;
    const config = projectConfigManager ? 
      projectConfigManager.getProjectConfig(projectId) : null;
    
    // 実行中のタスクの詳細
    const runningTasks = Array.from(advancedQueueManager.runningTasks.values())
      .filter(task => task.projectId === projectId);
    
    // キュー内のタスクの詳細
    const queuedTasks = advancedQueueManager.queue
      .filter(task => task.projectId === projectId)
      .slice(0, 100); // 最大100件
    
    const projectDetail = {
      ...project,
      currentStatus: {
        queued: stats.queued || 0,
        running: stats.running || 0,
        active: stats.running > 0,
        health: calculateProjectHealth(stats, resourceUsage)
      },
      tasks: {
        running: runningTasks.map(task => ({
          id: task.id,
          issueNumber: task.issueNumber,
          priority: task.priority,
          startedAt: task.startedAt,
          duration: Date.now() - new Date(task.startedAt).getTime()
        })),
        queued: queuedTasks.map(task => ({
          id: task.id,
          issueNumber: task.issueNumber,
          priority: task.priority,
          effectivePriority: task.effectivePriority,
          enqueuedAt: task.enqueuedAt,
          waitTime: Date.now() - new Date(task.enqueuedAt).getTime()
        }))
      },
      resources: {
        usage: resourceUsage,
        allocation: resourceManager?.resourceAllocations.get(projectId)
      },
      configuration: config,
      metrics: {
        fairShareTokens: stats.fairShareTokens,
        ...stats.metrics
      }
    };
    
    res.json(projectDetail);
  } catch (error) {
    logger.error('Project detail API error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/multi-project/project
 * 新規プロジェクトを登録
 */
router.post('/project', async (req, res) => {
  try {
    const { id, name, path, priority, config } = req.body;
    
    if (!id || !name || !path) {
      return res.status(400).json({ 
        error: 'Required fields: id, name, path' 
      });
    }
    
    if (!advancedQueueManager) {
      return res.status(503).json({ error: 'Queue manager not initialized' });
    }
    
    // プロジェクトを登録
    const project = await advancedQueueManager.registerProject({
      id,
      name,
      path,
      priority: priority || 50,
      config: config || {}
    });
    
    // リソースクォータを設定
    if (resourceManager && config?.resourceQuota) {
      resourceManager.setProjectQuota(id, config.resourceQuota);
    }
    
    // プロジェクト設定を登録
    if (projectConfigManager) {
      await projectConfigManager.registerProjectConfig(id, config || {});
    }
    
    logger.info('New project registered', { projectId: id });
    res.status(201).json(project);
  } catch (error) {
    logger.error('Project registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/multi-project/project/:projectId/config
 * プロジェクト設定を更新
 */
router.put('/project/:projectId/config', async (req, res) => {
  try {
    const { projectId } = req.params;
    const updates = req.body;
    
    if (!projectConfigManager) {
      return res.status(503).json({ error: 'Config manager not initialized' });
    }
    
    const updatedConfig = await projectConfigManager.updateProjectConfig(
      projectId,
      updates
    );
    
    logger.info('Project config updated', { projectId });
    res.json(updatedConfig);
  } catch (error) {
    logger.error('Config update error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/multi-project/search
 * プロジェクト横断検索
 */
router.get('/search', async (req, res) => {
  try {
    const { 
      query,
      type = 'all',
      projectIds,
      status,
      priority,
      limit = 50
    } = req.query;
    
    if (!query) {
      return res.status(400).json({ error: 'Query parameter required' });
    }
    
    const results = {
      tasks: [],
      projects: []
    };
    
    // プロジェクトIDのフィルタ
    const filterProjectIds = projectIds ? projectIds.split(',') : null;
    
    // タスク検索
    if (type === 'all' || type === 'tasks') {
      // キュー内のタスク
      const queuedTasks = advancedQueueManager.queue
        .filter(task => {
          if (filterProjectIds && !filterProjectIds.includes(task.projectId)) {
            return false;
          }
          if (status && task.status !== status) {
            return false;
          }
          if (priority && task.priority < parseInt(priority)) {
            return false;
          }
          
          // クエリでマッチング
          return task.id.includes(query) || 
                 task.issueNumber.toString().includes(query) ||
                 JSON.stringify(task.metadata).includes(query);
        })
        .slice(0, limit);
      
      results.tasks.push(...queuedTasks.map(task => ({
        ...task,
        source: 'queue'
      })));
      
      // 実行中のタスク
      const runningTasks = Array.from(advancedQueueManager.runningTasks.values())
        .filter(task => {
          if (filterProjectIds && !filterProjectIds.includes(task.projectId)) {
            return false;
          }
          
          return task.id.includes(query) || 
                 task.issueNumber.toString().includes(query);
        })
        .slice(0, limit - results.tasks.length);
      
      results.tasks.push(...runningTasks.map(task => ({
        ...task,
        source: 'running'
      })));
    }
    
    // プロジェクト検索
    if (type === 'all' || type === 'projects') {
      const projects = Array.from(advancedQueueManager.projects.entries())
        .filter(([id, project]) => {
          if (filterProjectIds && !filterProjectIds.includes(id)) {
            return false;
          }
          
          return id.includes(query) || 
                 project.name.toLowerCase().includes(query.toLowerCase()) ||
                 project.path.includes(query);
        })
        .slice(0, limit)
        .map(([id, project]) => ({ id, ...project }));
      
      results.projects = projects;
    }
    
    res.json({
      query,
      type,
      results,
      total: {
        tasks: results.tasks.length,
        projects: results.projects.length
      }
    });
  } catch (error) {
    logger.error('Search API error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/multi-project/metrics
 * 統合メトリクスを取得
 */
router.get('/metrics', async (req, res) => {
  try {
    const { period = 'hour', projectIds } = req.query;
    
    if (!advancedQueueManager) {
      return res.status(503).json({ error: 'Queue manager not initialized' });
    }
    
    const filterProjectIds = projectIds ? projectIds.split(',') : null;
    const queueStatus = advancedQueueManager.getDetailedQueueStatus();
    
    // 統合メトリクス
    const metrics = {
      timestamp: new Date().toISOString(),
      period,
      summary: {
        totalProjects: queueStatus.projects,
        totalQueuedTasks: queueStatus.queueSize,
        totalRunningTasks: queueStatus.runningTasks,
        avgWaitTime: queueStatus.schedulingMetrics.avgWaitTime,
        avgExecutionTime: queueStatus.schedulingMetrics.avgExecutionTime,
        fairnessIndex: queueStatus.schedulingMetrics.fairnessIndex
      },
      resourceUtilization: queueStatus.statistics.resourceUtilization,
      projectMetrics: {}
    };
    
    // プロジェクト別メトリクス
    for (const [projectId, stats] of Object.entries(queueStatus.projectStats || {})) {
      if (filterProjectIds && !filterProjectIds.includes(projectId)) {
        continue;
      }
      
      metrics.projectMetrics[projectId] = {
        name: stats.name,
        priority: stats.priority,
        tasks: {
          queued: stats.queued,
          running: stats.running,
          completed: stats.statistics?.completedTasks || 0,
          failed: stats.statistics?.failedTasks || 0
        },
        performance: {
          avgExecutionTime: stats.statistics?.averageExecutionTime || 0,
          avgWaitTime: stats.statistics?.averageWaitTime || 0,
          successRate: calculateSuccessRate(stats.statistics)
        },
        resources: {
          cpuUtilization: stats.resourceAllocation ? 
            (stats.statistics?.resourceUsage?.avgCpu || 0) / 
            parseCpuValue(stats.resourceAllocation.cpu) * 100 : 0,
          memoryUtilization: stats.resourceAllocation ?
            (stats.statistics?.resourceUsage?.avgMemory || 0) / 
            parseMemoryValue(stats.resourceAllocation.memory) * 100 : 0
        }
      };
    }
    
    // KPIの計算
    metrics.kpis = calculateKPIs(metrics);
    
    res.json(metrics);
  } catch (error) {
    logger.error('Metrics API error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/multi-project/comparison
 * プロジェクト間の比較分析
 */
router.get('/comparison', async (req, res) => {
  try {
    const { projectIds, metrics = 'all' } = req.query;
    
    if (!projectIds) {
      return res.status(400).json({ error: 'projectIds parameter required' });
    }
    
    const ids = projectIds.split(',');
    const queueStatus = advancedQueueManager.getDetailedQueueStatus();
    
    const comparison = {
      timestamp: new Date().toISOString(),
      projects: {},
      rankings: {}
    };
    
    // 各プロジェクトのデータを収集
    for (const projectId of ids) {
      const project = advancedQueueManager.projects.get(projectId);
      const stats = queueStatus.projectStats?.[projectId];
      
      if (!project || !stats) continue;
      
      comparison.projects[projectId] = {
        name: project.name,
        priority: stats.priority,
        throughput: stats.statistics?.completedTasks || 0,
        avgExecutionTime: stats.statistics?.averageExecutionTime || 0,
        avgWaitTime: stats.statistics?.averageWaitTime || 0,
        successRate: calculateSuccessRate(stats.statistics),
        resourceEfficiency: calculateResourceEfficiency(stats),
        fairShareTokens: stats.fairShareTokens || 0
      };
    }
    
    // ランキングを計算
    const metricsList = metrics === 'all' ? 
      ['throughput', 'avgExecutionTime', 'avgWaitTime', 'successRate', 'resourceEfficiency'] :
      metrics.split(',');
    
    for (const metric of metricsList) {
      comparison.rankings[metric] = Object.entries(comparison.projects)
        .map(([id, data]) => ({ id, value: data[metric] }))
        .sort((a, b) => {
          // 実行時間と待機時間は小さい方が良い
          if (metric === 'avgExecutionTime' || metric === 'avgWaitTime') {
            return a.value - b.value;
          }
          return b.value - a.value;
        })
        .map((item, index) => ({ ...item, rank: index + 1 }));
    }
    
    res.json(comparison);
  } catch (error) {
    logger.error('Comparison API error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/multi-project/report
 * 統合レポートを生成
 */
router.post('/report', async (req, res) => {
  try {
    const {
      type = 'summary',
      format = 'json',
      period = 'day',
      projectIds,
      includeDetails = false
    } = req.body;
    
    const report = {
      metadata: {
        type,
        format,
        period,
        generatedAt: new Date().toISOString(),
        generator: 'PoppoBuilder Multi-Project Dashboard'
      },
      summary: {},
      projects: {},
      trends: {},
      recommendations: []
    };
    
    // データ収集
    const queueStatus = advancedQueueManager.getDetailedQueueStatus();
    const resourceUsage = resourceManager ? resourceManager.getResourceUsage() : null;
    
    // サマリー情報
    report.summary = {
      totalProjects: queueStatus.projects,
      totalTasksProcessed: queueStatus.statistics.totalProcessed,
      totalTasksFailed: queueStatus.statistics.totalFailed,
      overallSuccessRate: calculateOverallSuccessRate(queueStatus.statistics),
      systemUtilization: resourceUsage ? {
        cpu: resourceUsage.system.cpu.percentage,
        memory: resourceUsage.system.memory.percentage
      } : null,
      schedulingEfficiency: queueStatus.schedulingMetrics.fairnessIndex
    };
    
    // プロジェクト別詳細
    const filterProjectIds = projectIds ? projectIds.split(',') : null;
    
    for (const [projectId, project] of advancedQueueManager.projects) {
      if (filterProjectIds && !filterProjectIds.includes(projectId)) {
        continue;
      }
      
      const stats = queueStatus.projectStats?.[projectId];
      if (!stats) continue;
      
      report.projects[projectId] = {
        name: project.name,
        summary: {
          tasksCompleted: stats.statistics?.completedTasks || 0,
          tasksFailed: stats.statistics?.failedTasks || 0,
          avgExecutionTime: stats.statistics?.averageExecutionTime || 0,
          avgWaitTime: stats.statistics?.averageWaitTime || 0,
          successRate: calculateSuccessRate(stats.statistics)
        }
      };
      
      if (includeDetails) {
        report.projects[projectId].details = {
          configuration: project.config,
          resourceAllocation: stats.resourceAllocation,
          currentStatus: {
            queued: stats.queued,
            running: stats.running
          }
        };
      }
    }
    
    // トレンド分析
    if (type === 'detailed' || type === 'analytics') {
      report.trends = analyzeTrends(queueStatus.statistics.resourceUtilization);
    }
    
    // 推奨事項の生成
    report.recommendations = generateRecommendations(report);
    
    // フォーマット変換
    if (format === 'markdown') {
      const markdown = convertReportToMarkdown(report);
      res.type('text/markdown').send(markdown);
    } else if (format === 'csv') {
      const csv = convertReportToCSV(report);
      res.type('text/csv').send(csv);
    } else {
      res.json(report);
    }
  } catch (error) {
    logger.error('Report generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ヘルパー関数

/**
 * プロジェクトの健全性を計算
 */
function calculateProjectHealth(stats, resourceUsage) {
  let healthScore = 100;
  
  // タスクの詰まり具合
  if (stats.queued > 10) {
    healthScore -= Math.min(20, stats.queued - 10);
  }
  
  // リソース使用率
  if (resourceUsage) {
    if (resourceUsage.cpu?.percentage > 80) {
      healthScore -= 10;
    }
    if (resourceUsage.memory?.percentage > 80) {
      healthScore -= 10;
    }
  }
  
  // 失敗率
  const failureRate = stats.statistics?.failedTasks / 
    (stats.statistics?.completedTasks + stats.statistics?.failedTasks);
  if (failureRate > 0.1) {
    healthScore -= 20;
  }
  
  return {
    score: Math.max(0, healthScore),
    status: healthScore >= 80 ? 'healthy' : 
            healthScore >= 60 ? 'warning' : 'critical'
  };
}

/**
 * 成功率を計算
 */
function calculateSuccessRate(statistics) {
  if (!statistics) return 100;
  
  const total = statistics.completedTasks + statistics.failedTasks;
  if (total === 0) return 100;
  
  return (statistics.completedTasks / total) * 100;
}

/**
 * 全体の成功率を計算
 */
function calculateOverallSuccessRate(statistics) {
  const total = statistics.totalProcessed + statistics.totalFailed;
  if (total === 0) return 100;
  
  return (statistics.totalProcessed / total) * 100;
}

/**
 * リソース効率を計算
 */
function calculateResourceEfficiency(stats) {
  if (!stats.resourceAllocation) return 0;
  
  const cpuAllocation = parseCpuValue(stats.resourceAllocation.cpu);
  const cpuUsage = stats.statistics?.resourceUsage?.avgCpu || 0;
  const throughput = stats.statistics?.completedTasks || 0;
  
  if (cpuUsage === 0 || throughput === 0) return 0;
  
  // タスク完了数 / CPU使用量
  return (throughput / cpuUsage) * 100;
}

/**
 * KPIを計算
 */
function calculateKPIs(metrics) {
  const kpis = {
    overallEfficiency: 0,
    resourceUtilization: 0,
    taskSuccessRate: 0,
    schedulingFairness: metrics.summary.fairnessIndex * 100
  };
  
  // 全体効率の計算
  let totalCompleted = 0;
  let totalTime = 0;
  
  for (const project of Object.values(metrics.projectMetrics)) {
    totalCompleted += project.tasks.completed;
    totalTime += project.performance.avgExecutionTime * project.tasks.completed;
  }
  
  if (totalCompleted > 0) {
    kpis.overallEfficiency = (totalCompleted / (totalTime / 1000 / 60)) * 100; // タスク/分
  }
  
  // リソース使用率
  const latestUtilization = metrics.resourceUtilization?.[metrics.resourceUtilization.length - 1];
  if (latestUtilization) {
    const totalCpu = latestUtilization.cpu || 0;
    const systemCpu = 8; // 仮定値
    kpis.resourceUtilization = (totalCpu / systemCpu) * 100;
  }
  
  // タスク成功率
  let totalTasks = 0;
  let successfulTasks = 0;
  
  for (const project of Object.values(metrics.projectMetrics)) {
    totalTasks += project.tasks.completed + project.tasks.failed;
    successfulTasks += project.tasks.completed;
  }
  
  if (totalTasks > 0) {
    kpis.taskSuccessRate = (successfulTasks / totalTasks) * 100;
  }
  
  return kpis;
}

/**
 * トレンド分析
 */
function analyzeTrends(resourceUtilization) {
  if (!resourceUtilization || resourceUtilization.length < 2) {
    return {};
  }
  
  const trends = {
    cpu: { direction: 'stable', change: 0 },
    memory: { direction: 'stable', change: 0 },
    queueLength: { direction: 'stable', change: 0 }
  };
  
  // 最新のデータポイントと1時間前を比較
  const latest = resourceUtilization[resourceUtilization.length - 1];
  const oneHourAgo = resourceUtilization.find(u => 
    latest.timestamp - u.timestamp >= 3600000
  ) || resourceUtilization[0];
  
  // CPU傾向
  const cpuChange = latest.cpu - oneHourAgo.cpu;
  trends.cpu.change = cpuChange;
  trends.cpu.direction = cpuChange > 5 ? 'increasing' : 
                         cpuChange < -5 ? 'decreasing' : 'stable';
  
  // メモリ傾向
  const memoryChange = latest.memory - oneHourAgo.memory;
  trends.memory.change = memoryChange;
  trends.memory.direction = memoryChange > 1073741824 ? 'increasing' : // 1GB
                           memoryChange < -1073741824 ? 'decreasing' : 'stable';
  
  // キュー長傾向
  const queueChange = latest.queueLength - oneHourAgo.queueLength;
  trends.queueLength.change = queueChange;
  trends.queueLength.direction = queueChange > 10 ? 'increasing' : 
                                queueChange < -10 ? 'decreasing' : 'stable';
  
  return trends;
}

/**
 * 推奨事項を生成
 */
function generateRecommendations(report) {
  const recommendations = [];
  
  // プロジェクト別の推奨事項
  for (const [projectId, project] of Object.entries(report.projects)) {
    // 高い失敗率
    if (project.summary.successRate < 80) {
      recommendations.push({
        type: 'warning',
        projectId,
        category: 'reliability',
        message: `プロジェクト ${project.name} の失敗率が高くなっています (成功率: ${project.summary.successRate.toFixed(1)}%)`,
        action: 'エラーログを確認し、タイムアウト設定やリトライ設定を見直してください'
      });
    }
    
    // 長い待機時間
    if (project.summary.avgWaitTime > 300000) { // 5分以上
      recommendations.push({
        type: 'optimization',
        projectId,
        category: 'performance',
        message: `プロジェクト ${project.name} のタスク待機時間が長くなっています (平均: ${(project.summary.avgWaitTime / 60000).toFixed(1)}分)`,
        action: 'プロジェクトの優先度を上げるか、並行実行数を増やすことを検討してください'
      });
    }
  }
  
  // システム全体の推奨事項
  if (report.summary.systemUtilization?.cpu > 80) {
    recommendations.push({
      type: 'warning',
      category: 'resources',
      message: 'システムのCPU使用率が高くなっています',
      action: 'タスクの並行実行数を減らすか、システムリソースの拡張を検討してください'
    });
  }
  
  if (report.summary.schedulingEfficiency < 0.7) {
    recommendations.push({
      type: 'optimization',
      category: 'scheduling',
      message: 'スケジューリングの公平性が低下しています',
      action: 'プロジェクトの優先度設定を見直し、フェアシェアウェイトを調整してください'
    });
  }
  
  return recommendations;
}

/**
 * レポートをMarkdown形式に変換
 */
function convertReportToMarkdown(report) {
  let markdown = `# PoppoBuilder マルチプロジェクトレポート

生成日時: ${report.metadata.generatedAt}

## サマリー

- **総プロジェクト数**: ${report.summary.totalProjects}
- **処理済みタスク**: ${report.summary.totalTasksProcessed}
- **失敗タスク**: ${report.summary.totalTasksFailed}
- **全体成功率**: ${report.summary.overallSuccessRate.toFixed(1)}%
- **スケジューリング効率**: ${report.summary.schedulingEfficiency.toFixed(2)}

`;

  if (report.summary.systemUtilization) {
    markdown += `### システムリソース使用状況
- CPU: ${report.summary.systemUtilization.cpu.toFixed(1)}%
- メモリ: ${report.summary.systemUtilization.memory.toFixed(1)}%

`;
  }

  markdown += `## プロジェクト別サマリー

| プロジェクト | 完了 | 失敗 | 成功率 | 平均実行時間 | 平均待機時間 |
|------------|------|------|--------|------------|------------|
`;

  for (const [projectId, project] of Object.entries(report.projects)) {
    markdown += `| ${project.name} | ${project.summary.tasksCompleted} | ${project.summary.tasksFailed} | ${project.summary.successRate.toFixed(1)}% | ${(project.summary.avgExecutionTime / 1000).toFixed(1)}秒 | ${(project.summary.avgWaitTime / 1000).toFixed(1)}秒 |\n`;
  }

  if (report.recommendations.length > 0) {
    markdown += `
## 推奨事項

`;
    for (const rec of report.recommendations) {
      markdown += `### ${rec.type === 'warning' ? '⚠️' : '💡'} ${rec.message}
**カテゴリ**: ${rec.category}
**アクション**: ${rec.action}

`;
    }
  }

  return markdown;
}

/**
 * レポートをCSV形式に変換
 */
function convertReportToCSV(report) {
  const rows = [
    ['Project ID', 'Project Name', 'Tasks Completed', 'Tasks Failed', 'Success Rate', 'Avg Execution Time', 'Avg Wait Time']
  ];
  
  for (const [projectId, project] of Object.entries(report.projects)) {
    rows.push([
      projectId,
      project.name,
      project.summary.tasksCompleted,
      project.summary.tasksFailed,
      project.summary.successRate.toFixed(1),
      (project.summary.avgExecutionTime / 1000).toFixed(1),
      (project.summary.avgWaitTime / 1000).toFixed(1)
    ]);
  }
  
  return rows.map(row => row.join(',')).join('\n');
}

/**
 * CPU値をパース
 */
function parseCpuValue(cpuString) {
  if (typeof cpuString === 'number') return cpuString;
  if (!cpuString) return 0;
  
  if (cpuString.endsWith('m')) {
    return parseInt(cpuString) / 1000;
  }
  return parseFloat(cpuString);
}

/**
 * メモリ値をパース
 */
function parseMemoryValue(memoryString) {
  if (typeof memoryString === 'number') return memoryString;
  if (!memoryString) return 0;
  
  const units = {
    'Ki': 1024,
    'Mi': 1024 * 1024,
    'Gi': 1024 * 1024 * 1024
  };
  
  for (const [unit, multiplier] of Object.entries(units)) {
    if (memoryString.endsWith(unit)) {
      return parseInt(memoryString) * multiplier;
    }
  }
  
  return parseInt(memoryString);
}

module.exports = { router, setupManagers };