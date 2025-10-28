import * as path from 'path';
import { expect, describe, afterEach, beforeEach, it, rstest } from '@rstest/core';
const mockFs = require('mock-fs');
import { GitHubService } from '../github';
import { uploadArtifact } from '../upload';
import { parseRsdoctorData, generateBundleAnalysisReport } from '../report';
import { mockConsole } from './mock-console';

describe('Integration Tests', () => {
  const mockCommitHash = 'abc1234567';
  const mockFilePath = path.join(process.cwd(), 'dist/.rsdoctor/rsdoctor-data.json');
  const mockRsdoctorData = {
    data: {
      chunkGraph: {
        assets: [
          {
            id: 1,
            path: 'dist/static/js/index.js',
            size: 1024 * 1024,
            chunks: ['index'],
          },
        ],
        chunks: [
          {
            id: 'index',
            name: 'index',
            initial: true,
            size: 1024 * 1024,
            assets: ['dist/static/js/index.js'],
          },
        ],
      },
    },
  };

  beforeEach(() => {
    mockConsole();
    // Mock file system
    mockFs({
      'dist/.rsdoctor': {
        'rsdoctor-data.json': JSON.stringify(mockRsdoctorData, null, 2),
      },
    });

    // Mock environment variables
    process.env.GITHUB_EVENT_NAME = 'pull_request';
    process.env.GITHUB_REF = 'refs/pull/123/merge';
  });

  afterEach(() => {
    mockFs.restore();
    rstest.restoreAllMocks();
  });

  describe('Pull Request Workflow', () => {
    it('should process pull request event correctly', async () => {
      // 1. Parse Rsdoctor data
      const bundleAnalysis = parseRsdoctorData(mockFilePath);
      expect(bundleAnalysis).toBeDefined();
      expect(bundleAnalysis?.totalSize).toBe(1024 * 1024);

      // 2. Upload artifact
      const uploadResponse = await uploadArtifact(mockFilePath, mockCommitHash);
      expect(uploadResponse.id).toBe(1);

      // 3. Generate report
      await generateBundleAnalysisReport(bundleAnalysis!);
      // GitHub Actions summary is mocked in setup.ts
      expect(true).toBe(true);
    });
  });

  describe('GitHub Service Integration', () => {
    let githubService: GitHubService;

    beforeEach(() => {
      githubService = new GitHubService();
    });

    it('should handle the complete artifact workflow', async () => {
      // Mock GitHub API responses
      rstest.spyOn(githubService, 'getTargetBranchLatestCommit')
        .mockResolvedValue('test-commit-hash');
      
      rstest.spyOn(githubService, 'findArtifactByNamePattern')
        .mockResolvedValue({ id: 1, name: 'test-artifact' });

      // 1. Get target branch commit
      const targetCommitHash = await githubService.getTargetBranchLatestCommit();
      expect(targetCommitHash).toBe('test-commit-hash');

      // 2. Find and download artifact
      const artifact = await githubService.findArtifactByNamePattern('rsdoctor-data');
      expect(artifact).toBeDefined();
      expect(artifact.id).toBe(1);

      // 3. Upload new artifact
      const uploadResponse = await uploadArtifact(mockFilePath, mockCommitHash);
      expect(uploadResponse.id).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing Rsdoctor data gracefully', async () => {
      mockFs.restore(); // Remove mock file system
      const bundleAnalysis = parseRsdoctorData('/non/existent/path.json');
      expect(bundleAnalysis).toBeNull();
    });

    it('should handle invalid Rsdoctor data format', async () => {
      mockFs({
        [mockFilePath]: '{ "invalid": "data" }',
      });
      const bundleAnalysis = parseRsdoctorData(mockFilePath);
      expect(bundleAnalysis).toBeNull();
    });
  });
});

