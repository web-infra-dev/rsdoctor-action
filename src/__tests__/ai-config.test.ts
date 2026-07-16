import { describe, expect, it } from '@rstest/core';
import { isAIAnalysisEnabled } from '../ai-config';

describe('isAIAnalysisEnabled', () => {
  it('is disabled by default', () => {
    expect(isAIAnalysisEnabled('')).toBe(false);
    expect(isAIAnalysisEnabled('false')).toBe(false);
  });

  it('is enabled only when explicitly set to true', () => {
    expect(isAIAnalysisEnabled('true')).toBe(true);
    expect(isAIAnalysisEnabled(' TRUE ')).toBe(true);
  });
});
