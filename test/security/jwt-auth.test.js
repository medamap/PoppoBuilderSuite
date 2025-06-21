const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs').promises;
const path = require('path');
const JWTAuthManager = require('../../src/security/jwt-auth');

describe('JWTAuthManager', () => {
    let jwtAuth;
    let sandbox;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        jwtAuth = new JWTAuthManager();
    });

    afterEach(() => {
        sandbox.restore();
    });

    describe('initialize', () => {
        it('初期化が正常に完了すること', async () => {
            sandbox.stub(fs, 'mkdir').resolves();
            sandbox.stub(fs, 'readFile').rejects(new Error('File not found'));
            sandbox.stub(fs, 'writeFile').resolves();
            sandbox.stub(fs, 'chmod').resolves();

            await jwtAuth.initialize();

            expect(jwtAuth.secretKey).to.exist;
            expect(jwtAuth.refreshSecretKey).to.exist;
            expect(jwtAuth.agentCredentials).to.exist;
        });

        it('既存の鍵を読み込むこと', async () => {
            const mockSecretKey = 'existing-secret-key';
            const mockRefreshKey = 'existing-refresh-key';
            const mockCredentials = { 'test-agent': { id: 'test-agent' } };

            sandbox.stub(fs, 'mkdir').resolves();
            sandbox.stub(fs, 'readFile')
                .onFirstCall().resolves(mockSecretKey)
                .onSecondCall().resolves(mockRefreshKey)
                .onThirdCall().resolves(JSON.stringify(mockCredentials));

            await jwtAuth.initialize();

            expect(jwtAuth.secretKey).to.equal(mockSecretKey);
            expect(jwtAuth.refreshSecretKey).to.equal(mockRefreshKey);
            expect(jwtAuth.agentCredentials).to.deep.equal(mockCredentials);
        });
    });

    describe('generateAccessToken', () => {
        beforeEach(async () => {
            jwtAuth.secretKey = 'test-secret-key';
        });

        it('有効なアクセストークンを生成すること', async () => {
            const agentId = 'test-agent';
            const permissions = ['read', 'write'];

            const token = await jwtAuth.generateAccessToken(agentId, permissions);

            expect(token).to.be.a('string');
            expect(token.split('.')).to.have.lengthOf(3);
        });

        it('トークンに正しいペイロードが含まれること', async () => {
            const agentId = 'test-agent';
            const permissions = ['read', 'write'];

            const token = await jwtAuth.generateAccessToken(agentId, permissions);
            const decoded = await jwtAuth.verifyAccessToken(token);

            expect(decoded.agentId).to.equal(agentId);
            expect(decoded.permissions).to.deep.equal(permissions);
            expect(decoded.type).to.equal('access');
        });
    });

    describe('authenticateAgent', () => {
        beforeEach(async () => {
            sandbox.stub(fs, 'mkdir').resolves();
            sandbox.stub(fs, 'readFile').rejects(new Error('File not found'));
            sandbox.stub(fs, 'writeFile').resolves();
            sandbox.stub(fs, 'chmod').resolves();
            
            await jwtAuth.initialize();
        });

        it('有効なAPIキーで認証が成功すること', async () => {
            const agentId = 'poppo-builder';
            const apiKey = 'valid-api-key';

            const bcrypt = require('bcrypt');
            sandbox.stub(bcrypt, 'compare').resolves(true);

            const result = await jwtAuth.authenticateAgent(agentId, apiKey);

            expect(result).to.have.property('accessToken');
            expect(result).to.have.property('refreshToken');
            expect(result).to.have.property('expiresIn');
            expect(result).to.have.property('permissions');
            expect(result).to.have.property('role');
        });

        it('無効なAPIキーで認証が失敗すること', async () => {
            const agentId = 'poppo-builder';
            const apiKey = 'invalid-api-key';

            const bcrypt = require('bcrypt');
            sandbox.stub(bcrypt, 'compare').resolves(false);

            try {
                await jwtAuth.authenticateAgent(agentId, apiKey);
                expect.fail('Expected authentication to fail');
            } catch (err) {
                expect(err.message).to.include('認証に失敗しました');
            }
        });

        it('存在しないエージェントで認証が失敗すること', async () => {
            const agentId = 'non-existent-agent';
            const apiKey = 'any-api-key';

            try {
                await jwtAuth.authenticateAgent(agentId, apiKey);
                expect.fail('Expected authentication to fail');
            } catch (err) {
                expect(err.message).to.include('エージェントが見つからないか無効です');
            }
        });
    });

    describe('refreshAccessToken', () => {
        beforeEach(async () => {
            jwtAuth.secretKey = 'test-secret-key';
            jwtAuth.refreshSecretKey = 'test-refresh-key';
            jwtAuth.agentCredentials = {
                'test-agent': {
                    id: 'test-agent',
                    permissions: ['read', 'write'],
                    active: true
                }
            };
        });

        it('有効なリフレッシュトークンで新しいアクセストークンを取得できること', async () => {
            const refreshToken = await jwtAuth.generateRefreshToken('test-agent');
            const result = await jwtAuth.refreshAccessToken(refreshToken);

            expect(result).to.have.property('accessToken');
            expect(result).to.have.property('expiresIn');
            expect(result).to.have.property('tokenType', 'Bearer');
        });

        it('無効なリフレッシュトークンでエラーになること', async () => {
            const invalidToken = 'invalid.refresh.token';

            try {
                await jwtAuth.refreshAccessToken(invalidToken);
                expect.fail('Expected token refresh to fail');
            } catch (err) {
                expect(err.message).to.include('リフレッシュトークンの検証に失敗');
            }
        });
    });

    describe('validatePermission', () => {
        beforeEach(() => {
            jwtAuth.secretKey = 'test-secret-key';
            jwtAuth.agentCredentials = {
                'test-agent': {
                    id: 'test-agent',
                    permissions: ['read', 'write'],
                    active: true
                },
                'admin-agent': {
                    id: 'admin-agent',
                    permissions: ['*'],
                    active: true
                }
            };
        });

        it('必要な権限を持つエージェントの検証が成功すること', async () => {
            const token = await jwtAuth.generateAccessToken('test-agent', ['read', 'write']);
            const hasPermission = await jwtAuth.validatePermission(token, 'read');

            expect(hasPermission).to.be.true;
        });

        it('必要な権限を持たないエージェントの検証が失敗すること', async () => {
            const token = await jwtAuth.generateAccessToken('test-agent', ['read', 'write']);
            const hasPermission = await jwtAuth.validatePermission(token, 'delete');

            expect(hasPermission).to.be.false;
        });

        it('ワイルドカード権限を持つエージェントはすべての権限を持つこと', async () => {
            const token = await jwtAuth.generateAccessToken('admin-agent', ['*']);
            const hasPermission = await jwtAuth.validatePermission(token, 'any.permission');

            expect(hasPermission).to.be.true;
        });
    });

    describe('revokeAgent', () => {
        beforeEach(() => {
            jwtAuth.agentCredentials = {
                'test-agent': {
                    id: 'test-agent',
                    active: true
                }
            };
            sandbox.stub(jwtAuth, 'saveAgentCredentials').resolves();
        });

        it('エージェントを無効化できること', async () => {
            await jwtAuth.revokeAgent('test-agent');

            expect(jwtAuth.agentCredentials['test-agent'].active).to.be.false;
            expect(jwtAuth.saveAgentCredentials).to.have.been.calledOnce;
        });

        it('存在しないエージェントの無効化を試みてもエラーにならないこと', async () => {
            await expect(jwtAuth.revokeAgent('non-existent')).to.not.be.rejected;
        });
    });

    describe('extractTokenFromHeader', () => {
        it('正しい形式のヘッダーからトークンを抽出できること', () => {
            const header = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
            const token = jwtAuth.extractTokenFromHeader(header);

            expect(token).to.equal('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
        });

        it('不正な形式のヘッダーでエラーになること', () => {
            expect(() => jwtAuth.extractTokenFromHeader('Invalid header'))
                .to.throw('認証ヘッダーが無効です');

            expect(() => jwtAuth.extractTokenFromHeader(null))
                .to.throw('認証ヘッダーが無効です');
        });
    });
});