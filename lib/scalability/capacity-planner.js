/**
 * Issue #136: Capacity Planning System
 * 
 * Intelligent capacity planning with:
 * - Resource requirement prediction
 * - Scaling recommendations
 * - Cost optimization
 * - Performance forecasting
 * - Bottleneck analysis
 * - Auto-scaling configuration
 */

const ProductionLogger = require('../utils/production-logger');

class CapacityPlanner {
  constructor(options = {}) {
    this.options = {
      forecastHorizon: options.forecastHorizon || 30, // days
      confidenceLevel: options.confidenceLevel || 0.95,
      scalingBuffer: options.scalingBuffer || 0.2, // 20% buffer
      costPerCore: options.costPerCore || 0.05, // per hour
      costPerGB: options.costPerGB || 0.01, // per hour
      targetUtilization: options.targetUtilization || 0.75, // 75%
      ...options
    };
    
    this.logger = new ProductionLogger('CapacityPlanner', {
      enableStructuredLogging: true,
      enablePerformanceTracking: true
    });
    
    this.historicalData = [];
    this.capacityModels = new Map();
    this.scalingPolicies = new Map();
    this.costModel = null;
    
    this.initializeCapacityModels();
    this.initializeCostModel();
  }

  /**
   * Initialize capacity prediction models
   */
  initializeCapacityModels() {
    // CPU capacity model
    this.capacityModels.set('cpu', {
      name: 'CPU Capacity Model',
      type: 'resource',
      thresholds: {
        warning: 70,
        critical: 85,
        maximum: 95
      },
      scalingFactor: 1.5,
      minimumInstances: 1,
      maximumInstances: 10
    });
    
    // Memory capacity model
    this.capacityModels.set('memory', {
      name: 'Memory Capacity Model',
      type: 'resource',
      thresholds: {
        warning: 75,
        critical: 90,
        maximum: 95
      },
      scalingFactor: 1.3,
      minimumInstances: 1,
      maximumInstances: 8
    });
    
    // Request throughput model
    this.capacityModels.set('throughput', {
      name: 'Throughput Capacity Model',
      type: 'performance',
      thresholds: {
        warning: 1000, // requests/minute
        critical: 1500,
        maximum: 2000
      },
      scalingFactor: 2.0,
      minimumInstances: 1,
      maximumInstances: 15
    });
    
    // Response time model
    this.capacityModels.set('response_time', {
      name: 'Response Time Model',
      type: 'performance',
      thresholds: {
        warning: 500, // milliseconds
        critical: 1000,
        maximum: 2000
      },
      scalingFactor: 1.8,
      minimumInstances: 1,
      maximumInstances: 12
    });
  }

  /**
   * Initialize cost optimization model
   */
  initializeCostModel() {
    this.costModel = {
      resourceCosts: {
        cpu: this.options.costPerCore,
        memory: this.options.costPerGB,
        storage: 0.001, // per GB per hour
        network: 0.0001 // per GB transferred
      },
      instanceTypes: [
        {
          name: 'micro',
          cpu: 1,
          memory: 1,
          cost: 0.01,
          suitableFor: ['development', 'testing']
        },
        {
          name: 'small',
          cpu: 2,
          memory: 4,
          cost: 0.05,
          suitableFor: ['small-production', 'staging']
        },
        {
          name: 'medium',
          cpu: 4,
          memory: 8,
          cost: 0.10,
          suitableFor: ['medium-production']
        },
        {
          name: 'large',
          cpu: 8,
          memory: 16,
          cost: 0.20,
          suitableFor: ['large-production', 'high-load']
        },
        {
          name: 'xlarge',
          cpu: 16,
          memory: 32,
          cost: 0.40,
          suitableFor: ['enterprise', 'high-performance']
        }
      ],
      scalingCosts: {
        autoScalingOverhead: 0.05, // 5% overhead
        manualScalingCost: 2.0 // per scaling event
      }
    };
  }

