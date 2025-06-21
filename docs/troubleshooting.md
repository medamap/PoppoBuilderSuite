# トラブルシューティングガイド

PoppoBuilder Suite で発生する可能性のある問題と、その解決方法を詳しく説明します。

## 🚨 よくある問題と解決方法

### 起動時の問題

#### 問題: PoppoBuilderが起動しない

**症状:**
```bash
npm start
# エラー: Cannot find module './src/minimal-poppo.js'
```

**原因と解決方法:**

1. **依存関係の未インストール**
   ```bash
   # 解決方法
   npm install
   ```

2. **Node.jsバージョンが古い**
   ```bash
   # バージョン確認
   node --version
   
   # v18以上でない場合は更新
   nvm install 18
   nvm use 18
   ```

3. **ファイルパスの問題**
   ```bash
   # 正しいディレクトリか確認
   pwd
   # /path/to/PoppoBuilderSuite であることを確認
   
   # ファイルの存在確認
   ls -la src/minimal-poppo.js
   ```

#### 問題: ポート3001が使用中

**症状:**
```
Error: listen EADDRINUSE: address already in use :::3001
```

**解決方法:**
```bash
# 1. 使用中のプロセスを確認
lsof -i :3001

# 2. プロセスを停止
kill -9 <PID>

# 3. 別のポートで起動
PORT=3002 npm run dashboard
```

### GitHub API関連の問題

#### 問題: 認証エラー (401 Unauthorized)

**症状:**
```
Error: Bad credentials
```

**解決方法:**

1. **GitHub CLIの認証確認**
   ```bash
   # 認証状態を確認
   gh auth status
   
   # 再認証
   gh auth login
   ```

2. **環境変数の確認**
   ```bash
   # .envファイルを確認
   cat .env | grep GITHUB
   
   # トークンが正しいか確認
   curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user
   ```

3. **トークンの権限確認**
   - GitHub設定 → Developer settings → Personal access tokens
   - 必要な権限: `repo`, `write:org`

#### 問題: レート制限エラー (403 Rate Limit)

**症状:**
```
Error: API rate limit exceeded
```

**解決方法:**

1. **現在のレート制限を確認**
   ```bash
   curl -H "Authorization: token $GITHUB_TOKEN" \
     https://api.github.com/rate_limit
   ```

2. **設定を調整**
   ```javascript
   // config/config.json
   {
     "rateLimiter": {
       "github": {
         "maxRequests": 20,  // 減らす
         "windowMs": 120000  // 間隔を広げる（2分）
       }
     }
   }
   ```

3. **リセット時刻まで待機**
   ```bash
   # リセット時刻を確認して待機
   date -d @$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
     https://api.github.com/rate_limit | jq .rate.reset)
   ```

### Claude API関連の問題

#### 問題: Claude CLIがハングアップする

**症状:**
- プロセスが応答しない
- ログに出力がない
- タイムアウトしない

**解決方法:**

1. **Claude CLIの再インストール**
   ```bash
   # アンインストール
   npm uninstall -g claude
   
   # 再インストール
   npm install -g claude@latest
   
   # バージョン確認
   claude --version
   ```

2. **APIキーの確認**
   ```bash
   # 環境変数を確認
   echo $CLAUDE_API_KEY
   
   # CLIの設定を確認
   claude config get api_key
   ```

3. **デバッグモードで実行**
   ```bash
   # 詳細ログを有効化
   DEBUG=* npm start
   ```

#### 問題: タイムアウトエラー

**症状:**
```
Error: Task execution timeout after 86400000ms
```

**解決方法:**

1. **タイムアウト設定を調整**
   ```javascript
   // config/config.json
   {
     "claude": {
       "timeout": 172800000,  // 48時間に延長
       "dynamicTimeout": {
         "enabled": true,
         "minTimeout": 300000,
         "maxTimeout": 172800000
       }
     }
   }
   ```

2. **タスクを分割**
   - 大きなタスクは小さく分割
   - バッチ処理を活用

### メモリ・パフォーマンスの問題

#### 問題: Out of Memory エラー

**症状:**
```
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
```

**解決方法:**

1. **即座の対応**
   ```bash
   # メモリ制限を増やして起動
   NODE_OPTIONS="--max-old-space-size=4096" npm start
   ```

