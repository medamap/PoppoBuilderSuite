/**
 * AgentIntegrationとCCSP統合のテスト
 */

const AgentIntegration = require('../src/agent-integration');
const { AdvancedCCSPClient } = require('../src/ccsp-client-advanced');
const Redis = require('ioredis');

// モックの作成
jest.mock('ioredis');
jest.mock('../agents/core/agent-coordinator');

describe('AgentIntegration CCSP統合テスト', () => {
  let agentIntegration;
  let mockRedis;
  let mockLogger;
  
  beforeEach(() => {
    // Redisモック
    mockRedis = {
      lpush: jest.fn().mockResolvedValue(1),
      blpop: jest.fn().mockResolvedValue(null),
      quit: jest.fn().mockResolvedValue('OK'),
      ping: jest.fn().mockResolvedValue('PONG'),
      on: jest.fn()
    };
    Redis.mockImplementation(() => mockRedis);
    
    // ロガーモック
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };
    
    // AgentIntegration設定
    const config = {
      agentMode: {
        enabled: true
      },
      ccsp: {
        enabled: true,
        responseTimeout: 60000
      },
      redis: {
        host: 'localhost',
        port: 6379
      },
      claude: {
        modelPreference: {
          primary: 'claude-3-opus-20240229',
          fallback: 'claude-3-sonnet-20240229'
        }
      }
    };
    
    agentIntegration = new AgentIntegration(config);
    agentIntegration.logger = mockLogger;
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });
  
  describe('CCSP統合の初期化', () => {
    test('CCSPクライアントが正しく初期化される', async () => {
      await agentIntegration.initialize();
      
      expect(agentIntegration.ccspClient).toBeDefined();
      expect(agentIntegration.ccspClient).toBeInstanceOf(AdvancedCCSPClient);
      expect(mockLogger.info).toHaveBeenCalledWith('CCSPクライアントを初期化中...');
      expect(mockLogger.info).toHaveBeenCalledWith('CCSPクライアントの初期化完了');
    });
    
    test('CCSPが無効な場合はクライアントが作成されない', async () => {
      agentIntegration.ccspEnabled = false;
      await agentIntegration.initialize();
      
      expect(agentIntegration.ccspClient).toBeNull();
    });
  });
  
  describe('Claude用プロンプト構築', () => {
    test('buildClaudePromptが正しいプロンプトを生成する', () => {
      const issue = {
        number: 123,
        title: 'テストIssue',
        body: 'これはテスト用のIssueです。',
        labels: [
          { name: 'task:dogfooding' },
          { name: 'priority:high' }
        ]
      };
      
      const prompt = agentIntegration.buildClaudePrompt(issue);
      
      expect(prompt).toContain('# Issue #123: テストIssue');
      expect(prompt).toContain('## ラベル\ntask:dogfooding, priority:high');
      expect(prompt).toContain('## 内容\nこれはテスト用のIssueです。');
      expect(prompt).toContain('PoppoBuilder Suiteのコードベースを理解し');
    });
  });
  
  describe('システムプロンプト構築', () => {
    test('buildSystemPromptがラベルに応じた指示を含む', () => {
      const testCases = [
        {
          labels: [{ name: 'task:dogfooding' }],
          expectedText: 'dogfoodingタスクです。実装品質と完成度を特に重視'
        },
        {
          labels: [{ name: 'task:bug' }],
          expectedText: 'バグ修正です。根本原因を特定し、確実に修正'
        },
        {
          labels: [{ name: 'task:feature' }],
          expectedText: '新機能の実装です。既存の設計パターンに従って'
        },
        {
          labels: [{ name: 'task:docs' }],
          expectedText: 'ドキュメントの作成・更新です。わかりやすく詳細な説明'
        }
      ];
      
      testCases.forEach(({ labels, expectedText }) => {
        const issue = { labels };
        const systemPrompt = agentIntegration.buildSystemPrompt(issue);
        
        expect(systemPrompt).toContain(expectedText);
        expect(systemPrompt).toContain('直接Claude APIを呼び出すコードは絶対に作成しないでください');
        expect(systemPrompt).toContain('CCSPエージェント経由でリクエスト');
      });
    });
  });
  
  describe('CCSP経由のClaude実行', () => {
    beforeEach(async () => {
      await agentIntegration.initialize();
    });
    
    test('executeClaudeViaCCSPが成功レスポンスを処理する', async () => {
      // 成功レスポンスをモック
      const mockResponse = {
        requestId: 'test-123',
        success: true,
        result: 'Claude実行結果',
        executionTime: 5000
      };
      
      mockRedis.blpop.mockResolvedValueOnce(['ccsp:response:agent-integration', JSON.stringify(mockResponse)]);
      
      const payload = {
        issueNumber: 123,
        prompt: 'テストプロンプト',
        systemPrompt: 'テストシステムプロンプト',
        priority: 'high'
      };
      
      const result = await agentIntegration.executeClaudeViaCCSP('test-123', payload);
      
      expect(result.success).toBe(true);
      expect(result.result.output).toBe('Claude実行結果');
      expect(result.result.executionTime).toBe(5000);
      expect(mockLogger.info).toHaveBeenCalledWith('[test-123] CCSP経由でClaude実行を開始');
      expect(mockLogger.info).toHaveBeenCalledWith('[test-123] CCSP実行成功');
    });
    
    test('セッションタイムアウトを適切に処理する', async () => {
      const mockResponse = {
        requestId: 'test-123',
        success: false,
        error: 'SESSION_TIMEOUT',
        sessionTimeout: true
      };
      
      mockRedis.blpop.mockResolvedValueOnce(['ccsp:response:agent-integration', JSON.stringify(mockResponse)]);
      
      const result = await agentIntegration.executeClaudeViaCCSP('test-123', {});
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('セッションタイムアウト');
      expect(result.requiresManualAction).toBe(true);
    });
    
    test('レート制限を適切に処理する', async () => {
      const unlockTime = Date.now() + 3600000;
      const mockResponse = {
        requestId: 'test-123',
        success: false,
        rateLimitInfo: {
          message: 'Rate limit reached',
          unlockTime: unlockTime,
          waitTime: 3600000
        }
      };
      
      mockRedis.blpop.mockResolvedValueOnce(['ccsp:response:agent-integration', JSON.stringify(mockResponse)]);
      
      const result = await agentIntegration.executeClaudeViaCCSP('test-123', {});
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('レート制限');
      expect(result.retryAfter).toBe(3600000);
    });
  });
  
  describe('タスク処理の統合', () => {
    test('claude-cliタスクがCCSP経由で実行される', async () => {
      await agentIntegration.initialize();
      
      const issue = {
        number: 123,
        title: 'テスト',
        body: 'テスト内容',
        labels: [{ name: 'task:misc' }]
      };
      
      // CCSP成功レスポンスをモック
      const mockResponse = {
        requestId: 'issue-123-claude-cli',
        success: true,
        result: 'タスク完了',
        executionTime: 3000
      };
      
      mockRedis.blpop.mockResolvedValueOnce(['ccsp:response:agent-integration', JSON.stringify(mockResponse)]);
      
      // waitForTaskCompletionを直接呼び出し
      const result = await agentIntegration.waitForTaskCompletion('issue-123-claude-cli', 'claude-cli', issue);
      
      expect(result.success).toBe(true);
      expect(result.result.output).toBe('タスク完了');
    });
  });
  
  describe('タスクマッピング', () => {
    test('claude-cliがタスクマッピングに含まれている', () => {
      const mapping = agentIntegration.getDefaultTaskMapping();
      
      expect(mapping.labels['task:misc']).toContain('claude-cli');
      expect(mapping.labels['task:feature']).toContain('claude-cli');
      expect(mapping.labels['task:docs']).toContain('claude-cli');
      expect(mapping.labels['task:bug']).toContain('claude-cli');
      expect(mapping.labels['task:dogfooding']).toContain('claude-cli');
      
      expect(mapping.keywords['claude']).toContain('claude-cli');
      expect(mapping.keywords['実装']).toContain('claude-cli');
      expect(mapping.keywords['修正']).toContain('claude-cli');
    });
  });
  
  describe('シャットダウン', () => {
    test('CCSPクライアントがクリーンアップされる', async () => {
      await agentIntegration.initialize();
      await agentIntegration.shutdown();
      
      expect(mockRedis.quit).toHaveBeenCalled();
    });
  });
});