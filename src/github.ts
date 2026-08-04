import { getInput } from '@actions/core';
import { getOctokit } from '@actions/github';
import { execSync } from 'child_process';

export interface Repository {
  owner: string;
  repo: string;
}

export interface WorkflowRunParams {
  branch: string;
  status?: 'completed' | 'in_progress' | 'queued' | 'requested';
  limit?: number;
  skipCommits?: number;
}

interface Artifact {
  id: number;
  name: string;
}

interface Comment {
  id: number;
  body: string;
}

interface ApiError extends Error {
  status?: number;
  response?: {
    data?: {
      message?: string;
    };
  };
}

function formatShortSha(commitHash: string): string {
  return commitHash.substring(0, 10);
}

export class GitHubService {
  private octokit: any;
  private repository: Repository;

  constructor() {
    this.octokit = getOctokit(getInput('github_token', { required: true }));
    
    const { context } = require('@actions/github');
    this.repository = {
      owner: context.repo.owner,
      repo: context.repo.repo
    };
    
    console.log(`🔧 GitHub Service initialized for: ${this.repository.owner}/${this.repository.repo}`);
  }

  getCurrentCommitHash(): string {
    return execSync('git rev-parse --short=10 HEAD', { encoding: 'utf8' }).trim();
  }

  async getTargetBranch(): Promise<string> {
    const dispatchTargetBranch = getInput('dispatch_target_branch');
    const configuredTargetBranch = dispatchTargetBranch || getInput('target_branch');
    if (configuredTargetBranch) {
      return configuredTargetBranch;
    }

    const { owner, repo } = this.repository;
    try {
      const repositoryResponse = await this.octokit.rest.repos.get({ owner, repo });
      const defaultBranch = repositoryResponse.data?.default_branch;
      if (!defaultBranch) {
        throw new Error('Repository default branch is unavailable');
      }
      return defaultBranch;
    } catch (error) {
      const apiError = error as ApiError;
      throw new Error(`Failed to get repository default branch: ${apiError.message}`);
    }
  }

  async listWorkflowRuns(params: WorkflowRunParams) {
    const { owner, repo } = this.repository;
    
    const runsResponse = await this.octokit.rest.actions.listWorkflowRuns({
      owner,
      repo,
      branch: params.branch,
      status: params.status || 'completed',
      per_page: (params.limit || 10) + (params.skipCommits || 0)
    });

    return runsResponse.data;
  }

  /**
   * Check if a commit has any artifacts by checking its workflow runs
   */
  async hasArtifactsForCommit(commitHash: string, branch?: string): Promise<boolean> {
    try {
      const workflowRuns = await this.findAllWorkflowRunsByCommit(commitHash, 'completed', branch);
      
      for (const workflowRun of workflowRuns) {
        try {
          const runArtifacts = await this.listArtifactsForWorkflowRun(workflowRun.id);
          if (runArtifacts.artifacts && runArtifacts.artifacts.length > 0) {
            return true;
          }
        } catch (error) {
          // Continue checking other workflow runs
          continue;
        }
      }
      
      return false;
    } catch (error) {
      // If we can't check, assume no artifacts
      return false;
    }
  }

  /**
   * Get parent commit hash
   */
  async getParentCommit(commitHash: string): Promise<string | null> {
    const { owner, repo } = this.repository;
    
    try {
      const commitResponse = await this.octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: commitHash
      });
      
      if (commitResponse.data.parents && commitResponse.data.parents.length > 0) {
        return commitResponse.data.parents[0].sha;
      }
      