  /**
   * Analyze current capacity requirements
   */
  async analyzeCurrentCapacity(performanceData) {
    try {
      await this.logger.logStructured('info', 'Starting capacity analysis', {
        component: 'CapacityAnalysis',
        dataPoints: performanceData.length
      });
      
      const analysis = {
        timestamp: new Date().toISOString(),
        currentUtilization: this.calculateCurrentUtilization(performanceData),
        resourceAnalysis: this.analyzeResourceRequirements(performanceData),
        performanceAnalysis: this.analyzePerformanceRequirements(performanceData),
        bottleneckAnalysis: this.identifyBottlenecks(performanceData),
        scalingRecommendations: [],
        costAnalysis: null
      };
      
      // Generate scaling recommendations
      analysis.scalingRecommendations = await this.generateScalingRecommendations(analysis);
      
      // Perform cost analysis
      analysis.costAnalysis = this.performCostAnalysis(analysis);
      
      await this.logger.logStructured('info', 'Capacity analysis completed', {
        component: 'CapacityAnalysis',
        recommendations: analysis.scalingRecommendations.length,
        bottlenecks: analysis.bottleneckAnalysis.length
      });
      
      return analysis;
      
    } catch (error) {
      await this.logger.error('Capacity analysis failed', { error });
      throw error;
    }
  }

  /**
   * Calculate current resource utilization
   */
  calculateCurrentUtilization(performanceData) {
    if (!performanceData || performanceData.length === 0) {
      return {
        cpu: 0,
        memory: 0,
        throughput: 0,
        responseTime: 0
      };
    }
    
    const recent = performanceData.slice(-60); // Last hour
    
    return {
      cpu: this.calculateAverage(recent, 'cpu'),
      memory: this.calculateAverage(recent, 'memory'),
      throughput: this.calculateAverage(recent, 'throughput'),
      responseTime: this.calculateAverage(recent, 'responseTime')
    };
  }

  /**
   * Analyze resource requirements
   */
  analyzeResourceRequirements(performanceData) {
    const resourceAnalysis = {};
    
    for (const [resourceType, model] of this.capacityModels.entries()) {
      if (model.type !== 'resource') continue;
      
      const utilization = this.calculateResourceUtilization(performanceData, resourceType);
      const trend = this.calculateTrend(performanceData, resourceType);
      const forecast = this.forecastRequirement(performanceData, resourceType);
      
      resourceAnalysis[resourceType] = {
        currentUtilization: utilization,
        trend: trend,
        forecast: forecast,
        status: this.getResourceStatus(utilization, model),
        recommendations: this.getResourceRecommendations(utilization, trend, model)
      };
    }
    
    return resourceAnalysis;
  }

  /**
   * Analyze performance requirements
   */
  analyzePerformanceRequirements(performanceData) {
    const performanceAnalysis = {};
    
    for (const [metricType, model] of this.capacityModels.entries()) {
      if (model.type !== 'performance') continue;
      
      const currentValue = this.calculateCurrentValue(performanceData, metricType);
      const trend = this.calculateTrend(performanceData, metricType);
      const forecast = this.forecastRequirement(performanceData, metricType);
      
      performanceAnalysis[metricType] = {
        currentValue: currentValue,
        trend: trend,
        forecast: forecast,
        status: this.getPerformanceStatus(currentValue, model),
        recommendations: this.getPerformanceRecommendations(currentValue, trend, model)
      };
    }
    
    return performanceAnalysis;
  }

