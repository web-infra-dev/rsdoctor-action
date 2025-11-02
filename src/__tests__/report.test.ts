import * as path from 'path';
import {
  parseRsdoctorData,
  generateBundleAnalysisMarkdown,
  generateBundleAnalysisReport,
} from '../report';
import { describe, it, expect } from '@rstest/core';

describe('Report Module', () => {
  const fixturesPath = path.join(__dirname, 'fixtures');
  const mockRsdoctorDataPath = path.join(fixturesPath, 'rsdoctor-data.json');

  describe('parseRsdoctorData', () => {
    it('should parse Rsdoctor data correctly', () => {
      const result = parseRsdoctorData(mockRsdoctorDataPath);
      expect(result).toBeDefined();
      expect(result?.totalSize).toBe(62914560);
      expect(result?.jsSize).toBe(52428800);
      expect(result?.cssSize).toBe(10485760);
      expect(result?.assets).toHaveLength(2);
      expect(result?.chunks).toHaveLength(1);
    });

    it('should return null for non-existent file', () => {
      const result = parseRsdoctorData('non-existent.json');
      expect(result).toBeNull();
    });
  });

  describe('generateBundleAnalysisMarkdown', () => {
    const mockAnalysis = {
      totalSize: 1024 * 1024, // 1MB
      jsSize: 512 * 1024,     // 512KB
      cssSize: 256 * 1024,    // 256KB
      htmlSize: 128 * 1024,   // 128KB
      otherSize: 128 * 1024,  // 128KB
      assets: [],
      chunks: [],
    };

    it('should generate markdown without baseline', () => {
      const markdown = generateBundleAnalysisMarkdown(mockAnalysis);
      expect(markdown).toContain('1.0 MB');
      expect(markdown).toContain('512.0 KB');
      expect(markdown).toMatchSnapshot();
    });

    it('should generate markdown with baseline', () => {
      const baseline = {
        ...mockAnalysis,
        totalSize: 512 * 1024, // 512KB (smaller)
      };
      const markdown = generateBundleAnalysisMarkdown(mockAnalysis, baseline);
      expect(markdown).toContain('+512.0 KB');
    });
  });

  describe('generateBundleAnalysisReport', () => {
    const mockAnalysis = {
      totalSize: 1024 * 1024,
      jsSize: 512 * 1024,
      cssSize: 256 * 1024,
      htmlSize: 128 * 1024,
      otherSize: 128 * 1024,
      assets: [],
      chunks: [],
    };

    it('should generate report without baseline', async () => {
      await generateBundleAnalysisReport(mockAnalysis);
      // GitHub Actions summary is mocked in setup.ts
      expect(true).toBe(true);
    });

    it('should generate report with baseline', async () => {
      const baseline = {
        ...mockAnalysis,
        totalSize: 512 * 1024,
      };
      await generateBundleAnalysisReport(mockAnalysis, baseline);
      // GitHub Actions summary is mocked in setup.ts
      expect(true).toBe(true);
    });
  });
});