      return null;
    } catch (error) {
      const apiError = error as ApiError;
      console.warn(`⚠️  Failed to get parent commit for ${commitHash}: ${apiError.message}`);
      return null;
    }
  }

  async getTargetBranchLatestCommit(): Promise<{ commitHash: string; usedFallbackCommit: boolean; latestCommitHash?: string }> {
    const targetBranch = await this.getTargetBranch();
    console.log(`🔍 Attempting to get latest commit for target branch: ${targetBranch}`);
    console.log(`📋 Repository: ${this.repository.owner}/${this.repository.repo}`);
    
    try {
      console.log(`📡 Trying to get latest commit from GitHub API...`);
      const { owner, repo } = this.repository;
      const branchResponse = await this.octokit.rest.repos.getBranch({
        owner,
        repo,
        branch: targetBranch
      });
      const latestCommitHash = branchResponse.data?.commit?.sha;
      if (!latestCommitHash) {
        throw new Error(`Target branch (${targetBranch}) has no commit hash`);
      }
      console.log(`✅ Found commit hash from GitHub API: ${formatShortSha(latestCommitHash)}`);

      const latestShortHash = formatShortSha(latestCommitHash);

      // Check if the latest commit has artifacts, if not, look for previous commits
      console.log(`🔍 Checking if commit ${latestShortHash} has baseline artifacts...`);
      const hasArtifacts = await this.hasArtifactsForCommit(latestCommitHash, targetBranch);
      
      if (hasArtifacts) {
        console.log(`✅ Commit ${latestShortHash} has baseline artifacts`);
        return {
          commitHash: latestCommitHash,
          usedFallbackCommit: false
        };
      }

      // Latest commit doesn't have artifacts, look for previous commits
      console.log(`⚠️  Commit ${latestShortHash} does not have baseline artifacts`);
      console.log(`🔍 Looking for previous commits with baseline artifacts...`);
      
      let currentCommit = latestCommitHash;
      const checkedCommits: string[] = [currentCommit];
      const maxDepth = 5;
      
      for (let depth = 0; depth < maxDepth; depth++) {
        const parentCommit = await this.getParentCommit(currentCommit);
        
        if (!parentCommit) {
          console.log(`⚠️  Reached the beginning of the branch, no more parent commits`);
          break;
        }
        
        if (checkedCommits.includes(parentCommit)) {
          console.log(`⚠️  Detected circular reference, stopping search`);
          break;
        }
        
        checkedCommits.push(parentCommit);
        const parentShortHash = formatShortSha(parentCommit);
        console.log(`🔍 Checking parent commit ${parentShortHash}...`);
        
        const parentHasArtifacts = await this.hasArtifactsForCommit(parentCommit, targetBranch);
        
        if (parentHasArtifacts) {
          console.log(`✅ Found commit ${parentShortHash} with baseline artifacts`);
          console.log(`\n⚠️  Note: The latest commit (${latestShortHash}) does not have baseline artifacts.`);
          console.log(`   Using commit ${parentShortHash} for baseline comparison instead.`);
          console.log(`   If this seems incorrect, please wait a few minutes and try rerunning the workflow.`);
          return {
            commitHash: parentCommit,
            usedFallbackCommit: true,
            latestCommitHash: latestCommitHash
          };
        }
        
        currentCommit = parentCommit;
      }
      
      // No commits with artifacts found
      console.log(`\n⚠️  No commits with baseline artifacts found in the last ${maxDepth} commits.`);
      console.log(`   Using latest commit ${latestShortHash} anyway.`);
      console.log(`   Note: If baseline comparison fails, please wait a few minutes and try rerunning the workflow.`);
      return {
        commitHash: latestCommitHash,
        usedFallbackCommit: false
      };
      
    } catch (error) {
      console.error(`❌ Failed to get target branch commit: ${error}`);
      console.error(`Repository: ${this.repository.owner}/${this.repository.repo}`);
      console.error(`Target branch: ${targetBranch}`);
      
      const apiError = error as ApiError;
      throw new Error(`Failed to get target branch (${targetBranch}) commit: ${apiError.message}`);
    }
  }

  async listArtifacts() {
    const { owner, repo } = this.repository;
    
    const artifactsResponse = await this.octokit.rest.actions.listArtifactsForRepo({
      owner,
      repo,
      per_page: 100
    });

    return artifactsResponse.data;
  }

  /**
   * Find workflow run by commit hash
   * This is more efficient than listing all artifacts
   */
  async findWorkflowRunByCommit(
    commitHash: string,
    status: 'completed' | 'in_progress' | 'queued' | 'requested' = 'completed',
    branch?: string,
  ) {
    const { owner, repo } = this.repository;
    
    try {
      // First try to find by exact commit hash
      const runsResponse = await this.octokit.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        branch,
        head_sha: commitHash,
        status,
        per_page: 10
      });

      if (runsResponse.data.workflow_runs && runsResponse.data.workflow_runs.length > 0) {
        // Return the most recent successful run, or the first one if no successful run
        const successfulRun = runsResponse.data.workflow_runs.find(
          (run: any) => run.conclusion === 'success'
        );
        return successfulRun || runsResponse.data.workflow_runs[0];
      }

      // If not found by exact hash, try searching by short hash (first 10 chars)
      const shortHash = commitHash.substring(0, 10);
      const allRunsResponse = await this.octokit.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        branch,
        status,
        per_page: 100
      });

      const matchingRun = allRunsResponse.data.workflow_runs?.find(
        (run: any) => run.head_sha.startsWith(shortHash) || run.head_sha.startsWith(commitHash)
      );

      return matchingRun || null;
    } catch (error) {
      const apiError = error as ApiError;
      console.warn(`⚠️  Failed to find workflow run for commit ${commitHash}: ${apiError.message}`);
      return null;
    }
  }

  /**
   * Find all workflow runs by commit hash
   * Returns all matching workflow runs without sorting
   */
  async findAllWorkflowRunsByCommit(
    commitHash: string,
    status: 'completed' | 'in_progress' | 'queued' | 'requested' = 'completed',
    branch?: string,
  ) {
    const { owner, repo } = this.repository;
    
    try {
      // First try to find by exact commit hash
      const runsResponse = await this.octokit.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        branch,
        head_sha: commitHash,
        status,
        per_page: 30  // Increase to get more runs
      });

      if (runsResponse.data.workflow_runs && runsResponse.data.workflow_runs.length > 0) {
        // Return all matching runs without sorting
        return runsResponse.data.workflow_runs;
      }

      // If not found by exact hash, try searching by short hash (first 10 chars)
      const shortHash = commitHash.substring(0, 10);
      const allRunsResponse = await this.octokit.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        branch,
        status,
        per_page: 100
      });

      const matchingRuns = allRunsResponse.data.workflow_runs?.filter(
        (run: any) => run.head_sha.startsWith(shortHash) || run.head_sha.startsWith(commitHash)
      ) || [];

      return matchingRuns;
    } catch (error) {
      const apiError = error as ApiError;
      console.warn(`⚠️  Failed to find workflow runs for commit ${commitHash}: ${apiError.message}`);
      return [];
    }
  }

  /**
   * List artifacts for a specific workflow run
   * This is more efficient than listing all repository artifacts
   */
  async listArtifactsForWorkflowRun(runId: number) {
    const { owner, repo } = this.repository;
    
    try {
      const artifactsResponse = await this.octokit.rest.actions.listWorkflowRunArtifacts({
        owner,
        repo,
        run_id: runId
      });

      return artifactsResponse.data;
    } catch (error) {
      const apiError = error as ApiError;
      console.warn(`⚠️  Failed to list artifacts for workflow run ${runId}: ${apiError.message}`);
      throw error;
    }
  }

  async findArtifactByNamePattern(pattern: string): Promise<Artifact | null> {
    const artifacts = await this.listArtifacts();
    
    console.log(`Looking for artifacts matching pattern: ${pattern}`);
    console.log(`Available artifacts: ${artifacts.artifacts.map((a: Artifact) => a.name).join(', ')}`);
    
    const matchingArtifacts = artifacts.artifacts.filter((artifact: Artifact) => 
      artifact.name.includes(pattern)
    );
    
    if (matchingArtifacts.length > 0) {
      console.log(`Found ${matchingArtifacts.length} matching artifacts:`, matchingArtifacts.map((a: Artifact) => a.name));
      return matchingArtifacts.sort((a: Artifact, b: Artifact) => b.id - a.id)[0];
    }
    
    console.log(`No artifacts found matching pattern: ${pattern}`);
    return null;
  }

  async downloadArtifact(artifactId: number) {
    const { owner, repo } = this.repository;
    
    const downloadResponse = await this.octokit.rest.actions.downloadArtifact({
      owner,
      repo,
      artifact_id: artifactId,
      archive_format: 'zip'
    });

    return downloadResponse.data;
  }

  async findExistingComment(prNumber: number, commentPrefix: string): Promise<number | null> {
    const { owner, repo } = this.repository;
    
    try {
      const { data: comments } = await this.octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: prNumber,
      });

      const existingComment = comments.find((comment: Comment) => comment.body.startsWith(commentPrefix));
      return existingComment ? existingComment.id : null;
    } catch (error) {
      const apiError = error as ApiError;
      console.warn(`Failed to find existing comment: ${apiError.message}`);
      return null;
    }
  }

  /**
   * Find PRs associated with a commit
   */
  async findPRsByCommit(commitHash: string): Promise<Array<{ number: number; title: string; url: string }>> {
    const { owner, repo } = this.repository;
    
    try {
      const { data: prs } = await this.octokit.rest.repos.listPullRequestsAssociatedWithCommit({
        owner,
        repo,
        commit_sha: commitHash,
      });
      
      return prs.map((pr: any) => ({
        number: pr.number,
        title: pr.title,
        url: pr.html_url
      }));
    } catch (error) {
      console.warn(`⚠️  Failed to find PRs for commit ${commitHash}: ${error}`);
      return [];
    }
  }

  async updateOrCreateComment(prNumber: number, body: string): Promise<void> {
    const { owner, repo } = this.repository;
    const commentPrefix = '## Rsdoctor Bundle Diff Analysis';
    
    try {
      const existingCommentId = await this.findExistingComment(prNumber, commentPrefix);

      if (existingCommentId) {
        console.log(`Updating existing comment: ${existingCommentId}`);
        await this.octokit.rest.issues.updateComment({
          owner,
          repo,
          comment_id: existingCommentId,
          body,
        });
      } else {
        console.log('Creating new comment');
        await this.octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: prNumber,
          body,
        });
      }
    } catch (error) {
      const apiError = error as ApiError;
      console.error(`Failed to update/create comment: ${apiError.message}`);
      throw error;
    }
  }
}