  /**
   * Identify system bottlenecks
   */
  identifyBottlenecks(performanceData) {
    const bottlenecks = [];
    
    // CPU bottleneck detection
    const cpuUtilization = this.calculateResourceUtilization(performanceData, 'cpu');
    if (cpuUtilization > 80) {
      bottlenecks.push({
        type: 'cpu',
        severity: cpuUtilization > 90 ? 'critical' : 'warning',
        utilization: cpuUtilization,
        impact: 'High CPU usage may cause processing delays',
        recommendation: 'Consider CPU scaling or optimization'
      });
    }
    
    // Memory bottleneck detection
    const memoryUtilization = this.calculateResourceUtilization(performanceData, 'memory');
    if (memoryUtilization > 85) {
      bottlenecks.push({
        type: 'memory',
        severity: memoryUtilization > 95 ? 'critical' : 'warning',
        utilization: memoryUtilization,
        impact: 'High memory usage may cause performance degradation',
        recommendation: 'Consider memory scaling or garbage collection optimization'
      });
    }
    
    // Throughput bottleneck detection
    const throughput = this.calculateCurrentValue(performanceData, 'throughput');
    const throughputModel = this.capacityModels.get('throughput');
    if (throughput > throughputModel.thresholds.warning) {
      bottlenecks.push({
        type: 'throughput',
        severity: throughput > throughputModel.thresholds.critical ? 'critical' : 'warning',
        currentValue: throughput,
        threshold: throughputModel.thresholds.warning,
        impact: 'High request volume may overwhelm system capacity',
        recommendation: 'Consider horizontal scaling or load balancing'
      });
    }
    
    // Response time bottleneck detection
    const responseTime = this.calculateCurrentValue(performanceData, 'response_time');
    const responseTimeModel = this.capacityModels.get('response_time');
    if (responseTime > responseTimeModel.thresholds.warning) {
      bottlenecks.push({
        type: 'response_time',
        severity: responseTime > responseTimeModel.thresholds.critical ? 'critical' : 'warning',
        currentValue: responseTime,
        threshold: responseTimeModel.thresholds.warning,
        impact: 'Slow response times may affect user experience',
        recommendation: 'Investigate performance optimization or scaling'
      });
    }
    
    return bottlenecks;
  }

