const nock = require('nock');

class APIMocks {
  constructor() {
    this.githubMock = null;
    this.claudeMock = null;
  }

  /**
   * GitHub APIのモックをセットアップ
   */
  setupGitHubMocks() {
    // GitHub APIのベースURL
    this.githubMock = nock('https://api.github.com');

    // リポジトリ情報の取得
    this.githubMock
      .get('/repos/medamap/PoppoBuilderSuite')
      .reply(200, {
        id: 12345,
        name: 'PoppoBuilderSuite',
        full_name: 'medamap/PoppoBuilderSuite',
        owner: {
          login: 'medamap',
          id: 67890
        },
        default_branch: 'main'
      });

    // Issue一覧の取得
    this.githubMock
      .get('/repos/medamap/PoppoBuilderSuite/issues')
      .query(true)
      .reply(200, [
        {
          id: 1,
          number: 100,
          title: 'テストIssue 1',
          body: 'これはE2Eテスト用のIssueです。',
          state: 'open',
          labels: [
            { name: 'task:execute', color: 'ff0000' },
            { name: 'dogfooding', color: '00ff00' }
          ],
          user: { login: 'test-user' },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        {
          id: 2,
          number: 101,
          title: 'テストIssue 2',
          body: 'エラーテスト用のIssueです。',
          state: 'open',
          labels: [
            { name: 'task:error-log', color: 'ff0000' }
          ],
          user: { login: 'test-user' },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ]);

    // 特定のIssue取得
    this.githubMock
      .get('/repos/medamap/PoppoBuilderSuite/issues/100')
      .reply(200, {
        id: 1,
        number: 100,
        title: 'テストIssue 1',
        body: 'これはE2Eテスト用のIssueです。',
        state: 'open',
        labels: [
          { name: 'task:execute', color: 'ff0000' },
          { name: 'dogfooding', color: '00ff00' }
        ],
        user: { login: 'test-user' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    // コメントの追加
    this.githubMock
      .post('/repos/medamap/PoppoBuilderSuite/issues/100/comments')
      .reply(201, (uri, requestBody) => {
        return {
          id: Date.now(),
          body: requestBody.body,
          user: { login: 'poppo-builder[bot]' },
          created_at: new Date().toISOString()
        };
      });

    // ラベルの追加
    this.githubMock
      .post('/repos/medamap/PoppoBuilderSuite/issues/100/labels')
      .reply(200, (uri, requestBody) => {
        return requestBody.labels.map(label => ({
          name: label,
          color: 'cccccc'
        }));
      });

    // Issueの更新
    this.githubMock
      .patch('/repos/medamap/PoppoBuilderSuite/issues/100')
      .reply(200, (uri, requestBody) => {
        return {
          id: 1,
          number: 100,
          title: requestBody.title || 'テストIssue 1',
          body: requestBody.body || 'これはE2Eテスト用のIssueです。',
          state: requestBody.state || 'open',
          labels: [],
          user: { login: 'test-user' },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      });

    // レート制限
    this.githubMock
      .get('/rate_limit')
      .reply(200, {
        resources: {
          core: {
            limit: 5000,
            remaining: 4999,
            reset: Math.floor(Date.now() / 1000) + 3600
          }
        }
      });

    return this.githubMock;
  }

  /**
   * Claude APIのモックをセットアップ
   */
  setupClaudeMocks() {
    // Claude APIのベースURL
    this.claudeMock = nock('https://api.anthropic.com');

    // メッセージ送信
    this.claudeMock
      .post('/v1/messages')
      .reply(200, (uri, requestBody) => {
        // リクエストに基づいて適切なレスポンスを生成
        const systemPrompt = requestBody.system || '';
        const lastMessage = requestBody.messages[requestBody.messages.length - 1];
        
        let responseContent = '';
        
        if (lastMessage.content.includes('エラー')) {
          responseContent = 'エラーを検出しました。修正コードは以下の通りです:\n```javascript\nconsole.log("修正済み");\n```';
        } else if (lastMessage.content.includes('テスト')) {
          responseContent = 'テストを実行します。\n```bash\nnpm test\n```\nテストが成功しました。';
        } else if (lastMessage.content.includes('ドキュメント')) {
          responseContent = '# ドキュメント\n\nこれは自動生成されたドキュメントです。';
        } else {
          responseContent = 'タスクを実行しました。正常に完了しました。';
        }

        return {
          id: 'msg_' + Date.now(),
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: responseContent
            }
          ],
          model: 'claude-3-haiku-20240307',
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 100,
            output_tokens: 50
          }
        };
      });

    return this.claudeMock;
  }

  /**
   * エラーレスポンスを設定
   */
  setupErrorResponses() {
    // GitHub APIエラー
    this.githubMock
      .get('/repos/medamap/PoppoBuilderSuite/issues/999')
      .reply(404, {
        message: 'Not Found',
        documentation_url: 'https://docs.github.com/rest'
      });

    // レート制限エラー
    this.githubMock
      .get('/repos/medamap/PoppoBuilderSuite/issues')
      .query({ error: 'rate_limit' })
      .reply(403, {
        message: 'API rate limit exceeded',
        documentation_url: 'https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting'
      });

    // Claude APIエラー
    this.claudeMock
      .post('/v1/messages')
      .query({ error: 'true' })
      .reply(500, {
        error: {
          type: 'internal_server_error',
          message: 'An internal server error occurred'
        }
      });
  }

  /**
   * 動的なモックレスポンス
   */
  setupDynamicMocks() {
    let issueComments = [];
    let processCount = 0;

    // コメントの取得（動的）
    this.githubMock
      .persist()
      .get('/repos/medamap/PoppoBuilderSuite/issues/100/comments')
      .reply(200, () => issueComments);

    // プロセスカウントのシミュレーション
    this.githubMock
      .persist()
      .get('/repos/medamap/PoppoBuilderSuite/issues')
      .query({ labels: 'processing' })
      .reply(200, () => {
        return Array(processCount).fill(null).map((_, i) => ({
          id: i + 1000,
          number: i + 1000,
          title: `処理中のIssue ${i + 1}`,
          state: 'open',
          labels: [{ name: 'processing' }]
        }));
      });

    return {
      addComment: (comment) => {
        issueComments.push({
          id: Date.now(),
          body: comment,
          user: { login: 'test-user' },
          created_at: new Date().toISOString()
        });
      },
      setProcessCount: (count) => {
        processCount = count;
      }
    };
  }

  /**
   * すべてのモックをクリーンアップ
   */
  cleanupMocks() {
    nock.cleanAll();
  }

  /**
   * 保留中のモックがないことを確認
   */
  verifyMocks() {
    if (!nock.isDone()) {
      console.error('未使用のモックがあります:', nock.pendingMocks());
      return false;
    }
    return true;
  }
}

module.exports = APIMocks;