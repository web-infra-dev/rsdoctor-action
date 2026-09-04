import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'rstack/test';
import {
  downloadArtifactByCommitHash,
  readArtifactFileFromZip,
} from '../download';
import { createArtifactName, hashPath } from '../upload';
import { mockConsole, restoreConsole } from './mock-console';
const nock = require('nock');

const artifactZip = Buffer.from(
  'UEsDBBQAAAAIAMV58FyYwF+WKQAAADEAAAAZAAAAbmVzdGVkL3JzZG9jdG9yLWRhdGEuanNvbqtWSkksSVSyqlZKzijNy3YvSizIAPESi4tTS4qVrKJjdSAyYHZtbS0AUEsBAhQDFAAAAAgAxXnwXJjAX5YpAAAAMQAAABkAAAAAAAAAAAAAAIABAAAAAG5lc3RlZC9yc2RvY3Rvci1kYXRhLmpzb25QSwUGAAAAAAEAAQBHAAAAYAAAAAAA',
  'base64',
);

describe('Download Module', () => {
  const commitHash = 'abc1234567abc1234567abc1234567abc1234567';
  const shortCommitHash = commitHash.substring(0, 10);
  const filePath = '/tmp/test/rsdoctor-data.json';
  const fileName = 'rsdoctor-data.json';
  const workflowRunId = 123;

  beforeEach(() => {
    mockConsole();
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
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
      .get(
        `/repos/web-infra-dev/rsdoctor-action/actions/runs/${workflowRunId}/artifacts`,
      )
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
      .get(
        `/repos/web-infra-dev/rsdoctor-action/actions/artifacts/${artifactId}/zip`,
      )
      .reply(200, Buffer.from('not a zip'));
  }

  it('should read the target JSON directly from a nested ZIP entry', async () => {
    const content = await readArtifactFileFromZip(artifactZip, fileName);

    expect(JSON.parse(content.toString('utf-8'))).toEqual({
      data: {
        chunkGraph: {
          assets: [],
          chunks: [],
        },
      },
    });
  });

  it('should reject when the target entry does not exist', async () => {
    await expect(
      readArtifactFileFromZip(artifactZip, 'missing.json'),
    ).rejects.toThrow('Target file missing.json not found in artifact');
  });

  it('should reject instead of exiting silently when ZIP opening stalls', async () => {
    await expect(
      readArtifactFileFromZip(Buffer.alloc(0), fileName, 10, () => undefined),
    ).rejects.toThrow(`Timed out after 10ms while extracting ${fileName}`);
  });

  it('should find artifacts that use the rsdoctor-prefixed name', async () => {
    const pathHash = getPathHash();
    const artifactName = createArtifactName(pathHash, shortCommitHash);
    const downloadScope = mockArtifactSearch(artifactName, 101);

    await expect(
      downloadArtifactByCommitHash(commitHash, fileName, filePath),
    ).rejects.toThrow();

    expect(downloadScope.isDone()).toBe(true);
  });

  it('should find artifacts that use the legacy unprefixed name', async () => {
    const pathHash = getPathHash();
    const downloadScope = mockArtifactSearch(
      `${pathHash}-${shortCommitHash}`,
      202,
    );

    await expect(
      downloadArtifactByCommitHash(commitHash, fileName, filePath),
    ).rejects.toThrow();

    expect(downloadScope.isDone()).toBe(true);
  });

  it('should find artifacts that use the legacy unprefixed name with extension', async () => {
    const pathHash = getPathHash();
    const downloadScope = mockArtifactSearch(
      `${pathHash}-${shortCommitHash}.json`,
      303,
    );

    await expect(
      downloadArtifactByCommitHash(commitHash, fileName, filePath),
    ).rejects.toThrow();

    expect(downloadScope.isDone()).toBe(true);
  });

  it('should also find artifacts that use a full SHA name', async () => {
    const pathHash = getPathHash();
    const artifactName = createArtifactName(pathHash, commitHash);
    const downloadScope = mockArtifactSearch(artifactName, 404);

    await expect(
      downloadArtifactByCommitHash(commitHash, fileName, filePath),
    ).rejects.toThrow();

    expect(downloadScope.isDone()).toBe(true);
  });
});
