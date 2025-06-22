/**
 * AgentIntegrationとCCSP統合のテスト
 */

const { expect } = require('chai');
const sinon = require('sinon');
const AgentIntegration = require('../src/agent-integration');
const { AdvancedCCSPClient } = require('../src/ccsp-client-advanced');
const Redis = require('ioredis');

describe('AgentIntegration CCSP統合テスト', () => {
  let agentIntegration;
  let mockRedis;
  let sandbox;
  let mockLogger;
  
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // Redisモック
    mockRedis = {
      lpush: sinon.stub().resolves(1),
      blpop: sinon.stub().resolves(null),
      quit: sinon.stub().resolves('OK'),
      ping: sinon.stub().resolves('PONG'),
      on: sinon.stub()
    };
    sinon.stub(Redis.prototype).callsFake(() => mockRedis);
    
    // ロガーモック
    mockLogger = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub()
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
    sinon.restore();
  });
  
  describe('CCSP統合の初期化', () => {
    it('CCSPクライアントが正しく初期化される', async () => {
      await agentIntegration.initialize();
      
      expect(agentIntegration.ccspClient).to.exist;
      expect(agentIntegration.ccspClient).to.be.instanceOf(AdvancedCCSPClient);
      expect(mockLogger.info).to.have.been.calledWith('CCSPクライアントを初期化中...');
      expect(mockLogger.info).to.have.been.calledWith('CCSPクライアントの初期化完了');
    });
    
    it('CCSPが無効な場合はクライアントが作成されない', async () => {
      agentIntegration.ccspEnabled = false;
      await agentIntegration.initialize();
      
      expect(agentIntegration.ccspClient).to.be.null;
    });
  });
  
  describe('Claude用プロンプト構築', () => {
    it('buildClaudePromptが正しいプロンプトを生成する', () => {
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
      
      expect(prompt).to.include('# Issue #123: テストIssue');
      expect(prompt).to.include('## ラベル\ntask:dogfooding, priority:high');
      expect(prompt).to.include('## 内容\nこれはテスト用のIssueです。');
      expect(prompt).to.include('PoppoBuilder Suiteのコードベースを理解し');
    });
  });
  
  describe('システムプロンプト構築', () => {
    it('buildSystemPromptがラベルに応じた指示を含む', () => {
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
        
        expect(systemPrompt).to.include(expectedText);
        expect(systemPrompt).to.include('直接Claude APIを呼び出すコードは絶対に作成しないでください');
        expect(systemPrompt).to.include('CCSPエージェント経由でリクエスト');
      });
    });
  });
  
  describe('CCSP経由のClaude実行', () => {
    beforeEach(async () => {
      await agentIntegration.initialize();
    });
    
    it('executeClaudeViaCCSPが成功レスポンスを処理する', async () => {
      // 成功レスポンスをモック
      const mockResponse = {
        requestId: 'test-123',
        success: true,
        result: 'Claude実行結果',
        executionTime: 5000
      };
      
      mockRedis.blpop.resolves(['ccsp:response:agent-integration', JSON.stringify(mockResponse)]);
      
      const payload = {
        issueNumber: 123,
        prompt: 'テストプロンプト',
        systemPrompt: 'テストシステムプロンプト',
        priority: 'high'
      };
      
      const result = await agentIntegration.executeClaudeViaCCSP('test-123', payload);
      
      expect(result.success).to.be.true;
      expect(result.result.output).to.equal('Claude実行結果');
      expect(result.result.executionTime).to.equal(5000);
      expect(mockLogger.info).to.have.been.calledWith('[test-123] CCSP経由でClaude実行を開始');
      expect(mockLogger.info).to.have.been.calledWith('[test-123] CCSP実行成功');
    });
    
    it('セッションタイムアウトを適切に処理する', async () => {
      const mockResponse = {
        requestId: 'test-123',
        success: false,
        error: 'SESSION_TIMEOUT',
        sessionTimeout: true
      };
      
      mockRedis.blpop.resolves(['ccsp:response:agent-integration', JSON.stringify(mockResponse)]);
      
      const result = await agentIntegration.executeClaudeViaCCSP('test-123', {});
      
      expect(result.success).to.be.false;
      expect(result.error).to.include('セッションタイムアウト');
      expect(result.requiresManualAction).to.be.true;
    });
    
    it('レート制限を適切に処理する', async () => {
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
      
      mockRedis.blpop.resolves(['ccsp:response:agent-integration', JSON.stringify(mockResponse)]);
      
      const result = await agentIntegration.executeClaudeViaCCSP('test-123', {});
      
      expect(result.success).to.be.false;
      expect(result.error).to.include('レート制限');
      expect(result.retryAfter).to.equal(3600000);
    });
  });
  
  describe('タスク処理の統合', () => {
    it('claude-cliタスクがCCSP経由で実行される', async () => {
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
      
      mockRedis.blpop.resolves(['ccsp:response:agent-integration', JSON.stringify(mockResponse)]);
      
      // waitForTaskCompletionを直接呼び出し
      const result = await agentIntegration.waitForTaskCompletion('issue-123-claude-cli', 'claude-cli', issue);
      
      expect(result.success).to.be.true;
      expect(result.result.output).to.equal('タスク完了');
    });
  });
  
  describe('タスクマッピング', () => {
    it('claude-cliがタスクマッピングに含まれている', () => {
      const mapping = agentIntegration.getDefaultTaskMapping();
      
      expect(mapping.labels['task:misc']).to.include('claude-cli');
      expect(mapping.labels['task:feature']).to.include('claude-cli');
      expect(mapping.labels['task:docs']).to.include('claude-cli');
      expect(mapping.labels['task:bug']).to.include('claude-cli');
      expect(mapping.labels['task:dogfooding']).to.include('claude-cli');
      
      expect(mapping.keywords['claude']).to.include('claude-cli');
      expect(mapping.keywords['実装']).to.include('claude-cli');
      expect(mapping.keywords['修正']).to.include('claude-cli');
    });
  });
  
  describe('シャットダウン', () => {
    it('CCSPクライアントがクリーンアップされる', async () => {
      await agentIntegration.initialize();
      await agentIntegration.shutdown();
      
      expect(mockRedis.quit).to.have.been.called;
    });
  });
});