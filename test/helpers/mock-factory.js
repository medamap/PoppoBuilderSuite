const sinon = require('sinon');
const EventEmitter = require('events');

/**
 * テスト用のモックオブジェクト生成ファクトリー
 */
class MockFactory {
    constructor() {
        this.stubs = [];
        this.mocks = [];
    }

    /**
     * Express リクエストのモック
     */
    createMockRequest(options = {}) {
        return {
            headers: options.headers || {},
            query: options.query || {},
            params: options.params || {},
            body: options.body || {},
            ip: options.ip || '127.0.0.1',
            path: options.path || '/test',
            method: options.method || 'GET',
            id: options.id || 'test-req-id',
            sessionID: options.sessionID || 'test-session-id',
            user: options.user || null,
            ...options.additional
        };
    }

    /**
     * Express レスポンスのモック
     */
    createMockResponse() {
        const res = {
            status: sinon.stub().returnsThis(),
            json: sinon.stub().returnsThis(),
            send: sinon.stub().returnsThis(),
            end: sinon.stub().returnsThis(),
            redirect: sinon.stub().returnsThis(),
            cookie: sinon.stub().returnsThis(),
            clearCookie: sinon.stub().returnsThis(),
            header: sinon.stub().returnsThis(),
            locals: {}
        };
        this.mocks.push(res);
        return res;
    }

    /**
     * Express next関数のモック
     */
    createMockNext() {
        const next = sinon.stub();
        this.stubs.push(next);
        return next;
    }

    /**
     * Loggerのモック
     */
    createMockLogger() {
        const logger = {
            debug: sinon.stub(),
            info: sinon.stub(),
            warn: sinon.stub(),
            error: sinon.stub(),
            log: sinon.stub()
        };
        this.mocks.push(logger);
        return logger;
    }

    /**
     * GitHubクライアントのモック
     */
    createMockGitHubClient() {
        const github = {
            // Issues
            getIssue: sinon.stub().resolves({
                number: 1,
                title: 'Test Issue',
                body: 'Test body',
                state: 'open',
                labels: []
            }),
            listIssues: sinon.stub().resolves([]),
            createIssueComment: sinon.stub().resolves({ id: 1 }),
            addLabels: sinon.stub().resolves(),
            removeLabels: sinon.stub().resolves(),
            
            // Pull Requests
            getPullRequest: sinon.stub().resolves({
                number: 1,
                title: 'Test PR',
                head: { sha: 'abc123' },
                base: { sha: 'def456' }
            }),
            listPullRequests: sinon.stub().resolves([]),
            createReview: sinon.stub().resolves({ id: 1 }),
            
            // Files
            getFileContent: sinon.stub().resolves('file content'),
            getChangedFiles: sinon.stub().resolves([])
        };
        this.mocks.push(github);
        return github;
    }

    /**
     * Claude APIクライアントのモック
     */
    createMockClaudeClient() {
        const claude = {
            sendMessage: sinon.stub().resolves({
                content: 'Mock response from Claude',
                usage: { input_tokens: 10, output_tokens: 20 }
            }),
            analyzeCode: sinon.stub().resolves({
                analysis: 'Mock code analysis',
                suggestions: []
            })
        };
        this.mocks.push(claude);
        return claude;
    }

    /**
     * JWTAuthManagerのモック
     */
    createMockJWTAuth() {
        const jwtAuth = {
            initialize: sinon.stub().resolves(),
            authenticateAgent: sinon.stub().resolves({
                accessToken: 'mock-access-token',
                refreshToken: 'mock-refresh-token',
                role: 'test-role',
                permissions: ['test.read']
            }),
            generateAccessToken: sinon.stub().returns('mock-token'),
            verifyAccessToken: sinon.stub().resolves({
                agentId: 'test-agent',
                permissions: ['test.read']
            }),
            extractTokenFromHeader: sinon.stub().returns('extracted-token'),
            validatePermission: sinon.stub().resolves(true),
            agentCredentials: {}
        };
        this.mocks.push(jwtAuth);
        return jwtAuth;
    }

