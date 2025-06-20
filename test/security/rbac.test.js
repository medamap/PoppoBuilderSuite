const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs').promises;
const RBACManager = require('../../src/security/rbac');

describe('RBACManager', () => {
    let rbac;
    let sandbox;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        rbac = new RBACManager();
    });

    afterEach(() => {
        sandbox.restore();
    });

    describe('initialize', () => {
        it('初期化が正常に完了すること', async () => {
            sandbox.stub(fs, 'readFile').rejects(new Error('File not found'));
            sandbox.stub(fs, 'mkdir').resolves();
            sandbox.stub(fs, 'writeFile').resolves();

            await rbac.initialize();

            expect(rbac.roles).to.exist;
            expect(rbac.permissions).to.exist;
            expect(Object.keys(rbac.roles).length).to.be.greaterThan(0);
            expect(Object.keys(rbac.permissions).length).to.be.greaterThan(0);
        });

        it('既存の設定を読み込むこと', async () => {
            const mockRoles = {
                'test-role': {
                    name: 'Test Role',
                    permissions: ['test.*']
                }
            };
            const mockPermissions = {
                'test': {
                    name: 'テスト',
                    actions: {
                        'read': '読み取り',
                        'write': '書き込み'
                    }
                }
            };

            sandbox.stub(fs, 'readFile')
                .onFirstCall().resolves(JSON.stringify(mockRoles))
                .onSecondCall().resolves(JSON.stringify(mockPermissions));

            await rbac.initialize();

            expect(rbac.roles).to.deep.equal(mockRoles);
            expect(rbac.permissions).to.deep.equal(mockPermissions);
        });
    });

    describe('hasPermission', () => {
        beforeEach(() => {
            rbac.permissions = {
                'system': {
                    name: 'システム管理',
                    actions: {
                        '*': 'すべて',
                        'monitor': '監視',
                        'config': '設定'
                    }
                },
                'log': {
                    name: 'ログ管理',
                    actions: {
                        'read': '読み取り',
                        'write': '書き込み'
                    }
                }
            };
        });

        it('ワイルドカード権限を持つ場合、すべての権限を許可すること', () => {
            const userPermissions = ['*'];
            expect(rbac.hasPermission(userPermissions, 'system.monitor')).to.be.true;
            expect(rbac.hasPermission(userPermissions, 'log.read')).to.be.true;
            expect(rbac.hasPermission(userPermissions, 'any.permission')).to.be.true;
        });

        it('完全一致する権限を持つ場合、許可すること', () => {
            const userPermissions = ['system.monitor', 'log.read'];
            expect(rbac.hasPermission(userPermissions, 'system.monitor')).to.be.true;
            expect(rbac.hasPermission(userPermissions, 'log.read')).to.be.true;
        });

        it('リソースレベルのワイルドカード権限を持つ場合、そのリソースのすべてのアクションを許可すること', () => {
            const userPermissions = ['system.*'];
            expect(rbac.hasPermission(userPermissions, 'system.monitor')).to.be.true;
            expect(rbac.hasPermission(userPermissions, 'system.config')).to.be.true;
            expect(rbac.hasPermission(userPermissions, 'log.read')).to.be.false;
        });

        it('権限を持たない場合、拒否すること', () => {
            const userPermissions = ['system.monitor'];
            expect(rbac.hasPermission(userPermissions, 'system.config')).to.be.false;
            expect(rbac.hasPermission(userPermissions, 'log.read')).to.be.false;
        });
    });

    describe('validatePermissionString', () => {
        beforeEach(() => {
            rbac.permissions = {
                'system': {
                    actions: {
                        'monitor': '監視',
                        'config': '設定'
                    }
                }
            };
        });

        it('有効な権限文字列を検証すること', () => {
            expect(rbac.validatePermissionString('*')).to.be.true;
            expect(rbac.validatePermissionString('system.*')).to.be.true;
            expect(rbac.validatePermissionString('system.monitor')).to.be.true;
        });

        it('無効な権限文字列を拒否すること', () => {
            expect(rbac.validatePermissionString('invalid')).to.be.false;
            expect(rbac.validatePermissionString('system.invalid')).to.be.false;
            expect(rbac.validatePermissionString('invalid.action')).to.be.false;
            expect(rbac.validatePermissionString('too.many.parts')).to.be.false;
        });
    });

    describe('addRole', () => {
        beforeEach(() => {
            rbac.permissions = {
                'test': {
                    actions: {
                        'read': '読み取り',
                        'write': '書き込み'
                    }
                }
            };
            sandbox.stub(rbac, 'saveRoles').resolves();
        });

        it('新しいロールを追加できること', async () => {
            const roleData = {
                name: 'New Role',
                description: '新しいロール',
                permissions: ['test.read', 'test.write'],
                priority: 50
            };

            await rbac.addRole('new-role', roleData);

            expect(rbac.roles['new-role']).to.exist;
            expect(rbac.roles['new-role'].name).to.equal('New Role');
            expect(rbac.roles['new-role'].permissions).to.deep.equal(['test.read', 'test.write']);
        });

        it('既存のロールIDで追加しようとするとエラーになること', async () => {
            rbac.roles['existing-role'] = { name: 'Existing' };

            try {
                await rbac.addRole('existing-role', { name: 'New' });
                expect.fail('Expected addRole to fail');
            } catch (err) {
                expect(err.message).to.include('ロール existing-role は既に存在します');
            }
        });

        it('無効な権限を含むロールを追加しようとするとエラーになること', async () => {
            const roleData = {
                name: 'Invalid Role',
                permissions: ['invalid.permission']
            };

            try {
                await rbac.addRole('invalid-role', roleData);
                expect.fail('Expected addRole to fail');
            } catch (err) {
                expect(err.message).to.include('無効な権限: invalid.permission');
            }
        });
    });

    describe('updateRole', () => {
        beforeEach(() => {
            rbac.roles = {
                'test-role': {
                    name: 'Test Role',
                    description: 'テストロール',
                    permissions: ['test.read'],
                    priority: 50
                }
            };
            rbac.permissions = {
                'test': {
                    actions: {
                        'read': '読み取り',
                        'write': '書き込み'
                    }
                }
            };
            sandbox.stub(rbac, 'saveRoles').resolves();
        });

        it('既存のロールを更新できること', async () => {
            const updates = {
                description: '更新されたテストロール',
                permissions: ['test.read', 'test.write']
            };

            await rbac.updateRole('test-role', updates);

            expect(rbac.roles['test-role'].description).to.equal('更新されたテストロール');
            expect(rbac.roles['test-role'].permissions).to.deep.equal(['test.read', 'test.write']);
            expect(rbac.roles['test-role'].name).to.equal('Test Role');
        });

        it('存在しないロールを更新しようとするとエラーになること', async () => {
            try {
                await rbac.updateRole('non-existent', { name: 'Updated' });
                expect.fail('Expected updateRole to fail');
            } catch (err) {
                expect(err.message).to.include('ロール non-existent が見つかりません');
            }
        });
    });

    describe('removeRole', () => {
        beforeEach(() => {
            rbac.roles = {
                'test-role': { name: 'Test Role' }
            };
            sandbox.stub(rbac, 'saveRoles').resolves();
        });

        it('ロールを削除できること', async () => {
            await rbac.removeRole('test-role');

            expect(rbac.roles['test-role']).to.be.undefined;
            expect(rbac.saveRoles).to.have.been.calledOnce;
        });

        it('存在しないロールを削除しようとするとエラーになること', async () => {
            try {
                await rbac.removeRole('non-existent');
                expect.fail('Expected removeRole to fail');
            } catch (err) {
                expect(err.message).to.include('ロール non-existent が見つかりません');
            }
        });
    });

    describe('getPermissionDescription', () => {
        beforeEach(() => {
            rbac.permissions = {
                'system': {
                    name: 'システム管理',
                    actions: {
                        '*': 'すべてのシステム操作',
                        'monitor': 'システム監視'
                    }
                }
            };
        });

        it('権限の説明を取得できること', () => {
            expect(rbac.getPermissionDescription('*')).to.equal('すべての権限');
            expect(rbac.getPermissionDescription('system.*')).to.equal('システム管理のすべての操作');
            expect(rbac.getPermissionDescription('system.monitor')).to.equal('システム監視');
            expect(rbac.getPermissionDescription('unknown.permission')).to.equal('不明な権限');
        });
    });

    describe('generatePermissionReport', () => {
        beforeEach(() => {
            rbac.roles = {
                'admin': {
                    name: 'Administrator',
                    permissions: ['*'],
                    priority: 100
                },
                'viewer': {
                    name: 'Viewer',
                    permissions: ['system.monitor', 'log.read'],
                    priority: 10
                }
            };
            rbac.permissions = {
                'system': {
                    name: 'システム管理',
                    actions: {
                        '*': 'すべて',
                        'monitor': '監視'
                    }
                },
                'log': {
                    name: 'ログ管理',
                    actions: {
                        'read': '読み取り'
                    }
                }
            };
        });

        it('権限レポートを生成できること', async () => {
            const report = await rbac.generatePermissionReport();

            expect(report).to.have.property('roles');
            expect(report).to.have.property('permissions');
            expect(report).to.have.property('generatedAt');

            expect(report.roles.admin.expandedPermissions).to.have.lengthOf(1);
            expect(report.roles.admin.expandedPermissions[0].permission).to.equal('*');
            expect(report.roles.admin.expandedPermissions[0].description).to.equal('すべての権限');

            expect(report.roles.viewer.expandedPermissions).to.have.lengthOf(2);
        });
    });
});