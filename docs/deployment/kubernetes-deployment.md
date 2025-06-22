# Kubernetes Deployment Guide for PoppoBuilder Suite

## 概要

このガイドでは、PoppoBuilder SuiteをKubernetes環境にデプロイする方法を説明します。Phase 4のコンテナ化実装により、本番環境での高可用性とスケーラブルな運用が可能になりました。

## 前提条件

- Kubernetes 1.24以上
- kubectl CLIツール
- Docker
- Helm 3.x（Helmチャート使用時）
- Ingress Controller（NGINX推奨）

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                    Kubernetes Cluster                         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Ingress   │  │  Dashboard  │  │    Core     │        │
│  │ Controller  │  │  (2 pods)   │  │  (1 pod)    │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                 │                 │                │
│  ┌──────┴─────────────────┴─────────────────┴──────┐        │
│  │                  Redis (StatefulSet)             │        │
│  └──────────────────────┬──────────────────────────┘        │
│                         │                                    │
│  ┌─────────┬───────────┬┴──────────┬───────────┐           │
│  │  CCPM   │   CCAG    │   CCLA    │   CCSP    │           │
│  │(2 pods) │ (2 pods)  │ (3 pods)  │ (1 pod)   │           │
│  └─────────┴───────────┴───────────┴───────────┘           │
│                                                              │
│  Storage:                                                    │
│  - PVC: poppobuilder-state-pvc (5Gi)                       │
│  - PVC: ccla-data-pvc (10Gi)                               │
│  - PVC: claude-session-pvc (1Gi)                           │
└─────────────────────────────────────────────────────────────┘
```

## デプロイ方法

### 方法1: 自動デプロイスクリプト

```bash
# リポジトリをクローン
git clone https://github.com/medamap/PoppoBuilderSuite.git
cd PoppoBuilderSuite

# 環境変数を設定
export GITHUB_TOKEN="your-github-token"
export DASHBOARD_PASSWORD="your-secure-password"

# デプロイスクリプトを実行
./scripts/k8s-deploy.sh

# カスタムレジストリを使用する場合
./scripts/k8s-deploy.sh --registry myregistry.io --tag v1.0.0
```

### 方法2: 手動デプロイ

```bash
# 1. Namespace作成
kubectl create namespace poppobuilder

# 2. Secretsを作成
kubectl create secret generic poppobuilder-secrets \
  --from-literal=GITHUB_TOKEN="${GITHUB_TOKEN}" \
  --from-literal=DASHBOARD_PASSWORD="${DASHBOARD_PASSWORD}" \
  -n poppobuilder

# 3. Storage作成
kubectl apply -f k8s/storage.yaml -n poppobuilder

# 4. ConfigMap作成
kubectl apply -f k8s/configmap.yaml -n poppobuilder
kubectl apply -f k8s/app-config.yaml -n poppobuilder

# 5. Redis デプロイ
kubectl apply -f k8s/redis.yaml -n poppobuilder

# 6. Core と Dashboard デプロイ
kubectl apply -f k8s/poppobuilder-core.yaml -n poppobuilder
kubectl apply -f k8s/dashboard.yaml -n poppobuilder

# 7. エージェント デプロイ
kubectl apply -f k8s/ccpm-agent.yaml -n poppobuilder
kubectl apply -f k8s/ccag-agent.yaml -n poppobuilder
kubectl apply -f k8s/ccla-agent.yaml -n poppobuilder
kubectl apply -f k8s/ccsp-agent.yaml -n poppobuilder

# 8. Ingress設定
kubectl apply -f k8s/ingress.yaml -n poppobuilder
```

### 方法3: Helmチャート使用

```bash
# 1. 依存関係を更新
cd helm/poppobuilder
helm dependency update

# 2. values.yamlをカスタマイズ
cp values.yaml my-values.yaml
# my-values.yamlを編集

# 3. インストール
helm install poppobuilder . \
  --namespace poppobuilder \
  --create-namespace \
  --values my-values.yaml \
  --set secrets.githubToken=$GITHUB_TOKEN \
  --set secrets.dashboardPassword=$DASHBOARD_PASSWORD

# 4. アップグレード
helm upgrade poppobuilder . \
  --namespace poppobuilder \
  --values my-values.yaml
```

## スケーリング

### 手動スケーリング

```bash
# エージェントのレプリカ数を増やす
kubectl scale deployment/ccpm-agent --replicas=5 -n poppobuilder
kubectl scale deployment/ccag-agent --replicas=5 -n poppobuilder
kubectl scale deployment/ccla-agent --replicas=10 -n poppobuilder

