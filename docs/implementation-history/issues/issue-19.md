# Issue #19: トレーサビリティ機能Phase 1

## 概要
要求と実装の双方向トレーサビリティ機能の基本実装。

## 実装日
2025年6月16日

## 実装内容

### 1. トレーサビリティマネージャー
`src/traceability-manager.js`：
```javascript
class TraceabilityManager {
  constructor(dataFile = '.poppo/traceability.yaml') {
    this.dataFile = dataFile;
    this.data = this.loadData();
  }

  // ID自動採番
  generateId(type) {
    const prefix = type === 'requirement' ? 'PBS-REQ' : 'PBS-IMPL';
    const sequence = this.getNextSequence(type);
    return `${prefix}-${String(sequence).padStart(3, '0')}`;
  }

  // 要求登録
  addRequirement(title, description, priority = 'medium') {
    const id = this.generateId('requirement');
    const requirement = {
      id,
      title,
      description,
      priority,
      status: 'open',
      createdAt: new Date().toISOString(),
      implementations: []
    };
    
    this.data.requirements[id] = requirement;
    this.saveData();
    return requirement;
  }

  // 双方向リンク作成
  linkRequirementToImplementation(reqId, implId) {
    // 要求側にリンク追加
    if (this.data.requirements[reqId]) {
      this.data.requirements[reqId].implementations.push(implId);
    }
    
    // 実装側にリンク追加
    if (this.data.implementations[implId]) {
      this.data.implementations[implId].requirements.push(reqId);
    }
    
    this.saveData();
  }
}
```

### 2. YAMLデータ構造
`.poppo/traceability.yaml`：
```yaml
requirements:
  PBS-REQ-001:
    id: PBS-REQ-001
    title: "dogfooding自動再起動機能"
    description: "PoppoBuilderが自身を改善するための自動再起動"
    priority: high
    status: implemented
    createdAt: "2025-06-16T09:00:00Z"
    implementations:
      - PBS-IMPL-001
      - PBS-IMPL-002

implementations:
  PBS-IMPL-001:
    id: PBS-IMPL-001
    title: "restart-scheduler.js実装"
    type: code
    path: scripts/restart-scheduler.js
    createdAt: "2025-06-16T09:30:00Z"
    requirements:
      - PBS-REQ-001
```

### 3. CLIツール
`scripts/trace-cli.js`：
```javascript
#!/usr/bin/env node
const TraceabilityManager = require('../src/traceability-manager');

const command = process.argv[2];
const manager = new TraceabilityManager();

switch(command) {
  case 'add':
    const [phase, ...titleParts] = process.argv.slice(3);
    const title = titleParts.join(' ');
    const item = phase === 'req' ? 
      manager.addRequirement(title) : 
      manager.addImplementation(title);
    console.log(`登録完了: ${item.id}`);
    break;
    
  case 'link':
    const [reqId, implId] = process.argv.slice(3);
    manager.linkRequirementToImplementation(reqId, implId);
    console.log(`リンク作成: ${reqId} <-> ${implId}`);
    break;
    
  case 'list':
    const items = manager.listItems(process.argv[3] || 'all');
    console.table(items);
    break;
}
```

### 4. 使用方法
```bash
# 要求追加
npm run trace add req "新機能の要求"

# 実装追加
npm run trace add impl "機能の実装"

# リンク作成
npm run trace link PBS-REQ-001 PBS-IMPL-001

# 一覧表示
npm run trace list
```

## テスト結果

### 実行例
```bash
$ npm run trace add req "エラーログ収集機能"
登録完了: PBS-REQ-019

$ npm run trace add impl "error-collector.js実装"
登録完了: PBS-IMPL-023

$ npm run trace link PBS-REQ-019 PBS-IMPL-023
リンク作成: PBS-REQ-019 <-> PBS-IMPL-023
```

### データ永続化確認
- YAMLファイルへの正常な保存
- PoppoBuilder再起動後もデータ保持
- 双方向リンクの整合性維持

## 技術的なポイント

1. **ID体系**
   - PBS (PoppoBuilder Suite) プレフィックス
   - REQ/IMPLでタイプ識別
   - 3桁のシーケンス番号

2. **双方向リンク**
   - 要求から実装を参照
   - 実装から要求を逆参照
   - 多対多の関係をサポート

3. **YAML永続化**
   - 人間が読みやすい形式
   - Gitでの差分管理が容易
   - 構造化データの保存

## 成果
- 要求と実装の関連性を明確化
- 変更影響の追跡が可能に
- ドキュメント生成の基盤確立

## 関連Issue
- Issue #25: Phase 2実装（影響分析機能）
- Issue #52: Phase 3実装（GitHub連携）