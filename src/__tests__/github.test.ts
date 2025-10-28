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

      const commit = await githubService.getTargetBranchLatestCommit();
      expect(commit).toBe(mockCommitSha);
    });
  });
});

