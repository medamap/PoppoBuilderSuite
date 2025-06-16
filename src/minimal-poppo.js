#!/usr/bin/env node

// プロセス名を設定（psコマンドで識別しやすくするため）
process.title = 'PoppoBuilder-Main';

const fs = require('fs');
const path = require('path');
const GitHubClient = require('./github-client');
const ProcessManager = require('./process-manager');
const RateLimiter = require('./rate-limiter');
const Logger = require('./logger');
const ConfigLoader = require('./config-loader');
const RestartScheduler = require('../scripts/restart-scheduler');

// 設定読み込み
const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../config/config.json'), 'utf-8')
);

// インスタンス作成
const logger = new Logger();
const github = new GitHubClient(config.github);
const rateLimiter = new RateLimiter();
const processManager = new ProcessManager(config.claude, rateLimiter, logger);
const configLoader = new ConfigLoader();

// 処理済みIssueを記録（メモリ内）
const processedIssues = new Set();

// 処理済みコメントを記録（メモリ内）
const processedComments = new Map(); // issueNumber -> Set(commentIds)

/**
 * Issueが処理対象かチェック
 */
function shouldProcessIssue(issue) {
  // すでに処理済み
  if (processedIssues.has(issue.number)) {
    return false;
  }

  // 作者のIssueかチェック
  if (issue.author.login !== config.github.owner) {
    return false;
  }

  // ラベルチェック
  const labels = issue.labels.map(l => l.name);
  
  // task:misc または task:dogfooding ラベルが必要
  if (!labels.includes('task:misc') && !labels.includes('task:dogfooding')) {
    return false;
  }

  // completed, processing, awaiting-responseラベルがあればスキップ
  if (labels.includes('completed') || labels.includes('processing') || labels.includes('awaiting-response')) {
    return false;
  }

  return true;
}

/**
 * Issueを処理
 */
async function processIssue(issue) {
  const issueNumber = issue.number;
  logger.logIssue(issueNumber, 'START', { title: issue.title, labels: issue.labels });
  console.log(`\nIssue #${issueNumber} の処理開始: ${issue.title}`);

  // 処理開始前に処理済みとして記録（二重起動防止）
  processedIssues.add(issueNumber);

  try {
    // processingラベルを追加
    await github.addLabels(issueNumber, ['processing']);
    logger.logIssue(issueNumber, 'LABEL_ADDED', { label: 'processing' });

    // ラベル取得
    const labels = issue.labels.map(l => l.name);
    
    // 言語設定読み込み
    const poppoConfig = configLoader.loadConfig();
    
    // Claude用の指示を作成
    const instruction = {
      task: 'execute',
      issue: {
        number: issueNumber,
        title: issue.title,
        body: issue.body
      },
      context: {
        repository: `${config.github.owner}/${config.github.repo}`,
        workingDirectory: process.cwd(),
        defaultBranch: 'work/poppo-builder',
        systemPrompt: configLoader.generateSystemPrompt(poppoConfig, issueNumber, labels)
      }
    };

    // Claudeで実行
    logger.logIssue(issueNumber, 'EXECUTE_START', { instruction });
    const result = await processManager.execute(`issue-${issueNumber}`, instruction);
    logger.logIssue(issueNumber, 'EXECUTE_SUCCESS', { outputLength: result.output.length });

    // 結果をコメント
    const comment = `## 実行完了\n\n${result.output}`;
    await github.addComment(issueNumber, comment);

    // processingを削除、awaiting-responseラベルを追加（コメント対応機能のため）
    await github.removeLabels(issueNumber, ['processing']);
    
    // コメント対応機能が有効な場合はawaiting-responseを追加、無効な場合はcompletedを追加
    if (config.commentHandling && config.commentHandling.enabled) {
      await github.addLabels(issueNumber, ['awaiting-response']);
      logger.logIssue(issueNumber, 'LABEL_ADDED', { label: 'awaiting-response' });
    } else {
      await github.addLabels(issueNumber, ['completed']);
      logger.logIssue(issueNumber, 'LABEL_ADDED', { label: 'completed' });
    }
    
    console.log(`Issue #${issueNumber} の処理完了`);

    // dogfoodingタスク完了時は自己再起動をスケジュール（ワンショット方式）
    // 最新のラベル情報を取得してdogfooding判定
    const currentIssue = await github.getIssue(issueNumber);
    const currentLabels = currentIssue.labels.map(l => l.name);
    
    if (currentLabels.includes('task:dogfooding')) {
      console.log('🔧 DOGFOODINGタスク完了 - 30秒後に再起動をスケジュール...');
      
      try {
        // ワンショット再起動スケジューラーを起動
        const { spawn } = require('child_process');
        const child = spawn('node', ['scripts/restart-scheduler.js', '--oneshot', '30'], {
          detached: true,
          stdio: 'ignore',
          cwd: process.cwd()
        });
        child.unref();
        
        console.log('再起動スケジューラーを起動しました (PID: ' + child.pid + ')');
      } catch (error) {
        console.error('再起動スケジューラー起動エラー:', error.message);
        // エラーが発生してもawiting-responseラベルは残る（コメント機能継続）
      }
    }

  } catch (error) {
    logger.logIssue(issueNumber, 'ERROR', { 
      message: error.message, 
      stack: error.stack,
      stdout: error.stdout,
      stderr: error.stderr 
    });
    console.error(`Issue #${issueNumber} の処理エラー:`, error.message);
    
    // より詳細なエラー情報をコメントに含める
    const errorDetails = [
      `## エラーが発生しました`,
      ``,
      `### エラーメッセージ`,
      `\`\`\``,
      error.message || '(エラーメッセージなし)',
      `\`\`\``,
      error.stderr ? `\n### エラー出力\n\`\`\`\n${error.stderr}\n\`\`\`` : '',
      error.stdout ? `\n### 標準出力\n\`\`\`\n${error.stdout}\n\`\`\`` : '',
      ``,
      `詳細なログは \`logs/issue-${issueNumber}-*.log\` を確認してください。`
    ].filter(Boolean).join('\n');
    
    await github.addComment(issueNumber, errorDetails);
    
    // processingラベルを削除（エラー時は処理済みリストから削除して再試行可能に）
    await github.removeLabels(issueNumber, ['processing']);
    processedIssues.delete(issueNumber);
  }
}