# 注意: CCSPは常に1レプリカ（Claude CLIセッション管理のため）
```

### 自動スケーリング（HPA）

```bash
# Horizontal Pod Autoscaler設定
kubectl autoscale deployment/ccla-agent \
  --cpu-percent=70 \
  --min=3 \
  --max=20 \
  -n poppobuilder
```

## モニタリング

### ログ確認

```bash
# Core ログ
kubectl logs -f deployment/poppobuilder-core -n poppobuilder

# 特定のエージェントログ
kubectl logs -f -l app=ccla-agent -n poppobuilder

# すべてのPodのログ
kubectl logs -f -l app.kubernetes.io/name=poppobuilder -n poppobuilder --all-containers=true
```

### メトリクス確認

```bash
# Pod リソース使用状況
kubectl top pods -n poppobuilder

# ノード リソース使用状況
kubectl top nodes
```

### Prometheus統合

```yaml
# ServiceMonitor設定例
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: poppobuilder-metrics
  namespace: poppobuilder
spec:
  selector:
    matchLabels:
      app: poppobuilder-core
  endpoints:
  - port: metrics
    interval: 30s
```

## トラブルシューティング

### Pod が起動しない

```bash
# Pod のイベント確認
kubectl describe pod <pod-name> -n poppobuilder

# 前回のログ確認
kubectl logs <pod-name> -n poppobuilder --previous
```

### CCSPセッションエラー

```bash
# Claude セッションボリューム確認
kubectl exec -it deployment/ccsp-agent -n poppobuilder -- ls -la /home/node/.config/claude

# セッションリセット
kubectl delete pod -l app=ccsp-agent -n poppobuilder
```

### Redis接続エラー

```bash
# Redisの状態確認
kubectl exec -it redis-0 -n poppobuilder -- redis-cli ping

# Redis ログ確認
kubectl logs redis-0 -n poppobuilder
```

## セキュリティ考慮事項

1. **Secrets管理**
   - KubernetesのSecretリソースを使用
   - 外部シークレット管理ツール（Vault、Sealed Secrets）の利用を推奨

2. **Network Policy**
   ```yaml
   apiVersion: networking.k8s.io/v1
   kind: NetworkPolicy
   metadata:
     name: poppobuilder-network-policy
     namespace: poppobuilder
   spec:
     podSelector: {}
     policyTypes:
     - Ingress
     - Egress
     ingress:
     - from:
       - namespaceSelector:
           matchLabels:
             name: poppobuilder
     egress:
     - to:
       - namespaceSelector:
           matchLabels:
             name: poppobuilder
     - ports:
       - protocol: TCP
         port: 443  # GitHub API
   ```

3. **Pod Security Standards**
   - 非rootユーザーでの実行
   - 読み取り専用ルートファイルシステム
   - 必要最小限の権限

## バックアップとリストア

### バックアップ

```bash
# 状態データのバックアップ
kubectl exec -it deployment/poppobuilder-core -n poppobuilder -- tar czf /tmp/backup.tar.gz /app/state
kubectl cp poppobuilder/<pod-name>:/tmp/backup.tar.gz ./backup-$(date +%Y%m%d).tar.gz

# PVCのスナップショット（CSIドライバーがサポートしている場合）
kubectl apply -f - <<EOF
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: state-snapshot-$(date +%Y%m%d)
  namespace: poppobuilder
spec:
  volumeSnapshotClassName: csi-snapclass
  source:
    persistentVolumeClaimName: poppobuilder-state-pvc
EOF
```

### リストア

```bash
# バックアップからのリストア
kubectl cp ./backup-20240620.tar.gz poppobuilder/<pod-name>:/tmp/backup.tar.gz
kubectl exec -it deployment/poppobuilder-core -n poppobuilder -- tar xzf /tmp/backup.tar.gz -C /
```

## アップデート戦略

### ローリングアップデート

```bash
# イメージの更新
kubectl set image deployment/poppobuilder-core poppobuilder-core=poppobuilder/core:v1.1.0 -n poppobuilder

# ロールアウト状態確認
kubectl rollout status deployment/poppobuilder-core -n poppobuilder

# ロールバック（必要な場合）
kubectl rollout undo deployment/poppobuilder-core -n poppobuilder
```

### Blue-Green デプロイメント

Helmチャートを使用して、別のリリース名でデプロイし、Ingressを切り替えます。

## まとめ

PoppoBuilder SuiteのKubernetes環境へのデプロイにより、以下の利点が得られます：

- **高可用性**: 複数レプリカによる冗長性
- **スケーラビリティ**: 負荷に応じた自動スケーリング
- **可観測性**: 統合されたログとメトリクス
- **セキュリティ**: Kubernetesのセキュリティ機能を活用
- **運用効率**: 宣言的な設定管理

問題が発生した場合は、[GitHub Issues](https://github.com/medamap/PoppoBuilderSuite/issues)で報告してください。