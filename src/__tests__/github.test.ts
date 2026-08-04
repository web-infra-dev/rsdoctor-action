import { describe, beforeEach, afterAll, it, expect } from '@rstest/core';
import { getInput } from '@actions/core';
import { GitHubService } from '../github';
const nock = require('nock');

describe('GitHub Service', () => {
  let githubService: GitHubService;

  beforeEach(() => {
    githubService = new GitHubService();
    nock.cleanAll();
  });

  afterAll(() => {
    nock.restore();
  });

  describe('getCurrentCommitHash', () => {
    it('should return current commit hash', () => {
      const hash = githubService.getCurrentCommitHash();
      expect(hash).toMatch(/^[a-f0-9]{10}$/);
    });
  });

  describe('getTargetBranch', () => {
    it('should return the configured target branch', async () => {
      const branch = await githubService.getTargetBranch();
      expect(branch).toBe('main');
    });

    it('should use the repository default branch when not configured', async () => {
      (getInput as any)
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      nock('https://api.github.com')
        .get('/repos/web-infra-dev/rsdoctor-action')
        .reply(200, { default_branch: 'master' });

      const branch = await githubService.getTargetBranch();
      expect(branch).toBe('master');
    });
  });

  describe('getTargetBranchLatestCommit', () => {
    it('should get commit from GitHub API', async () => {
      const mockCommitSha = 'abcdef1234abcdef1234abcdef1234abcdef1234';
      nock('https://api.github.com')
        .get('/repos/web-infra-dev/rsdoctor-action/branches/main')
        .reply(200, {
          commit: {
            sha: mockCommitSha,
          },
        });

      // Mock workflow runs check (no artifacts found)
      nock('https://api.github.com')
        .get('/repos/web-infra-dev/rsdoctor-action/actions/runs')
        .query({ branch: 'main', head_sha: mockCommitSha, status: 'completed', per_page: 30 })
        .reply(200, {
          workflow_runs: [],
        });

      // Mock branch-filtered fallback workflow runs check (no artifacts found)
      nock('https://api.github.com')
        .get('/repos/web-infra-dev/rsdoctor-action/actions/runs')
        .query({ branch: 'main', status: 'completed', per_page: 100 })
        .reply(200, {
          workflow_runs: [],
        });

      // Mock get parent commit (no parent, reached beginning)
      nock('https://api.github.com')
        .get(`/repos/web-infra-dev/rsdoctor-action/commits/${mockCommitSha}`)
        .reply(200, {
          sha: mockCommitSha,
          parents: [],
        });

      const result = await githubService.getTargetBranchLatestCommit();
      expect(result).toHaveProperty('commitHash');
      expect(result).toHaveProperty('usedFallbackCommit');
      expect(result.commitHash).toBe(mockCommitSha);
      expect(result.usedFallbackCommit).toBe(false);
    });

    it('should return object with fallback info when latest commit has no artifacts', async () => {
      const mockCommitSha = 'abcdef1234abcdef1234abcdef1234abcdef1234';
      const mockParentSha = '1234567890abcdef1234567890abcdef12345678';
      nock('https://api.github.com')
        .get('/repos/web-infra-dev/rsdoctor-action/branches/main')
        .reply(200, {
          commit: {
            sha: mockCommitSha,
          },
        });

      // Mock workflow runs check for latest commit (no artifacts)
      nock('https://api.github.com')
        .get('/repos/web-infra-dev/rsdoctor-action/actions/runs')
        .query({ branch: 'main', head_sha: mockCommitSha, status: 'completed', per_page: 30 })
        .reply(200, {
          workflow_runs: [],
        });

      // Mock branch-filtered fallback workflow runs check for latest commit (no artifacts)
      nock('https://api.github.com')
        .get('/repos/web-infra-dev/rsdoctor-action/actions/runs')
        .query({ branch: 'main', status: 'completed', per_page: 100 })
        .reply(200, {
          workflow_runs: [],
        });

      // Mock get parent commit
      nock('https://api.github.com')
        .get(`/repos/web-infra-dev/rsdoctor-action/commits/${mockCommitSha}`)
        .reply(200, {
          sha: mockCommitSha,
          parents: [
            { sha: mockParentSha },
          ],
        });

      // Mock workflow runs check for parent commit (has artifacts)
      nock('https://api.github.com')
        .get('/repos/web-infra-dev/rsdoctor-action/actions/runs')
        .query({ branch: 'main', head_sha: mockParentSha, status: 'completed', per_page: 30 })
        .reply(200, {
          workflow_runs: [
            {
              id: 123,
              name: 'CI',
              head_sha: mockParentSha,
              status: 'completed',
              conclusion: 'success',
            },
          ],
        });

      // Mock artifacts for parent commit
      nock('https://api.github.com')
        .get('/repos/web-infra-dev/rsdoctor-action/actions/runs/123/artifacts')
        .reply(200, {
          artifacts: [
            { id: 1, name: 'test-artifact' },
          ],
        });

      const result = await githubService.getTargetBranchLatestCommit();
      expect(result).toHaveProperty('commitHash');
      expect(result).toHaveProperty('usedFallbackCommit');
      expect(result).toHaveProperty('latestCommitHash');
      expect(result.commitHash).toBe(mockParentSha);
      expect(result.usedFallbackCommit).toBe(true);
      expect(result.latestCommitHash).toBe(mockCommitSha);
    });

    it('should fail when the target branch cannot be queried', async () => {
      nock('https://api.github.com')
        .get('/repos/web-infra-dev/rsdoctor-action/branches/main')
        .reply(404, { message: 'Branch not found' });

      await expect(githubService.getTargetBranchLatestCommit())
        .rejects
        .toThrow('Failed to get target branch (main) commit: Branch not found');
    });

    it('should use the full SHA when querying workflow runs for baseline artifacts', async () => {
      const mockCommitSha = 'fedcba9876fedcba9876fedcba9876fedcba9876';
      nock('https://api.github.com')
        .get('/repos/web-infra-dev/rsdoctor-action/branches/main')
        .reply(200, {
          commit: {
            sha: mockCommitSha,
          },
        });

      nock('https://api.github.com')
        .get('/repos/web-infra-dev/rsdoctor-action/actions/runs')
        .query({ branch: 'main', head_sha: mockCommitSha, status: 'completed', per_page: 30 })
        .reply(200, {
          workflow_runs: [
            {
              id: 456,
              name: 'CI',
              head_sha: mockCommitSha,
              status: 'completed',
              conclusion: 'success',
            },
          ],
        });

      nock('https://api.github.com')
        .get('/repos/web-infra-dev/rsdoctor-action/actions/runs/456/artifacts')
        .reply(200, {
          artifacts: [
            { id: 1, name: 'rsdoctor-artifact' },
          ],
        });

      const result = await githubService.getTargetBranchLatestCommit();
      expect(result.commitHash).toBe(mockCommitSha);
      expect(result.usedFallbackCommit).toBe(false);
    });
  });

  describe('findWorkflowRunByCommit', () => {
    it('should filter the exact workflow run lookup by branch', async () => {
      const fullSha = 'abcdef1234abcdef1234abcdef1234abcdef1234';

      nock('https://api.github.com')
        .get('/repos/web-infra-dev/rsdoctor-action/actions/runs')
        .query({ branch: 'main', head_sha: fullSha, status: 'completed', per_page: 10 })
        .reply(200, {
          workflow_runs: [
            {
              id: 456,
              head_sha: fullSha,
              conclusion: 'success',
            },
          ],
        });

      const run = await githubService.findWorkflowRunByCommit(fullSha, 'completed', 'main');
      expect(run.id).toBe(456);
    });
  });

  describe('findAllWorkflowRunsByCommit', () => {
    it('should filter fallback workflow run lookup by branch', async () => {
      const fullSha = 'abcdef1234abcdef1234abcdef1234abcdef1234';

      nock('https://api.github.com')
        .get('/repos/web-infra-dev/rsdoctor-action/actions/runs')
        .query({ branch: 'main', head_sha: fullSha, status: 'completed', per_page: 30 })
        .reply(200, {
          workflow_runs: [],
        });

      nock('https://api.github.com')
        .get('/repos/web-infra-dev/rsdoctor-action/actions/runs')
        .query({ branch: 'main', status: 'completed', per_page: 100 })
        .reply(200, {
          workflow_runs: [
            {
              id: 789,
              head_sha: fullSha,
              conclusion: 'success',
            },
          ],
        });

      const runs = await githubService.findAllWorkflowRunsByCommit(fullSha, 'completed', 'main');
      expect(runs).toHaveLength(1);
      expect(runs[0].id).toBe(789);
    });
  });
});