/**
 * コメントが処理対象かチェック
 */
function shouldProcessComment(issue, comment) {
  const labels = issue.labels.map(l => l.name);
  
  // awaiting-responseラベルが必須
  if (!labels.includes('awaiting-response')) {
    return false;
  }
  
  // 作成者のコメントのみ
  if (comment.author.login !== config.github.owner) {
    return false;
  }
  
  // PoppoBuilder自身のコメントは無視
  if (comment.body.includes('## 実行完了') || 
      comment.body.includes('## エラーが発生しました')) {
    return false;
  }
  
  return true;
}

/**
 * コメントが完了を示しているか判定
 */
function isCompletionComment(comment) {
  if (!config.commentHandling || !config.commentHandling.completionKeywords) {
    return false;
  }
  
  const lowerBody = comment.body.toLowerCase();
  return config.commentHandling.completionKeywords.some(keyword => 
    lowerBody.includes(keyword.toLowerCase())
  );
}

/**
 * コンテキストを構築
 */
async function buildContext(issueNumber) {
  const issue = await github.getIssue(issueNumber);
  const comments = await github.listComments(issueNumber);
  
  // 会話履歴を構築
  const conversation = [];
  
  // 初回のIssue本文
  conversation.push({
    role: 'user',
    content: `Issue #${issue.number}: ${issue.title}\n\n${issue.body}`
  });
  
  // コメント履歴を時系列で追加（PoppoBuilderのコメントと作成者のコメントを分離）
  for (const comment of comments) {
    if (comment.author.login === config.github.owner) {
      conversation.push({
        role: 'user',
        content: comment.body
      });
    } else if (comment.body.includes('## 実行完了')) {
      // PoppoBuilderの応答から"## 実行完了"を除去
      const content = comment.body.replace(/^## 実行完了\n\n/, '');
      conversation.push({
        role: 'assistant',
        content: content
      });
    }
  }
  
  return conversation;
}

/**
 * コメントを処理
 */
async function processComment(issue, comment) {
  const issueNumber = issue.number;
  logger.logIssue(issueNumber, 'COMMENT_START', { 
    commentId: comment.id,
    commentAuthor: comment.author.login 
  });
  console.log(`\nIssue #${issueNumber} のコメント処理開始`);

  try {
    // awaiting-responseを削除、processingラベルを追加
    await github.removeLabels(issueNumber, ['awaiting-response']);
    await github.addLabels(issueNumber, ['processing']);
    logger.logIssue(issueNumber, 'LABEL_UPDATED', { 
      removed: 'awaiting-response', 
      added: 'processing' 
    });

    // コンテキストを構築
    const conversation = await buildContext(issueNumber);
    
    // ラベル取得
    const labels = issue.labels.map(l => l.name);
    
    // 言語設定読み込み
    const poppoConfig = configLoader.loadConfig();
    
    // Claude用の指示を作成（コンテキスト付き）
    const instruction = {
      task: 'execute_with_context',
      issue: {
        number: issueNumber,
        title: issue.title,
        conversation: conversation
      },
      context: {
        repository: `${config.github.owner}/${config.github.repo}`,
        workingDirectory: process.cwd(),
        defaultBranch: 'work/poppo-builder',
        systemPrompt: configLoader.generateSystemPrompt(poppoConfig, issueNumber, labels),
        isFollowUp: true
      }
    };

    // Claudeで実行
    logger.logIssue(issueNumber, 'COMMENT_EXECUTE_START', { 
      commentId: comment.id,
      conversationLength: conversation.length 
    });
    const result = await processManager.execute(`issue-${issueNumber}-comment-${comment.id}`, instruction);
    logger.logIssue(issueNumber, 'COMMENT_EXECUTE_SUCCESS', { 
      outputLength: result.output.length 
    });

    // 結果をコメント
    const responseComment = `## 実行完了\n\n${result.output}`;
    await github.addComment(issueNumber, responseComment);

    // processingを削除
    await github.removeLabels(issueNumber, ['processing']);
    
    // 完了判定
    if (isCompletionComment(comment)) {
      // 完了キーワードが含まれている場合
      await github.addLabels(issueNumber, ['completed']);
      logger.logIssue(issueNumber, 'COMMENT_COMPLETED', { 
        reason: 'completion_keyword' 
      });
      console.log(`Issue #${issueNumber} のコメント処理完了（完了キーワード検出）`);
    } else {
      // 続けて対話する場合
      await github.addLabels(issueNumber, ['awaiting-response']);
      logger.logIssue(issueNumber, 'COMMENT_AWAITING', { 
        commentCount: processedComments.get(issueNumber)?.size || 1 
      });
      console.log(`Issue #${issueNumber} のコメント処理完了（応答待ち）`);
    }

  } catch (error) {
    logger.logIssue(issueNumber, 'COMMENT_ERROR', { 
      commentId: comment.id,
      message: error.message, 
      stack: error.stack 
    });
    console.error(`Issue #${issueNumber} のコメント処理エラー:`, error.message);
    
    // エラー時はawaiting-responseに戻す
    await github.removeLabels(issueNumber, ['processing']);
    await github.addLabels(issueNumber, ['awaiting-response']);
  }
}

/**
 * コメントをチェック
 */
async function checkComments() {
  if (!config.commentHandling || !config.commentHandling.enabled) {
    return;
  }

  try {
    // awaiting-responseラベル付きのIssueを取得
    const issues = await github.listIssues({ 
      state: 'open', 
      labels: ['awaiting-response'] 
    });
    
    for (const issue of issues) {
      const comments = await github.listComments(issue.number);
      const processed = processedComments.get(issue.number) || new Set();
      
      // 新規コメントをチェック
      for (const comment of comments) {
        // IDフィールドがない場合はcreatedAtとauthorでユニークIDを生成
        const commentId = comment.id || `${comment.createdAt}-${comment.author.login}`;
        
        if (!processed.has(commentId) && shouldProcessComment(issue, comment)) {
          // 処理対象のコメントを発見
          console.log(`新規コメントを検出: Issue #${issue.number}, Comment: ${commentId}`);
          
          // 処理済みとして記録
          if (!processedComments.has(issue.number)) {
            processedComments.set(issue.number, new Set());
          }
          processedComments.get(issue.number).add(commentId);
          
          // コメントを処理
          if (processManager.canExecute()) {
            processComment(issue, { ...comment, id: commentId }); // awaitしない（並行実行）
          } else {
            console.log('最大同時実行数に達しています（コメント処理）');
          }
        }
      }
    }
  } catch (error) {
    console.error('コメントチェックエラー:', error.message);
  }
}

/**
 * メインループ
 */
async function mainLoop() {
  console.log('PoppoBuilder 最小限実装 起動');
  console.log(`設定: ${JSON.stringify(config, null, 2)}\n`);

  while (true) {
    try {
      // レート制限チェック
      if (rateLimiter.isRateLimited()) {
        const remaining = Math.ceil(rateLimiter.getRemainingTime() / 1000);
        console.log(`レート制限中... 残り${remaining}秒`);
        await rateLimiter.waitForReset();
        continue;
      }

      // Issue取得
      console.log('Issueをチェック中...');
      const issues = await github.listIssues({ state: 'open' });
      
      // 処理対象のIssueを抽出
      const targetIssues = issues.filter(shouldProcessIssue);
      
      if (targetIssues.length === 0) {
        console.log('処理対象のIssueはありません');
      } else {
        console.log(`${targetIssues.length}件のIssueが見つかりました`);
        
        // 古い順に処理
        targetIssues.sort((a, b) => 
          new Date(a.createdAt) - new Date(b.createdAt)
        );

        // 実行可能な分だけ処理
        for (const issue of targetIssues) {
          if (processManager.canExecute()) {
            processIssue(issue); // awaitしない（並行実行）
          } else {
            console.log('最大同時実行数に達しています');
            break;
          }
        }
      }

      // コメント処理（コメント対応機能が有効な場合）
      await checkComments();

    } catch (error) {
      console.error('メインループエラー:', error.message);
    }

    // ポーリング間隔待機
    console.log(`\n${config.polling.interval / 1000}秒後に再チェック...`);
    await new Promise(resolve => setTimeout(resolve, config.polling.interval));
  }
}

// プロセス終了時のクリーンアップ
process.on('SIGINT', () => {
  console.log('\n\n終了します...');
  processManager.killAll();
  process.exit(0);
});

// 開始
mainLoop().catch(console.error);