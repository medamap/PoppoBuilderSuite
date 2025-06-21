# ミリンちゃんRedis大使昇格計画 - 要求定義書

## 概要
MirinOrphanManagerを「Redis大使」に昇格し、すべての状態管理をRedis経由で行う新しいアーキテクチャを段階的に実装します。各プロセスはミリンちゃんに依頼してRedisの更新・取得を行い、ミリンちゃんがプロセス生存監視と孤児Issue調整を一元管理します。

## 現状分析

### 管理すべき情報の洗い出し

#### 1. Issue状態管理
- **現在の場所**: GitHub Labels + `state/issue-status.json`
- **使用プロセス**: PoppoBuilder(main/cron), MirinOrphanManager
- **情報**: status(processing/awaiting-response/completed), processId, pid, startTime, lastHeartbeat

#### 2. 実行中タスク管理
- **現在の場所**: `state/running-tasks.json`
- **使用プロセス**: PoppoBuilder, IndependentProcessManager
- **情報**: taskId, issueNumber, title, pid, type, startTime

#### 3. 処理済みIssue/コメント管理
- **現在の場所**: `state/processed-issues.json`, `state/processed-comments.json`
- **使用プロセス**: PoppoBuilder(main/cron)
- **情報**: 処理済みIssue番号リスト, コメントIDマップ

#### 4. プロセス管理情報
- **現在の場所**: プロセスロックファイル、ハートビートファイル
- **使用プロセス**: 全プロセス
- **情報**: プロセス生存状態、ロック情報、ハートビート

#### 5. タスクキュー情報
- **現在の場所**: `state/pending-tasks.json`
- **使用プロセス**: PoppoBuilder
- **情報**: 保留中タスク、優先度情報

#### 6. 設定情報
- **現在の場所**: `config/config.json`, 環境変数
- **使用プロセス**: 全プロセス
- **情報**: 動的設定値、フラグ管理

#### 7. メトリクス・統計情報
- **現在の場所**: SQLite、ログファイル
- **使用プロセス**: HealthCheckManager, Analytics
- **情報**: パフォーマンス統計、エラー統計

## 新しいアーキテクチャ

### ミリンちゃん（Redis大使）の役割

```
┌─────────────────┐    依頼    ┌─────────────────┐    Redis操作    ┌─────────────────┐
│  PoppoBuilder   │ ──────────→ │ ミリンちゃん      │ ──────────────→ │     Redis       │
│  (ぽっぽちゃん)   │            │ (Redis大使)      │                │                 │
└─────────────────┘            └─────────────────┘                └─────────────────┘
        ↑                               │                                    ↑
        │                               ▼                                    │
        │                    ┌─────────────────┐                           │
        └────────────────────│   GitHub API    │ ←─────────────────────────┘
                             │   (ラベル更新)    │        状態同期
                             └─────────────────┘
```

### 1. RedisStateClient（各プロセス用）
```javascript
class RedisStateClient {
  constructor(processId, mirinChannel = 'mirin-requests') {
    this.processId = processId;
    this.mirinChannel = mirinChannel;
    this.redis = new Redis(); // 読み取り専用接続
  }

  // Issue状態の依頼（ミリンちゃん経由）
  async requestIssueCheckout(issueNumber, taskType) {
    const requestId = `req-${Date.now()}-${this.processId}`;
    const request = {
      requestId,
      action: 'checkout_issue',
      issueNumber,
      processId: this.processId,
      pid: process.pid,
      taskType,
      timestamp: new Date().toISOString()
    };
    
    // ミリンちゃんに依頼を送信
    await this.redis.publish(this.mirinChannel, JSON.stringify(request));
    
    // 応答を待機（タイムアウト付き）
    return await this.waitForResponse(requestId, 5000);
  }

  // ハートビート送信（ミリンちゃん経由）
  async sendHeartbeat() {
    const request = {
      action: 'heartbeat',
      processId: this.processId,
      pid: process.pid,
      timestamp: new Date().toISOString()
    };
    
    await this.redis.publish(this.mirinChannel, JSON.stringify(request));
  }
}
```

