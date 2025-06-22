const { expect } = require('chai');
const InstructionAnalyzer = require('../src/instruction-analyzer');
const TwoStageProcessor = require('../src/two-stage-processor');
const path = require('path');

// モックのClaudeクライアント
class MockClaudeClient {
  constructor(responseFactory) {
    this.responseFactory = responseFactory;
  }

  async sendMessage(prompt) {
    if (this.responseFactory) {
      return this.responseFactory(prompt);
    }
    return '';
  }
}

// モックのGitHubクライアント
class MockGitHubClient {
  constructor() {
    this.issues = [];
    this.comments = [];
  }

  async createIssue(data) {
    const issue = {
      number: this.issues.length + 1,
      title: data.title,
      body: data.body,
      labels: data.labels.map(name => ({ name })),
      html_url: `https://github.com/it/repo/issues/${this.issues.length + 1}`
    };
    this.issues.push(issue);
    return issue;
  }

  async createComment(issueNumber, body) {
    const comment = {
      issueNumber,
      body,
      id: this.comments.length + 1
    };
    this.comments.push(comment);
    return comment;
  }
}

// モックのlogger
const mockLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {}
};

describe('InstructionAnalyzer', () => {
  it('正しくプロンプトテンプレートを読み込めること', async () => {
    const analyzer = new InstructionAnalyzer(new MockClaudeClient(), mockLogger);
    await analyzer.init();
    expect(analyzer.promptTemplate).to.include('指示内容分析プロンプト');
  });

  it('Issue作成指示を正しく分析できること', async () => {
    const mockClient = new MockClaudeClient(() => {
      return JSON.stringify({
        action: 'create_issue',
        confidence: 0.9,
        reasoning: 'Issue作成の明示的な指示',
        data: {
          title: 'テストIssue',
          body: 'テスト本文',
          labels: ['task:dogfooding', 'priority:high']
        }
      });
    });

    const analyzer = new InstructionAnalyzer(mockClient, mockLogger);
    const result = await analyzer.analyze('dogfoodingタスクとして新しいIssueを作成してください');
    
    expect(result.action).to.equal('create_issue');
    expect(result.confidence).to.equal(0.9);
    expect(result.data.labels).to.include('task:dogfooding');
  });

  it('コード実行指示を正しく分析できること', async () => {
    const mockClient = new MockClaudeClient(() => {
      return JSON.stringify({
        action: 'execute_code',
        confidence: 0.85,
        reasoning: 'バグ修正の指示',
        data: {
          instruction: 'バグを修正してください',
          context: {}
        }
      });
    });

    const analyzer = new InstructionAnalyzer(mockClient, mockLogger);
    const result = await analyzer.analyze('バグを修正してください');
    
    expect(result.action).to.equal('execute_code');
    expect(result.confidence).to.equal(0.85);
  });

  it('デフォルトラベルが正しく適用されること', () => {
    const analyzer = new InstructionAnalyzer(new MockClaudeClient(), mockLogger);
    
    // dogfoodingキーワード
    let labels = analyzer.applyDefaultLabels([], 'dogfoodingタスクです');
    expect(labels).to.include('task:dogfooding');
    expect(labels).to.include('priority:medium');
    
    // バグキーワード
    labels = analyzer.applyDefaultLabels([], 'バグを修正してください');
    expect(labels).to.include('task:bug');
    
    // 緊急キーワード
    labels = analyzer.applyDefaultLabels([], '緊急でお願いします');
    expect(labels).to.include('priority:high');
    
    // 既存のラベルは保持される
    labels = analyzer.applyDefaultLabels(['task:feature'], 'テスト');
    expect(labels).to.include('task:feature');
    expect(labels).not.to.include('task:misc');
  });

  it('無効なレスポンスの場合unknownを返すこと', async () => {
    const mockClient = new MockClaudeClient(() => 'invalid json');
    const analyzer = new InstructionAnalyzer(mockClient, mockLogger);
    const result = await analyzer.analyze('テスト');
    
    expect(result.action).to.equal('unknown');
    expect(result.confidence).to.equal(0.0);
  });
});

