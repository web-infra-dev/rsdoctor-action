import { describe, beforeEach, afterAll, it, expect } from '@rstest/core';
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
    it('should return default branch when not specified', () => {
      const branch = githubService.getTargetBranch();
      expect(branch).toBe('main');
    });
  });

  describe('getTargetBranchLatestCommit', () => {
    it('should get commit from GitHub API', async () => {
      const mockCommitSha = 'abcdef1234';
      nock('https://api.github.com')
        .get('/repos/web-infra-dev/rsdoctor-action/branches/main')
        .reply(200, {
          commit: {
            sha: mockCommitSha + '0123456789',
          },
        });

      // Mock workflow runs check (no artifacts found)
      nock('https://api.github.com')
        .get('/repos/web-infra-dev/rsdoctor-action/actions/runs')
        .query({ head_sha: mockCommitSha, status: 'completed', per_page: 30 })
        .reply(200, {
          workflow_runs: [],
        });

      // Mock get parent commit (no parent, reached beginning)
      nock('https://api.github.com')
        .get(`/repos/web-infra-dev/rsdoctor-action/commits/${mockCommitSha}`)
        .reply(200, {
          sha: mockCommitSha + '0123456789',
          parents: [],
        });

      const result = await githubService.getTargetBranchLatestCommit();
      expect(result).toHaveProperty('commitHash');
      expect(result).toHaveProperty('usedFallbackCommit');
      expect(result.commitHash).toBe(mockCommitSha);
      expect(result.usedFallbackCommit).toBe(false);
    });

    it('should return object with fallback info when latest commit has no artifacts', async () => {
      const mockCommitSha = 'abcdef1234';
      const mockParentSha = 'parent1234';
      nock('https://api.github.com')
        .get('/repos/web-infra-dev/rsdoctor-action/branches/main')
        .reply(200, {
          commit: {
            sha: mockCommitSha + '0123456789',
          },
        });

      // Mock workflow runs check for latest commit (no artifacts)
      nock('https://api.github.com')
        .get('/repos/web-infra-dev/rsdoctor-action/actions/runs')
        .query({ head_sha: mockCommitSha, status: 'completed', per_page: 30 })
        .reply(200, {
          workflow_runs: [],
        });

      // Mock get parent commit
      nock('https://api.github.com')
        .get(`/repos/web-infra-dev/rsdoctor-action/commits/${mockCommitSha}`)
        .reply(200, {
          sha: mockCommitSha + '0123456789',
          parents: [
            { sha: mockParentSha + '0123456789' },
          ],
        });

      // Mock workflow runs check for parent commit (has artifacts)
      nock('https://api.github.com')
        .get('/repos/web-infra-dev/rsdoctor-action/actions/runs')
        .query({ head_sha: mockParentSha, status: 'completed', per_page: 30 })
        .reply(200, {
          workflow_runs: [
            {
              id: 123,
              name: 'CI',
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
  });
});