### 2. MirinRedisAmbassador（新しいミリンちゃん）
```javascript
class MirinRedisAmbassador {
  constructor() {
    this.redis = new Redis(); // 読み書き可能な接続
    this.github = new GitHubClient();
    this.requestChannel = 'mirin-requests';
    this.responseChannel = 'mirin-responses';
  }

  // 依頼の処理
  async handleRequest(request) {
    switch (request.action) {
      case 'checkout_issue':
        return await this.checkoutIssue(request);
      case 'checkin_issue':
        return await this.checkinIssue(request);
      case 'heartbeat':
        return await this.updateHeartbeat(request);
      default:
        throw new Error(`Unknown action: ${request.action}`);
    }
  }

  // Issue状態のチェックアウト
  async checkoutIssue(request) {
    const { issueNumber, processId, pid, taskType } = request;
    
    // Redisでアトミックに状態を設定
    const multi = this.redis.multi();
    multi.hset(`issue:${issueNumber}`, {
      status: 'processing',
      processId,
      pid,
      taskType,
      startTime: new Date().toISOString(),
      checkedOutBy: 'mirin'
    });
    multi.setex(`heartbeat:${processId}`, 1800, 'alive'); // 30分TTL
    multi.sadd('processing_issues', issueNumber);
    multi.hset(`process:${processId}`, {
      pid,
      issueNumber,
      status: 'active',
      lastSeen: new Date().toISOString()
    });
    
    const result = await multi.exec();
    
    if (result.every(([err]) => !err)) {
      // GitHubラベルを更新
      await this.github.addLabels(issueNumber, ['processing']);
      
      return { success: true, message: 'Issue checked out successfully' };
    } else {
      throw new Error('Failed to checkout issue');
    }
  }

  // 孤児Issue検出と修復
  async checkOrphanedIssues() {
    const processingIssues = await this.redis.smembers('processing_issues');
    const orphaned = [];
    
    for (const issueNumber of processingIssues) {
      const issueData = await this.redis.hgetall(`issue:${issueNumber}`);
      if (!issueData.processId) continue;
      
      // ハートビートチェック
      const heartbeat = await this.redis.get(`heartbeat:${issueData.processId}`);
      if (!heartbeat) {
        // プロセス生存確認
        if (!this.isProcessAlive(issueData.pid)) {
          orphaned.push({
            issue: issueNumber,
            processId: issueData.processId,
            pid: issueData.pid,
            lastSeen: issueData.startTime
          });
        }
      }
    }
    
    // 孤児Issueを修復
    for (const orphan of orphaned) {
      await this.repairOrphanedIssue(orphan);
    }
    
    return orphaned;
  }
}
```

## Redis データ構造設計

### 1. Issue状態 (Hash)
```redis
# issue:{number}
HSET issue:123 status processing
HSET issue:123 processId issue-123-poppo
HSET issue:123 pid 12345
HSET issue:123 taskType dogfooding
HSET issue:123 startTime 2025-06-19T10:00:00Z
HSET issue:123 checkedOutBy mirin
HSET issue:123 lastUpdate 2025-06-19T10:05:00Z
```

### 2. プロセス情報 (Hash)
```redis
# process:{processId}
HSET process:issue-123-poppo pid 12345
HSET process:issue-123-poppo host MacBook-Pro.local
HSET process:issue-123-poppo tmuxSession poppo-builder-main
HSET process:issue-123-poppo status active
HSET process:issue-123-poppo lastSeen 2025-06-19T10:05:00Z
```

### 3. ハートビート (String with TTL)
```redis
# heartbeat:{processId} (30分TTL)
SETEX heartbeat:issue-123-poppo 1800 "alive"
```

### 4. 処理中Issue一覧 (Set)
```redis
# processing_issues
SADD processing_issues 123 456 789
```

### 5. 処理済みIssue (Set)
```redis
# processed_issues
SADD processed_issues 100 101 102
```

### 6. タスクキュー (List + Hash)
```redis
# task_queue:priority:{level}
LPUSH task_queue:priority:high task:123:dogfooding
LPUSH task_queue:priority:normal task:456:misc

# task:{taskId}
HSET task:123:dogfooding issueNumber 123
HSET task:123:dogfooding type dogfooding
HSET task:123:dogfooding priority high
HSET task:123:dogfooding createdAt 2025-06-19T10:00:00Z
```

## 段階的実装計画

### Phase 1: Redis環境とミリンちゃん基盤構築 (3日)
**目標**: Redis環境を構築し、ミリンちゃんの基本機能を実装

#### 1.1 Redis環境構築
- `brew install redis`
- Redis設定ファイルの調整
- 自動起動設定
- 基本的な接続テスト

#### 1.2 MirinRedisAmbassador実装
- `src/mirin-redis-ambassador.js`の作成
- 基本的なPub/Sub機能
- Issue状態管理の基本機能
- ユニットテスト作成

#### 1.3 RedisStateClient実装
- `src/redis-state-client.js`の作成
- リクエスト/レスポンス機能
- エラーハンドリング
- 接続管理

**成功条件**: ミリンちゃんがRedis経由でIssue状態を管理できる

### Phase 2: Issue状態管理のRedis移行 (4日)
**目標**: Issue状態管理を完全にRedisに移行

#### 2.1 StatusManagerのRedis対応
- 既存の`StatusManager`をRedis版に更新
- JSON ファイルとの並行動作
- データ移行機能

