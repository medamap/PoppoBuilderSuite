/**
 * SLA (Service Level Agreement) 定義
 * PoppoBuilder Suiteの各サービスに対するSLA目標値を定義
 */

const SLADefinitions = {
  // 可用性目標
  availability: {
    'poppo-builder': {
      target: 0.995,  // 99.5%
      window: 'rolling_30d',
      description: 'PoppoBuilder本体の可用性'
    },
    'agents': {
      target: 0.99,   // 99%
      window: 'rolling_30d',
      description: '各エージェントの可用性'
    },
    'dashboard': {
      target: 0.95,   // 95%
      window: 'rolling_30d',
      description: 'ダッシュボードの可用性'
    }
  },

  // パフォーマンス目標
  performance: {
    'issue-processing-start': {
      target: 300,    // 5分 = 300秒
      unit: 'seconds',
      percentile: 0.95,
      description: 'Issue処理開始時間 (P95)'
    },
    'api-response-time': {
      target: 200,    // 200ms
      unit: 'milliseconds',
      percentile: 0.95,
      description: 'API応答時間 (P95)'
    },
    'queue-latency': {
      target: 600,    // 10分 = 600秒
      unit: 'seconds',
      percentile: 0.95,
      description: 'キュー滞留時間 (P95)'
    }
  },

  // 処理成功率目標
  success_rate: {
    'issue-processing': {
      target: 0.95,   // 95%
      window: 'rolling_7d',
      description: 'Issue処理成功率'
    },
    'agent-processing': {
      target: 0.90,   // 90%
      window: 'rolling_7d',
      description: 'エージェント処理成功率'
    }
  },

  // エラーバジェット計算
  error_budget: {
    calculation_window: 30 * 24 * 60 * 60 * 1000,  // 30日間（ミリ秒）
    alert_threshold: 0.2,  // エラーバジェットの20%を消費したらアラート
    critical_threshold: 0.8  // エラーバジェットの80%を消費したら緊急アラート
  }
};

/**
 * SLI (Service Level Indicator) 定義
 * 各SLAを測定するための具体的な指標
 */
const SLIDefinitions = {
  // 可用性SLI
  availability: {
    'poppo-builder': {
      good_events: 'successful_health_checks',
      total_events: 'total_health_checks',
      measurement_interval: 60000  // 1分ごと
    },
    'agents': {
      good_events: 'agent_heartbeats_received',
      total_events: 'agent_heartbeats_expected',
      measurement_interval: 60000
    },
    'dashboard': {
      good_events: 'dashboard_requests_success',
      total_events: 'dashboard_requests_total',
      measurement_interval: 60000
    }
  },

  // パフォーマンスSLI
  performance: {
    'issue-processing-start': {
      metric: 'issue_processing_start_time',
      aggregation: 'percentile',
      percentile: 0.95
    },
    'api-response-time': {
      metric: 'api_response_duration',
      aggregation: 'percentile',
      percentile: 0.95
    },
    'queue-latency': {
      metric: 'queue_wait_time',
      aggregation: 'percentile',
      percentile: 0.95
    }
  },

  // 成功率SLI
  success_rate: {
    'issue-processing': {
      good_events: 'issues_processed_successfully',
      total_events: 'issues_processed_total'
    },
    'agent-processing': {
      good_events: 'agent_tasks_successful',
      total_events: 'agent_tasks_total'
    }
  }
};

/**
 * アラート定義
 */
const AlertDefinitions = {
  slo_violation: {
    channels: ['log', 'github-issue'],
    severity_mapping: {
      warning: 0.98,    // SLO目標の98%に達したら警告
      critical: 1.0     // SLO違反で緊急
    }
  },
  error_budget: {
    channels: ['log', 'github-issue'],
    templates: {
      warning: 'エラーバジェットの{percentage}%を消費しました。残り: {remaining}%',
      critical: '緊急: エラーバジェットが危険水準です。残り: {remaining}%'
    }
  }
};

module.exports = {
  SLADefinitions,
  SLIDefinitions,
  AlertDefinitions
};