  /**
   * Generate scaling recommendations
   */
  async generateScalingRecommendations(analysis) {
    const recommendations = [];
    
    // Resource-based scaling recommendations
    for (const [resourceType, resourceData] of Object.entries(analysis.resourceAnalysis)) {
      if (resourceData.status === 'warning' || resourceData.status === 'critical') {
        const model = this.capacityModels.get(resourceType);
        
        recommendations.push({
          type: 'vertical_scaling',
          resource: resourceType,
          priority: resourceData.status === 'critical' ? 'high' : 'medium',
          action: 'scale_up',
          factor: model.scalingFactor,
          reason: `${resourceType} utilization at ${resourceData.currentUtilization.toFixed(1)}%`,
          estimatedCost: this.estimateScalingCost(resourceType, model.scalingFactor)
        });
      }
    }
    
    // Performance-based scaling recommendations
    for (const [metricType, metricData] of Object.entries(analysis.performanceAnalysis)) {
      if (metricData.status === 'warning' || metricData.status === 'critical') {
        const model = this.capacityModels.get(metricType);
        
        recommendations.push({
          type: 'horizontal_scaling',
          metric: metricType,
          priority: metricData.status === 'critical' ? 'high' : 'medium',
          action: 'scale_out',
          instances: Math.ceil(model.scalingFactor),
          reason: `${metricType} at ${metricData.currentValue} (threshold: ${model.thresholds.warning})`,
          estimatedCost: this.estimateHorizontalScalingCost(Math.ceil(model.scalingFactor))
        });
      }
    }
    
    // Proactive scaling recommendations based on trends
    const proactiveRecommendations = this.generateProactiveRecommendations(analysis);
    recommendations.push(...proactiveRecommendations);
    
    return recommendations.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  /**
   * Generate proactive scaling recommendations
   */
  generateProactiveRecommendations(analysis) {
    const recommendations = [];
    
    // Check for upward trends that might require preemptive scaling
    for (const [resourceType, resourceData] of Object.entries(analysis.resourceAnalysis)) {
      if (resourceData.trend > 0.1 && resourceData.currentUtilization > 60) {
        recommendations.push({
          type: 'proactive_scaling',
          resource: resourceType,
          priority: 'low',
          action: 'prepare_scale_up',
          factor: 1.2,
          reason: `Upward trend detected (${(resourceData.trend * 100).toFixed(1)}% increase)`,
          estimatedCost: this.estimateScalingCost(resourceType, 1.2),
          timing: 'within_24_hours'
        });
      }
    }
    
    return recommendations;
  }

  /**
   * Perform cost analysis
   */
  performCostAnalysis(analysis) {
    const currentCost = this.calculateCurrentCost();
    const scalingCosts = this.calculateScalingCosts(analysis.scalingRecommendations);
    const optimizationSavings = this.calculateOptimizationSavings(analysis);
    
    return {
      current: {
        monthly: currentCost * 24 * 30,
        breakdown: this.getCostBreakdown()
      },
      scaling: {
        additional: scalingCosts,
        percentage: currentCost > 0 ? (scalingCosts / currentCost) * 100 : 0
      },
      optimization: {
        potential_savings: optimizationSavings,
        percentage: currentCost > 0 ? (optimizationSavings / currentCost) * 100 : 0
      },
      recommendations: this.generateCostOptimizationRecommendations(analysis)
    };
  }

  /**
   * Calculate current infrastructure cost
   */
  calculateCurrentCost() {
    // This would integrate with actual infrastructure monitoring
    // For now, return estimated cost based on default configuration
    
    const baseCost = this.costModel.instanceTypes.find(t => t.name === 'medium')?.cost || 0.10;
    return baseCost;
  }

  /**
   * Calculate scaling costs
   */
  calculateScalingCosts(recommendations) {
    let totalCost = 0;
    
    for (const recommendation of recommendations) {
      if (recommendation.estimatedCost) {
        totalCost += recommendation.estimatedCost;
      }
    }
    
    return totalCost;
  }

  /**
   * Estimate scaling cost for resource
   */
  estimateScalingCost(resourceType, factor) {
    const resourceCost = this.costModel.resourceCosts[resourceType] || 0.05;
    return resourceCost * (factor - 1) * 24 * 30; // Monthly cost increase
  }

  /**
   * Estimate horizontal scaling cost
   */
  estimateHorizontalScalingCost(additionalInstances) {
    const instanceCost = this.costModel.instanceTypes.find(t => t.name === 'medium')?.cost || 0.10;
    return instanceCost * additionalInstances * 24 * 30; // Monthly cost
  }

  /**
   * Calculate optimization savings
   */
  calculateOptimizationSavings(analysis) {
    let savings = 0;
    
    // Identify over-provisioned resources
    for (const [resourceType, resourceData] of Object.entries(analysis.resourceAnalysis)) {
      if (resourceData.currentUtilization < 30) {
        const resourceCost = this.costModel.resourceCosts[resourceType] || 0.05;
        const savingsPercentage = (30 - resourceData.currentUtilization) / 100;
        savings += resourceCost * savingsPercentage * 24 * 30;
      }
    }
    
    return savings;
  }

  /**
   * Generate cost optimization recommendations
   */
  generateCostOptimizationRecommendations(analysis) {
    const recommendations = [];
    
    // Right-sizing recommendations
    for (const [resourceType, resourceData] of Object.entries(analysis.resourceAnalysis)) {
      if (resourceData.currentUtilization < 40) {
        recommendations.push({
          type: 'right_sizing',
          resource: resourceType,
          action: 'downsize',
          currentUtilization: resourceData.currentUtilization,
          recommendedReduction: '20%',
          estimatedSavings: this.estimateRightSizingSavings(resourceType, 0.2)
        });
      }
    }
    
    // Reserved instance recommendations
    if (analysis.currentUtilization.cpu > 60 && analysis.currentUtilization.memory > 60) {
      recommendations.push({
        type: 'reserved_instances',
        action: 'purchase_reserved_capacity',
        term: '1_year',
        estimatedSavings: this.calculateCurrentCost() * 0.3 * 12, // 30% savings
        payback_period: '4_months'
      });
    }
    
    return recommendations;
  }

  /**
   * Estimate right-sizing savings
   */
  estimateRightSizingSavings(resourceType, reductionPercentage) {
    const resourceCost = this.costModel.resourceCosts[resourceType] || 0.05;
    return resourceCost * reductionPercentage * 24 * 30;
  }

  /**
   * Get cost breakdown
   */
  getCostBreakdown() {
    return {
      compute: this.costModel.instanceTypes.find(t => t.name === 'medium')?.cost * 24 * 30 || 72,
      storage: 0.001 * 100 * 24 * 30, // 100GB
      network: 0.0001 * 1000 * 30, // 1TB per month
      additional_services: 10 // Monitoring, backups, etc.
    };
  }

  /**
   * Forecast resource requirements
   */
  forecastRequirement(performanceData, resourceType, horizon = this.options.forecastHorizon) {
    if (!performanceData || performanceData.length < 7) {
      return {
        predicted: null,
        confidence: 0,
        method: 'insufficient_data'
      };
    }
    
    // Simple linear regression for trend prediction
    const trend = this.calculateTrend(performanceData, resourceType);
    const current = this.calculateCurrentValue(performanceData, resourceType);
    const predicted = current * (1 + trend * horizon);
    
    return {
      predicted: Math.max(0, predicted),
      confidence: Math.min(0.95, Math.max(0.1, 1 - Math.abs(trend))),
      method: 'linear_regression',
      trendRate: trend
    };
  }

  /**
   * Create auto-scaling policy
   */
  createAutoScalingPolicy(resourceType, options = {}) {
    const model = this.capacityModels.get(resourceType);
    if (!model) {
      throw new Error(`Unknown resource type: ${resourceType}`);
    }
    
    const policy = {
      id: `autoscale_${resourceType}_${Date.now()}`,
      resourceType,
      enabled: true,
      scaleUpPolicy: {
        threshold: options.scaleUpThreshold || model.thresholds.warning,
        factor: options.scaleUpFactor || model.scalingFactor,
        cooldown: options.scaleUpCooldown || 300000, // 5 minutes
        maxInstances: options.maxInstances || model.maximumInstances
      },
      scaleDownPolicy: {
        threshold: options.scaleDownThreshold || model.thresholds.warning * 0.6,
        factor: options.scaleDownFactor || 1 / model.scalingFactor,
        cooldown: options.scaleDownCooldown || 600000, // 10 minutes
        minInstances: options.minInstances || model.minimumInstances
      },
      evaluationPeriods: options.evaluationPeriods || 2,
      createdAt: new Date().toISOString()
    };
    
    this.scalingPolicies.set(policy.id, policy);
    
    return policy;
  }

  /**
   * Utility functions
   */
  calculateAverage(data, property) {
    if (!data || data.length === 0) return 0;
    
    const values = data.map(item => item[property] || 0);
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  calculateResourceUtilization(data, resourceType) {
    return this.calculateAverage(data, resourceType);
  }

  calculateCurrentValue(data, metricType) {
    if (!data || data.length === 0) return 0;
    
    const recent = data.slice(-5); // Last 5 data points
    return this.calculateAverage(recent, metricType);
  }

  calculateTrend(data, property) {
    if (!data || data.length < 2) return 0;
    
    const values = data.map(item => item[property] || 0);
    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));
    
    const firstAvg = firstHalf.reduce((sum, val) => sum + val, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, val) => sum + val, 0) / secondHalf.length;
    
