import * as path from 'path';
import * as fs from 'fs';
import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import { downloadArtifactByCommitHash } from '../download';
import { GitHubService } from '../github';
import { createArtifactName, hashPath } from '../upload';
import { mockConsole, restoreConsole } from './mock-console';
const nock = require('nock');

describe('Download Module', () => {
  const commitHash = 'abc1234567';
  const filePath = '/tmp/test/rsdoctor-data.json';
  const fileName = 'rsdoctor-data.json';
  const workflowRunId = 123;

  beforeEach(() => {
    mockConsole();
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
    fs.rmSync(path.join(process.cwd(), 'temp-artifact'), { recursive: true, force: true });
    fs.rmSync(path.join(process.cwd(), 'temp-artifacts'), { recursive: true, force: true });
    restoreConsole();
  });

  function getPathHash() {
    const relativePath = path.relative(process.cwd(), filePath);
    const pathParts = relativePath.split(path.sep);
    return hashPath(pathParts, 'rsdoctor-data');
  }

  function mockArtifactSearch(artifactName: string, artifactId: number) {
    nock('https://api.github.com')
      .get('/repos/web-infra-dev/rsdoctor-action/actions/runs')
      .query({ head_sha: commitHash, status: 'completed', per_page: 30 })
      .reply(200, {
        workflow_runs: [
          {
            id: workflowRunId,
            name: 'CI',
            status: 'completed',
            conclusion: 'success',
          },
        ],
      });

    nock('https://api.github.com')
      .get(`/repos/web-infra-dev/rsdoctor-action/actions/runs/${workflowRunId}/artifacts`)
      .reply(200, {
        artifacts: [
          {
            id: artifactId,
            name: artifactName,
            created_at: '2026-05-08T00:00:00Z',
            size_in_bytes: 100,
          },
        ],
      });

    return nock('https://api.github.com')
      .get(`/repos/web-infra-dev/rsdoctor-action/actions/artifacts/${artifactId}/zip`)
      .reply(200, Buffer.from('not a zip'));
  }

  it('should find artifacts that use the rsdoctor-prefixed name', async () => {
    const pathHash = getPathHash();
    const artifactName = createArtifactName(pathHash, commitHash);
    const downloadScope = mockArtifactSearch(artifactName, 101);

    await expect(downloadArtifactByCommitHash(commitHash, fileName, filePath)).rejects.toThrow();

    expect(downloadScope.isDone()).toBe(true);
  });

  it('should find artifacts that use the legacy unprefixed name', async () => {
    const pathHash = getPathHash();
    const downloadScope = mockArtifactSearch(`${pathHash}-${commitHash}`, 202);

    await expect(downloadArtifactByCommitHash(commitHash, fileName, filePath)).rejects.toThrow();

    expect(downloadScope.isDone()).toBe(true);
  });

  it('should find artifacts that use the legacy unprefixed name with extension', async () => {
    const pathHash = getPathHash();
    const downloadScope = mockArtifactSearch(`${pathHash}-${commitHash}.json`, 303);

    await expect(downloadArtifactByCommitHash(commitHash, fileName, filePath)).rejects.toThrow();

    expect(downloadScope.isDone()).toBe(true);
  });

  it('should reuse workflow run and artifact lookups for the same commit', async () => {
    const secondFilePath = '/tmp/test/another/rsdoctor-data.json';
    const firstPathHash = getPathHash();
    const secondRelativePath = path.relative(process.cwd(), secondFilePath);
    const secondPathHash = hashPath(secondRelativePath.split(path.sep), 'rsdoctor-data');
    const firstArtifactName = createArtifactName(firstPathHash, commitHash);
    const secondArtifactName = createArtifactName(secondPathHash, commitHash);
    const githubService = new GitHubService();

    const runsScope = nock('https://api.github.com')
      .get('/repos/web-infra-dev/rsdoctor-action/actions/runs')
      .query({ head_sha: commitHash, status: 'completed', per_page: 30 })
      .reply(200, {
        workflow_runs: [
          {
            id: workflowRunId,
            name: 'CI',
            status: 'completed',
            conclusion: 'success',
          },
        ],
      });

    const artifactsScope = nock('https://api.github.com')
      .get(`/repos/web-infra-dev/rsdoctor-action/actions/runs/${workflowRunId}/artifacts`)
      .reply(200, {
        artifacts: [
          {
            id: 101,
            name: firstArtifactName,
            created_at: '2026-05-08T00:00:00Z',
            size_in_bytes: 100,
          },
          {
            id: 202,
            name: secondArtifactName,
            created_at: '2026-05-08T00:00:00Z',
            size_in_bytes: 100,
          },
        ],
      });

    const firstDownloadScope = nock('https://api.github.com')
      .get('/repos/web-infra-dev/rsdoctor-action/actions/artifacts/101/zip')
      .reply(200, Buffer.from('not a zip'));

    const secondDownloadScope = nock('https://api.github.com')
      .get('/repos/web-infra-dev/rsdoctor-action/actions/artifacts/202/zip')
      .reply(200, Buffer.from('not a zip'));

    await expect(downloadArtifactByCommitHash(commitHash, fileName, filePath, githubService)).rejects.toThrow();
    await expect(downloadArtifactByCommitHash(commitHash, fileName, secondFilePath, githubService)).rejects.toThrow();

    expect(runsScope.isDone()).toBe(true);
    expect(artifactsScope.isDone()).toBe(true);
    expect(firstDownloadScope.isDone()).toBe(true);
    expect(secondDownloadScope.isDone()).toBe(true);
  });
});
