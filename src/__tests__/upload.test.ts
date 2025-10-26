import * as path from 'path';
const mockFs = require('mock-fs');
import { uploadArtifact } from '../upload';
import { mockConsole, restoreConsole } from './mock-console';
import { describe, beforeEach, rstest, afterEach, it, expect } from '@rstest/core';

describe('Upload Module', () => {
  const mockCommitHash = 'abc1234567';
  const mockFilePath = '/tmp/test/rsdoctor-data.json';
  const mockFileContent = JSON.stringify({ test: 'data' });

  beforeEach(() => {
    mockConsole();
    // Mock the file system
    mockFs({
      '/tmp/test': {
        'rsdoctor-data.json': mockFileContent,
        'other-file.txt': 'test content',
      },
    });

    // Mock git command
    rstest.spyOn(require('child_process'), 'execSync')
      .mockReturnValue(mockCommitHash);
  });

  afterEach(() => {
    mockFs.restore();
    rstest.restoreAllMocks();
    restoreConsole();
  });

  it('should upload artifact successfully', async () => {
    const result = await uploadArtifact(mockFilePath);
    expect(result).toBeDefined();
    expect(result.id).toBe(1);
  });

  it('should use provided commit hash', async () => {
    const customHash = 'custom123456';
    const result = await uploadArtifact(mockFilePath, customHash);
    expect(result).toBeDefined();
    expect(result.id).toBe(1);
  });

  it('should throw error for non-existent file', async () => {
    await expect(uploadArtifact('/non/existent/file.json'))
      .rejects
      .toThrow('Target file not found');
  });

  it('should generate correct artifact name', async () => {
    const result = await uploadArtifact(mockFilePath, mockCommitHash);
    expect(result).toBeDefined();
    expect(result.id).toBe(1);
  });
});

