#!/bin/bash

# Kubernetes deployment script for PoppoBuilder Suite

set -e

# Default values
NAMESPACE="poppobuilder"
REGISTRY="${REGISTRY:-docker.io}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
BUILD_IMAGES="${BUILD_IMAGES:-true}"

# Usage function
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo "Options:"
    echo "  -n, --namespace <namespace>    Kubernetes namespace (default: poppobuilder)"
    echo "  -r, --registry <registry>      Docker registry (default: docker.io)"
    echo "  -t, --tag <tag>               Image tag (default: latest)"
    echo "  -s, --skip-build              Skip building Docker images"
    echo "  -h, --help                    Show this help message"
    exit 1
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        -r|--registry)
            REGISTRY="$2"
            shift 2
            ;;
        -t|--tag)
            IMAGE_TAG="$2"
            shift 2
            ;;
        -s|--skip-build)
            BUILD_IMAGES="false"
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
done

# Build Docker images
if [ "$BUILD_IMAGES" = "true" ]; then
    echo "Building Docker images..."
    
    # Build base image
    docker build -t ${REGISTRY}/poppobuilder/base:${IMAGE_TAG} -f docker/base/Dockerfile .
    
    # Build agent images
    docker build -t ${REGISTRY}/poppobuilder/ccpm:${IMAGE_TAG} -f docker/agents/ccpm/Dockerfile .
    docker build -t ${REGISTRY}/poppobuilder/ccag:${IMAGE_TAG} -f docker/agents/ccag/Dockerfile .
    docker build -t ${REGISTRY}/poppobuilder/ccla:${IMAGE_TAG} -f docker/agents/ccla/Dockerfile .
    docker build -t ${REGISTRY}/poppobuilder/ccsp:${IMAGE_TAG} -f docker/agents/ccsp/Dockerfile .
    
    # Push images to registry
    if [ "$REGISTRY" != "local" ]; then
        echo "Pushing images to registry..."
        docker push ${REGISTRY}/poppobuilder/base:${IMAGE_TAG}
        docker push ${REGISTRY}/poppobuilder/ccpm:${IMAGE_TAG}
        docker push ${REGISTRY}/poppobuilder/ccag:${IMAGE_TAG}
        docker push ${REGISTRY}/poppobuilder/ccla:${IMAGE_TAG}
        docker push ${REGISTRY}/poppobuilder/ccsp:${IMAGE_TAG}
    fi
fi

# Create namespace if not exists
echo "Creating namespace..."
kubectl create namespace $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -

# Apply Kubernetes manifests
echo "Deploying to Kubernetes..."

# Apply storage
kubectl apply -f k8s/storage.yaml -n $NAMESPACE

# Apply configs
kubectl apply -f k8s/configmap.yaml -n $NAMESPACE
kubectl apply -f k8s/app-config.yaml -n $NAMESPACE

# Deploy Redis
kubectl apply -f k8s/redis.yaml -n $NAMESPACE

# Wait for Redis to be ready
echo "Waiting for Redis..."
kubectl wait --for=condition=ready pod -l app=redis -n $NAMESPACE --timeout=300s

# Deploy core components
kubectl apply -f k8s/poppobuilder-core.yaml -n $NAMESPACE
kubectl apply -f k8s/dashboard.yaml -n $NAMESPACE

# Deploy agents
kubectl apply -f k8s/ccpm-agent.yaml -n $NAMESPACE
kubectl apply -f k8s/ccag-agent.yaml -n $NAMESPACE
kubectl apply -f k8s/ccla-agent.yaml -n $NAMESPACE
kubectl apply -f k8s/ccsp-agent.yaml -n $NAMESPACE

# Apply Ingress
kubectl apply -f k8s/ingress.yaml -n $NAMESPACE

# Show deployment status
echo ""
echo "Deployment status:"
kubectl get pods -n $NAMESPACE
echo ""
kubectl get services -n $NAMESPACE
echo ""
kubectl get ingress -n $NAMESPACE

echo ""
echo "Deployment complete!"
echo "Access the dashboard at: http://poppobuilder.example.com"
echo ""
echo "To check logs:"
echo "  kubectl logs -f deployment/poppobuilder-core -n $NAMESPACE"
echo ""
echo "To scale agents:"
echo "  kubectl scale deployment/ccpm-agent --replicas=3 -n $NAMESPACE"