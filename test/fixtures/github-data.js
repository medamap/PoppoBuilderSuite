/**
 * GitHubテスト用のサンプルデータ
 */

const sampleIssue = {
    id: 1,
    number: 123,
    title: 'Sample Issue',
    body: 'This is a sample issue for testing',
    state: 'open',
    labels: [
        { name: 'task:misc', color: 'f0f0f0' },
        { name: 'priority:normal', color: '00ff00' }
    ],
    user: {
        login: 'testuser',
        id: 12345
    },
    assignees: [],
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z',
    html_url: 'https://github.com/test/repo/issues/123'
};

const samplePullRequest = {
    id: 2,
    number: 456,
    title: 'Sample Pull Request',
    body: 'This is a sample PR for testing',
    state: 'open',
    head: {
        sha: 'abc123def456',
        ref: 'feature-branch'
    },
    base: {
        sha: 'def456abc789',
        ref: 'main'
    },
    user: {
        login: 'testuser',
        id: 12345
    },
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z',
    html_url: 'https://github.com/test/repo/pull/456'
};

const sampleComment = {
    id: 789,
    body: 'This is a test comment',
    user: {
        login: 'testuser',
        id: 12345
    },
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z',
    html_url: 'https://github.com/test/repo/issues/123#issuecomment-789'
};

const sampleFileContent = {
    name: 'test.js',
    path: 'src/test.js',
    content: 'Y29uc29sZS5sb2coJ0hlbGxvLCB3b3JsZCEnKTs=', // base64 encoded "console.log('Hello, world!');"
    encoding: 'base64',
    sha: 'abc123'
};

const sampleChangedFiles = [
    {
        filename: 'src/test.js',
        status: 'modified',
        additions: 10,
        deletions: 5,
        changes: 15,
        patch: '@@ -1,3 +1,8 @@\n console.log("test");\n+console.log("new line");'
    },
    {
        filename: 'src/new-file.js',
        status: 'added',
        additions: 20,
        deletions: 0,
        changes: 20,
        patch: '@@ -0,0 +1,20 @@\n+function newFunction() {\n+  return true;\n+}'
    }
];

const sampleLabels = [
    { name: 'task:misc', color: 'f0f0f0', description: 'Miscellaneous task' },
    { name: 'task:dogfooding', color: 'ff0000', description: 'Dogfooding task' },
    { name: 'task:bug', color: 'ee0000', description: 'Bug fix' },
    { name: 'task:feature', color: '00ff00', description: 'New feature' },
    { name: 'task:docs', color: '0000ff', description: 'Documentation' },
    { name: 'priority:high', color: 'ff4444', description: 'High priority' },
    { name: 'priority:normal', color: '44ff44', description: 'Normal priority' },
    { name: 'priority:low', color: '4444ff', description: 'Low priority' },
    { name: 'status:in-progress', color: 'ffaa00', description: 'In progress' },
    { name: 'status:review', color: 'aa00ff', description: 'Under review' }
];

const sampleReview = {
    id: 101,
    user: {
        login: 'reviewer',
        id: 67890
    },
    body: 'This is a review comment',
    state: 'COMMENTED',
    commit_id: 'abc123def456',
    submitted_at: '2023-01-01T00:00:00Z'
};

module.exports = {
    sampleIssue,
    samplePullRequest,
    sampleComment,
    sampleFileContent,
    sampleChangedFiles,
    sampleLabels,
    sampleReview,
    
    // ヘルパー関数
    createIssue: (overrides = {}) => ({
        ...sampleIssue,
        ...overrides
    }),
    
    createPullRequest: (overrides = {}) => ({
        ...samplePullRequest,
        ...overrides
    }),
    
    createComment: (overrides = {}) => ({
        ...sampleComment,
        ...overrides
    }),
    
    createFileContent: (content, overrides = {}) => ({
        ...sampleFileContent,
        content: Buffer.from(content).toString('base64'),
        ...overrides
    }),
    
    createChangedFiles: (files = []) => {
        if (files.length === 0) return sampleChangedFiles;
        return files.map(file => ({
            filename: file.filename || 'test.js',
            status: file.status || 'modified',
            additions: file.additions || 10,
            deletions: file.deletions || 5,
            changes: (file.additions || 10) + (file.deletions || 5),
            patch: file.patch || '@@ -1,3 +1,8 @@\n console.log("test");'
        }));
    }
};