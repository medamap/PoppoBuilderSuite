const fs = require('fs').promises;
const path = require('path');

class RBACManager {
    constructor() {
        this.configPath = path.join(process.cwd(), 'config', 'security');
        this.rolesPath = path.join(this.configPath, 'roles.json');
        this.permissionsPath = path.join(this.configPath, 'permissions.json');
        this.roles = {};
        this.permissions = {};
    }

    async initialize() {
        await this.loadOrCreateRoles();
        await this.loadOrCreatePermissions();
    }

    async loadOrCreateRoles() {
        try {
            const data = await fs.readFile(this.rolesPath, 'utf8');
            this.roles = JSON.parse(data);
        } catch (error) {
            console.log('ロール設定が見つかりません。デフォルトを作成します。');
            await this.createDefaultRoles();
        }
    }

    async loadOrCreatePermissions() {
        try {
            const data = await fs.readFile(this.permissionsPath, 'utf8');
            this.permissions = JSON.parse(data);
        } catch (error) {
            console.log('権限設定が見つかりません。デフォルトを作成します。');
            await this.createDefaultPermissions();
        }
    }

    async createDefaultRoles() {
        this.roles = {
            'coordinator': {
                name: 'Coordinator',
                description: 'システム全体の調整・管理を行う最高権限',
                permissions: ['*'],
                priority: 100
            },
            'monitor': {
                name: 'Monitor',
                description: 'システム監視と復旧を行う権限',
                permissions: [
                    'system.monitor',
                    'system.health',
                    'process.read',
                    'process.restart',
                    'log.read',
                    'log.write',
                    'alert.send'
                ],
                priority: 90
            },
            'error-handler': {
                name: 'Error Handler',
                description: 'エラーの分析と修復を行う権限',
                permissions: [
                    'error.read',
                    'error.analyze',
                    'error.repair',
                    'code.read',
                    'code.suggest',
                    'issue.comment',
                    'log.read',
                    'log.write'
                ],
                priority: 80
            },
            'documentation': {
                name: 'Documentation',
                description: 'ドキュメントの生成・管理を行う権限',
                permissions: [
                    'doc.read',
                    'doc.write',
                    'doc.generate',
                    'doc.translate',
                    'code.read',
                    'issue.read',
                    'log.read'
                ],
                priority: 70
            },
            'reviewer': {
                name: 'Code Reviewer',
                description: 'コードレビューと改善提案を行う権限',
                permissions: [
                    'code.read',
                    'code.review',
                    'code.suggest',
                    'issue.read',
                    'issue.comment',
                    'log.read'
                ],
                priority: 70
            },
            'cleaner': {
                name: 'Cleaner',
                description: 'システムのクリーンアップを行う権限',
                permissions: [
                    'system.clean',
                    'log.read',
                    'log.clean',
                    'comment.read',
                    'comment.clean',
                    'file.read',
                    'file.clean'
                ],
                priority: 60
            },
            'orphan-manager': {
                name: 'Orphan Manager',
                description: '孤児Issueの検出・管理を行う権限',
                permissions: [
                    'issue.read',
                    'issue.detect',
                    'issue.manage',
                    'issue.comment',
                    'log.read',
                    'log.write'
                ],
                priority: 60
            },
            'guest': {
                name: 'Guest',
                description: '読み取り専用の最小権限',
                permissions: [
                    'system.info',
                    'log.read',
                    'issue.read'
                ],
                priority: 10
            }
        };

        await this.saveRoles();
    }