2. **設定の最適化**
   ```javascript
   // config/config.json
   {
     "performance": {
       "maxConcurrentTasks": 1,  // 並行実行を減らす
       "memoryOptimization": {
         "enabled": true,
         "gcInterval": 60000    // 1分ごとにGC
       }
     }
   }
   ```

3. **メモリリークの調査**
   ```bash
   # ヒープダンプを取得
   node --heapsnapshot-signal=SIGUSR2 src/minimal-poppo.js
   
   # Chrome DevToolsで分析
   # chrome://inspect → Memory → Load
   ```

#### 問題: CPU使用率が高い

**症状:**
- システムが重い
- 他のアプリケーションが遅い
- ファンが常に回っている

**解決方法:**

1. **プロセスの確認**
   ```bash
   # CPU使用率を確認
   top -p $(pgrep -f "PoppoBuilder")
   
   # 詳細な情報
   ps aux | grep -E "(node|poppo)" | grep -v grep
   ```

2. **設定の調整**
   ```javascript
   {
     "performance": {
       "cpuThrottle": {
         "enabled": true,
         "maxCpuPercent": 50
       }
     }
   }
   ```

### ファイルシステムの問題

#### 問題: ENOENT - ファイルが見つからない

**症状:**
```
Error: ENOENT: no such file or directory, open './logs/poppo-2025-01-20.log'
```

**解決方法:**

```bash
# 必要なディレクトリを作成
mkdir -p logs state temp .poppo

# 権限を確認
ls -la

# 権限を修正
chmod -R 755 .
```

#### 問題: EACCES - アクセス権限エラー

**症状:**
```
Error: EACCES: permission denied
```

**解決方法:**

```bash
# 所有者を変更
sudo chown -R $USER:$USER .

# 権限を設定
chmod -R u+rwX,go+rX,go-w .

# SELinuxの場合
sudo setenforce 0  # 一時的に無効化
```

### 状態管理の問題

#### 問題: 重複処理が発生する

**症状:**
- 同じIssueが複数回処理される
- `processing`ラベルが残り続ける

**解決方法:**

1. **ロックファイルのクリア**
   ```bash
   # ロックファイルを確認
   ls -la state/.locks/
   
   # 古いロックを削除
   find state/.locks -mtime +1 -delete
   ```

2. **状態ファイルのリセット**
   ```bash
   # バックアップを作成
   cp state/issue-status.json state/issue-status.json.backup
   
   # 状態をリセット
   echo "{}" > state/issue-status.json
   ```

3. **MirinOrphanManagerを実行**
   ```bash
   # 孤児Issueを修復
   node scripts/start-mirin.js --once
   ```

#### 問題: データの不整合

**症状:**
- ダッシュボードの表示が実際と異なる
- 処理済みなのに未処理と表示される

**解決方法:**

```bash
# 1. 整合性チェック
npm run integrity:check

# 2. データベースの修復
npm run repair database

# 3. キャッシュのクリア
npm run cache:clear all

# 4. 完全リセット（最終手段）
npm run reset --confirm
```

### ネットワークの問題

#### 問題: 接続タイムアウト

**症状:**
```
Error: connect ETIMEDOUT
```

**解決方法:**

1. **プロキシ設定の確認**
   ```bash
   # 環境変数を確認
   echo $HTTP_PROXY
   echo $HTTPS_PROXY
   
   # npmのプロキシ設定
   npm config get proxy
   npm config get https-proxy
   ```

2. **DNSの確認**
   ```bash
   # GitHub APIの名前解決
   nslookup api.github.com
   
   # 別のDNSを試す
   echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
   ```

3. **ファイアウォールの確認**
   ```bash
   # 外部接続を確認
   curl -I https://api.github.com
   
   # ファイアウォールルールを確認
   sudo iptables -L
   ```

### プロセス管理の問題

#### 問題: ゾンビプロセスが残る

**症状:**
- 停止してもプロセスが残る
- メモリが解放されない

**解決方法:**

```bash
# 1. ゾンビプロセスを確認
ps aux | grep defunct

# 2. 親プロセスを特定
ps -o ppid= -p <zombie-pid>

# 3. 強制終了
kill -9 <parent-pid>

# 4. すべてのPoppo関連プロセスを停止
pkill -f "poppo|PoppoBuilder"
```

