import path from 'path';
import { describe, it, expect } from '@rstest/core';
import { extractProjectName } from '../index';

describe('extractProjectName', () => {
  describe('monorepo - single entry (default .rsdoctor output)', () => {
    it('should return package name only', () => {
      const filePath = path.join(process.cwd(), 'packages/adapter-rsbuild/dist/.rsdoctor/rsdoctor-data.json');
      expect(extractProjectName(filePath)).toBe('adapter-rsbuild');
    });

    it('should work with apps/ pattern', () => {
      const filePath = path.join(process.cwd(), 'apps/web/dist/.rsdoctor/rsdoctor-data.json');
      expect(extractProjectName(filePath)).toBe('web');
    });
  });

  describe('monorepo - multi entry with custom reportDir', () => {
    it('should return packageName/suffix for different entries', () => {
      const mainPath = path.join(process.cwd(), 'packages/core/dist/rsdoctor-main/rsdoctor-data.json');
      const loadersPath = path.join(process.cwd(), 'packages/core/dist/rsdoctor-loaders/rsdoctor-data.json');
      const browserPath = path.join(process.cwd(), 'packages/core/dist/rsdoctor-browser/rsdoctor-data.json');

      expect(extractProjectName(mainPath)).toBe('core/rsdoctor-main');
      expect(extractProjectName(loadersPath)).toBe('core/rsdoctor-loaders');
      expect(extractProjectName(browserPath)).toBe('core/rsdoctor-browser');
    });

    it('should work with nested custom dirs', () => {
      const filePath = path.join(process.cwd(), 'packages/vscode/dist/rsdoctor-extension/rsdoctor-data.json');
      expect(extractProjectName(filePath)).toBe('vscode/rsdoctor-extension');
    });
  });

  describe('non-monorepo', () => {
    it('should use parent directory name from fallback logic', () => {
      const filePath = path.join(process.cwd(), 'dist/rsdoctor-main/rsdoctor-data.json');
      expect(extractProjectName(filePath)).toBe('rsdoctor-main');
    });

    it('should handle default .rsdoctor output dir', () => {
      const filePath = path.join(process.cwd(), 'dist/.rsdoctor/rsdoctor-data.json');
      expect(extractProjectName(filePath)).toBe('dist');
    });
  });
});