    return firstAvg > 0 ? (secondAvg - firstAvg) / firstAvg : 0;
  }

  getResourceStatus(utilization, model) {
    if (utilization >= model.thresholds.critical) return 'critical';
    if (utilization >= model.thresholds.warning) return 'warning';
    return 'normal';
  }

  getPerformanceStatus(value, model) {
    if (value >= model.thresholds.critical) return 'critical';
    if (value >= model.thresholds.warning) return 'warning';
    return 'normal';
  }

  getResourceRecommendations(utilization, trend, model) {
    const recommendations = [];
    
    if (utilization > model.thresholds.critical) {
      recommendations.push('Immediate scaling required');
    } else if (utilization > model.thresholds.warning) {
      recommendations.push('Consider scaling in near term');
    }
    
    if (trend > 0.1) {
      recommendations.push('Upward trend detected - prepare for scaling');
    }
    
    return recommendations;
  }

  getPerformanceRecommendations(value, trend, model) {
    const recommendations = [];
    
    if (value > model.thresholds.critical) {
      recommendations.push('Performance optimization required');
    } else if (value > model.thresholds.warning) {
      recommendations.push('Monitor performance closely');
    }
    
    if (trend > 0.1) {
      recommendations.push('Performance degradation trend detected');
    }
    
    return recommendations;
  }

  /**
   * Get capacity planning report
   */
  getCapacityReport() {
    return {
      timestamp: new Date().toISOString(),
      capacityModels: Object.fromEntries(this.capacityModels),
      scalingPolicies: Object.fromEntries(this.scalingPolicies),
      costModel: this.costModel,
      historicalDataPoints: this.historicalData.length
    };
  }
}

module.exports = CapacityPlanner;