# Issue #54: 認証機能実装

## 概要
ダッシュボード認証機能の実装。セキュアなアクセス制御、ユーザー管理、セッション管理を実装。

## 実装日
2025年6月17日

## 実装内容

### 1. 認証システム
`src/auth/auth-manager.js`：
- JWT（JSON Web Token）ベースの認証
- セキュアなパスワードハッシュ化（bcrypt）
- リフレッシュトークン機能
- セッション管理

### 2. ユーザー管理
`src/auth/user-manager.js`：
- ユーザーの作成/更新/削除
- 権限レベル管理（admin/operator/viewer）
- パスワードポリシーの適用
- アカウントロック機能

### 3. 認証ミドルウェア
`dashboard/server/middleware/auth.js`：
- トークン検証
- 権限チェック
- APIエンドポイント保護
- CSRF対策

### 4. ログインUI
`dashboard/client/login.html`：
- セキュアなログインフォーム
- Remember Me機能
- パスワードリセット
- 2要素認証対応（TOTP）

### 5. セキュリティ機能
- ブルートフォース攻撃対策
- セッションタイムアウト
- 監査ログ
- IPホワイトリスト

## 権限レベル

### Admin（管理者）
- 全機能へのアクセス
- ユーザー管理
- システム設定変更
- ログ削除

### Operator（オペレーター）
- ダッシュボード閲覧
- プロセス管理
- 通知設定
- ログ閲覧

### Viewer（閲覧者）
- ダッシュボード閲覧のみ
- 読み取り専用アクセス
- 統計情報の参照

## 設定
`config/config.json`：
```json
"dashboard": {
  "authentication": {
    "enabled": true,
    "jwtSecret": "CHANGE_THIS_SECRET_KEY",
    "tokenExpiry": "1h",
    "refreshTokenExpiry": "7d",
    "sessionTimeout": 3600000,
    "maxLoginAttempts": 5,
    "lockoutDuration": 900000,
    "passwordPolicy": {
      "minLength": 8,
      "requireUppercase": true,
      "requireLowercase": true,
      "requireNumbers": true,
      "requireSpecialChars": true
    },
    "twoFactor": {
      "enabled": false,
      "issuer": "PoppoBuilder"
    }
  }
}
```

## ユーザー管理CLI
```bash
# ユーザー作成
npm run user create <username> <role>

# パスワードリセット
npm run user reset-password <username>

# ユーザー一覧
npm run user list

# ユーザー削除
npm run user delete <username>

# 権限変更
npm run user set-role <username> <role>
```

## 認証フロー

### ログイン
1. ユーザー名/パスワード送信
2. 認証情報の検証
3. 2要素認証（有効時）
4. JWTトークン発行
5. リフレッシュトークン発行

### API アクセス
1. Authorizationヘッダーでトークン送信
2. トークン検証
3. 権限チェック
4. リクエスト処理

### トークンリフレッシュ
1. リフレッシュトークン送信
2. トークン検証
3. 新しいアクセストークン発行

## セキュリティ実装

### パスワード保護
```javascript
// bcryptによるハッシュ化
const hashedPassword = await bcrypt.hash(password, 12);

// パスワード検証
const isValid = await bcrypt.compare(password, hashedPassword);
```

### JWT実装
```javascript
// トークン生成
const token = jwt.sign(
  { userId, username, role },
  jwtSecret,
  { expiresIn: '1h' }
);

// トークン検証
const decoded = jwt.verify(token, jwtSecret);
```

### ブルートフォース対策
- ログイン失敗回数の記録
- 一定回数失敗でアカウントロック
- IPアドレスベースの制限
- 段階的な遅延処理

## 監査ログ
`.poppo/auth-audit.log`：
```
2025-06-17 10:30:00 [LOGIN_SUCCESS] user: admin, ip: 192.168.1.1
2025-06-17 10:35:00 [ACCESS_DENIED] user: viewer, endpoint: /api/system/config
2025-06-17 10:40:00 [PASSWORD_CHANGE] user: operator
2025-06-17 10:45:00 [LOGIN_FAILED] user: unknown, ip: 192.168.1.2, attempt: 3
```

## テスト結果
`test/test-authentication.js`：
- ✅ ユーザー作成と認証
- ✅ トークン生成と検証
- ✅ 権限レベルチェック
- ✅ ブルートフォース対策
- ✅ セッション管理
- ✅ 2要素認証（TOTP）

## 初期セットアップ
```bash
# 管理者ユーザー作成
npm run user create admin admin

# デフォルトパスワード変更を促す
# 初回ログイン時にパスワード変更が必須
```

## 成果
- セキュアなアクセス制御
- 不正アクセスの防止
- 操作履歴の追跡
- コンプライアンス対応

## 技術的なポイント

### セキュリティベストプラクティス
- パスワードの平文保存禁止
- HTTPSの強制
- セキュアなCookie設定
- XSS/CSRF対策

### パフォーマンス
- トークンキャッシュ
- セッション管理の最適化
- 非同期認証処理

### 拡張性
- 外部認証プロバイダー対応準備
- LDAP/AD連携の基盤
- OAuth2.0対応の準備

## 今後の拡張予定
- LDAP/Active Directory連携
- OAuth2.0/SAML対応
- 生体認証サポート
- ロールベースアクセス制御（RBAC）の詳細化

## 関連ファイル
- **認証マネージャー**: `src/auth/auth-manager.js`
- **ユーザー管理**: `src/auth/user-manager.js`
- **認証ミドルウェア**: `dashboard/server/middleware/auth.js`
- **ログインUI**: `dashboard/client/login.html`
- **テストコード**: `test/test-authentication.js`

## 関連Issue
- Issue #23: プロセス管理ダッシュボード（認証で保護）
- Issue #51, #56: スマホ通知機能（認証トークンでの通知）