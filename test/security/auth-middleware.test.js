const { expect } = require('chai');
const sinon = require('sinon');
const MockFactory = require('../helpers/mock-factory');
const AuthMiddleware = require('../../src/security/auth-middleware');

describe('AuthMiddleware', () => {
    let authMiddleware;
    let sandbox;
    let mockFactory;
    let mockReq, mockRes, mockNext;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        mockFactory = new MockFactory();
        
        // AuthMiddleware のモック依存関係を設定
        authMiddleware = new AuthMiddleware();
        authMiddleware.jwtAuth = mockFactory.createMockJWTAuth();
        authMiddleware.rbac = mockFactory.createMockRBAC();
        authMiddleware.auditLogger = mockFactory.createMockAuditLogger();
        authMiddleware.initialized = false;
        
        mockReq = mockFactory.createMockRequest();
        mockRes = mockFactory.createMockResponse();
        mockNext = mockFactory.createMockNext();
    });

    afterEach(() => {
        sandbox.restore();
        mockFactory.cleanup();
    });

    describe('initialize', () => {
        it('すべてのコンポーネントが初期化されること', async () => {
            sandbox.stub(authMiddleware.jwtAuth, 'initialize').resolves();
            sandbox.stub(authMiddleware.rbac, 'initialize').resolves();
            sandbox.stub(authMiddleware.auditLogger, 'initialize').resolves();

            await authMiddleware.initialize();

            expect(authMiddleware.initialized).to.be.true;
            expect(authMiddleware.jwtAuth.initialize).to.have.been.calledOnce;
            expect(authMiddleware.rbac.initialize).to.have.been.calledOnce;
            expect(authMiddleware.auditLogger.initialize).to.have.been.calledOnce;
        });

        it('既に初期化されている場合は再初期化しないこと', async () => {
            authMiddleware.initialized = true;
            sandbox.stub(authMiddleware.jwtAuth, 'initialize');

            await authMiddleware.initialize();

            expect(authMiddleware.jwtAuth.initialize).to.not.have.been.called;
        });
    });

    describe('authenticate', () => {
        beforeEach(async () => {
            sandbox.stub(authMiddleware, 'initialize').resolves();
            sandbox.stub(authMiddleware.auditLogger, 'logEvent').resolves();
        });

        it('有効な認証情報で認証が成功すること', async () => {
            const mockAuthResult = {
                accessToken: 'mock-token',
                refreshToken: 'mock-refresh',
                role: 'test-role',
                permissions: ['test.read']
            };
            
            sandbox.stub(authMiddleware.jwtAuth, 'authenticateAgent').resolves(mockAuthResult);

            const result = await authMiddleware.authenticate('test-agent', 'test-api-key', {
                ipAddress: '192.168.1.1'
            });

            expect(result).to.deep.equal(mockAuthResult);
            expect(authMiddleware.auditLogger.logEvent).to.have.been.calledTwice;
            
            const firstCall = authMiddleware.auditLogger.logEvent.firstCall.args[0];
            expect(firstCall.eventType).to.equal('authentication_attempt');
            expect(firstCall.result).to.equal('pending');
            
            const secondCall = authMiddleware.auditLogger.logEvent.secondCall.args[0];
            expect(secondCall.eventType).to.equal('authentication_success');
            expect(secondCall.result).to.equal('success');
        });

        it('無効な認証情報で認証が失敗すること', async () => {
            const error = new Error('Invalid credentials');
            authMiddleware.jwtAuth.authenticateAgent.rejects(error);

            try {
                await authMiddleware.authenticate('test-agent', 'invalid-key');
                expect.fail('Expected authentication to fail');
            } catch (err) {
                expect(err.message).to.equal('Invalid credentials');
            }

            expect(authMiddleware.auditLogger.logEvent).to.have.been.calledTwice;
            
            const lastCall = authMiddleware.auditLogger.logEvent.lastCall.args[0];
            expect(lastCall.eventType).to.equal('authentication_failure');
            expect(lastCall.result).to.equal('failure');
            expect(lastCall.errorMessage).to.equal('Invalid credentials');
        });
    });

    describe('createExpressMiddleware', () => {
        beforeEach(async () => {
            sandbox.stub(authMiddleware, 'initialize').resolves();
            sandbox.stub(authMiddleware.auditLogger, 'logEvent').resolves();
        });

        it('認証ヘッダーがない場合401エラーを返すこと', async () => {
            const middleware = authMiddleware.createExpressMiddleware('test.read');
            
            await middleware(mockReq, mockRes, mockNext);

            expect(mockRes.status).to.have.been.calledWith(401);
            expect(mockRes.json).to.have.been.calledWith({
                error: 'Unauthorized',
                message: '認証が必要です'
            });
            expect(mockNext).to.not.have.been.called;
        });

        it('有効なトークンで認証が成功すること', async () => {
            mockReq.headers.authorization = 'Bearer valid-token';
            
            sandbox.stub(authMiddleware.jwtAuth, 'extractTokenFromHeader').returns('valid-token');
            sandbox.stub(authMiddleware.jwtAuth, 'verifyAccessToken').resolves({
                agentId: 'test-agent',
                permissions: ['test.read']
            });
            sandbox.stub(authMiddleware.jwtAuth, 'validatePermission').resolves(true);

            const middleware = authMiddleware.createExpressMiddleware('test.read');
            await middleware(mockReq, mockRes, mockNext);

            expect(mockReq.auth).to.deep.equal({
                agentId: 'test-agent',
                permissions: ['test.read']
            });
            expect(mockNext).to.have.been.calledOnce;
            expect(mockRes.status).to.not.have.been.called;
        });

        it('権限が不足している場合403エラーを返すこと', async () => {
            mockReq.headers.authorization = 'Bearer valid-token';
            
            sandbox.stub(authMiddleware.jwtAuth, 'extractTokenFromHeader').returns('valid-token');
            sandbox.stub(authMiddleware.jwtAuth, 'verifyAccessToken').resolves({
                agentId: 'test-agent',
                permissions: ['test.read']
            });
            sandbox.stub(authMiddleware.jwtAuth, 'validatePermission').resolves(false);

            const middleware = authMiddleware.createExpressMiddleware('test.write');
            await middleware(mockReq, mockRes, mockNext);

            expect(mockRes.status).to.have.been.calledWith(403);
            expect(mockRes.json).to.have.been.calledWith({
                error: 'Forbidden',
                message: '権限が不足しています'
            });
            expect(mockNext).to.not.have.been.called;
        });

        it('無効なトークンで401エラーを返すこと', async () => {
            mockReq.headers.authorization = 'Bearer invalid-token';
            
            sandbox.stub(authMiddleware.jwtAuth, 'extractTokenFromHeader').returns('invalid-token');
            sandbox.stub(authMiddleware.jwtAuth, 'verifyAccessToken').rejects(new Error('Invalid token'));

            const middleware = authMiddleware.createExpressMiddleware();
            await middleware(mockReq, mockRes, mockNext);

            expect(mockRes.status).to.have.been.calledWith(401);
            expect(mockRes.json).to.have.been.calledWith({
                error: 'Unauthorized',
                message: 'トークンが無効です'
            });
            expect(mockNext).to.not.have.been.called;
        });
    });

    describe('createFileMessageMiddleware', () => {
        beforeEach(async () => {
            sandbox.stub(authMiddleware, 'initialize').resolves();
            sandbox.stub(authMiddleware.auditLogger, 'logEvent').resolves();
        });

        it('認証トークンがないメッセージを拒否すること', async () => {
            const message = {
                from: 'test-agent',
                type: 'TEST_MESSAGE',
                id: 'msg-123'
            };

            const middleware = authMiddleware.createFileMessageMiddleware('test.read');
            
            try {
                await middleware(message);
                expect.fail('Expected middleware to reject message');
            } catch (err) {
                expect(err.message).to.include('認証トークンがありません');
            }
        });

        it('有効なトークンでメッセージを処理すること', async () => {
            const message = {
                from: 'test-agent',
                to: 'core',
                type: 'TEST_MESSAGE',
                id: 'msg-123',
                auth: {
                    token: 'valid-token'
                }
            };

            sandbox.stub(authMiddleware.jwtAuth, 'verifyAccessToken').resolves({
                agentId: 'test-agent',
                permissions: ['test.read']
            });
            sandbox.stub(authMiddleware.rbac, 'hasPermission').returns(true);

            const middleware = authMiddleware.createFileMessageMiddleware('test.read');
            const result = await middleware(message);

            expect(result).to.deep.equal({
                valid: true,
                agentId: 'test-agent',
                permissions: ['test.read']
            });
        });

        it('エージェントIDが一致しない場合メッセージを拒否すること', async () => {
            const message = {
                from: 'test-agent',
                auth: {
                    token: 'valid-token'
                }
            };

            authMiddleware.jwtAuth.verifyAccessToken.resolves({
                agentId: 'different-agent',
                permissions: ['test.read']
            });

            const middleware = authMiddleware.createFileMessageMiddleware();
            
            try {
                await middleware(message);
                expect.fail('Expected middleware to reject message');
            } catch (err) {
                expect(err.message).to.include('エージェントIDが一致しません');
            }
        });

        it('権限が不足している場合メッセージを拒否すること', async () => {
            const message = {
                from: 'test-agent',
                auth: {
                    token: 'valid-token'
                }
            };

            authMiddleware.jwtAuth.verifyAccessToken.resolves({
                agentId: 'test-agent',
                permissions: ['test.read']
            });
            authMiddleware.rbac.hasPermission.returns(false);

            const middleware = authMiddleware.createFileMessageMiddleware('test.write');
            
            try {
                await middleware(message);
                expect.fail('Expected middleware to reject message');
            } catch (err) {
                expect(err.message).to.include('権限が不足しています: test.write');
            }
        });
    });

    describe('getSecurityMetrics', () => {
        it('セキュリティメトリクスを取得できること', async () => {
            const mockLogs = [
                { result: 'success', event_type: 'api_access', agent_id: 'agent1' },
                { result: 'success', event_type: 'api_access', agent_id: 'agent2' },
                { result: 'failure', event_type: 'authentication_failure', agent_id: 'agent1' },
                { result: 'blocked', event_type: 'authorization_failure', agent_id: 'agent3' }
            ];
            
            const mockAlerts = [
                { id: 1, type: 'brute_force', resolved: false }
            ];

            sandbox.stub(authMiddleware.auditLogger, 'getAuditLogs').resolves(mockLogs);
            sandbox.stub(authMiddleware.auditLogger, 'getSecurityAlerts').resolves(mockAlerts);

            const metrics = await authMiddleware.getSecurityMetrics();

            expect(metrics.totalRequests).to.equal(4);
            expect(metrics.successfulRequests).to.equal(2);
            expect(metrics.failedRequests).to.equal(1);
            expect(metrics.blockedRequests).to.equal(1);
            expect(metrics.uniqueAgents).to.equal(3);
            expect(metrics.authenticationFailures).to.equal(1);
            expect(metrics.authorizationFailures).to.equal(1);
            expect(metrics.activeAlerts).to.have.lengthOf(1);
            expect(metrics.successRate).to.equal('50.00');
        });
    });

    describe('generateNewApiKey', () => {
        it('新しいAPIキーを生成できること', async () => {
            const mockAgent = {
                apiKeyHash: 'old-hash'
            };
            
            authMiddleware.jwtAuth.agentCredentials = {
                'test-agent': mockAgent
            };
            authMiddleware.jwtAuth.saltRounds = 10;
            
            sandbox.stub(authMiddleware.jwtAuth, 'saveAgentCredentials').resolves();
            sandbox.stub(authMiddleware.auditLogger, 'logEvent').resolves();

            const bcrypt = require('bcrypt');
            sandbox.stub(bcrypt, 'hash').resolves('new-hash');

            const newApiKey = await authMiddleware.generateNewApiKey('test-agent');

            expect(newApiKey).to.be.a('string');
            expect(newApiKey).to.have.lengthOf(64);
            expect(mockAgent.apiKeyHash).to.equal('new-hash');
            expect(mockAgent.lastRotated).to.exist;
        });

        it('存在しないエージェントでエラーになること', async () => {
            authMiddleware.jwtAuth.agentCredentials = {};

            try {
                await authMiddleware.generateNewApiKey('non-existent');
                expect.fail('Expected generateNewApiKey to fail');
            } catch (err) {
                expect(err.message).to.include('エージェントが見つかりません');
            }
        });
    });
});