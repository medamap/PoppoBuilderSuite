#!/bin/bash

# GitHubリポジトリのラベルを作成するスクリプト
# 使い方: ./create-github-labels.sh <owner> <repo>

OWNER=${1:-medamap}
REPO=${2:-MedamaCode}

echo "Creating labels for $OWNER/$REPO..."

# タスクタイプのラベル
gh label create "task:feature" -d "New feature implementation" -c "0e8a16" -R "$OWNER/$REPO" 2>/dev/null || echo "task:feature already exists"
gh label create "task:bug" -d "Bug fix" -c "d73a4a" -R "$OWNER/$REPO" 2>/dev/null || echo "task:bug already exists"
gh label create "task:refactor" -d "Code refactoring" -c "cfd3d7" -R "$OWNER/$REPO" 2>/dev/null || echo "task:refactor already exists"
gh label create "task:test" -d "Test addition or modification" -c "fff200" -R "$OWNER/$REPO" 2>/dev/null || echo "task:test already exists"
gh label create "task:docs" -d "Documentation update" -c "0075ca" -R "$OWNER/$REPO" 2>/dev/null || echo "task:docs already exists"
gh label create "task:dogfooding" -d "PoppoBuilder self-improvement" -c "7057ff" -R "$OWNER/$REPO" 2>/dev/null || echo "task:dogfooding already exists"

# 優先度ラベル
gh label create "priority:high" -d "High priority" -c "b60205" -R "$OWNER/$REPO" 2>/dev/null || echo "priority:high already exists"
gh label create "priority:medium" -d "Medium priority" -c "fbca04" -R "$OWNER/$REPO" 2>/dev/null || echo "priority:medium already exists"
gh label create "priority:low" -d "Low priority" -c "0e8a16" -R "$OWNER/$REPO" 2>/dev/null || echo "priority:low already exists"

# 特殊ラベル
gh label create "skip:poppobuilder" -d "Skip PoppoBuilder processing" -c "cccccc" -R "$OWNER/$REPO" 2>/dev/null || echo "skip:poppobuilder already exists"

echo "✅ Label creation complete!"
echo ""
echo "📋 Created labels:"
gh label list -R "$OWNER/$REPO" | grep -E "(task:|priority:|skip:)"