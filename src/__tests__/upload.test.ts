import * as path from 'path';
const mockFs = require('mock-fs');
import { uploadArtifact, hashPath } from '../upload';
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

  describe('hashPath', () => {
    it('should generate consistent hash for same path', () => {
      const pathParts1 = ['packages', 'app1', 'dist', '.rsdoctor'];
      const fileName1 = 'rsdoctor-data';
      const hash1 = hashPath(pathParts1, fileName1);
      
      const hash2 = hashPath(pathParts1, fileName1);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(8);
    });

    it('should generate different hash for different paths', () => {
      const pathParts1 = ['packages', 'app1', 'dist', '.rsdoctor'];
      const pathParts2 = ['packages', 'app2', 'dist', '.rsdoctor'];
      const fileName = 'rsdoctor-data';
      
      const hash1 = hashPath(pathParts1, fileName);
      const hash2 = hashPath(pathParts2, fileName);
      
      expect(hash1).not.toBe(hash2);
    });

    it('should generate different hash for different file names', () => {
      const pathParts = ['packages', 'app1', 'dist', '.rsdoctor'];
      const fileName1 = 'rsdoctor-data';
      const fileName2 = 'other-data';
      
      const hash1 = hashPath(pathParts, fileName1);
      const hash2 = hashPath(pathParts, fileName2);
      
      expect(hash1).not.toBe(hash2);
    });
  });
});