#### 問題: 自動再起動が機能しない

**症状:**
- Dogfoodingタスク後に再起動しない
- エラー後に自動回復しない

**解決方法:**

1. **systemdサービスとして設定**
   ```bash
   # サービスファイルを作成
   sudo nano /etc/systemd/system/poppo-builder.service
   ```

   ```ini
   [Unit]
   Description=PoppoBuilder Suite
   After=network.target
   
   [Service]
   Type=simple
   User=your-user
   WorkingDirectory=/path/to/PoppoBuilderSuite
   ExecStart=/usr/bin/npm start
   Restart=always
   RestartSec=10
   
   [Install]
   WantedBy=multi-user.target
   ```

2. **サービスを有効化**
   ```bash
   sudo systemctl enable poppo-builder
   sudo systemctl start poppo-builder
   ```

## 🔍 デバッグ方法

### 詳細ログの有効化

```bash
# すべてのデバッグ情報を表示
DEBUG=* npm start

# 特定のモジュールのみ
DEBUG=poppo:*,ccla:* npm start

# ログレベルを変更
LOG_LEVEL=debug npm start
```

### プロファイリング

```bash
# CPUプロファイリング
node --prof src/minimal-poppo.js

# 結果を分析
node --prof-process isolate-*.log > profile.txt

# メモリプロファイリング
node --trace-gc src/minimal-poppo.js
```

### リモートデバッグ

```bash
# インスペクタを有効化
node --inspect=0.0.0.0:9229 src/minimal-poppo.js

# Chrome DevToolsで接続
# chrome://inspect
```

## 🚑 緊急時の対処

### システム完全停止時

```bash
#!/bin/bash
# emergency-recovery.sh

echo "緊急リカバリーを開始..."

# 1. すべてのプロセスを停止
pkill -f "node|npm|poppo|PoppoBuilder"

# 2. ロックファイルをクリア
rm -rf state/.locks/*
rm -f state/*.lock

# 3. 破損ファイルをバックアップから復元
for file in state/*.json; do
  if [ -f "$file.backup" ]; then
    cp "$file.backup" "$file"
    echo "復元: $file"
  fi
done

# 4. キャッシュをクリア
rm -rf temp/* logs/cache/*

# 5. セーフモードで起動
SAFE_MODE=true npm start
```

### データ復旧

```bash
# 最新のバックアップを確認
npm run backup:list

# バックアップから復元
npm run backup:restore latest --dry-run
npm run backup:restore latest

# 部分的な復元
npm run backup:restore latest --target "state/"
```

## 📞 サポートを受ける

### 情報収集

問題報告時に必要な情報：

```bash
# システム情報を収集
npm run diagnose all > diagnosis.txt

# 環境情報
node --version >> diagnosis.txt
npm --version >> diagnosis.txt
gh --version >> diagnosis.txt

# 最新のエラーログ
tail -n 1000 logs/poppo-$(date +%Y-%m-%d).log > error-log.txt

# 設定情報（機密情報は除去）
npm run config:show --sanitize > config.txt
```

### 問題報告

1. [GitHub Issues](https://github.com/medamap/PoppoBuilderSuite/issues)で新しいIssueを作成
2. 上記で収集した情報を添付
3. 再現手順を詳しく記載
4. 期待する動作と実際の動作を明記

## 🎯 予防的メンテナンス

### 定期的なメンテナンスタスク

```bash
# 週次メンテナンススクリプト
#!/bin/bash

# ログローテーション
npm run log:rotate
npm run log:clean --days 7

# キャッシュクリア
npm run cache:clear temp

# ヘルスチェック
npm run health:check --detailed

# バックアップ
npm run backup:create -- --name "weekly-$(date +%Y%m%d)"

# 統計レポート
npm run analytics:report weekly
```

### 監視の設定

```javascript
// config/config.json
{
  "monitoring": {
    "alerts": {
      "enabled": true,
      "conditions": {
        "memoryUsage": { "threshold": 80, "action": "warn" },
        "errorRate": { "threshold": 5, "window": 300000 },
        "taskTimeout": { "threshold": 3, "window": 3600000 }
      }
    }
  }
}
```

これらの対処法で解決しない場合は、[詳細なエラーハンドリングガイド](features/error-handling-guide.md)も参照してください。