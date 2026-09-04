import { describe, expect, it } from 'rstack/test';
import { isAIAnalysisEnabled } from '../ai-config';

describe('isAIAnalysisEnabled', () => {
  it('is enabled by default', () => {
    expect(isAIAnalysisEnabled('')).toBe(true);
    expect(isAIAnalysisEnabled('true')).toBe(true);
    expect(isAIAnalysisEnabled(' TRUE ')).toBe(true);
  });

  it('is disabled only when explicitly set to false', () => {
    expect(isAIAnalysisEnabled('false')).toBe(false);
    expect(isAIAnalysisEnabled(' FALSE ')).toBe(false);
  });
});