    /**
     * RBACのモック
     */
    createMockRBAC() {
        const rbac = {
            initialize: sinon.stub().resolves(),
            hasPermission: sinon.stub().returns(true),
            getRolePermissions: sinon.stub().returns(['test.read']),
            validateAccess: sinon.stub().returns(true)
        };
        this.mocks.push(rbac);
        return rbac;
    }

    /**
     * AuditLoggerのモック
     */
    createMockAuditLogger() {
        const auditLogger = {
            initialize: sinon.stub().resolves(),
            logEvent: sinon.stub().resolves(),
            getAuditLogs: sinon.stub().resolves([]),
            getSecurityAlerts: sinon.stub().resolves([])
        };
        this.mocks.push(auditLogger);
        return auditLogger;
    }

    /**
     * FileStateManagerのモック
     */
    createMockFileStateManager() {
        const stateManager = {
            loadProcessedIssues: sinon.stub().resolves(new Set()),
            saveProcessedIssues: sinon.stub().resolves(),
            loadRunningTasks: sinon.stub().resolves(new Map()),
            saveRunningTasks: sinon.stub().resolves(),
            loadPendingTasks: sinon.stub().resolves([]),
            savePendingTasks: sinon.stub().resolves(),
            acquireProcessLock: sinon.stub().resolves(true),
            releaseProcessLock: sinon.stub().resolves()
        };
        this.mocks.push(stateManager);
        return stateManager;
    }

    /**
     * EventEmitterベースのモック
     */
    createMockEventEmitter() {
        const emitter = new EventEmitter();
        this.mocks.push(emitter);
        return emitter;
    }

    /**
     * WebSocketのモック
     */
    createMockWebSocket() {
        const ws = Object.assign(new EventEmitter(), {
            send: sinon.stub(),
            close: sinon.stub(),
            terminate: sinon.stub(),
            readyState: 1, // OPEN
            OPEN: 1,
            CLOSED: 3
        });
        this.mocks.push(ws);
        return ws;
    }

    /**
     * データベースのモック
     */
    createMockDatabase() {
        const db = {
            prepare: sinon.stub().returns({
                run: sinon.stub().returns({ changes: 1 }),
                get: sinon.stub().returns({}),
                all: sinon.stub().returns([])
            }),
            exec: sinon.stub(),
            close: sinon.stub(),
            transaction: sinon.stub().returns(() => {})
        };
        this.mocks.push(db);
        return db;
    }

    /**
     * Redisクライアントのモック
     */
    createMockRedis() {
        const redis = {
            get: sinon.stub().resolves(null),
            set: sinon.stub().resolves('OK'),
            del: sinon.stub().resolves(1),
            exists: sinon.stub().resolves(0),
            expire: sinon.stub().resolves(1),
            keys: sinon.stub().resolves([]),
            hget: sinon.stub().resolves(null),
            hset: sinon.stub().resolves(1),
            hdel: sinon.stub().resolves(1),
            lpush: sinon.stub().resolves(1),
            rpop: sinon.stub().resolves(null),
            llen: sinon.stub().resolves(0),
            disconnect: sinon.stub().resolves()
        };
        this.mocks.push(redis);
        return redis;
    }

    /**
     * すべてのスタブをリセット
     */
    resetAllStubs() {
        this.stubs.forEach(stub => {
            if (stub.reset) stub.reset();
        });
        
        this.mocks.forEach(mock => {
            Object.values(mock).forEach(method => {
                if (method && method.reset) method.reset();
            });
        });
    }

    /**
     * クリーンアップ
     */
    cleanup() {
        this.resetAllStubs();
        this.stubs = [];
        this.mocks = [];
    }
}

module.exports = MockFactory;