    async createDefaultPermissions() {
        this.permissions = {
            'system': {
                name: 'システム管理',
                actions: {
                    '*': 'すべてのシステム操作',
                    'monitor': 'システム監視',
                    'health': 'ヘルスチェック',
                    'clean': 'システムクリーンアップ',
                    'info': 'システム情報取得',
                    'config': 'システム設定変更'
                }
            },
            'process': {
                name: 'プロセス管理',
                actions: {
                    '*': 'すべてのプロセス操作',
                    'read': 'プロセス情報取得',
                    'start': 'プロセス起動',
                    'stop': 'プロセス停止',
                    'restart': 'プロセス再起動',
                    'kill': 'プロセス強制終了'
                }
            },
            'error': {
                name: 'エラー管理',
                actions: {
                    '*': 'すべてのエラー操作',
                    'read': 'エラー情報取得',
                    'analyze': 'エラー分析',
                    'repair': 'エラー修復',
                    'report': 'エラーレポート作成'
                }
            },
            'code': {
                name: 'コード管理',
                actions: {
                    '*': 'すべてのコード操作',
                    'read': 'コード読み取り',
                    'write': 'コード書き込み',
                    'review': 'コードレビュー',
                    'suggest': '改善提案'
                }
            },
            'doc': {
                name: 'ドキュメント管理',
                actions: {
                    '*': 'すべてのドキュメント操作',
                    'read': 'ドキュメント読み取り',
                    'write': 'ドキュメント書き込み',
                    'generate': 'ドキュメント生成',
                    'translate': 'ドキュメント翻訳'
                }
            },
            'issue': {
                name: 'Issue管理',
                actions: {
                    '*': 'すべてのIssue操作',
                    'read': 'Issue読み取り',
                    'write': 'Issue書き込み',
                    'comment': 'Issueコメント',
                    'detect': 'Issue検出',
                    'manage': 'Issue管理'
                }
            },
            'log': {
                name: 'ログ管理',
                actions: {
                    '*': 'すべてのログ操作',
                    'read': 'ログ読み取り',
                    'write': 'ログ書き込み',
                    'clean': 'ログクリーンアップ',
                    'export': 'ログエクスポート'
                }
            },
            'comment': {
                name: 'コメント管理',
                actions: {
                    '*': 'すべてのコメント操作',
                    'read': 'コメント読み取り',
                    'write': 'コメント書き込み',
                    'clean': 'コメントクリーンアップ'
                }
            },
            'file': {
                name: 'ファイル管理',
                actions: {
                    '*': 'すべてのファイル操作',
                    'read': 'ファイル読み取り',
                    'write': 'ファイル書き込み',
                    'clean': 'ファイルクリーンアップ'
                }
            },
            'alert': {
                name: 'アラート管理',
                actions: {
                    '*': 'すべてのアラート操作',
                    'send': 'アラート送信',
                    'read': 'アラート読み取り'
                }
            }
        };

        await this.savePermissions();
    }

    async saveRoles() {
        await fs.mkdir(this.configPath, { recursive: true });
        await fs.writeFile(
            this.rolesPath,
            JSON.stringify(this.roles, null, 2),
            'utf8'
        );
    }

    async savePermissions() {
        await fs.mkdir(this.configPath, { recursive: true });
        await fs.writeFile(
            this.permissionsPath,
            JSON.stringify(this.permissions, null, 2),
            'utf8'
        );
    }

    hasPermission(userPermissions, requiredPermission) {
        if (userPermissions.includes('*')) {
            return true;
        }

        if (userPermissions.includes(requiredPermission)) {
            return true;
        }

        const [resource, action] = requiredPermission.split('.');
        const wildcardPermission = `${resource}.*`;
        
        return userPermissions.includes(wildcardPermission);
    }

    getRolePermissions(roleName) {
        const role = this.roles[roleName];
        return role ? role.permissions : [];
    }

    validatePermissionString(permission) {
        if (permission === '*') {
            return true;
        }

        const parts = permission.split('.');
        if (parts.length !== 2) {
            return false;
        }

        const [resource, action] = parts;
        
        if (!this.permissions[resource]) {
            return false;
        }

        if (action === '*') {
            return true;
        }

        return this.permissions[resource].actions.hasOwnProperty(action);
    }

    async addRole(roleId, roleData) {
        if (this.roles[roleId]) {
            throw new Error(`ロール ${roleId} は既に存在します`);
        }

        for (const permission of roleData.permissions) {
            if (!this.validatePermissionString(permission)) {
                throw new Error(`無効な権限: ${permission}`);
            }
        }

        this.roles[roleId] = {
            name: roleData.name,
            description: roleData.description,
            permissions: roleData.permissions,
            priority: roleData.priority || 50
        };

        await this.saveRoles();
    }

    async updateRole(roleId, updates) {
        if (!this.roles[roleId]) {
            throw new Error(`ロール ${roleId} が見つかりません`);
        }

        if (updates.permissions) {
            for (const permission of updates.permissions) {
                if (!this.validatePermissionString(permission)) {
                    throw new Error(`無効な権限: ${permission}`);
                }
            }
        }

        this.roles[roleId] = {
            ...this.roles[roleId],
            ...updates
        };

        await this.saveRoles();
    }

    async removeRole(roleId) {
        if (!this.roles[roleId]) {
            throw new Error(`ロール ${roleId} が見つかりません`);
        }

        delete this.roles[roleId];
        await this.saveRoles();
    }

    getPermissionDescription(permission) {
        if (permission === '*') {
            return 'すべての権限';
        }

        const [resource, action] = permission.split('.');
        
        if (!this.permissions[resource]) {
            return '不明な権限';
        }

        if (action === '*') {
            return `${this.permissions[resource].name}のすべての操作`;
        }

        const actionDesc = this.permissions[resource].actions[action];
        return actionDesc || '不明な操作';
    }

    async generatePermissionReport() {
        const report = {
            roles: {},
            permissions: this.permissions,
            generatedAt: new Date().toISOString()
        };

        for (const [roleId, role] of Object.entries(this.roles)) {
            report.roles[roleId] = {
                ...role,
                expandedPermissions: role.permissions.map(p => ({
                    permission: p,
                    description: this.getPermissionDescription(p)
                }))
            };
        }

        return report;
    }
}

module.exports = RBACManager;