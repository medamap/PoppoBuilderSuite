#!/usr/bin/env node

/**
 * コメントコンテキスト拡張機能のテスト
 */

const path = require('path');
const fs = require('fs');

// テスト用に環境をセットアップ
process.env.NODE_ENV = 'test';

// モジュールの読み込み
const config = require('../config/config.json');

// GitHub設定を確実に設定
if (!config.github) {
  config.github = {
    owner: 'medamap',
    repo: 'PoppoBuilderSuite'
  };
}

const GitHubClient = require('../src/github-client');
const Logger = require('../src/logger');
const ConfigLoader = require('../src/config-loader');

// minimal-poppo.jsから必要な関数をエクスポート用に修正が必要なため、
// ここでは簡易的なテストを実行します

async function testContextBuilding() {
  console.log('🧪 コメントコンテキスト拡張機能のテスト開始\n');
  
  // GitHubクライアントの初期化
  const github = new GitHubClient(config.github);
  const logger = new Logger();
  
  try {
    // テスト用のIssue番号（実際のIssueを使用）
    const testIssueNumber = 28; // コメントがあるIssue
    
    console.log(`📋 Issue #${testIssueNumber} の情報を取得中...`);
    
    // Issue詳細を取得
    const issue = await github.getIssue(testIssueNumber);
    if (!issue) {
      console.error('❌ Issueの取得に失敗しました');
      return;
    }
    
    console.log('✅ Issue情報:');
    console.log(`   - タイトル: ${issue.title}`);
    console.log(`   - 作成者: ${issue.author?.login || 'unknown'}`);
    console.log(`   - 作成日時: ${issue.createdAt || 'unknown'}`);
    console.log(`   - ラベル: ${issue.labels.map(l => l.name).join(', ')}`);
    
    // コメントを取得
    console.log('\n📋 コメント一覧を取得中...');
    const comments = await github.listComments(testIssueNumber);
    console.log(`✅ コメント数: ${comments.length}`);
    
    // 拡張コンテキストの構築をシミュレート
    console.log('\n🔨 拡張コンテキストを構築中...');
    
    const maxComments = config.commentHandling?.maxCommentCount || 10;
    const truncated = comments.length > maxComments;
    const limitedComments = comments.slice(-maxComments);
    
    const context = {
      issue: {
        number: issue.number,
        title: issue.title,
        description: issue.body,
        labels: issue.labels.map(l => l.name),
        created_at: issue.createdAt,
        updated_at: issue.updatedAt
      },
      conversation: [],
      context_summary: {
        total_comments: comments.length,
        truncated: truncated,
        oldest_included: limitedComments.length > 0 ? limitedComments[0].createdAt : null
      }
    };
    
    // Issue本文を追加
    context.conversation.push({
      role: 'user',
      content: `Issue #${issue.number}: ${issue.title}\n\n${issue.body}`,
      metadata: {
        author: issue.author?.login || 'unknown',
        created_at: issue.createdAt,
        id: issue.number,
        is_completion: false
      }
    });
    
    // コメントを追加
    for (const comment of limitedComments) {
      const author = comment.author?.login || 'unknown';
      const isUserComment = author === (issue.author?.login || config.github.owner);
      
      context.conversation.push({
        role: isUserComment ? 'user' : 'assistant',
        content: comment.body.replace(/^## 実行完了\n\n/, ''),
        metadata: {
          author: author,
          created_at: comment.createdAt,
          id: comment.id || comment.number,
          is_completion: false
        }
      });
    }
    
    console.log('\n✅ 拡張コンテキスト構築完了:');
    console.log(`   - 会話数: ${context.conversation.length}`);
    console.log(`   - 総コメント数: ${context.context_summary.total_comments}`);
    console.log(`   - 切り捨て: ${context.context_summary.truncated ? 'あり' : 'なし'}`);
    if (context.context_summary.oldest_included) {
      console.log(`   - 最古のコメント: ${context.context_summary.oldest_included}`);
    }
    
    // 会話の内容を表示
    console.log('\n📝 会話履歴:');
    context.conversation.forEach((entry, index) => {
      console.log(`\n[${index + 1}] ${entry.role.toUpperCase()} (${entry.metadata.author})`);
      console.log(`    日時: ${entry.metadata.created_at || 'unknown'}`);
      console.log(`    内容: ${entry.content.substring(0, 100)}${entry.content.length > 100 ? '...' : ''}`);
    });
    
    console.log('\n✅ テスト完了！');
    
  } catch (error) {
    console.error('\n❌ テストエラー:', error.message);
    console.error(error.stack);
  }
}

// テスト実行
testContextBuilding().catch(console.error);