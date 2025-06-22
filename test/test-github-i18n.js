/**
 * Test GitHub comment internationalization
 */

const commentTemplates = require('../lib/github/comment-templates');
const languageDetector = require('../lib/utils/language-detector');
const i18nManager = require('../lib/i18n/i18n-manager');

async function testGitHubI18n() {
  console.log('Testing GitHub comment internationalization...\n');

  // Initialize i18n
  await i18nManager.initialize();

  console.log('=== Testing Language Detection ===\n');

  // Test cases for language detection
  const testCases = [
    {
      name: 'Japanese issue',
      issue: {
        title: 'バグ修正: ログインエラーについて',
        body: 'ログイン時にエラーが発生します。パスワードを入力しても認証に失敗します。',
        labels: [],
        user: { login: 'test-user' }
      },
      expected: 'ja'
    },
    {
      name: 'English issue',
      issue: {
        title: 'Bug fix: Login error',
        body: 'Getting an error when trying to login. Authentication fails even with correct password.',
        labels: [],
        user: { login: 'test-user' }
      },
      expected: 'en'
    },
    {
      name: 'Issue with Japanese label',
      issue: {
        title: 'Test issue',
        body: 'Test body',
        labels: [{ name: 'lang:ja' }],
        user: { login: 'test-user' }
      },
      expected: 'ja'
    },
    {
      name: 'Mixed content (more Japanese)',
      issue: {
        title: 'Feature Request: 新機能の追加',
        body: 'I would like to request a new feature. 新しい機能を追加してください。これは重要です。',
        labels: [],
        user: { login: 'test-user' }
      },
      expected: 'ja'
    }
  ];

  for (const testCase of testCases) {
    const detected = languageDetector.detect({
      title: testCase.issue.title,
      body: testCase.issue.body,
      labels: testCase.issue.labels
    });
    
    console.log(`${testCase.name}:`);
    console.log(`  Expected: ${testCase.expected}, Got: ${detected}`);
    console.log(`  ✅ ${detected === testCase.expected ? 'PASS' : 'FAIL'}\n`);
  }

  console.log('\n=== Testing Comment Templates ===\n');

  // Japanese issue
  const japaneseIssue = {
    number: 123,
    title: 'テスト: 日本語のIssue',
    body: 'これは日本語のテストIssueです。',
    labels: [],
    user: { login: 'jp-user' }
  };

  // English issue
  const englishIssue = {
    number: 124,
    title: 'Test: English Issue',
    body: 'This is an English test issue.',
    labels: [],
    user: { login: 'en-user' }
  };

  // Test task started
  console.log('--- Task Started ---');
  console.log('\nJapanese:');
  console.log(commentTemplates.taskStarted(japaneseIssue, { 
    taskId: 'task-001', 
    estimatedTime: '30秒' 
  }));
  
  console.log('\nEnglish:');
  console.log(commentTemplates.taskStarted(englishIssue, { 
    taskId: 'task-002', 
    estimatedTime: '30s' 
  }));

  // Test task completed
  console.log('\n\n--- Task Completed ---');
  console.log('\nJapanese:');
  console.log(commentTemplates.taskCompleted(japaneseIssue, {
    taskId: 'task-001',
    duration: 25,
    filesChanged: [
      { status: 'modified', path: 'src/main.js' },
      { status: 'added', path: 'test/new.test.js' }
    ],
    testsRun: 10,
    testsPassed: 9,
    summary: 'ログイン機能のバグを修正しました。'
  }));

  console.log('\nEnglish:');
  console.log(commentTemplates.taskCompleted(englishIssue, {
    taskId: 'task-002',
    duration: 30,
    filesChanged: [
      { status: 'modified', path: 'src/app.js' }
    ],
    testsRun: 5,
    testsPassed: 5,
    summary: 'Fixed the authentication bug.'
  }));

  // Test task failed
  console.log('\n\n--- Task Failed ---');
  console.log('\nJapanese:');
  console.log(commentTemplates.taskFailed(japaneseIssue, {
    taskId: 'task-003',
    errorCode: 'E301',
    duration: 5
  }));

  console.log('\nEnglish:');
  console.log(commentTemplates.taskFailed(englishIssue, {
    taskId: 'task-004',
    errorMessage: 'Connection timeout',
    duration: 10
  }));

  // Test welcome message
  console.log('\n\n--- Welcome Messages ---');
  console.log('\nJapanese (first time):');
  console.log(commentTemplates.welcomeContributor(japaneseIssue, true));

  console.log('\nEnglish (returning):');
  console.log(commentTemplates.welcomeContributor(englishIssue, false));

  // Test help
  console.log('\n\n--- Help ---');
  console.log('\nJapanese:');
  console.log(commentTemplates.help(japaneseIssue));

  console.log('\n=== Test Complete ===');
}

// Run the test
testGitHubI18n().catch(console.error);