#### 2.2 PoppoBuilderの修正
- `minimal-poppo.js`のRedisStateClient統合
- 直接的なラベル操作を削除
- エラーハンドリングの更新

#### 2.3 MirinOrphanManagerの更新
- 孤児Issue検出ロジックのRedis対応
- GitHub API連携の強化
- 定期実行スケジュールの最適化

**成功条件**: すべてのIssue状態管理がRedis経由で動作

### Phase 3: 実行中タスク管理の移行 (3日)
**目標**: 実行中タスク情報をRedisに移行

#### 3.1 IndependentProcessManagerのRedis対応
- タスク管理のRedis移行
- プロセス監視機能の統合
- 状態同期の実装

#### 3.2 プロセス管理情報の統合
- プロセスロック機能のRedis移行
- ハートビート機能の実装
- プロセス生存監視の強化

**成功条件**: 実行中タスクとプロセス情報がRedisで管理される

### Phase 4: その他の状態情報移行 (3日)
**目標**: 残りの状態情報をRedisに移行

#### 4.1 処理済み情報の移行
- 処理済みIssue/コメント管理
- タスクキュー情報
- 設定情報の一部

#### 4.2 メトリクス情報の連携
- Redis内のメトリクス収集
- HealthCheckManagerとの連携
- ダッシュボード表示の更新

**成功条件**: ほぼすべての状態情報がRedisで管理される

### Phase 5: 最適化と統合テスト (3日)
**目標**: パフォーマンス最適化と総合テスト

#### 5.1 パフォーマンス最適化
- Redis接続プールの実装
- バッチ処理の最適化
- メモリ使用量の監視

#### 5.2 障害復旧機能
- Redis停止時のフォールバック
- 状態復元機能
- エラー回復機能

#### 5.3 統合テスト
- 全機能の統合テスト
- 負荷テスト
- 障害テスト

**成功条件**: システム全体が安定して動作する

### Phase 6: 旧システムの削除と文書化 (2日)
**目標**: 旧システムの削除と運用文書の整備

#### 6.1 旧システムの削除
- FileStateManagerの削除
- 不要なJSONファイルの削除
- コードのクリーンアップ

#### 6.2 運用文書の整備
- Redis運用マニュアル
- トラブルシューティングガイド
- パフォーマンス監視ガイド

**成功条件**: 完全にRedisベースのシステムに移行完了

## 改修規模の分析

### 修正が必要なファイル (重要度順)

#### 🔴 高 (大幅修正)
1. `src/minimal-poppo.js` - StatusManagerをRedisStateClientに置換
2. `src/minimal-poppo-cron.js` - 同上
3. `src/independent-process-manager.js` - Redis連携追加
4. `mirin-orphan-manager.js` - Redis大使に昇格
5. `src/file-state-manager.js` - 段階的に削除

#### 🟡 中 (部分修正)
6. `src/status-manager.js` - Redis版に更新
7. `src/task-queue.js` - Redis連携追加
8. `dashboard/server/api/*.js` - Redis対応
9. `src/health-check-manager.js` - Redis統計連携

#### 🟢 低 (軽微修正)
10. `config/config.json` - Redis設定追加
11. `package.json` - ioredis依存関係追加
12. テストファイル群 - Redis対応

### 予想工数
- **総工数**: 18人日
- **期間**: 約3週間（並行作業含む）
- **リスク**: 中程度（段階的移行によりリスク軽減）

## バグ防止策

### 1. 段階的移行
- 各Phaseで完全にテストしてから次へ
- 新旧システムの並行運用期間を設ける
- ロールバック機能を常に準備

### 2. 包括的テスト
- ユニットテスト (各Phase毎)
- 統合テスト (Phase間連携)
- エンドツーエンドテスト (全体動作)
- 障害テスト (Redis停止等)

### 3. 監視強化
- Redis接続状態監視
- パフォーマンス監視
- エラー率監視
- データ整合性チェック

### 4. フォールバック機能
- Redis停止時の緊急モード
- データ復元機能
- 手動修復ツール

## 期待される効果

### 1. パフォーマンス向上
- ファイルI/O → インメモリ操作: **10-50倍高速化**
- ロック競合の大幅減少
- 並行処理能力の向上

### 2. 信頼性向上
- アトミック操作による整合性保証
- TTLによる自動クリーンアップ
- プロセス監視の精度向上

### 3. 運用性向上
- 状態の可視化が容易
- デバッグ情報の充実
- 障害回復の自動化

### 4. 拡張性確保
- 「ぽっぽ学園」への対応
- 分散処理への発展
- マルチプロジェクト管理

## まとめ

ミリンちゃんをRedis大使に昇格させることで、PoppoBuilderの根本的な問題を解決し、将来の拡張にも対応できる堅牢なシステムを構築できます。段階的な実装により、バグリスクを最小限に抑えながら、確実に移行を進めることができます。