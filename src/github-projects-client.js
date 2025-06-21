const axios = require('axios');

/**
 * GitHub Projects API クライアント
 * GitHub Projects (v2) GraphQL APIを使用してプロジェクトボードを管理
 */
class GitHubProjectsClient {
  constructor(token, logger) {
    this.token = token;
    this.logger = logger;
    this.graphqlEndpoint = 'https://api.github.com/graphql';
    
    // GraphQLクライアントの設定
    this.client = axios.create({
      baseURL: this.graphqlEndpoint,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
  }

  /**
   * GraphQLクエリを実行
   */
  async query(query, variables = {}) {
    try {
      const response = await this.client.post('', {
        query,
        variables
      });
      
      if (response.data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(response.data.errors)}`);
      }
      
      return response.data.data;
    } catch (error) {
      this.logger?.error('GraphQLクエリエラー:', error);
      throw error;
    }
  }

  /**
   * 組織またはユーザーのプロジェクト一覧を取得
   */
  async listProjects(owner, isOrg = false) {
    const query = `
      query($login: String!, $first: Int!) {
        ${isOrg ? 'organization' : 'user'}(login: $login) {
          projectsV2(first: $first) {
            nodes {
              id
              number
              title
              shortDescription
              closed
              public
              url
              createdAt
              updatedAt
            }
          }
        }
      }
    `;
    
    const data = await this.query(query, {
      login: owner,
      first: 20
    });
    
    return data[isOrg ? 'organization' : 'user']?.projectsV2?.nodes || [];
  }

  /**
   * プロジェクトの詳細情報を取得
   */
  async getProject(projectId) {
    const query = `
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            id
            number
            title
            shortDescription
            closed
            public
            url
            createdAt
            updatedAt
            fields(first: 20) {
              nodes {
                ... on ProjectV2Field {
                  id
                  name
                  dataType
                }
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    `;
    
    const data = await this.query(query, { projectId });
    return data.node;
  }

  /**
   * プロジェクトのアイテム（Issue/PR）を取得
   */
  async getProjectItems(projectId, first = 50) {
    const query = `
      query($projectId: ID!, $first: Int!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: $first) {
              nodes {
                id
                fieldValues(first: 20) {
                  nodes {
                    ... on ProjectV2ItemFieldTextValue {
                      text
                      field {
                        ... on ProjectV2Field {
                          name
                        }
                      }
                    }
                    ... on ProjectV2ItemFieldNumberValue {
                      number
                      field {
                        ... on ProjectV2Field {
                          name
                        }
                      }
                    }
                    ... on ProjectV2ItemFieldDateValue {
                      date
                      field {
                        ... on ProjectV2Field {
                          name
                        }
                      }
                    }
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field {
                        ... on ProjectV2SingleSelectField {
                          name
                        }
                      }
                    }
                  }
                }
                content {
                  ... on Issue {
                    id
                    number
                    title
                    state
                    url
                    labels(first: 10) {
                      nodes {
                        name
                      }
                    }
                  }
                  ... on PullRequest {
                    id
                    number
                    title
                    state
                    url
                  }
                }
              }
            }
          }
        }
      }
    `;
    
    const data = await this.query(query, { projectId, first });
    return data.node?.items?.nodes || [];
  }

  /**
   * Issueをプロジェクトに追加
   */
  async addIssueToProject(projectId, issueId) {
    const mutation = `
      mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: {
          projectId: $projectId
          contentId: $contentId
        }) {
          item {
            id
          }
        }
      }
    `;
    
    const data = await this.query(mutation, {
      projectId,
      contentId: issueId
    });
    
    return data.addProjectV2ItemById?.item;
  }

  /**
   * プロジェクトアイテムをアーカイブ
   */
  async archiveProjectItem(projectId, itemId) {
    const mutation = `
      mutation($projectId: ID!, $itemId: ID!) {
        archiveProjectV2Item(input: {
          projectId: $projectId
          itemId: $itemId
        }) {
          item {
            id
          }
        }
      }
    `;
    
    const data = await this.query(mutation, { projectId, itemId });
    return data.archiveProjectV2Item?.item;
  }

  /**
   * プロジェクトアイテムのフィールド値を更新
   */
  async updateProjectItemField(projectId, itemId, fieldId, value) {
    // SingleSelectフィールドの場合
    const mutation = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: {
            singleSelectOptionId: $value
          }
        }) {
          projectV2Item {
            id
          }
        }
      }
    `;
    
    const data = await this.query(mutation, {
      projectId,
      itemId,
      fieldId,
      value
    });
    
    return data.updateProjectV2ItemFieldValue?.projectV2Item;
  }

  /**
   * プロジェクトアイテムのステータスを更新
   */
  async updateItemStatus(projectId, itemId, statusFieldId, statusOptionId) {
    return this.updateProjectItemField(projectId, itemId, statusFieldId, statusOptionId);
  }

  /**
   * Issueのノード IDを取得
   */
  async getIssueNodeId(owner, repo, issueNumber) {
    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) {
            id
          }
        }
      }
    `;
    
    const data = await this.query(query, {
      owner,
      repo,
      number: issueNumber
    });
    
    return data.repository?.issue?.id;
  }

  /**
   * プロジェクト内のIssueを検索
   */
  async findProjectItem(projectId, issueNumber) {
    const items = await this.getProjectItems(projectId);
    
    return items.find(item => 
      item.content && 
      item.content.number === issueNumber
    );
  }

  /**
   * プロジェクトのステータスフィールドを取得
   */
  async getStatusField(projectId) {
    const project = await this.getProject(projectId);
    
    // "Status"という名前のSingleSelectフィールドを探す
    const statusField = project.fields.nodes.find(field => 
      field.name === 'Status' && field.options
    );
    
    if (!statusField) {
      throw new Error('プロジェクトにStatusフィールドが見つかりません');
    }
    
    return statusField;
  }

  /**
   * ステータスオプションIDを名前から取得
   */
  getStatusOptionId(statusField, optionName) {
    const option = statusField.options.find(opt => 
      opt.name.toLowerCase() === optionName.toLowerCase()
    );
    
    if (!option) {
      throw new Error(`ステータスオプション '${optionName}' が見つかりません`);
    }
    
    return option.id;
  }
}

module.exports = GitHubProjectsClient;