describe('TwoStageProcessor', () => {
  let processor;
  let mockGitHub;
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockGitHub = new MockGitHubClient();
    const config = {
      twoStageProcessing: {
        enabled: true,
        confidenceThreshold: 0.7,
        analyzeTimeout: 30000
      }
    };
    processor = new TwoStageProcessor(config, null, mockLogger);
    processor.githubClient = mockGitHub;
  });

  it('Issue作成アクションが正しく実行されること', async () => {
    const mockClient = new MockClaudeClient(() => {
      return JSON.stringify({
        action: 'create_issue',
        confidence: 0.9,
        reasoning: 'Issue作成指示',
        data: {
          title: '新機能の実装',
          body: '詳細な説明',
          labels: ['task:feature', 'priority:high']
        }
      });
    });
    
    processor.analyzer = new InstructionAnalyzer(mockClient, mockLogger);
    await processor.init();
    
    const result = await processor.processInstruction('新機能のIssueを作成してください', {
      issueNumber: 1
    });
    
    expect(result.action).to.equal('create_issue');
    expect(result.executed).to.equal(true);
    expect(result.executionResult.success).to.equal(true);
    expect(mockGitHub.issues).to.have.lengthOf(1);
    expect(mockGitHub.issues[0].title).to.equal('新機能の実装');
    expect(mockGitHub.issues[0].labels).to.deep.include({ name: 'task:feature' });
  });

  it('信頼度が閾値未満の場合はexecute_codeにフォールバックすること', async () => {
    const mockClient = new MockClaudeClient(() => {
      return JSON.stringify({
        action: 'create_issue',
        confidence: 0.5,
        reasoning: '不確実な指示',
        data: {
          title: 'テスト',
          body: 'テスト',
          labels: []
        }
      });
    });
    
    processor.analyzer = new InstructionAnalyzer(mockClient, mockLogger);
    await processor.init();
    
    const result = await processor.processInstruction('何かしてください');
    
    expect(result.action).to.equal('execute_code');
    expect(result.executed).to.equal(false);
    expect(result.reason).to.include('Low confidence');
  });

  it('2段階処理が無効の場合はデフォルトの処理を返すこと', async () => {
    const config = {
      twoStageProcessing: {
        enabled: false
      }
    };
    processor = new TwoStageProcessor(config, null, mockLogger);
    
    const result = await processor.processInstruction('テスト');
    
    expect(result.action).to.equal('execute_code');
    expect(result.executed).to.equal(false);
    expect(result.reason).to.equal('Two-stage processing disabled');
  });

  it('shouldProcessがキーワードを正しく検出すること', () => {
    expect(processor.shouldProcess('新しいIssueを作成してください')).to.equal(true);
    expect(processor.shouldProcess('dogfoodingタスクです')).to.equal(true);
    expect(processor.shouldProcess('バグを修正')).to.equal(true);
    expect(processor.shouldProcess('コードを実行')).to.equal(false);
  });

  it('分析タイムアウトが機能すること', async () => {
    const config = {
      twoStageProcessing: {
        enabled: true,
        confidenceThreshold: 0.7,
        analyzeTimeout: 100 // 100msでタイムアウト
      }
    };
    processor = new TwoStageProcessor(config, null, mockLogger);
    
    // 遅いレスポンスをシミュレート
    const mockClient = new MockClaudeClient(async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return JSON.stringify({
        action: 'create_issue',
        confidence: 0.9,
        data: {}
      });
    });
    
    processor.analyzer = new InstructionAnalyzer(mockClient, mockLogger);
    await processor.init();
    
    const result = await processor.analyzeWithTimeout('テスト');
    
    expect(result.action).to.equal('execute_code');
    expect(result.reasoning).to.equal('Analysis timed out');
  });
});

